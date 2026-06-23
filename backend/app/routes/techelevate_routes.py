"""
TechElevate Training Portal routes.

All endpoints proxy to the TechElevate API at TECHELEVATE_BASE_URL using the
caller's Microsoft-derived bearer token. Role enforcement (admin vs. employee)
is done by TechElevate itself; Centriq routes just forward the token.

Prefix: /api/portal/techelevate
"""

import time
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from app.auth import CurrentUser, get_current_user
from app.services.oauth_service import (
    exchange_techelevate_id_token,
    get_techelevate_token,
)
from app.services.techelevate_service import (
    get_all_logins,
    get_assignment_evaluations,
    get_assignment_level_dates,
    get_assignment_stats,
    get_category_performance,
    get_course_enrollments,
    get_department_performance,
    get_employee_group_stats,
    get_login_overview,
    get_login_trends,
    get_me,
    get_monthly_completions,
    get_reports_overview,
    get_top_employees,
    get_top_employees_by_training,
    get_top_trainings,
    get_training_details_report,
    get_training_level,
    get_training_stats,
    list_assignments,
    list_employee_groups,
    list_employees_for_group,
    list_trainings,
    list_users,
    get_my_assignments,
    get_user_filter_options,
)

router = APIRouter(prefix="/api/portal/techelevate", tags=["TechElevate"])

_CONNECT_MSG = (
    "TechElevate session not established. Sign in with your Microsoft account "
    "in Centriq, then reopen TechElevate."
)

# In-memory token cache: email → (te_jwt, expires_at_unix).
#
# Primary auth path (this environment): the browser acquires an Azure AD
# id_token via MSAL and posts it to POST /connect, which exchanges it at
# TechElevate's /api/auth/sso-login for a native JWT cached here.
# Legacy path (no connected_accounts table in this DB → currently inert):
# get_techelevate_token() mints from a stored Microsoft refresh token.
_te_session: dict[str, tuple[str, float]] = {}


async def _token(user: CurrentUser) -> str:
    """Return a cached TechElevate JWT for this user, or 401 to prompt /connect."""
    from app.config import settings as _s
    cached = _te_session.get(user.email)
    if cached and cached[1] > time.time():
        return cached[0]

    token = await get_techelevate_token(user.email)
    # Dev bypass: TECHELEVATE_DEV_JWT in .env.local lets the portal load without MSAL.
    if not token and _s.TECHELEVATE_DEV_JWT:
        token = _s.TECHELEVATE_DEV_JWT
    if not token:
        raise HTTPException(status_code=401, detail=_CONNECT_MSG)
    _te_session[user.email] = (token, time.time() + 55 * 60)
    return token


# ── Connect (frontend-minted id_token → TechElevate JWT) ─────────────────────────

@router.post("/connect")
async def te_connect(
    id_token: Optional[str] = Body(None, embed=True),
    te_jwt: Optional[str] = Body(None, embed=True),
    user: CurrentUser = Depends(get_current_user),
):
    """Establish a TechElevate session.

    Primary path: post {id_token} (browser MSAL) → exchange at sso-login.
    Dev/manual path: post {te_jwt} directly (grab from DevTools on training.alignedautomation.com).
    """
    if te_jwt:
        _te_session[user.email] = (te_jwt, time.time() + 55 * 60)
        return {"connected": True}

    if not id_token:
        raise HTTPException(status_code=422, detail="id_token or te_jwt required")

    result, detail = await exchange_techelevate_id_token(id_token)
    if not result:
        raise HTTPException(
            status_code=401,
            detail=f"TechElevate rejected the sign-in token. {detail or ''}".strip(),
        )
    _te_session[user.email] = (result, time.time() + 55 * 60)
    return {"connected": True}


def _te_error(exc: Exception):
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=401, detail=_CONNECT_MSG)
    raise HTTPException(status_code=502, detail=f"TechElevate error: {exc}")


# ── Profile ────────────────────────────────────────────────────────────────────

@router.get("/me")
async def te_me(user: CurrentUser = Depends(get_current_user)):
    """Current user's TechElevate profile including role ('admin' | 'employee')."""
    try:
        return get_me(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Trainings ─────────────────────────────────────────────────────────────────

@router.get("/trainings")
async def te_list_trainings(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=10000),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return list_trainings(await _token(user), skip=skip, limit=limit)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/trainings/stats")
async def te_training_stats(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_training_stats(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/training-levels/{level_id}")
async def te_training_level(level_id: int, user: CurrentUser = Depends(get_current_user)):
    try:
        return get_training_level(await _token(user), level_id)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Assignments ───────────────────────────────────────────────────────────────

@router.get("/assignments")
async def te_list_assignments(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    sort_by: str = Query("user_name"),
    sort_order: str = Query("asc"),
    training_id: Optional[int] = Query(None),
    user_email: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return list_assignments(
            await _token(user),
            skip=skip,
            limit=limit,
            sort_by=sort_by,
            sort_order=sort_order,
            training_id=training_id,
            user_email=user_email,
            status=status,
            department=department,
        )
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/assignments/stats")
async def te_assignment_stats(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_assignment_stats(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/assignments/my")
async def te_my_assignments(user: CurrentUser = Depends(get_current_user)):
    """Assignments for the currently signed-in employee."""
    try:
        return get_my_assignments(await _token(user), user.email)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/assignments/{assignment_id}/evaluations")
async def te_assignment_evaluations(
    assignment_id: int,
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return get_assignment_evaluations(await _token(user), assignment_id)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/assignments/{assignment_id}/level-dates")
async def te_assignment_level_dates(
    assignment_id: int,
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return get_assignment_level_dates(await _token(user), assignment_id)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
async def te_list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=10000),
    search: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return list_users(await _token(user), skip=skip, limit=limit, search=search,
                          department=department, role=role)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/users/filter-options")
async def te_user_filter_options(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_user_filter_options(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/employees/all-for-group")
async def te_employees_for_group(user: CurrentUser = Depends(get_current_user)):
    try:
        return list_employees_for_group(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/employee-groups")
async def te_employee_groups(
    limit: int = Query(1000, ge=1, le=10000),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return list_employee_groups(await _token(user), limit=limit)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/employee-groups/stats")
async def te_employee_group_stats(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_employee_group_stats(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Reports ───────────────────────────────────────────────────────────────────

@router.get("/reports/overview")
async def te_reports_overview(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_reports_overview(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/top-employees")
async def te_top_employees(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_top_employees(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/top-trainings")
async def te_top_trainings(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_top_trainings(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/category-performance")
async def te_category_performance(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_category_performance(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/department-performance")
async def te_department_performance(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_department_performance(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/top-employees-by-training")
async def te_top_employees_by_training(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_top_employees_by_training(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/training-details")
async def te_training_details_report(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_training_details_report(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/monthly-completions")
async def te_monthly_completions(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_monthly_completions(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/course-enrollments")
async def te_course_enrollments(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_course_enrollments(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/analytics/login-overview")
async def te_login_overview(user: CurrentUser = Depends(get_current_user)):
    try:
        return get_login_overview(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/analytics/login-trends")
async def te_login_trends(
    period: str = Query("daily"),
    months: int = Query(1, ge=1, le=12),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return get_login_trends(await _token(user), period=period, months=months)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/analytics/all-logins")
async def te_all_logins(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: CurrentUser = Depends(get_current_user),
):
    try:
        return get_all_logins(await _token(user), page=page, page_size=page_size)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)
