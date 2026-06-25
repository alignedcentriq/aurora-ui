"""
Udemy Business portal routes.

Proxies the org's Udemy Business catalog & reporting API (HTTP Basic auth with
the stored client id/secret) so the frontend never sees the credential. The
catalog is readable by any authenticated user; the learner-activity report is
gated to people-management roles.

Prefix: /api/portal/udemy
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import CurrentUser, get_current_user
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
    _guard_configured()
    try:
        return udemy.get_course(course_id)
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
