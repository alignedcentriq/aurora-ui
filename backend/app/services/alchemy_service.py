"""
Alchemy Skills Portal API service.

Alchemy is secured with Azure AD (App ID: 4a7dad8b-1372-499d-ade0-a91fe84ae4d6).
Tokens are obtained by exchanging the user's stored Microsoft refresh token via
oauth_service.get_alchemy_token(). No separate connect flow needed — users who
have connected Microsoft automatically get Alchemy access.

API base: https://apps.alignedautomation.com/alchemyapi/api/v1
"""

import logging

import httpx

from app.config import settings

log = logging.getLogger("aurora-logger")

_BASE = settings.ALCHEMY_BASE_URL.rstrip("/")

_CONNECT_MSG = (
    "Please connect your Microsoft account first. "
    "Go to **Settings > Connected Accounts** and click **Connect Microsoft**."
)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _check(resp: httpx.Response, label: str) -> dict:
    if resp.status_code in (401, 403):
        raise PermissionError("not_connected")
    if not resp.is_success:
        log.warning("[alchemy] %s → %s %s", label, resp.status_code, resp.text[:200])
        resp.raise_for_status()
    return resp.json()


def get_employee_id(user_email: str) -> str | None:
    """Look up the Alchemy employee ID (e.g. AASPL-1540) from the employees table.

    DB may store either the full ID ("AASPL-1540") or just the numeric part ("1540").
    ALCHEMY_EMPLOYEE_PREFIX is prepended if the stored value doesn't already have it.
    """
    from app.database import SessionLocal
    from app.models import Employee
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == user_email).first()
        if not emp or not emp.employee_id:
            return None
        raw = emp.employee_id
        prefix = settings.ALCHEMY_EMPLOYEE_PREFIX
        if prefix and not raw.startswith(prefix):
            return f"{prefix}{raw}"
        return raw
    finally:
        db.close()


def get_my_skills(token: str, employee_id: str) -> dict:
    """GET /users/{employee_id}/skills — returns the user's skill list."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/users/{employee_id}/skills", headers=_headers(token))
    return _check(resp, f"skills/{employee_id}")


def get_user_roles(token: str, employee_id: str) -> dict:
    """GET /user-roles/{employee_id} — returns the user's roles/designations."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/user-roles/{employee_id}", headers=_headers(token))
    return _check(resp, f"user-roles/{employee_id}")


def get_skills_stats_summary(token: str) -> dict:
    """GET /skills/stats-summary — org-wide skills stats summary."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/skills/stats-summary", headers=_headers(token))
    return _check(resp, "skills/stats-summary")


def get_top_skills_by_interest(token: str) -> dict:
    """GET /skills/top-by-interest — top skills employees want to learn."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/skills/top-by-interest", headers=_headers(token))
    return _check(resp, "skills/top-by-interest")


def get_skill_categories(token: str) -> dict:
    """GET /skills/stats/categories — available skill categories."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/skills/stats/categories", headers=_headers(token))
    return _check(resp, "skills/stats/categories")
