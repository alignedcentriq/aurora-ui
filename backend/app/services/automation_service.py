"""
Email Automation Hub service.

Provides CRUD for AutomationRule rows and a run_due() function called every
60 s from the startup scheduler (see main.py).  Each active rule whose
next_run <= now is fired: the creator's Microsoft delegated token is used to
send the email from their mailbox.
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
) -> datetime.datetime:
    """Return the next UTC-naïve datetime this cadence should fire."""
    now = (after or datetime.datetime.now()).replace(minute=0, second=0, microsecond=0)

    if frequency == "daily":
        candidate = now.replace(hour=hour)
        if candidate <= (after or datetime.datetime.now()):
            candidate += datetime.timedelta(days=1)
        # Skip weekends for daily automations
        while candidate.weekday() >= 5:
            candidate += datetime.timedelta(days=1)
        return candidate

    elif frequency == "weekly":
        dow = day_of_week if day_of_week is not None else 0
        days_ahead = (dow - now.weekday()) % 7
        candidate = (now + datetime.timedelta(days=days_ahead)).replace(hour=hour)
        if candidate <= (after or datetime.datetime.now()):
            candidate += datetime.timedelta(weeks=1)
        return candidate

    elif frequency == "monthly":
        dom = min(day_of_month or 1, 28)
        try:
            candidate = now.replace(day=dom, hour=hour)
        except ValueError:
            candidate = now.replace(day=28, hour=hour)
        if candidate <= (after or datetime.datetime.now()):
            month = now.month % 12 + 1
            year = now.year + (1 if now.month == 12 else 0)
            try:
                candidate = candidate.replace(year=year, month=month)
            except ValueError:
                candidate = candidate.replace(year=year, month=month, day=28)
        return candidate

    else:  # custom — treat as daily
        return compute_next_run("daily", None, None, hour, after)


# ── CRUD ───────────────────────────────────────────────────────────────────────

def list_rules(user_email: str, user_role: str) -> list[dict]:
    db = SessionLocal()
    try:
        q = db.query(AutomationRule)
        if user_role.lower() != "super admin":
            q = q.filter(AutomationRule.created_by == user_email)
        rules = q.order_by(AutomationRule.created_at.desc()).all()
        return [_rule_dict(r) for r in rules]
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
            email_subject=payload["email_subject"],
            email_body=payload["email_body"],
            recipients_json=payload.get("recipients_json") or [],
            is_active=True,
        )
        rule.next_run = compute_next_run(
            rule.frequency, rule.day_of_week, rule.day_of_month, rule.hour
        )
        db.add(rule)
        db.commit()
        db.refresh(rule)
        return {"success": True, "rule": _rule_dict(rule)}
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
        if rule.created_by != user_email and user_role.lower() != "super admin":
            return {"success": False, "error": "forbidden"}

        timing_fields = {"frequency", "day_of_week", "day_of_month", "hour"}
        changed_timing = False
        for field in [
            "name", "description", "frequency", "day_of_week", "day_of_month",
            "hour", "email_subject", "email_body", "recipients_json", "is_active",
        ]:
            if field in payload:
                setattr(rule, field, payload[field])
                if field in timing_fields:
                    changed_timing = True

        if changed_timing:
            rule.next_run = compute_next_run(
                rule.frequency, rule.day_of_week, rule.day_of_month, rule.hour
            )

        db.commit()
        db.refresh(rule)
        return {"success": True, "rule": _rule_dict(rule)}
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
        if rule.created_by != user_email and user_role.lower() != "super admin":
            return {"success": False, "error": "forbidden"}
        db.delete(rule)
        db.commit()
        return {"success": True}
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


def send_now(rule_id: int, sender_email: str) -> dict:
    """Send an automation email immediately (test / on-demand)."""
    from app.services.email_service import _send_html
    db = SessionLocal()
    try:
        rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
        if not rule:
            return {"success": False, "error": "not_found"}
        emails = _extract_emails(rule.recipients_json)
        if not emails:
            return {"success": False, "error": "no_recipients"}
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
                )
                fired += 1

        if due:
            db.commit()
        return fired
    except Exception as exc:
        print(f"[automation_hub] run_due error: {exc}")
        return 0
    finally:
        db.close()


# ── Serialisation ──────────────────────────────────────────────────────────────

def _rule_dict(r: AutomationRule) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "description": r.description,
        "created_by": r.created_by,
        "created_by_role": r.created_by_role,
        "frequency": r.frequency,
        "day_of_week": r.day_of_week,
        "day_of_month": r.day_of_month,
        "hour": r.hour,
        "email_subject": r.email_subject,
        "email_body": r.email_body,
        "recipients_json": r.recipients_json or [],
        "is_active": r.is_active,
        "next_run": r.next_run.isoformat() if r.next_run else None,
        "last_run": r.last_run.isoformat() if r.last_run else None,
        "last_status": r.last_status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
