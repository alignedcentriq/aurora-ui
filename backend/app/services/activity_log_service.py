"""Org-wide admin/system activity ledger (roadmap: Activity bell + Audit Trail).

Every confirmed admin/system state change (role grants, role/capability definition
changes, automation CRUD + system-triggered fires, settings changes) is recorded here
via emit(). Two read paths sit on top of the same table:
  - list_feed()  -> header Activity bell: last 30 days, short form. Admin + Super Admin.
  - list_audit() -> Control Hub Audit Trail: unbounded, full detail incl. old/new values.
    Super Admin only.

Explicitly out of scope: chat/prompt interactions (AI Observability owns those).

emit() mirrors receipt_service.emit()'s contract: opens its own SessionLocal(), commits,
and NEVER RAISES — a logging failure can never break the real action it's recording.

"High" severity (currently: role assign/change/revoke) triggers a best-effort
notification to every OTHER Super Admin (never the actor themselves) via email +
Teams Activity-feed ping, reusing email_service's existing notification plumbing.
"""

from __future__ import annotations

import datetime
import logging
import math
from typing import Optional

from app.database import SessionLocal
from app.models import ActivityLogEntry, UserRoleOverride, MS365User, Employee

log = logging.getLogger("aurora-logger")

_SYSTEM_ACTOR_LABELS = {
    "system@centriq.ai": "Automation Scheduler",
}


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


def resolve_display_name(db, email: str) -> str:
    """MS365User.name -> Employee.name -> email local-part, title-cased.
    Mirrors the ad-hoc lookup access_routes.list_users_with_access() already does inline."""
    if not email:
        return "Someone"
    if email in _SYSTEM_ACTOR_LABELS:
        return _SYSTEM_ACTOR_LABELS[email]
    try:
        ms = db.query(MS365User).filter(MS365User.email == email).first()
        if ms and ms.name:
            return ms.name
        emp = db.query(Employee).filter(Employee.email == email).first()
        if emp and emp.name:
            return emp.name
    except Exception:
        pass
    local = email.split("@")[0].replace(".", " ").replace("_", " ")
    return local.title() if local else email


def _to_dict(r: ActivityLogEntry, *, full: bool) -> dict:
    d = {
        "id": r.id,
        "actor_email": r.actor_email,
        "actor_name": r.actor_name,
        "category": r.category,
        "action_type": r.action_type,
        "severity": r.severity,
        "target_type": r.target_type,
        "target_id": r.target_id,
        "target_name": r.target_name,
        "summary": r.summary,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
    if full:
        d["old_value"] = r.old_value
        d["new_value"] = r.new_value
    return d


# ── Emit ─────────────────────────────────────────────────────────────────────

def emit(
    actor_email: str,
    category: str,
    action_type: str,
    summary: str,
    *,
    severity: str = "normal",
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    target_name: Optional[str] = None,
    old_value: Optional[dict] = None,
    new_value: Optional[dict] = None,
    meta: Optional[dict] = None,
) -> Optional[dict]:
    """Record one activity event. `summary` may contain an "{actor}" placeholder,
    substituted with the resolved actor display name (saves call sites from opening
    their own session just to build the summary string). Never raises — on any
    failure, logs and returns None so a logging failure can never break the action
    being recorded."""
    db = SessionLocal()
    try:
        actor_email = (actor_email or "").strip().lower()
        actor_name = resolve_display_name(db, actor_email)
        if "{actor}" in summary:
            summary = summary.format(actor=actor_name)
        row = ActivityLogEntry(
            actor_email=actor_email,
            actor_name=actor_name,
            category=category,
            action_type=action_type,
            severity=severity,
            target_type=target_type,
            target_id=target_id,
            target_name=target_name,
            summary=summary,
            old_value=old_value,
            new_value=new_value,
            entry_metadata=meta or None,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        result = _to_dict(row, full=True)
        if severity == "high":
            try:
                _notify_other_super_admins(db, actor_email, row)
            except Exception as exc:
                log.warning("[activity] high-severity notify failed for entry %s: %s", row.id, exc)
        return result
    except Exception as exc:
        db.rollback()
        log.warning("[activity] emit failed (%s/%s): %s", category, action_type, exc)
        return None
    finally:
        db.close()


def _notify_other_super_admins(db, actor_email: str, entry: ActivityLogEntry) -> None:
    """Best-effort email + Teams Activity-feed ping to every Super Admin EXCEPT the actor.
    Super Admin is DB-override-only (auth.py never grants it via header), so this query is
    the authoritative "all current Super Admins" list."""
    from app.services.email_service import notify_admin_activity_alert

    recipients = [
        o.email for o in db.query(UserRoleOverride)
        .filter(UserRoleOverride.role == "super admin")
        .all()
        if (o.email or "").strip().lower() != actor_email
    ]
    if not recipients:
        return

    subject = f"Centriq AI — {entry.summary}"
    body_html = (
        f"<p><b>{entry.actor_name or entry.actor_email}</b> just made a high-severity "
        f"change in Access Management:</p>"
        f"<p style='font-size:15px;'>{entry.summary}</p>"
        f"<p style='color:#6b7280;font-size:12px;'>Review it in Control Hub &rarr; Audit Trail.</p>"
    )
    notify_admin_activity_alert(actor_email, recipients, subject, body_html)


# ── Queries ──────────────────────────────────────────────────────────────────

def list_feed(limit: int = 100) -> list[dict]:
    """Org-wide, last 30 days, newest first, short form (no old/new value)."""
    db = SessionLocal()
    try:
        cutoff = _now() - datetime.timedelta(days=30)
        rows = (
            db.query(ActivityLogEntry)
            .filter(ActivityLogEntry.created_at >= cutoff)
            .order_by(ActivityLogEntry.created_at.desc())
            .limit(limit)
            .all()
        )
        return [_to_dict(r, full=False) for r in rows]
    finally:
        db.close()


def list_audit(
    page: int = 1,
    limit: int = 50,
    category: Optional[str] = None,
    actor_email: Optional[str] = None,
    severity: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> dict:
    """Unbounded, full detail (incl. old/new value), filterable + paginated."""
    db = SessionLocal()
    try:
        q = db.query(ActivityLogEntry)
        if category:
            q = q.filter(ActivityLogEntry.category == category)
        if severity:
            q = q.filter(ActivityLogEntry.severity == severity)
        if actor_email:
            q = q.filter(ActivityLogEntry.actor_email.ilike(f"%{actor_email.lower()}%"))
        if from_date:
            try:
                q = q.filter(ActivityLogEntry.created_at >= datetime.datetime.fromisoformat(from_date))
            except ValueError:
                pass
        if to_date:
            try:
                end = datetime.datetime.fromisoformat(to_date) + datetime.timedelta(days=1)
                q = q.filter(ActivityLogEntry.created_at < end)
            except ValueError:
                pass

        total = q.count()
        limit = max(1, min(limit, 200))
        page = max(1, page)
        rows = (
            q.order_by(ActivityLogEntry.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
            .all()
        )
        return {
            "entries": [_to_dict(r, full=True) for r in rows],
            "total": total,
            "page": page,
            "pages": max(1, math.ceil(total / limit)),
        }
    finally:
        db.close()
