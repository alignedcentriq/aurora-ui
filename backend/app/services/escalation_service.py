"""
Escalation service — creates Escalation records and notifies the responsible department.

The escalation matrix maps each domain to a department label and a contact email.
Department emails fall back to the global NOTIFY_TO_EMAIL when no domain-specific
address is configured.
"""

import datetime
import html
import logging

from sqlalchemy.orm import Session

from app.config import settings
from app.models import SCHEMA, Escalation
from app.services.email_service import (
    _email_shell,
    _detail_rows,
    _status_pill,
    _note,
    _send_html,
)

logger = logging.getLogger("aurora-logger")

# ── Escalation Matrix ────────────────────────────────────────────────────────
# domain → (display label, fallback contact email)
# The contact email is used when no specific address is configured via env vars.

_DOMAIN_MATRIX: dict[str, tuple[str, str]] = {
    "hr":                 ("HR Team",            "hr@alignedautomation.com"),
    "admin":              ("Admin & Facilities",  "admin@alignedautomation.com"),
    "it_support":         ("IT Helpdesk",         "it-support@alignedautomation.com"),
    "pmo":                ("PMO Team",            "pmo@alignedautomation.com"),
    "functional_manager": ("Your Manager",        settings.NOTIFY_TO_EMAIL),
    "ms365":              ("IT Helpdesk",         "it-support@alignedautomation.com"),
    "general":            ("Support Team",        settings.NOTIFY_TO_EMAIL),
}

# Optional env-var overrides: ESCALATION_EMAIL_HR, ESCALATION_EMAIL_IT_SUPPORT, …
import os
_ENV_OVERRIDES: dict[str, str] = {
    "hr":         os.getenv("ESCALATION_EMAIL_HR", ""),
    "admin":      os.getenv("ESCALATION_EMAIL_ADMIN", ""),
    "it_support": os.getenv("ESCALATION_EMAIL_IT_SUPPORT", ""),
    "pmo":        os.getenv("ESCALATION_EMAIL_PMO", ""),
}


def _contact_for(domain: str | None) -> tuple[str, str]:
    """Return (department_label, contact_email) for the given domain."""
    key = (domain or "general").lower()
    label, default_email = _DOMAIN_MATRIX.get(key, _DOMAIN_MATRIX["general"])
    env_email = _ENV_OVERRIDES.get(key, "")
    return label, (env_email or default_email or settings.NOTIFY_TO_EMAIL)


def _next_reference_id(db: Session) -> str:
    count = db.query(Escalation).count()
    return f"ESC-{count + 1:04d}"


def create_escalation(
    db: Session,
    *,
    user_email: str,
    user_name: str | None,
    domain: str | None,
    original_query: str | None,
    error_type: str | None,
    description: str | None,
    priority: str,
    session_id: str | None,
    sender_email: str | None = None,
) -> Escalation:
    """Persist the escalation record and fire a notification email to the department."""
    ref_id = _next_reference_id(db)
    dept_label, contact_email = _contact_for(domain)

    esc = Escalation(
        reference_id=ref_id,
        user_email=user_email,
        user_name=user_name,
        domain=domain,
        original_query=original_query,
        error_type=error_type,
        description=description,
        priority=priority,
        session_id=session_id,
        notified_to=contact_email,
        status="Open",
    )
    db.add(esc)
    db.commit()
    db.refresh(esc)

    # Fire-and-forget notification — log but don't fail the API response if email bounces.
    # Always send via NOTIFY_TO_EMAIL (the connected service account) because regular
    # employees don't have a Graph token stored, so using their email as sender fails silently.
    notify_sender = settings.NOTIFY_TO_EMAIL or sender_email or user_email
    try:
        _send_escalation_email(
            sender_email=notify_sender,
            to=contact_email,
            user_email=user_email,
            user_name=user_name or user_email,
            dept_label=dept_label,
            ref_id=ref_id,
            domain=domain,
            original_query=original_query,
            error_type=error_type,
            description=description,
            priority=priority,
        )
    except Exception as exc:
        logger.warning("[escalation] Email notification failed for %s: %s", ref_id, exc)

    return esc


def _send_escalation_email(
    *,
    sender_email: str,
    to: str,
    user_email: str,
    user_name: str,
    dept_label: str,
    ref_id: str,
    domain: str | None,
    original_query: str | None,
    error_type: str | None,
    description: str | None,
    priority: str,
) -> None:
    priority_colors = {"High": "#dc2626", "Medium": "#D97706", "Low": "#16A34A"}
    p_color = priority_colors.get(priority, "#D97706")

    error_labels = {
        "error":       "Tool / model error",
        "no_response": "No response received",
        "unsatisfied": "Answer not helpful",
    }
    err_label = error_labels.get(error_type or "", "Unknown")

    rows = [
        ("Reference", f"<strong>{html.escape(ref_id)}</strong>"),
        ("Raised by", html.escape(user_email)),
        ("Department", html.escape(dept_label)),
        ("Domain", html.escape(domain or "general").replace("_", " ").title()),
        ("Reason", html.escape(err_label)),
        ("Priority", _status_pill(priority, p_color)),
    ]
    if original_query:
        rows.append(("Original query", html.escape(original_query[:300])))
    if description:
        rows.append(("User notes", html.escape(description[:500])))

    body_html = _detail_rows(rows) + _note(f"Raised at {datetime.datetime.utcnow().strftime('%d %b %Y, %H:%M')} UTC via Centriq AI chat.")

    intro = (
        f'<p>An escalation has been raised by <strong>{html.escape(user_name)}</strong> '
        f'that requires attention from the <strong>{html.escape(dept_label)}</strong>.</p>'
        f'<p>Please review and respond to the employee directly at '
        f'<a href="mailto:{html.escape(user_email)}" style="color:#1B6FC8;">{html.escape(user_email)}</a>.</p>'
    )

    html_body = _email_shell(
        f"Escalation {ref_id} — Action Required",
        intro,
        body_html,
        preheader=f"New escalation {ref_id} from {user_name} requires your attention.",
    )

    _send_html(
        sender_email,
        to,
        f"[Escalation {ref_id}] {dept_label} — Action Required",
        html_body,
    )
