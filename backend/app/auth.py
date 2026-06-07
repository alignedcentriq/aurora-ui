"""
Request-level authentication for Centriq AI.

The frontend (MSAL SSO) sends the authenticated user's email and role
as HTTP headers derived from the verified Azure AD token claims.
Backend reads and validates these headers on every protected request.
If a Super Admin has assigned a role override via the Access Management
page, the DB override takes precedence over the Azure AD token claims.
"""

from dataclasses import dataclass, field
from typing import Optional, List

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db

VALID_ROLES = {"employee", "admin", "manager", "hr", "it", "pmo", "functional manager", "super admin"}
DOMAIN_MANAGER_ROLES = {"hr", "it", "pmo", "admin", "super admin"}


@dataclass
class CurrentUser:
    email: str
    role: str
    scopes: List[str] = field(default_factory=list)


def get_current_user(
    x_user_email: Optional[str] = Header(None, alias="x-user-email"),
    x_user_role: Optional[str] = Header(None, alias="x-user-role"),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """
    Extract authenticated user from MSAL-populated request headers.
    DB role overrides (set by Super Admin) take precedence over Azure AD claims.
    Falls back to DEFAULT_USER_EMAIL in dev when headers are absent.
    """
    email = (x_user_email or "").strip().lower() or settings.DEFAULT_USER_EMAIL
    if settings.ALLOWED_EMAILS and email not in settings.ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="Access denied.")

    # Check for a Super Admin-assigned role override in DB
    try:
        from app.models import UserRoleOverride
        override = db.query(UserRoleOverride).filter(UserRoleOverride.email == email).first()
        if override:
            return CurrentUser(email=email, role=override.role, scopes=override.scopes or [])
    except Exception:
        pass

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


def require_super_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows super admin role only."""
    if user.role != "super admin":
        raise HTTPException(status_code=403, detail="Super Admin access required.")
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


def require_non_employee(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows all roles except employee."""
    if user.role == "employee":
        raise HTTPException(status_code=403, detail="Access restricted to employees.")
    return user
