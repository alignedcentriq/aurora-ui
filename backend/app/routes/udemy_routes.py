"""
Udemy Business portal routes.

Proxies the org's Udemy Business catalog & reporting API (HTTP Basic auth with
the stored client id/secret) so the frontend never sees the credential. The
catalog is readable by any authenticated user; the learner-activity report is
gated to people-management roles.

Prefix: /api/portal/udemy
"""

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.services import udemy_business_service as udemy
from app.services import udemy_scim_service as _scim_real
from app.services import udemy_scim_mock_service as _scim_mock

# Use the mock service when real SCIM is not configured or not yet reachable.
# Set UDEMY_SCIM_MOCK=false in .env (and restart) to switch to live SCIM.
import os as _os
_use_mock = _os.environ.get("UDEMY_SCIM_MOCK", "true").lower() in ("1", "true", "yes", "on")
scim = _scim_mock if (_use_mock or not _scim_real.configured()) else _scim_real

router = APIRouter(prefix="/api/portal/udemy", tags=["Udemy Business"])

_NOT_CONFIGURED = (
    "Udemy Business isn't connected yet. An administrator needs to set "
    "UDEMY_CLIENT_ID / UDEMY_CLIENT_SECRET in the backend environment."
)

# Roles allowed to see org-wide learner activity (reporting).
_REPORT_ROLES = {"hr", "pmo", "admin", "super admin"}
# Roles allowed to edit the seat ledger (purchased/available counts).
_LICENSE_EDIT_ROLES = {"pmo", "admin", "super admin"}


def _guard_configured():
    if not udemy.configured():
        raise HTTPException(status_code=503, detail=_NOT_CONFIGURED)


def _err(exc: Exception):
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=503, detail=_NOT_CONFIGURED)
    raise HTTPException(status_code=502, detail=f"Udemy error: {exc}")


@router.get("/status")
def udemy_status(user: CurrentUser = Depends(get_current_user)):
    """Whether the integration is wired, report access, and search-index readiness.

    Calling this also warms the search index in the background (the portal hits
    /status on load), so search is likely ready by the time the user types.
    """
    out = {
        "configured": udemy.configured(),
        "can_view_reports": user.role in _REPORT_ROLES,
        "scim_configured": scim.configured(),          # SCIM app wired? (no network probe)
        "can_provision": user.role in _SCIM_ROLES,      # may this user drive SCIM writes?
    }
    if udemy.configured():
        out["index"] = udemy.index_status()  # triggers background warm-up
    return out


@router.get("/courses")
def udemy_courses(
    q: str = Query("", description="Keyword search; blank lists the catalog"),
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
):
    """Browse or search the org's Udemy Business course collection."""
    _guard_configured()
    try:
        return udemy.search_courses(q, page=page, page_size=page_size)
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/courses/{course_id}")
def udemy_course_detail(course_id: int, user: CurrentUser = Depends(get_current_user)):
    """Full course detail with org enrollment + completion stats annotated."""
    _guard_configured()
    try:
        return udemy.get_course_with_org_stats(course_id)
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/analytics/org-course-stats")
def org_course_stats(user: CurrentUser = Depends(get_current_user)):
    """Aggregated org stats for every course: enrolled, completed, avg_completion_pct.
    Cached for 1 hour. Used to annotate search results without per-course API calls."""
    _guard_configured()
    try:
        return {"results": udemy.get_org_stats()}
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/analytics/user-activity")
def udemy_user_activity(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
):
    """Aggregated learner activity report (people-management roles only)."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Reporting is restricted to HR / PMO / Admin.")
    try:
        return udemy.get_user_activity(page=page, page_size=page_size)
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/analytics/user-course-activity")
def udemy_user_course_activity(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
):
    """Per-user, per-course breakdown: completion %, minutes consumed, completion date."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Reporting is restricted to HR / PMO / Admin.")
    try:
        return udemy.get_user_course_activity(page=page, page_size=page_size)
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/analytics/user-progress")
def udemy_user_progress(
    from_date: str | None = Query(None, description="Filter completions from this date (YYYY-MM-DD)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
):
    """Completion events per user. Pass from_date=YYYY-MM-DD for incremental pulls."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Reporting is restricted to HR / PMO / Admin.")
    try:
        return udemy.get_user_progress(from_date=from_date, page=page, page_size=page_size)
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/analytics/course-insights")
def udemy_course_insights(user: CurrentUser = Depends(get_current_user)):
    """High-level org learning insights: totals, top/low-engagement courses, category
    mix. Cached ~1h (heavy aggregation). HR / PMO / Admin only."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Reporting is restricted to HR / PMO / Admin.")
    try:
        result = udemy.get_course_insights()
        if "error" in result:
            raise HTTPException(status_code=503, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/analytics/license-summary")
def udemy_license_summary(user: CurrentUser = Depends(get_current_user)):
    """Seat utilisation: active (used) seats, deactivated, and — when the purchased
    total is configured — available seats + utilisation %. HR / PMO / Admin only."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Reporting is restricted to HR / PMO / Admin.")
    try:
        result = udemy.get_license_summary()
        if "error" in result:
            raise HTTPException(status_code=503, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.put("/analytics/license-config")
def udemy_set_license_config(
    payload: dict = Body(..., examples=[{"purchased": 230, "available": 1, "inactive_days": 30}]),
    user: CurrentUser = Depends(get_current_user),
):
    """PMO/Admin update Udemy portal settings: seat ledger (purchased + available, read off
    the Udemy dashboard) and the org-default inactivity threshold. Persisted server-side —
    no env edit needed. Send null to clear a seat count."""
    _guard_configured()
    if user.role not in _LICENSE_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Managing Udemy settings is restricted to PMO / Admin.")

    def _coerce(key, *, min_value=0):
        if key not in payload or payload[key] in (None, ""):
            return None
        try:
            v = int(payload[key])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"'{key}' must be a whole number.")
        if v < min_value:
            raise HTTPException(status_code=400, detail=f"'{key}' must be at least {min_value}.")
        return v

    purchased = _coerce("purchased")
    available = _coerce("available")
    inactive_days = _coerce("inactive_days", min_value=1)
    if inactive_days is not None and inactive_days > 3650:
        raise HTTPException(status_code=400, detail="'inactive_days' is unrealistically large.")
    if purchased is not None and available is not None and available > purchased:
        raise HTTPException(status_code=400, detail="Available seats can't exceed purchased seats.")
    try:
        return udemy.set_license_config(purchased=purchased, available=available,
                                        inactive_days=inactive_days, updated_by=user.email)
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/analytics/inactive-users")
def udemy_inactive_users(
    days: int = Query(None, ge=1, le=3650, description="Idle-day threshold; defaults to the PMO-set org default"),
    include_deactivated: bool = Query(False, description="Include already-deactivated seats"),
    user: CurrentUser = Depends(get_current_user),
):
    """Learners with no Udemy visit in >= `days` days, so PMO/HR can deactivate the
    seat manually in Udemy admin (each row carries a `manage_url` deep-link).
    Read-only — nothing is revoked here. HR / PMO / Admin only.
    """
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Reporting is restricted to HR / PMO / Admin.")
    threshold = days if days is not None else udemy.get_inactive_default_days()
    try:
        result = udemy.get_inactive_users(threshold, include_deactivated=include_deactivated)
        if "error" in result:
            raise HTTPException(status_code=503, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.post("/analytics/sync-skills")
def udemy_sync_skills(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pull Udemy completions and write verified skills to employee profiles.
    Idempotent — safe to run multiple times. HR / PMO / Admin only.
    """
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Skill sync is restricted to HR / PMO / Admin.")
    try:
        result = udemy.sync_completions_to_skills(db)
        if "error" in result:
            raise HTTPException(status_code=503, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/analytics/sync-skills/status")
def udemy_sync_skills_status(user: CurrentUser = Depends(get_current_user)):
    """Last skill sync result (in-memory — resets on server restart)."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to HR / PMO / Admin.")
    return udemy.last_sync_status()


# ── SCIM provisioning (write side; separate Udemy app) ─────────────────────────
# Roles allowed to drive SCIM writes (provision/deprovision/groups/licenses).
_SCIM_ROLES = {"pmo", "admin", "super admin"}


def _scim_guard(user: CurrentUser):
    if user.role not in _SCIM_ROLES:
        raise HTTPException(status_code=403, detail="SCIM provisioning is restricted to PMO / Admin.")


def _scim_result(res: dict):
    """Map a SCIM service result to an HTTP response/exception."""
    if res.get("ok"):
        return res
    err = res.get("error")
    msg = res.get("message") or err or "SCIM error"
    status = {
        "not_configured": 503,
        "unauthorized": 502,
        "not_found": 404,
        "invalid": 400,
    }.get(err, 502)
    raise HTTPException(status_code=status, detail=msg)


@router.get("/scim/status")
async def udemy_scim_status(user: CurrentUser = Depends(get_current_user)):
    """Whether the SCIM app is wired and reachable (no secrets exposed). PMO/Admin."""
    _scim_guard(user)
    return scim.status()


@router.post("/scim/users/provision")
async def udemy_scim_provision(
    payload: dict = Body(..., examples=[{"email": "x@org.com", "given_name": "X", "family_name": "Y"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Provision (create) a Udemy user and grant access."""
    _scim_guard(user)
    email = (payload.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="'email' is required.")
    return _scim_result(scim.provision_user(
        email, given_name=payload.get("given_name", ""), family_name=payload.get("family_name", "")))


@router.post("/scim/users/deactivate")
async def udemy_scim_deactivate(
    payload: dict = Body(..., examples=[{"email": "x@org.com"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Deprovision / deactivate a user → frees the seat. The seat-reclaim action."""
    _scim_guard(user)
    email = (payload.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="'email' is required.")
    return _scim_result(scim.deactivate_user(email))


@router.post("/scim/users/reactivate")
async def udemy_scim_reactivate(
    payload: dict = Body(..., examples=[{"email": "x@org.com"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Reactivate a previously-deprovisioned user (if PII not anonymized)."""
    _scim_guard(user)
    email = (payload.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="'email' is required.")
    return _scim_result(scim.reactivate_user(email))


@router.patch("/scim/users/update")
async def udemy_scim_update_user(
    payload: dict = Body(..., examples=[{"email": "x@org.com", "new_email": "z@org.com"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Update a user's name and/or email."""
    _scim_guard(user)
    email = (payload.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="'email' is required.")
    return _scim_result(scim.update_user(
        email, new_email=payload.get("new_email"),
        given_name=payload.get("given_name"), family_name=payload.get("family_name")))


@router.get("/scim/groups")
async def udemy_scim_groups(user: CurrentUser = Depends(get_current_user)):
    """List SCIM groups (also the license-pool / Pro groups)."""
    _scim_guard(user)
    return _scim_result(scim.list_groups())


@router.post("/scim/groups")
async def udemy_scim_create_group(
    payload: dict = Body(..., examples=[{"display_name": "PMO", "member_emails": []}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Create a group, optionally seeding members by email."""
    _scim_guard(user)
    name = (payload.get("display_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="'display_name' is required.")
    return _scim_result(scim.create_group(name, payload.get("member_emails") or []))


@router.patch("/scim/groups/{group_id}/rename")
async def udemy_scim_rename_group(
    group_id: str,
    payload: dict = Body(..., examples=[{"new_name": "PMO Team"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Rename a group."""
    _scim_guard(user)
    new_name = (payload.get("new_name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="'new_name' is required.")
    return _scim_result(scim.rename_group(group_id, new_name))


@router.delete("/scim/groups/{group_id}")
async def udemy_scim_delete_group(group_id: str, user: CurrentUser = Depends(get_current_user)):
    """Delete a group."""
    _scim_guard(user)
    return _scim_result(scim.delete_group(group_id))


@router.post("/scim/groups/{group_id}/members")
async def udemy_scim_add_member(
    group_id: str,
    payload: dict = Body(..., examples=[{"email": "x@org.com"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Add a user to a group (manage membership)."""
    _scim_guard(user)
    email = (payload.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="'email' is required.")
    return _scim_result(scim.add_member_to_group(group_id, email))


@router.post("/scim/groups/{group_id}/members/remove")
async def udemy_scim_remove_member(
    group_id: str,
    payload: dict = Body(..., examples=[{"email": "x@org.com"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Remove a user from a group (manage membership)."""
    _scim_guard(user)
    email = (payload.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="'email' is required.")
    return _scim_result(scim.remove_member_from_group(group_id, email))


@router.post("/scim/groups/move")
async def udemy_scim_move_member(
    payload: dict = Body(..., examples=[{"email": "x@org.com", "from_group_id": "g1", "to_group_id": "g2"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Move a user between groups (changing groups)."""
    _scim_guard(user)
    email = (payload.get("email") or "").strip()
    frm = (payload.get("from_group_id") or "").strip()
    to = (payload.get("to_group_id") or "").strip()
    if not (email and frm and to):
        raise HTTPException(status_code=400, detail="email, from_group_id and to_group_id are required.")
    return _scim_result(scim.move_user_between_groups(email, frm, to))


@router.post("/scim/license-pools/{pool_group_id}/add")
async def udemy_scim_add_to_pool(
    pool_group_id: str,
    payload: dict = Body(..., examples=[{"email": "x@org.com"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Add a user to a License Pool (pool = a SCIM group)."""
    _scim_guard(user)
    email = (payload.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="'email' is required.")
    return _scim_result(scim.add_user_to_license_pool(email, pool_group_id))


@router.post("/scim/pro-license")
async def udemy_scim_assign_pro(
    payload: dict = Body(..., examples=[{"email": "x@org.com", "pro_pool_group_id": "g-pro"}]),
    user: CurrentUser = Depends(get_current_user),
):
    """Assign a Udemy Business Pro license (add to the Pro license-pool group)."""
    _scim_guard(user)
    email = (payload.get("email") or "").strip()
    pool = (payload.get("pro_pool_group_id") or "").strip()
    if not (email and pool):
        raise HTTPException(status_code=400, detail="email and pro_pool_group_id are required.")
    return _scim_result(scim.assign_pro_license(email, pool))


# ── Udemy Notification Automations (PMO/Admin) ──────────────────────────────
# These wrap the generic AutomationRule CRUD but are scoped to
# automation_kind="udemy_inactive" and exposed within the Udemy portal.

from pydantic import BaseModel
from typing import Any, Optional
from app.services import automation_service


class UdemyAutomationBody(BaseModel):
    name: str
    description: Optional[str] = ""
    frequency: str  # daily | weekly | monthly
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    hour: Optional[int] = 9
    minute: Optional[int] = 0
    email_subject: str  # subject for the summary report email
    email_body: Optional[str] = ""  # optional intro text in the report
    recipients_json: Optional[list[Any]] = []  # PMO/Admin who receive the report
    # Udemy-specific config:
    inactive_days: Optional[int] = 30
    notify_mode: Optional[str] = "report"  # report | nudge | both
    filter_groups: Optional[list[str]] = []
    filter_users: Optional[list[str]] = []
    exclude_deactivated: Optional[bool] = True
    nudge_subject: Optional[str] = ""
    nudge_body: Optional[str] = ""
    is_active: Optional[bool] = True


def _udemy_extra_config(body) -> dict:
    """Extract udemy_inactive-specific fields into extra_config dict."""
    d = body if isinstance(body, dict) else body.model_dump()
    return {
        "inactive_days": d.get("inactive_days") or 30,
        "notify_mode": d.get("notify_mode") or "report",
        "filter_groups": d.get("filter_groups") or [],
        "filter_users": d.get("filter_users") or [],
        "exclude_deactivated": d.get("exclude_deactivated", True),
        "nudge_subject": d.get("nudge_subject") or "",
        "nudge_body": d.get("nudge_body") or "",
    }


@router.get("/automations")
def list_udemy_automations(user: CurrentUser = Depends(get_current_user)):
    """List notification automations created for Udemy Business."""
    if user.role not in _LICENSE_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to PMO / Admin.")
    all_rules = automation_service.list_rules(user.email, user.role)
    return [r for r in all_rules if r.get("automation_kind") == "udemy_inactive"]


@router.post("/automations")
def create_udemy_automation(
    body: UdemyAutomationBody,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a new Udemy inactive-seat notification automation."""
    if user.role not in _LICENSE_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to PMO / Admin.")
    payload = body.model_dump()
    payload["automation_kind"] = "udemy_inactive"
    payload["extra_config"] = _udemy_extra_config(body)
    result = automation_service.create(user.email, user.role, payload)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "create_failed"))
    return result["rule"]


@router.patch("/automations/{rule_id}")
def update_udemy_automation(
    rule_id: int,
    body: dict = Body(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Update an existing Udemy notification automation."""
    if user.role not in _LICENSE_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to PMO / Admin.")
    if any(k in body for k in ("inactive_days", "notify_mode", "filter_groups",
                                "filter_users", "exclude_deactivated",
                                "nudge_subject", "nudge_body")):
        body["extra_config"] = _udemy_extra_config(body)
    result = automation_service.update(user.email, user.role, rule_id, body)
    if not result.get("success"):
        error = result.get("error", "error")
        status = 404 if error == "not_found" else 403 if error == "forbidden" else 400
        raise HTTPException(status_code=status, detail=error)
    return result["rule"]


@router.delete("/automations/{rule_id}")
def delete_udemy_automation(rule_id: int, user: CurrentUser = Depends(get_current_user)):
    if user.role not in _LICENSE_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to PMO / Admin.")
    result = automation_service.delete(user.email, user.role, rule_id)
    if not result.get("success"):
        error = result.get("error", "error")
        raise HTTPException(status_code=404 if error == "not_found" else 403, detail=error)
    return {"success": True}


@router.post("/automations/{rule_id}/send-now")
def send_udemy_automation_now(rule_id: int, user: CurrentUser = Depends(get_current_user)):
    """Fire a Udemy notification automation immediately (test / on-demand)."""
    if user.role not in _LICENSE_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to PMO / Admin.")
    result = automation_service.send_now(rule_id, user.email, user.role)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "send_failed"))
    return result


@router.patch("/automations/{rule_id}/toggle")
def toggle_udemy_automation(rule_id: int, user: CurrentUser = Depends(get_current_user)):
    """Toggle active/inactive for a Udemy automation."""
    if user.role not in _LICENSE_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to PMO / Admin.")
    from app.database import SessionLocal
    from app.models import AutomationRule as AR
    db = SessionLocal()
    try:
        rule = db.query(AR).filter(AR.id == rule_id).first()
        if not rule:
            raise HTTPException(status_code=404, detail="not_found")
        rule.is_active = not rule.is_active
        db.commit()
        return {"success": True, "is_active": rule.is_active}
    finally:
        db.close()


@router.get("/groups")
def udemy_groups(user: CurrentUser = Depends(get_current_user)):
    """Distinct Udemy groups from the user directory — used by the automation filter picker."""
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to HR / PMO / Admin.")
    _guard_configured()
    try:
        directory = udemy._ensure_user_directory()
        groups: set[str] = set()
        for entry in directory.values():
            for g in (entry.get("groups") or []):
                if g:
                    groups.add(g)
        return {"groups": sorted(groups)}
    except Exception as e:
        _err(e)


# ── Export endpoints (Excel download for any tabular data) ───────────────────

@router.get("/export/inactive-users")
def export_inactive_users(
    days: int = Query(None, ge=1, le=3650),
    user: CurrentUser = Depends(get_current_user),
):
    """Export inactive users as an Excel file."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to HR / PMO / Admin.")
    threshold = days if days is not None else udemy.get_inactive_default_days()
    try:
        result = udemy.get_inactive_users(threshold)
        if "error" in result:
            raise HTTPException(status_code=503, detail=result["error"])
    except HTTPException:
        raise
    except Exception as e:
        _err(e)

    rows = result.get("results") or []
    return _build_xlsx_response(
        rows,
        columns=["name", "email", "role", "groups", "last_active", "joined_date",
                 "idle_days", "never_visited", "video_minutes", "completed_courses",
                 "is_deactivated"],
        headers=["Name", "Email", "Role", "Groups", "Last Active", "Joined",
                 "Idle Days", "Never Visited", "Video Minutes", "Completed Courses",
                 "Deactivated"],
        filename=f"udemy-inactive-users-{threshold}d.xlsx",
        sheet_name="Inactive Users",
    )


@router.get("/export/user-activity")
def export_user_activity(user: CurrentUser = Depends(get_current_user)):
    """Export learner activity as an Excel file."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to HR / PMO / Admin.")
    try:
        data = udemy.get_user_activity(page=1, page_size=100)
    except Exception as e:
        _err(e)

    rows = data.get("results") or []
    return _build_xlsx_response(
        rows,
        columns=["user_name", "user_surname", "user_email", "user_role",
                 "user_joined_date", "last_date_visit", "user_is_deactivated",
                 "num_video_consumed_minutes", "num_web_visited_days",
                 "num_completed_courses"],
        headers=["First Name", "Last Name", "Email", "Role",
                 "Joined", "Last Visit", "Deactivated",
                 "Video Minutes", "Days Visited", "Completed Courses"],
        filename="udemy-learner-activity.xlsx",
        sheet_name="Learner Activity",
    )


@router.get("/export/course-activity")
def export_course_activity(user: CurrentUser = Depends(get_current_user)):
    """Export per-user course activity as an Excel file."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to HR / PMO / Admin.")
    try:
        all_rows: list[dict] = []
        page = 1
        while True:
            data = udemy.get_user_course_activity(page=page, page_size=100)
            results = data.get("results") or []
            if not results:
                break
            all_rows.extend(results)
            if not data.get("next"):
                break
            page += 1
    except Exception as e:
        _err(e)

    return _build_xlsx_response(
        all_rows,
        columns=["user_email", "course_title", "course_category",
                 "completion_ratio", "num_video_consumed_minutes",
                 "course_completion_date"],
        headers=["Email", "Course", "Category",
                 "Completion %", "Video Minutes", "Completed On"],
        filename="udemy-course-activity.xlsx",
        sheet_name="Course Activity",
    )


@router.get("/export/insights")
def export_insights(user: CurrentUser = Depends(get_current_user)):
    """Export course insights as an Excel file."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to HR / PMO / Admin.")
    try:
        data = udemy.get_course_insights()
        if "error" in data:
            raise HTTPException(status_code=503, detail=data["error"])
    except HTTPException:
        raise
    except Exception as e:
        _err(e)

    # Flatten top_enrolled + top_completed + low_engagement into one list
    all_courses = []
    seen_ids = set()
    for key in ("top_enrolled", "top_completed", "low_engagement"):
        for c in (data.get(key) or []):
            cid = c.get("course_id")
            if cid not in seen_ids:
                seen_ids.add(cid)
                all_courses.append(c)

    return _build_xlsx_response(
        all_courses,
        columns=["title", "category", "enrolled", "completed",
                 "completion_rate", "avg_completion_pct", "hours"],
        headers=["Course", "Category", "Enrolled", "Completed",
                 "Completion Rate %", "Avg Completion %", "Hours"],
        filename="udemy-insights.xlsx",
        sheet_name="Course Insights",
    )


def _build_xlsx_response(
    rows: list[dict],
    columns: list[str],
    headers: list[str],
    filename: str,
    sheet_name: str = "Sheet1",
):
    """Build an Excel file from dict rows and return a StreamingResponse."""
    import io
    from fastapi.responses import StreamingResponse

    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name

    header_font = Font(name="Segoe UI", bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="1B6FC8", end_color="1B6FC8", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style="thin", color="D1D5DB"),
        right=Side(style="thin", color="D1D5DB"),
        top=Side(style="thin", color="D1D5DB"),
        bottom=Side(style="thin", color="D1D5DB"),
    )
    cell_font = Font(name="Segoe UI", size=10)
    alt_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        cell.border = thin_border

    for row_idx, row_data in enumerate(rows, 2):
        for col_idx, col_key in enumerate(columns, 1):
            val = row_data.get(col_key, "")
            if isinstance(val, list):
                val = ", ".join(str(v) for v in val)
            if isinstance(val, bool):
                val = "Yes" if val else "No"
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.font = cell_font
            cell.border = thin_border
            if row_idx % 2 == 0:
                cell.fill = alt_fill

    for col_idx in range(1, len(headers) + 1):
        max_len = max(
            len(str(ws.cell(row=r, column=col_idx).value or ""))
            for r in range(1, min(len(rows) + 2, 100))
        )
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = min(max_len + 4, 50)

    ws.auto_filter.ref = ws.dimensions

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
