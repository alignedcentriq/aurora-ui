"""
Request-level authentication for Centriq AI.

The frontend (MSAL SSO) sends the authenticated user's email and role
as HTTP headers derived from the verified Azure AD token claims.
Backend reads and validates these headers on every protected request.
"""

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException

from app.config import settings

VALID_ROLES = {"employee", "admin", "manager", "hr", "it", "pmo", "functional manager"}
DOMAIN_MANAGER_ROLES = {"hr", "it", "pmo", "admin"}


@dataclass
class CurrentUser:
    email: str
    role: str


def get_current_user(
    x_user_email: Optional[str] = Header(None, alias="x-user-email"),
    x_user_role: Optional[str] = Header(None, alias="x-user-role"),
) -> CurrentUser:
    """
    Extract authenticated user from MSAL-populated request headers.
    Falls back to DEFAULT_USER_EMAIL in dev when headers are absent.
    """
    email = (x_user_email or "").strip().lower() or settings.DEFAULT_USER_EMAIL
    if settings.ALLOWED_EMAILS and email not in settings.ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="Access denied.")
    role = (x_user_role or "employee").strip().lower()
    if role not in VALID_ROLES:
        role = "employee"
    return CurrentUser(email=email, role=role)


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Dependency that rejects non-admin callers with 403."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def require_domain_manager(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows hr, it, pmo, and admin roles (domain config/announcement managers)."""
    if user.role not in DOMAIN_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Domain manager access required.")
    return user


def require_hr(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows hr and admin roles."""
    if user.role not in {"hr", "admin"}:
        raise HTTPException(status_code=403, detail="HR access required.")
    return user


def require_it(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows it and admin roles."""
    if user.role not in {"it", "admin"}:
        raise HTTPException(status_code=403, detail="IT access required.")
    return user


def require_pmo(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows pmo and admin roles."""
    if user.role not in {"pmo", "admin"}:
        raise HTTPException(status_code=403, detail="PMO access required.")
    return user


def require_functional_manager(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows functional managers only. Whole-hierarchy attendance reporting is restricted
    to this role per product decision (2026-06-04)."""
    if user.role != "functional manager":
        raise HTTPException(status_code=403, detail="Functional Manager access required.")
    return user
