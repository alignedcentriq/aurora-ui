"""
Welcome email service for new employees.

Flow (default — 'auto' mode):
1. A new employee is deliberately added (Add Employee form or bulk import, see
   PeopleService.add_employee / PeopleService.import_employees) → kickoff_new_hire()
2. The welcome email is sent immediately, no HR click required. HR gets a non-blocking
   FYI email confirming it was sent (or that it failed and needs a manual resend).
3. HR can review, edit resources, and resend any time from the HR Portal welcome logs tab.

Legacy flow (opt-in via the 'welcome_email_mode' company setting = 'review'):
1. kickoff_new_hire() calls notify_hr_new_employee() instead of sending immediately.
2. HR receives an email with Yes / No one-click buttons (token-authenticated).
3. HR clicks Yes → send_welcome_email() fires a branded resource email to the new employee.
"""

import datetime
import logging
import secrets
import threading

from app.config import settings

logger = logging.getLogger("aurora-logger")


def notify_hr_new_employee(emp_email: str, emp_name: str, db, initiated_by: str = "system") -> None:
    """Create a WelcomeLog and email HR a Yes/No confirmation (non-blocking)."""
    from app.models import WelcomeLog

    # Idempotent — one notification per employee
    if db.query(WelcomeLog).filter(WelcomeLog.employee_email == emp_email).first():
        return

    send_token = secrets.token_urlsafe(48)[:64]
    skip_token = secrets.token_urlsafe(48)[:64]

    log = WelcomeLog(
        employee_email=emp_email,
        employee_name=emp_name,
        send_token=send_token,
        skip_token=skip_token,
        status="pending_hr",
        initiated_by=initiated_by,
    )
    db.add(log)
    db.commit()

    threading.Thread(
        target=_send_hr_notification,
        args=(emp_email, emp_name, send_token, skip_token),
        daemon=True,
    ).start()
    logger.info("[welcome] HR notification queued for new employee: %s", emp_email)


def _send_hr_notification(emp_email: str, emp_name: str, send_token: str, skip_token: str) -> None:
    try:
        import html as html_mod
        from app.services.email_service import _send_html, _email_shell, _detail_rows, _button_row

        hr_email = settings.NOTIFY_TO_EMAIL
        if not hr_email:
            logger.warning("[welcome] NOTIFY_TO_EMAIL not set — skipping HR notification.")
            return

        base_url = getattr(settings, "APP_BASE_URL", "http://localhost:8080").rstrip("/")
        send_url = f"{base_url}/api/welcome/confirm/{send_token}"
        skip_url = f"{base_url}/api/welcome/confirm/{skip_token}"

        intro = (
            f"<p>A new team member has just joined the organization.</p>"
            f"<p>Would you like to send <strong>{html_mod.escape(emp_name)}</strong> "
            f"a welcome email with all the resources and guides they need to get started?</p>"
        )
        body = (
            _detail_rows([
                ("Name", html_mod.escape(emp_name)),
                ("Email", html_mod.escape(emp_email)),
                ("Joined", datetime.date.today().strftime("%d %B %Y")),
            ])
            + _button_row([
                ("Yes, Send Welcome", send_url, "#16A34A"),
                ("No, Skip", skip_url, "#6B7280"),
            ])
        )
        html_body = _email_shell(
            "New Employee Onboarding",
            intro,
            body,
            preheader=f"{emp_name} just joined — send them a welcome package?",
        )
        _send_html(hr_email, hr_email, f"{emp_name} just joined — Send welcome email?", html_body)
        logger.info("[welcome] HR notification sent for %s", emp_email)
    except Exception as e:
        logger.error("[welcome] HR notification failed for %s: %s", emp_email, e)


_DEFAULT_WELCOME_MESSAGE = (
    "Welcome to the team, {name}! 🎉\n\n"
    "We're thrilled to have you on board as our new {designation} in {department}. "
    "Below are the tools and resources available to you through Centriq AI — your "
    "digital workplace assistant. Just open the app and ask anything!"
)

_DEFAULT_WELCOME_SUBJECT = "Welcome to the team, {name}!"

_CAT_COLORS = {
    "App Guide":  "#1B6FC8",
    "HR":         "#16A34A",
    "Policy":     "#D97706",
    "IT":         "#0D9488",
    "Admin":      "#7c3aed",
    "Facilities": "#db2777",
    "General":    "#64748b",
}


def _build_intro_html(emp_name: str, department: str = "", designation: str = "",
                       joining_date_label: str = "", manager_name: str = "") -> str:
    """Build the intro HTML for the welcome email.
    Uses HR-customised text from company settings if set, otherwise falls back to default.
    Supports {name}, {department}, {designation}, {joining_date}, {manager_name} placeholders.
    Double newlines become paragraph breaks; single newlines become <br>.
    """
    import html as html_mod
    from app.services.company_settings_service import CompanySettingsService

    raw = CompanySettingsService.get("welcome_email_intro") or _DEFAULT_WELCOME_MESSAGE
    text = raw.replace("{name}", f"<strong>{html_mod.escape(emp_name)}</strong>")
    text = text.replace("{department}", html_mod.escape(department) or "your team")
    text = text.replace("{designation}", html_mod.escape(designation) or "your role")
    text = text.replace("{joining_date}", html_mod.escape(joining_date_label) or "your joining date")
    text = text.replace("{manager_name}", html_mod.escape(manager_name) or "your manager")
    # Split on double newlines → paragraphs; single newlines → <br>
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    return "".join(f"<p>{p.replace(chr(10), '<br>')}</p>" for p in paragraphs)


def _render_subject(emp_name: str) -> str:
    """HR-customisable subject line. Supports {name}; falls back to the default template."""
    from app.services.company_settings_service import CompanySettingsService

    tmpl = CompanySettingsService.get("welcome_email_subject") or _DEFAULT_WELCOME_SUBJECT
    return tmpl.replace("{name}", emp_name) if "{name}" in tmpl else tmpl


def _resolve_employee_context(emp_email: str, db) -> dict:
    """Best-effort lookup of real department/designation/joining_date/manager_name for a
    hire, used as welcome-email placeholder values. Missing data resolves to ''."""
    from app.models import Employee, ManagerCallInvite

    department = designation = joining_date_label = manager_name = ""
    emp = db.query(Employee).filter(Employee.email == emp_email).first()
    if emp:
        department = emp.department or ""
        designation = emp.designation or ""
        if emp.joining_date:
            joining_date_label = emp.joining_date.strftime("%d %B %Y")
    inv = db.query(ManagerCallInvite).filter(ManagerCallInvite.new_hire_email == emp_email).first()
    if inv:
        manager_name = inv.manager_name or ""
    return {
        "department": department,
        "designation": designation,
        "joining_date_label": joining_date_label,
        "manager_name": manager_name,
    }


def _build_welcome_email(emp_name: str, department: str, designation: str,
                         joining_date_label: str, manager_name: str, db) -> tuple[str, str, list[dict]]:
    """Build (subject, html_body, resources_sent_snapshot) for the new-hire welcome email.
    Shared by send_welcome_email() and the HR preview endpoint — a real send and a preview
    differ only in where the placeholder values come from (real employee vs. sample data)."""
    import html as html_mod
    from app.services.email_service import _email_shell, _section
    from app.models import WelcomeResource

    resources = (
        db.query(WelcomeResource)
        .filter(WelcomeResource.is_active == True)
        .order_by(WelcomeResource.sort_order, WelcomeResource.id)
        .all()
    )

    by_category: dict[str, list] = {}
    for r in resources:
        cat = r.category or "General"
        by_category.setdefault(cat, []).append(r)

    sections_html = ""
    for cat, items in by_category.items():
        color = _CAT_COLORS.get(cat, "#64748b")
        items_html = ""
        for r in items:
            name_html = html_mod.escape(r.name)
            if r.url:
                name_html = (
                    f'<a href="{html_mod.escape(r.url)}" '
                    f'style="color:#1B6FC8;text-decoration:none;">{name_html}</a>'
                )
            desc = f" — {html_mod.escape(r.description)}" if r.description else ""
            icon = r.icon or "•"
            items_html += f"<li>{icon} <strong>{name_html}</strong>{desc}</li>"
        sections_html += _section(cat, color, items_html)

    intro = _build_intro_html(emp_name, department, designation, joining_date_label, manager_name)
    subject = _render_subject(emp_name)
    html_body = _email_shell(
        "Welcome to the Team!",
        intro,
        sections_html,
        preheader=f"Welcome {emp_name}! Here are your workplace resources.",
    )
    sent_snapshot = [{"name": r.name, "category": r.category, "url": r.url} for r in resources]
    return subject, html_body, sent_snapshot


def send_welcome_email(emp_email: str, emp_name: str, db) -> bool:
    """Build and send the branded welcome email to the new employee."""
    try:
        from app.services.email_service import _send_html

        hr_email = settings.NOTIFY_TO_EMAIL
        if not hr_email:
            logger.warning("[welcome] NOTIFY_TO_EMAIL not set — welcome email not sent.")
            return False

        ctx = _resolve_employee_context(emp_email, db)
        subject, html_body, sent_snapshot = _build_welcome_email(
            emp_name, ctx["department"], ctx["designation"],
            ctx["joining_date_label"], ctx["manager_name"], db,
        )
        ok = _send_html(hr_email, emp_email, subject, html_body)
        if ok:
            logger.info("[welcome] Welcome email sent to %s", emp_email)
            _snapshot_resources_sent(emp_email, sent_snapshot, db)
            try:
                from app.services.email_service import send_joining_kit_email
                send_joining_kit_email(hr_email, emp_name, emp_email)
            except Exception as ex:
                logger.error("[welcome] Failed to send joining kit email for %s: %s", emp_email, ex)
        else:
            logger.warning("[welcome] Welcome email delivery failed for %s", emp_email)
        return ok
    except Exception as e:
        logger.error("[welcome] Welcome email error for %s: %s", emp_email, e)
        return False


def _snapshot_resources_sent(emp_email: str, resources: list[dict], db) -> None:
    """Persist which resources were actually included at send time, so historical sends
    stay auditable even after resources are later edited/removed from the live config."""
    import json
    from app.models import WelcomeLog

    try:
        log = db.query(WelcomeLog).filter(WelcomeLog.employee_email == emp_email).first()
        if log:
            log.resources_sent = json.dumps(resources)
            db.commit()
    except Exception as e:
        logger.error("[welcome] Failed to snapshot resources_sent for %s: %s", emp_email, e)


def render_welcome_preview(db, name: str = "", department: str = "", designation: str = "",
                           joining_date_label: str = "", manager_name: str = "") -> dict:
    """Render the welcome email subject+HTML using sample/override placeholder values,
    without sending anything or writing to the database. Backs the HR Portal preview."""
    subject, html_body, _ = _build_welcome_email(
        name or "Jane Doe",
        department or "Engineering",
        designation or "Software Engineer",
        joining_date_label or datetime.date.today().strftime("%d %B %Y"),
        manager_name or "Alex Manager",
        db,
    )
    return {"subject": subject, "html": html_body}


def kickoff_new_hire(emp_email: str, emp_name: str, db, initiated_by: str = "system") -> None:
    """Fire the full new-hire onboarding kickoff: welcome email + manager intro-call invite.

    Call this ONLY from a deliberate "employee added" action (Add Employee form, bulk
    import, or HR's manual "Trigger Onboarding" button) — never from a lazy
    get-or-create-employee stub path, so a stray API touch for an existing/unknown email
    never triggers real onboarding emails.

    Idempotent per employee — WelcomeLog and ManagerCallInvite are each unique on the
    employee's email, so calling this twice for the same hire is a no-op the second time.

    Honors the 'welcome_email_mode' company setting: 'auto' (default) sends the welcome
    email immediately with an FYI to HR; 'review' falls back to the legacy HR Yes/No
    confirmation flow. `initiated_by` (an HR user's email, or "system") is recorded on the
    WelcomeLog for the onboarding audit trail.
    """
    from app.models import WelcomeLog
    from app.services.company_settings_service import CompanySettingsService
    from app.services.manager_call_service import ensure_invite

    emp_email = (emp_email or "").strip().lower()
    if not emp_email:
        return

    if not db.query(WelcomeLog).filter(WelcomeLog.employee_email == emp_email).first():
        mode = (CompanySettingsService.get("welcome_email_mode") or "auto").strip().lower()
        if mode == "review":
            notify_hr_new_employee(emp_email, emp_name, db, initiated_by=initiated_by)
        else:
            log = WelcomeLog(
                employee_email=emp_email,
                employee_name=emp_name,
                send_token=secrets.token_urlsafe(48)[:64],
                skip_token=secrets.token_urlsafe(48)[:64],
                status="pending_hr",
                initiated_by=initiated_by,
            )
            db.add(log)
            db.commit()
            db.refresh(log)

            ok = send_welcome_email(emp_email, emp_name, db)
            log.status = "welcome_sent" if ok else "pending_hr"
            log.acted_at = datetime.datetime.utcnow()
            log.acted_by = "system:auto"
            db.commit()

            threading.Thread(
                target=_send_hr_fyi_notification,
                args=(emp_email, emp_name, ok),
                daemon=True,
            ).start()

    try:
        ensure_invite(emp_email, emp_name, db)
    except Exception:
        logger.error("[welcome] Manager-call invite failed during kickoff for %s", emp_email, exc_info=True)


def trigger_onboarding_manual(emp_email: str, emp_name: str, initiated_by: str, db) -> dict:
    """HR's one-click 'Trigger Onboarding' button — safe to click repeatedly.

    - If onboarding was never kicked off for this employee (e.g. a legacy record, or one
      created via a lazy stub path), this performs the full kickoff: welcome email +
      manager-call invite.
    - If it was already kicked off but the welcome email never actually sent (mailbox
      wasn't connected, etc.), this retries the send and re-checks the manager invite.
    - If everything already succeeded, this is a no-op that just reports the current state.
    """
    from app.models import WelcomeLog
    from app.services.manager_call_service import ensure_invite

    emp_email = (emp_email or "").strip().lower()
    if not emp_email:
        return {"ok": False, "error": "No email on file for this employee."}

    log = db.query(WelcomeLog).filter(WelcomeLog.employee_email == emp_email).first()
    if not log:
        kickoff_new_hire(emp_email, emp_name, db, initiated_by=initiated_by)
        return {"ok": True, "action": "kicked_off"}

    try:
        ensure_invite(emp_email, emp_name, db)
    except Exception:
        logger.error("[welcome] Manager-call invite failed during manual trigger for %s", emp_email, exc_info=True)

    if log.status == "welcome_sent":
        return {"ok": True, "action": "already_sent"}

    ok = send_welcome_email(emp_email, emp_name, db)
    log.status = "welcome_sent" if ok else log.status
    log.acted_at = datetime.datetime.utcnow()
    log.acted_by = f"manual-trigger:{initiated_by}"
    db.commit()
    return {"ok": ok, "action": "resent"}


def _send_hr_fyi_notification(emp_email: str, emp_name: str, welcome_sent_ok: bool) -> None:
    """Non-blocking, informational-only email to HR after an automatic welcome send.
    Unlike the legacy Yes/No notification, this never blocks or requires HR action —
    it only flags failures so a broken mailbox connection doesn't fail silently."""
    try:
        import html as html_mod
        from app.services.email_service import _send_html, _email_shell, _detail_rows

        hr_email = settings.NOTIFY_TO_EMAIL
        if not hr_email:
            logger.warning("[welcome] NOTIFY_TO_EMAIL not set — skipping HR FYI notification.")
            return

        if welcome_sent_ok:
            subject = f"{emp_name} joined — welcome email sent automatically"
            intro = "<p>A new team member has joined and their welcome email was sent automatically.</p>"
        else:
            subject = f"{emp_name} joined — welcome email FAILED to send"
            intro = (
                "<p>A new team member has joined, but the automatic welcome email "
                "<strong>failed to send</strong>. Check that a mailbox is connected under "
                "Settings → Integrations, then resend from HR Portal → Welcome Logs.</p>"
            )

        body = _detail_rows([
            ("Name", html_mod.escape(emp_name)),
            ("Email", html_mod.escape(emp_email)),
            ("Joined", datetime.date.today().strftime("%d %B %Y")),
        ])
        html_body = _email_shell("New Employee Onboarding", intro, body, preheader=subject)
        _send_html(hr_email, hr_email, subject, html_body)
        logger.info("[welcome] HR FYI notification sent for %s (ok=%s)", emp_email, welcome_sent_ok)
    except Exception as e:
        logger.error("[welcome] HR FYI notification failed for %s: %s", emp_email, e)


def process_confirmation(token: str, db) -> dict:
    """Handle HR clicking Yes (send_token) or No (skip_token) from the email."""
    from app.models import WelcomeLog

    log = (
        db.query(WelcomeLog)
        .filter(
            (WelcomeLog.send_token == token) | (WelcomeLog.skip_token == token)
        )
        .first()
    )
    if not log:
        return {"ok": False, "error": "Invalid or expired link."}

    if log.status != "pending_hr":
        return {
            "ok": False,
            "already_done": True,
            "status": log.status,
            "employee_name": log.employee_name,
        }

    is_send = log.send_token == token

    if is_send:
        ok = send_welcome_email(log.employee_email, log.employee_name, db)
        log.status = "welcome_sent" if ok else "pending_hr"
    else:
        log.status = "skipped"
        ok = True

    if ok:
        log.acted_at = datetime.datetime.utcnow()
        db.commit()

    return {
        "ok": ok,
        "action": "send" if is_send else "skip",
        "employee_name": log.employee_name,
        "status": log.status,
    }
