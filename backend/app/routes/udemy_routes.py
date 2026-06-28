"""
Udemy Business portal routes.

Proxies the org's Udemy Business catalog & reporting API (HTTP Basic auth with
the stored client id/secret) so the frontend never sees the credential. The
catalog is readable by any authenticated user; the learner-activity report is
gated to people-management roles.

Prefix: /api/portal/udemy
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.services import udemy_business_service as udemy

router = APIRouter(prefix="/api/portal/udemy", tags=["Udemy Business"])

_NOT_CONFIGURED = (
    "Udemy Business isn't connected yet. An administrator needs to set "
    "UDEMY_CLIENT_ID / UDEMY_CLIENT_SECRET in the backend environment."
)

# Roles allowed to see org-wide learner activity (reporting).
_REPORT_ROLES = {"hr", "pmo", "admin", "super admin"}


def _guard_configured():
    if not udemy.configured():
        raise HTTPException(status_code=503, detail=_NOT_CONFIGURED)


def _err(exc: Exception):
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=503, detail=_NOT_CONFIGURED)
    raise HTTPException(status_code=502, detail=f"Udemy error: {exc}")


@router.get("/status")
async def udemy_status(user: CurrentUser = Depends(get_current_user)):
    """Whether the integration is wired, report access, and search-index readiness.

    Calling this also warms the search index in the background (the portal hits
    /status on load), so search is likely ready by the time the user types.
    """
    out = {
        "configured": udemy.configured(),
        "can_view_reports": user.role in _REPORT_ROLES,
    }
    if udemy.configured():
        out["index"] = udemy.index_status()  # triggers background warm-up
    return out


@router.get("/courses")
async def udemy_courses(
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
async def udemy_course_detail(course_id: int, user: CurrentUser = Depends(get_current_user)):
    """Full course detail with org enrollment + completion stats annotated."""
    _guard_configured()
    try:
        return udemy.get_course_with_org_stats(course_id)
    except HTTPException:
        raise
    except Exception as e:
        _err(e)


@router.get("/analytics/org-course-stats")
async def org_course_stats(user: CurrentUser = Depends(get_current_user)):
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
async def udemy_user_activity(
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
async def udemy_user_course_activity(
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
async def udemy_user_progress(
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


@router.post("/analytics/sync-skills")
async def udemy_sync_skills(
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
async def udemy_sync_skills_status(user: CurrentUser = Depends(get_current_user)):
    """Last skill sync result (in-memory — resets on server restart)."""
    _guard_configured()
    if user.role not in _REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Restricted to HR / PMO / Admin.")
    return udemy.last_sync_status()
