"""
Email Automation Hub service.

Provides CRUD for AutomationRule rows and a run_due() function called every
60 s from the startup scheduler (see main.py).  Each active rule whose
next_run <= now is fired: the creator's Microsoft delegated token is used to
send the email from their mailbox.

Access model:
  - Creator: full CRUD + co-owner management
  - Super Admin: full CRUD on all rules + co-owner management
  - Co-owner: list/view only (cannot edit/delete/toggle/send-now/create)
"""

from __future__ import annotations

import datetime
import html
from typing import Optional

from app.database import SessionLocal
from app.models import AutomationRule


# ── Scheduling math ────────────────────────────────────────────────────────────

def compute_next_run(
    frequency: str,
    day_of_week: Optional[int],
    day_of_month: Optional[int],
    hour: int,
    after: Optional[datetime.datetime] = None,
    minute: int = 0,
) -> datetime.datetime:
    """Return the next UTC-naïve datetime this cadence should fire."""
    minute = max(0, min(59, int(minute or 0)))
    now = (after or datetime.datetime.now()).replace(second=0, microsecond=0)

    if frequency == "daily":
        candidate = now.replace(hour=hour, minute=minute)
        if candidate <= (after or datetime.datetime.now()):
            candidate += datetime.timedelta(days=1)
        # Skip weekends for daily automations
        while candidate.weekday() >= 5:
            candidate += datetime.timedelta(days=1)
        return candidate

    elif frequency == "weekly":
        dow = day_of_week if day_of_week is not None else 0
        days_ahead = (dow - now.weekday()) % 7
        candidate = (now + datetime.timedelta(days=days_ahead)).replace(hour=hour, minute=minute)
        if candidate <= (after or datetime.datetime.now()):
            candidate += datetime.timedelta(weeks=1)
        return candidate

    elif frequency == "monthly":
        dom = min(day_of_month or 1, 28)
        try:
            candidate = now.replace(day=dom, hour=hour, minute=minute)
        except ValueError:
            candidate = now.replace(day=28, hour=hour, minute=minute)
        if candidate <= (after or datetime.datetime.now()):
            month = now.month % 12 + 1
            year = now.year + (1 if now.month == 12 else 0)
            try:
                candidate = candidate.replace(year=year, month=month)
            except ValueError:
                candidate = candidate.replace(year=year, month=month, day=28)
        return candidate

    else:  # custom — treat as daily
        return compute_next_run("daily", None, None, hour, after, minute)


# ── Permission helpers ─────────────────────────────────────────────────────────

def _can_manage(rule: AutomationRule, user_email: str, user_role: str) -> bool:
    """True if the user may edit/delete/toggle/send-now this rule."""
    return rule.created_by == user_email or user_role.lower() == "super admin"


def _is_co_owner(rule: AutomationRule, user_email: str) -> bool:
    return user_email.lower() in [e.lower() for e in (rule.co_owners_json or [])]


# ── CRUD ───────────────────────────────────────────────────────────────────────

def list_rules(user_email: str, user_role: str) -> list[dict]:
    db = SessionLocal()
    try:
        q = db.query(AutomationRule)
        if user_role.lower() != "super admin":
            rules = q.order_by(AutomationRule.created_at.desc()).all()
            # Show own rules + rules where user is co-owner
            rules = [
                r for r in rules
                if r.created_by == user_email or _is_co_owner(r, user_email)
            ]
            return [_rule_dict(r, user_email, user_role) for r in rules]
        rules = q.order_by(AutomationRule.created_at.desc()).all()
        return [_rule_dict(r, user_email, user_role) for r in rules]
    finally:
        db.close()


def create(user_email: str, user_role: str, payload: dict) -> dict:
    db = SessionLocal()
    try:
        rule = AutomationRule(
            name=payload["name"],
            description=payload.get("description") or "",
            created_by=user_email,
            created_by_role=user_role,
            frequency=payload["frequency"],
            day_of_week=payload.get("day_of_week"),
            day_of_month=payload.get("day_of_month"),
            hour=int(payload.get("hour") or 9),
            minute=int(payload.get("minute") or 0),
            automation_kind=payload.get("automation_kind") or "email",
            extra_config=payload.get("extra_config"),
            email_subject=payload["email_subject"],
            email_body=payload["email_body"],
            recipients_json=payload.get("recipients_json") or [],
            co_owners_json=[],
            # Default on for plain email rules; roi_digest rules ship OFF until the user enables.
            is_active=bool(payload["is_active"]) if "is_active" in payload else True,
        )
        rule.next_run = compute_next_run(
            rule.frequency, rule.day_of_week, rule.day_of_month, rule.hour,
            minute=rule.minute,
        )
        db.add(rule)
        db.commit()
        db.refresh(rule)
        return {"success": True, "rule": _rule_dict(rule, user_email, user_role)}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}
    finally:
        db.close()


def update(user_email: str, user_role: str, rule_id: int, payload: dict) -> dict:
    db = SessionLocal()
    try:
        rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
        if not rule:
            return {"success": False, "error": "not_found"}
        if not _can_manage(rule, user_email, user_role):
            return {"success": False, "error": "forbidden"}

        timing_fields = {"frequency", "day_of_week", "day_of_month", "hour", "minute"}
        changed_timing = False
        for field in [
            "name", "description", "frequency", "day_of_week", "day_of_month",
            "hour", "minute", "email_subject", "email_body", "recipients_json", "is_active",
        ]:
            if field in payload:
                setattr(rule, field, payload[field])
                if field in timing_fields:
                    changed_timing = True

        if changed_timing:
            rule.next_run = compute_next_run(
                rule.frequency, rule.day_of_week, rule.day_of_month, rule.hour,
                minute=rule.minute,
            )

        db.commit()
        db.refresh(rule)
        return {"success": True, "rule": _rule_dict(rule, user_email, user_role)}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}
    finally:
        db.close()


def delete(user_email: str, user_role: str, rule_id: int) -> dict:
    db = SessionLocal()
    try:
        rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
        if not rule:
            return {"success": False, "error": "not_found"}
        if not _can_manage(rule, user_email, user_role):
            return {"success": False, "error": "forbidden"}
        db.delete(rule)
        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}
    finally:
        db.close()


# ── Co-owner management ────────────────────────────────────────────────────────

def update_co_owners(
    user_email: str,
    user_role: str,
    rule_id: int,
    action: str,       # "add" | "remove"
    co_owner_email: str,
) -> dict:
    """Add or remove a co-owner. Only creator or Super Admin may call this."""
    db = SessionLocal()
    try:
        rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
        if not rule:
            return {"success": False, "error": "not_found"}
        if not _can_manage(rule, user_email, user_role):
            return {"success": False, "error": "forbidden"}

        current: list[str] = list(rule.co_owners_json or [])
        target = co_owner_email.lower().strip()

        if action == "add":
            if target == rule.created_by.lower():
                return {"success": False, "error": "creator_cannot_be_coowner"}
            if target not in [e.lower() for e in current]:
                current.append(co_owner_email.strip())
        elif action == "remove":
            current = [e for e in current if e.lower() != target]
        else:
            return {"success": False, "error": "invalid_action"}

        rule.co_owners_json = current
        db.commit()
        db.refresh(rule)
        return {"success": True, "rule": _rule_dict(rule, user_email, user_role)}
    except Exception as e:
        db.rollback()
        return {"success": False, "error": str(e)}
    finally:
        db.close()


# ── Email delivery ─────────────────────────────────────────────────────────────

def _extract_emails(recipients_json: list) -> list[str]:
    """Flatten recipient list to individual email addresses."""
    emails: list[str] = []
    for r in recipients_json or []:
        if r.get("type") == "individual" and r.get("email"):
            emails.append(r["email"].strip())
        elif r.get("type") == "teams_group":
            for e in r.get("emails") or []:
                if e:
                    emails.append(e.strip())
    # Deduplicate preserving order
    seen: set[str] = set()
    result: list[str] = []
    for e in emails:
        el = e.lower()
        if el not in seen:
            seen.add(el)
            result.append(e)
    return result


def _build_html(subject: str, body_text: str) -> str:
    """Wrap plain-text body in the branded Gradient Hero email template."""
    from app.services.email_service import _email_shell, _nl2br
    intro = f"<p style='margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;'>{_nl2br(body_text)}</p>"
    return _email_shell(subject, intro, "")


def _render_roi_digest(rule: AutomationRule) -> tuple[str, dict | None]:
    """For a roi_digest rule, compute the live ROI summary and return (html_body, files).

    files is the {filename: (base64, content_type)} attachment dict for _send_html, or None.
    The summary is computed for the rule creator's role so scoping matches the dashboard."""
    import base64
    from app.database import SessionLocal as _SL
    from app.services import analytics_service as _an

    period = (rule.extra_config or {}).get("period", "30d")
    db = _SL()
    try:
        summary = _an.roi_summary(db, period=period, role=rule.created_by_role or "super admin")
    finally:
        db.close()

    cur = summary.get("currency", "INR")
    sym = "₹" if cur == "INR" else "$"
    sat = summary.get("satisfaction_pct")
    lines = [
        rule.email_body or "",
        "",
        f"Period: {period}",
        f"Hours saved: {summary.get('hours_saved', 0):,}",
        f"Estimated value: {sym}{summary.get('value_saved', 0):,.0f}",
        f"Infra cost (period): {sym}{summary.get('infra_cost', 0):,.0f}",
        f"Net value: {sym}{summary.get('net_value', 0):,.0f}",
        f"Requests handled (deflected): {summary.get('requests_handled', 0):,}",
        f"Satisfaction: {sat}%" if sat is not None else "Satisfaction: —",
    ]
    html_body = _build_html(rule.email_subject, "\n".join(lines))

    files = None
    try:
        pdf = _an.roi_pdf_bytes(summary)
        b64 = base64.b64encode(pdf).decode("ascii")
        files = {f"roi-summary-{period}.pdf": (b64, "application/pdf")}
    except Exception:
        files = None  # email still sends without the attachment
    return html_body, files


def send_now(rule_id: int, sender_email: str, user_role: str) -> dict:
    """Send an automation email immediately (test / on-demand).
    Only creator or Super Admin may trigger this."""
    from app.services.email_service import _send_html
    db = SessionLocal()
    try:
        rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
        if not rule:
            return {"success": False, "error": "not_found"}
        if not _can_manage(rule, sender_email, user_role):
            return {"success": False, "error": "forbidden"}
        emails = _extract_emails(rule.recipients_json)
        if not emails:
            return {"success": False, "error": "no_recipients"}
        if rule.automation_kind == "roi_digest":
            html_body, files = _render_roi_digest(rule)
            ok = _send_html(sender_email, emails, rule.email_subject, html_body, files=files)
        else:
            html_body = _build_html(rule.email_subject, rule.email_body)
            ok = _send_html(sender_email, emails, rule.email_subject, html_body)
        return {"success": ok, "sent_to": emails}
    finally:
        db.close()


# ── Scheduler ─────────────────────────────────────────────────────────────────

def run_due() -> int:
    """Fire all active rules whose next_run <= now. Called every 60 s from main.py."""
    from app.services.email_service import _send_html
    now = datetime.datetime.now()
    db = SessionLocal()
    try:
        due = (
            db.query(AutomationRule)
            .filter(
                AutomationRule.is_active.is_(True),
                AutomationRule.next_run.isnot(None),
                AutomationRule.next_run <= now,
            )
            .all()
        )

        fired = 0
        for rule in due:
            try:
                emails = _extract_emails(rule.recipients_json)
                if emails:
                    if rule.automation_kind == "roi_digest":
                        html_body, files = _render_roi_digest(rule)
                        ok = _send_html(rule.created_by, emails, rule.email_subject, html_body, files=files)
                    else:
                        html_body = _build_html(rule.email_subject, rule.email_body)
                        ok = _send_html(rule.created_by, emails, rule.email_subject, html_body)
                    rule.last_status = "sent" if ok else "failed:send_error"
                else:
                    rule.last_status = "failed:no_recipients"
            except Exception as exc:
                rule.last_status = f"failed:{str(exc)[:120]}"
            finally:
                rule.last_run = now
                # Always advance next_run — even on failure — to prevent hot-looping.
                rule.next_run = compute_next_run(
                    rule.frequency, rule.day_of_week, rule.day_of_month, rule.hour,
                    after=now + datetime.timedelta(minutes=1),
                    minute=rule.minute or 0,
                )
                fired += 1

        if due:
            db.commit()
        return fired
    except Exception as exc:
        return 0
    finally:
        db.close()


# ── Serialisation ──────────────────────────────────────────────────────────────

def _rule_dict(r: AutomationRule, user_email: str = "", user_role: str = "") -> dict:
    can_manage = _can_manage(r, user_email, user_role) if user_email else False
    return {
        "id": r.id,
        "name": r.name,
        "description": r.description,
        "created_by": r.created_by,
        "created_by_role": r.created_by_role,
        "automation_kind": r.automation_kind or "email",
        "extra_config": r.extra_config or {},
        "frequency": r.frequency,
        "day_of_week": r.day_of_week,
        "day_of_month": r.day_of_month,
        "hour": r.hour,
        "minute": r.minute or 0,
        "email_subject": r.email_subject,
        "email_body": r.email_body,
        "recipients_json": r.recipients_json or [],
        "co_owners_json": r.co_owners_json or [],
        "is_active": r.is_active,
        "next_run": r.next_run.isoformat() if r.next_run else None,
        "last_run": r.last_run.isoformat() if r.last_run else None,
        "last_status": r.last_status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "can_manage": can_manage,
    }
