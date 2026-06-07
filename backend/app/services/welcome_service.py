"""
Welcome email service for new employees.

Flow:
1. New employee detected in _get_or_create_employee → notify_hr_new_employee()
2. HR receives email with Yes / No one-click buttons (token-authenticated)
3. HR clicks Yes → send_welcome_email() fires a branded resource email to new employee
4. HR can also resend or skip from the HR Portal welcome logs tab
"""

import datetime
import logging
import secrets
import threading

from app.config import settings

logger = logging.getLogger("aurora-logger")


def notify_hr_new_employee(emp_email: str, emp_name: str, db) -> None:
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


def send_welcome_email(emp_email: str, emp_name: str, db) -> bool:
    """Build and send the branded welcome email to the new employee."""
    try:
        import html as html_mod
        from app.services.email_service import _send_html, _email_shell, _section
        from app.models import WelcomeResource

        hr_email = settings.NOTIFY_TO_EMAIL
        if not hr_email:
            logger.warning("[welcome] NOTIFY_TO_EMAIL not set — welcome email not sent.")
            return False

        resources = (
            db.query(WelcomeResource)
            .filter(WelcomeResource.is_active == True)
            .order_by(WelcomeResource.sort_order, WelcomeResource.id)
            .all()
        )

        # Group resources by category
        by_category: dict[str, list] = {}
        for r in resources:
            cat = r.category or "General"
            by_category.setdefault(cat, []).append(r)

        _CAT_COLORS = {
            "App Guide":  "#1B6FC8",
            "HR":         "#16A34A",
            "Policy":     "#D97706",
            "IT":         "#0D9488",
            "Admin":      "#7c3aed",
            "Facilities": "#db2777",
            "General":    "#64748b",
        }

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

        intro = (
            f"<p>Welcome to the team, <strong>{html_mod.escape(emp_name)}</strong>! 🎉</p>"
            f"<p>We're thrilled to have you on board. Below are the tools and resources "
            f"available to you through <strong>Centriq AI</strong> — your digital workplace assistant. "
            f"Just open the app and ask anything!</p>"
        )
        html_body = _email_shell(
            "Welcome to the Team!",
            intro,
            sections_html,
            preheader=f"Welcome {emp_name}! Here are your workplace resources.",
        )
        ok = _send_html(hr_email, emp_email, f"Welcome to the team, {emp_name}!", html_body)
        if ok:
            logger.info("[welcome] Welcome email sent to %s", emp_email)
        else:
            logger.warning("[welcome] Welcome email delivery failed for %s", emp_email)
        return ok
    except Exception as e:
        logger.error("[welcome] Welcome email error for %s: %s", emp_email, e)
        return False


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
