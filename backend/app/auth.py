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
    role: str                                   # EFFECTIVE role (after any test impersonation)
    scopes: List[str] = field(default_factory=list)
    extra_capabilities: List[str] = field(default_factory=list)
    real_role: Optional[str] = None             # true role; differs from `role` only while a
                                                # Super Admin is test-impersonating another role

    @property
    def is_impersonating(self) -> bool:
        return self.real_role is not None and self.real_role != self.role


def get_current_user(
    x_user_email: Optional[str] = Header(None, alias="x-user-email"),
    x_user_role: Optional[str] = Header(None, alias="x-user-role"),
    x_impersonate_role: Optional[str] = Header(None, alias="x-impersonate-role"),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """
    Extract authenticated user from MSAL-populated request headers.
    DB role overrides (set by Super Admin) take precedence over Azure AD claims.
    Falls back to DEFAULT_USER_EMAIL in dev when headers are absent.

    Test impersonation: a *real* Super Admin may set `x-impersonate-role` to act as any
    role for testing. This is a non-destructive overlay — the Super Admin's grant is only
    READ, never changed, so they can switch back at any time. It can never be used to
    escalate: the overlay is applied only when the resolved real role is Super Admin.
    """
    email = (x_user_email or "").strip().lower() or settings.DEFAULT_USER_EMAIL
    if settings.ALLOWED_EMAILS and email not in settings.ALLOWED_EMAILS:
        raise HTTPException(status_code=403, detail="Access denied.")

    # 1. Resolve the REAL role + scopes (DB override wins over the Azure AD header claim).
    real_role = None
    scopes: List[str] = []
    extra_capabilities: List[str] = []
    try:
        from app.models import UserRoleOverride
        override = db.query(UserRoleOverride).filter(UserRoleOverride.email == email).first()
        if override:
            real_role = override.role
            scopes = override.scopes or []
            extra_capabilities = override.extra_capabilities or []
    except Exception:
        pass
    if real_role is None:
        r = (x_user_role or "employee").strip().lower()
        # Super Admin can NEVER be claimed via header — only a DB override grants it.
        if r not in VALID_ROLES or r == "super admin":
            r = "employee"
        real_role = r

    # 2. Apply the test-impersonation overlay (real Super Admin only).
    effective_role = real_role
    imp = (x_impersonate_role or "").strip().lower()
    if real_role == "super admin" and imp and imp in VALID_ROLES:
        effective_role = imp
        if imp != "super admin":
            scopes = []  # test the target role cleanly, without the super-admin scopes

    return CurrentUser(email=email, role=effective_role, scopes=scopes,
                       extra_capabilities=extra_capabilities, real_role=real_role)


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Dependency that rejects non-admin callers with 403."""
    if user.role not in {"admin", "super admin"}:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def require_domain_manager(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows hr, it, pmo, and admin roles (domain config/announcement managers)."""
    if user.role not in DOMAIN_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Domain manager access required.")
    return user


def require_hr(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows hr, admin, and super admin roles."""
    if user.role not in {"hr", "admin", "super admin"}:
        raise HTTPException(status_code=403, detail="HR access required.")
    return user


def require_it(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows it, admin, and super admin roles."""
    if user.role not in {"it", "admin", "super admin"}:
        raise HTTPException(status_code=403, detail="IT access required.")
    return user


def require_super_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows super admin role only."""
    if user.role != "super admin":
        raise HTTPException(status_code=403, detail="Super Admin access required.")
    return user


def require_pmo(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows pmo, admin, and super admin roles."""
    if user.role not in {"pmo", "admin", "super admin"}:
        raise HTTPException(status_code=403, detail="PMO access required.")
    return user


def require_functional_manager(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows functional managers + super admin. Restricted to onboarding/VDI/PMO features."""
    if user.role not in {"functional manager", "super admin"}:
        raise HTTPException(status_code=403, detail="Functional Manager access required.")
    return user


def require_has_reports(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows any authenticated user who has at least one direct report.
    Enables My Team for TLs / anyone with reportees, not just Functional Managers."""
    if user.role == "super admin":
        return user
    from app.database import SessionLocal
    from app.models import Employee
    db = SessionLocal()
    try:
        mgr = db.query(Employee).filter(Employee.email == user.email).first()
        if not mgr:
            raise HTTPException(status_code=403, detail="No team found for your account.")
        if db.query(Employee).filter(Employee.manager_id == mgr.id).first() is None:
            raise HTTPException(status_code=403, detail="You have no direct reports.")
    finally:
        db.close()
    return user


def require_non_employee(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allows all roles except employee."""
    if user.role == "employee":
        raise HTTPException(status_code=403, detail="Access restricted to employees.")
    return user
