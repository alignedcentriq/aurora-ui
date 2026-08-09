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
"""

from __future__ import annotations

import datetime
import logging
import math
from typing import Optional

from app.database import SessionLocal
from app.models import ActivityLogEntry, MS365User, Employee

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
        return result
    except Exception as exc:
        db.rollback()
        log.warning("[activity] emit failed (%s/%s): %s", category, action_type, exc)
        return None
    finally:
        db.close()


# ── Queries ──────────────────────────────────────────────────────────────────

def list_feed(limit: int = 100) -> list[dict]:
    """Org-wide, last 30 days, newest first, short form (no old/new value).
    Excludes "login" — that's Super-Admin-only via list_audit(), never the bell."""
    db = SessionLocal()
    try:
        cutoff = _now() - datetime.timedelta(days=30)
        rows = (
            db.query(ActivityLogEntry)
            .filter(ActivityLogEntry.created_at >= cutoff, ActivityLogEntry.category != "login")
            .order_by(ActivityLogEntry.created_at.desc())
            .limit(limit)
            .all()
        )
        return [_to_dict(r, full=False) for r in rows]
    finally:
        db.close()


_LOGIN_DEDUPE_MINUTES = 30


def emit_login(actor_email: str) -> None:
    """Record a login. Super-Admin-only visibility (list_audit), never the bell feed,
    never a notification — severity stays "low" so _notify_other_super_admins never fires.
    Deduped: skips if this email already logged in within the last 30 minutes, so a
    silent MSAL token refresh doesn't spam the trail with one row per page load."""
    actor_email = (actor_email or "").strip().lower()
    if not actor_email:
        return
    db = SessionLocal()
    try:
        cutoff = _now() - datetime.timedelta(minutes=_LOGIN_DEDUPE_MINUTES)
        recent = (
            db.query(ActivityLogEntry)
            .filter(
                ActivityLogEntry.actor_email == actor_email,
                ActivityLogEntry.category == "login",
                ActivityLogEntry.created_at >= cutoff,
            )
            .first()
        )
        if recent:
            return
    except Exception as exc:
        log.warning("[activity] login dedupe check failed for %s: %s", actor_email, exc)
    finally:
        db.close()
    emit(actor_email, "login", "user_login", "{actor} logged in", severity="low")


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
