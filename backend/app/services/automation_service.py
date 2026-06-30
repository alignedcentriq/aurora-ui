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
            "hour", "minute", "automation_kind", "extra_config",
            "email_subject", "email_body", "recipients_json", "is_active",
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


def _render_udemy_inactive(rule: AutomationRule) -> tuple[str, str, list[dict]]:
    """For a udemy_inactive rule, pull the live inactive-user list, apply filters,
    and render:
      1. A summary report email for the rule's recipients (PMO/Admin).
      2. Optionally, per-user nudge emails sent directly to the inactive learners.

    Returns (report_html, nudge_html_template, filtered_users).
    nudge_html_template contains {name} and {idle_days} placeholders.
    """
    from app.services import udemy_business_service as udemy
    from app.services.email_service import (
        _email_shell, _detail_rows, _status_pill, _note, _nl2br,
        _C_AMBER, _C_PRIMARY, _C_NO, _C_INFO,
    )
    import html as _html

    cfg = rule.extra_config or {}
    inactive_days = int(cfg.get("inactive_days") or udemy.get_inactive_default_days())
    filter_groups: list[str] = cfg.get("filter_groups") or []
    filter_users: list[str] = cfg.get("filter_users") or []
    exclude_deactivated = cfg.get("exclude_deactivated", True)

    if not udemy.configured():
        empty_html = _email_shell(
            "Udemy Inactive Seats Report",
            "<p>Udemy Business is not configured — the report could not be generated.</p>",
            "",
        )
        return empty_html, "", []

    result = udemy.get_inactive_users(
        inactive_days, include_deactivated=not exclude_deactivated
    )
    users = result.get("results") or []

    if filter_groups:
        lower_groups = {g.lower() for g in filter_groups}
        users = [
            u for u in users
            if any(g.lower() in lower_groups for g in (u.get("groups") or []))
        ]

    if filter_users:
        lower_emails = {e.lower() for e in filter_users}
        users = [u for u in users if (u.get("email") or "").lower() in lower_emails]

    total = result.get("total_learners", 0)
    today = datetime.datetime.now().strftime("%d %b %Y")
    custom_body = rule.email_body or ""

    # ── Report email (sent to recipients_json) ───────────────────────────
    intro = (
        f'<p>{_status_pill("Inactive Seats Report", _C_AMBER)}</p>'
        f"<p>{_nl2br(custom_body)}</p>" if custom_body else
        f'<p>{_status_pill("Inactive Seats Report", _C_AMBER)}</p>'
    )
    summary_rows = [
        ("Report Date", today),
        ("Idle Threshold", f"{inactive_days} days"),
        ("Total Learners", str(total)),
        ("Inactive Count", f'<strong style="color:{_C_NO};">{len(users)}</strong>'),
    ]
    if filter_groups:
        summary_rows.append(("Filtered Groups", ", ".join(filter_groups)))

    # Build the user table inline (top 50 rows — keep email size sane)
    FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
    if users:
        head_cells = "".join(
            f'<th style="padding:9px 10px;background:{_C_PRIMARY};color:#fff;font:700 11px {FONT};'
            f'text-align:left;">{h}</th>'
            for h in ["Learner", "Email", "Groups", "Last Active", "Idle Days", "Completed"]
        )
        body_rows_html = ""
        for idx, u in enumerate(users[:50]):
            bg = "#ffffff" if idx % 2 == 0 else "#f5f8fc"
            groups_str = ", ".join(u.get("groups") or []) or "—"
            last = u.get("last_active") or "Never"
            body_rows_html += (
                f'<tr>'
                f'<td style="padding:7px 10px;background:{bg};font:400 12px {FONT};color:#0d1b2e;">{_html.escape(u.get("name",""))}</td>'
                f'<td style="padding:7px 10px;background:{bg};font:400 12px {FONT};color:#475569;">{_html.escape(u.get("email",""))}</td>'
                f'<td style="padding:7px 10px;background:{bg};font:400 11px {FONT};color:#475569;">{_html.escape(groups_str)}</td>'
                f'<td style="padding:7px 10px;background:{bg};font:400 12px {FONT};color:#475569;">{_html.escape(str(last))}</td>'
                f'<td style="padding:7px 10px;background:{bg};font:700 12px {FONT};color:{_C_NO};">{u.get("idle_days",0)}</td>'
                f'<td style="padding:7px 10px;background:{bg};font:400 12px {FONT};color:#475569;">{u.get("completed_courses",0)}</td>'
                f'</tr>'
            )
        overflow = len(users) - 50
        table_html = (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;'
            f'margin:16px 0;border:1px solid #e6edf6;">'
            f'<tr>{head_cells}</tr>{body_rows_html}</table>'
        )
        if overflow > 0:
            table_html += _note(f"Showing the first 50 of {len(users)} inactive learners.")
    else:
        table_html = (
            '<div style="padding:24px;text-align:center;color:#16A34A;font-weight:700;">'
            'No inactive learners found for this threshold and filter combination.</div>'
        )

    report_body = _detail_rows(summary_rows) + table_html
    report_body += _note("Generated by Centriq AI · Udemy Business Automation")
    report_html = _email_shell("Udemy Inactive Seats Report", intro, report_body,
                               preheader=f"{len(users)} inactive seats · {inactive_days}+ days idle")

    # ── Nudge email template (sent per-user if notify_mode includes nudge) ──
    nudge_subject = cfg.get("nudge_subject") or "Your Udemy Business account needs attention"
    nudge_body_text = cfg.get("nudge_body") or (
        "We noticed you haven't visited Udemy Business in a while. "
        "Your organization provides access to thousands of courses to help you "
        "grow your skills. Inactive seats may be reclaimed for other team members."
    )
    nudge_intro = (
        f'<p>{_status_pill("Action Needed", _C_INFO)}</p>'
        f"<p>Hi {{name}},</p>"
        f"<p>{_nl2br(nudge_body_text)}</p>"
    )
    nudge_detail = _detail_rows([
        ("Last Active", "{{last_active}}"),
        ("Idle Days", "{{idle_days}}"),
    ])
    portal_url = "https://alignedautomation.udemy.com"
    nudge_detail += (
        f'<div style="text-align:center;margin:20px 0;">'
        f'<a href="{portal_url}" style="background:{_C_PRIMARY};color:#ffffff;display:inline-block;'
        f'font:600 14px {FONT};line-height:44px;height:44px;padding:0 28px;text-align:center;'
        f'text-decoration:none;border-radius:22px;box-shadow:0 2px 8px rgba(13,27,46,.20);">'
        f'Resume Learning on Udemy</a></div>'
    )
    nudge_detail += _note("This is an automated reminder from your organization. "
                          "If you believe this was sent in error, please contact PMO.")
    nudge_html = _email_shell(nudge_subject, nudge_intro, nudge_detail,
                              preheader="Your Udemy Business account has been idle")

    return report_html, nudge_html, users


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


def _fire_udemy_inactive(rule: AutomationRule, sender_email: str) -> dict:
    """Execute a udemy_inactive automation: send report + optional nudges."""
    from app.services.email_service import _send_html

    report_html, nudge_html_tpl, users = _render_udemy_inactive(rule)
    cfg = rule.extra_config or {}
    notify_mode = cfg.get("notify_mode", "report")
    nudge_subject = cfg.get("nudge_subject") or "Your Udemy Business account needs attention"

    report_emails = _extract_emails(rule.recipients_json)
    results = {"report_sent": False, "nudges_sent": 0, "nudge_failed": 0, "inactive_count": len(users)}

    if notify_mode in ("report", "both") and report_emails:
        ok = _send_html(sender_email, report_emails, rule.email_subject, report_html)
        results["report_sent"] = ok

    if notify_mode in ("nudge", "both") and users and nudge_html_tpl:
        for u in users:
            email = (u.get("email") or "").strip()
            if not email:
                continue
            personalized = nudge_html_tpl.replace("{name}", u.get("name") or "there")
            personalized = personalized.replace("{{name}}", u.get("name") or "there")
            personalized = personalized.replace("{{last_active}}", u.get("last_active") or "Never")
            personalized = personalized.replace("{{idle_days}}", str(u.get("idle_days", 0)))
            try:
                ok = _send_html(sender_email, email, nudge_subject, personalized)
                if ok:
                    results["nudges_sent"] += 1
                else:
                    results["nudge_failed"] += 1
            except Exception:
                results["nudge_failed"] += 1

    return results


def _dispatch_smart(rule: AutomationRule, sender_email: str) -> dict:
    """Route a non-custom automation_kind to the appropriate smart generator."""
    from app.services.email_service import _send_html
    from app.services import smart_generators

    kind = rule.automation_kind or "custom_email"

    if kind == "udemy_inactive":
        results = _fire_udemy_inactive(rule, sender_email)
        return {"success": True, **results}

    if kind == "roi_digest":
        emails = _extract_emails(rule.recipients_json)
        if not emails:
            return {"success": False, "error": "no_recipients"}
        html_body, files = _render_roi_digest(rule)
        ok = _send_html(sender_email, emails, rule.email_subject or "ROI Digest", html_body, files=files)
        return {"success": ok, "sent_to": emails}

    # All catalog smart types go through smart_generators
    generator = getattr(smart_generators, f"gen_{kind}", None)
    if generator:
        emails = _extract_emails(rule.recipients_json)
        if not emails:
            return {"success": False, "error": "no_recipients"}
        try:
            subject, html_body = generator(rule)
            ok = _send_html(sender_email, emails, subject, html_body)
            return {"success": ok, "sent_to": emails}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    # Fallback: plain custom email
    emails = _extract_emails(rule.recipients_json)
    if not emails:
        return {"success": False, "error": "no_recipients"}
    html_body = _build_html(rule.email_subject or rule.name, rule.email_body or "")
    ok = _send_html(sender_email, emails, rule.email_subject or rule.name, html_body)
    return {"success": ok, "sent_to": emails}


def send_now(rule_id: int, sender_email: str, user_role: str) -> dict:
    """Send an automation email immediately (test / on-demand).
    Only creator or Super Admin may trigger this."""
    db = SessionLocal()
    try:
        rule = db.query(AutomationRule).filter(AutomationRule.id == rule_id).first()
        if not rule:
            return {"success": False, "error": "not_found"}
        if not _can_manage(rule, sender_email, user_role):
            return {"success": False, "error": "forbidden"}
        return _dispatch_smart(rule, sender_email)
    finally:
        db.close()


# ── Scheduler ─────────────────────────────────────────────────────────────────

def run_due() -> int:
    """Fire all active rules whose next_run <= now. Called every 60 s from main.py."""
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
                res = _dispatch_smart(rule, rule.created_by)
                if res.get("success"):
                    sent_to = res.get("sent_to") or []
                    nudges = res.get("nudges_sent", 0)
                    inactive = res.get("inactive_count", 0)
                    if nudges or inactive:
                        rule.last_status = (
                            f"sent:report={'yes' if res.get('report_sent') else 'no'}"
                            f",nudges={nudges},inactive={inactive}"
                        )
                    else:
                        rule.last_status = f"sent:{len(sent_to)}_recipients"
                else:
                    rule.last_status = f"failed:{res.get('error','unknown')}"
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
