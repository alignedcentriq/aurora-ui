"""Answer-layer access control for personal / sensitive HR data.

Tools that expose one person's private data (leave balance, leave history) must
call this BEFORE returning data for a target other than the requester.
Enforcement lives here, at the data boundary — not in LLM prose, which the model
can ignore. This mirrors the relationship check already used by
``attendance_service.summary_for_manager`` (self or direct report), extended
with an HR/admin role override so HR can do its job.
"""
from dataclasses import dataclass
from typing import Optional

from app.database import SessionLocal
from app.services.attendance_service import resolve_employee

# Roles that may view any employee's personal HR data (legitimate HR function).
_PRIVILEGED_ROLES = {"hr", "super_admin"}


@dataclass
class AccessDecision:
    allowed: bool
    target_email: Optional[str] = None
    target_name: Optional[str] = None
    reason: Optional[str] = None        # machine code when denied/blocked
    message: Optional[str] = None       # human-facing line shown to the user


def check_personal_data_access(
    requester_email: str,
    requester_role: Optional[str],
    target_query: Optional[str],
) -> AccessDecision:
    """Decide whether ``requester`` may view personal HR data for ``target_query``.

    Allowed when: the target is the requester themselves; the requester is the
    target's direct manager; or the requester holds a privileged role (HR/admin).
    ``target_query`` may be a name or an email; empty/blank means "self".
    """
    role = (requester_role or "").strip().lower()
    db = SessionLocal()
    try:
        requester = resolve_employee(db, requester_email) if requester_email else None

        # No explicit target → self-service. Always allowed; resolve to requester.
        if not target_query or not target_query.strip():
            return AccessDecision(
                allowed=True,
                target_email=requester_email,
                target_name=requester.name if requester else None,
            )

        target = resolve_employee(db, target_query)
        if not target:
            return AccessDecision(
                allowed=False,
                reason="target_not_found",
                message=(
                    f"No employee found matching '{target_query}'. "
                    "Try their full name or work email."
                ),
            )

        # Asking about oneself (by name/email) is always fine.
        if requester and target.id == requester.id:
            return AccessDecision(
                allowed=True, target_email=target.email, target_name=target.name
            )

        # HR / admin may view anyone's personal HR data.
        if role in _PRIVILEGED_ROLES:
            return AccessDecision(
                allowed=True, target_email=target.email, target_name=target.name
            )

        # The target's direct manager may view it.
        if requester and target.manager_id == requester.id:
            return AccessDecision(
                allowed=True, target_email=target.email, target_name=target.name
            )

        if not requester:
            return AccessDecision(
                allowed=False,
                reason="requester_not_found",
                message=(
                    "Could not verify your identity, so access to another "
                    "person's data can't be granted."
                ),
            )

        return AccessDecision(
            allowed=False,
            reason="not_authorized",
            target_name=target.name,
            message=(
                f"You don't have access to {target.name}'s personal HR data. "
                "Only the person themselves, their manager, or HR can view it."
            ),
        )
    finally:
        db.close()
