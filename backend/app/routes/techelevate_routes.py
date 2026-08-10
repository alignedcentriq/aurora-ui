"""
TechElevate routes — real API integration (training.alignedautomation.com).

Auth: the browser mints an Azure AD id_token via MSAL and posts it to POST /connect, which
exchanges it at TechElevate's /auth/sso-login for a TechElevate-native JWT. That JWT is cached
in-memory per user (55 min) and forwarded as the bearer token on every proxy call below.
TechElevate enforces its own roles (admin/instructor/employee) — these routes just forward
whichever token the caller has; a 403 from TechElevate surfaces as a 403 here.

Scope: this proxies TechElevate's data/admin surface (trainings, assignments, MCQ bank,
groups, reports, analytics, users, role-mappings). It deliberately does NOT build the
interactive exam-attempt flow (mcq-exam start/submit) or proctoring (camera monitoring,
violation detection) — those aren't a goal here, not redirected elsewhere, just out of scope.

Prefix: /api/portal/techelevate
"""

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from typing import Optional

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.services.oauth_service import exchange_techelevate_id_token
from app.services.techelevate import assignments as te_assignments
from app.services.techelevate import analytics as te_analytics
from app.services.techelevate import groups as te_groups
from app.services.techelevate import mcq as te_mcq
from app.services.techelevate import reports as te_reports
from app.services.techelevate import role_mappings as te_role_mappings
from app.services.techelevate import session as te_session
from app.services.techelevate import users as te_users
from app.services.techelevate import trainings as te_trainings

router = APIRouter(prefix="/api/portal/techelevate", tags=["TechElevate"])

_CONNECT_MSG = (
    "TechElevate session not established. Open the TechElevate tab (or sign out/in) to "
    "connect your Microsoft account."
)


def _guard_enabled():
    if not settings.TECHELEVATE_ENABLED:
        raise HTTPException(status_code=503, detail="TechElevate integration is disabled.")


async def _token(user: CurrentUser) -> str:
    """Return this user's cached TechElevate JWT, or 401 prompting /connect."""
    token = te_session.get_cached_token(user.email)
    if token:
        return token
    raise HTTPException(status_code=401, detail=_CONNECT_MSG)


def _te_error(exc: Exception):
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=401, detail=_CONNECT_MSG)
    raise HTTPException(status_code=502, detail=f"TechElevate error: {exc}")


# ── Status + connect ──────────────────────────────────────────────────────────

@router.get("/status")
async def status(user: CurrentUser = Depends(get_current_user)):
    return {
        "enabled": settings.TECHELEVATE_ENABLED,
        "connected": bool(te_session.get_cached_token(user.email)),
        "portal_url": settings.TECHELEVATE_PORTAL_URL,
    }


@router.post("/connect")
async def connect(
    id_token: Optional[str] = Body(None, embed=True),
    user: CurrentUser = Depends(get_current_user),
):
    """Exchange the browser's Azure id_token for a TechElevate JWT and cache it."""
    _guard_enabled()
    if not id_token:
        raise HTTPException(status_code=422, detail="id_token is required")

    token, detail = await exchange_techelevate_id_token(id_token)
    if not token:
        raise HTTPException(
            status_code=401,
            detail=f"TechElevate rejected the sign-in token. {detail or ''}".strip(),
        )
    te_session.cache_token(user.email, token)
    return {"connected": True}


# ── Trainings ──────────────────────────────────────────────────────────────────

@router.get("/trainings")
async def list_trainings(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    search: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    _guard_enabled()
    try:
        return te_trainings.list_trainings(await _token(user), skip=skip, limit=limit, search=search)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/trainings/stats")
async def training_stats(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_trainings.get_training_stats(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/trainings/{training_id}")
async def get_training(training_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_trainings.get_training(await _token(user), training_id)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.post("/trainings")
async def create_training(payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    if not (payload.get("title") or "").strip():
        raise HTTPException(status_code=422, detail="title is required.")
    try:
        return te_trainings.create_training(await _token(user), payload)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.put("/trainings/{training_id}")
async def update_training(training_id: int, payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_trainings.update_training(await _token(user), training_id, payload)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.delete("/trainings/{training_id}")
async def delete_training(training_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        te_trainings.delete_training(await _token(user), training_id)
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.put("/training-levels/{level_id}")
async def update_training_level(level_id: int, payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_trainings.update_training_level(await _token(user), level_id, payload)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Assignments ────────────────────────────────────────────────────────────────

@router.get("/assignments/my")
async def my_assignments(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_assignments.get_my_assignments(await _token(user), user.email)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/assignments")
async def list_assignments(
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    sort_by: str = Query("id"),
    sort_order: str = Query("desc"),
    search: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    training_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    _guard_enabled()
    try:
        return te_assignments.list_assignments(
            await _token(user), skip=skip, limit=limit, sort_by=sort_by, sort_order=sort_order,
            search=search, user_id=user_id, training_id=training_id, status=status,
        )
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/assignments/stats")
async def assignment_stats(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_assignments.get_assignment_stats(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/assignments/{assignment_id}")
async def get_assignment(assignment_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_assignments.get_assignment(await _token(user), assignment_id)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.post("/assignments")
async def create_assignment(payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    for field in ("training_id", "current_level_id", "user_id"):
        if not payload.get(field):
            raise HTTPException(status_code=422, detail=f"{field} is required.")
    try:
        return te_assignments.create_assignment(
            await _token(user),
            training_id=payload["training_id"],
            current_level_id=payload["current_level_id"],
            user_id=payload["user_id"],
            training_start_date=payload.get("training_start_date"),
            training_end_date=payload.get("training_end_date"),
            status=payload.get("status", "assigned"),
            group_id=payload.get("group_id"),
            instructor_id=payload.get("instructor_id"),
        )
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.put("/assignments/{assignment_id}")
async def update_assignment(assignment_id: int, payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_assignments.update_assignment(await _token(user), assignment_id, payload)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.delete("/assignments/{assignment_id}")
async def delete_assignment(assignment_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        te_assignments.delete_assignment(await _token(user), assignment_id)
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/assignments/{assignment_id}/evaluations-detailed")
async def get_evaluations_detailed(assignment_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_assignments.get_evaluations_detailed(await _token(user), assignment_id)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Employee Groups ─────────────────────────────────────────────────────────────

@router.get("/employee-groups")
async def list_groups(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    search: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    _guard_enabled()
    try:
        return te_groups.list_groups(await _token(user), skip=skip, limit=limit, search=search)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/employee-groups/stats")
async def group_stats(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_groups.get_group_stats(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/employee-groups/{group_id}")
async def get_group(group_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_groups.get_group(await _token(user), group_id)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.post("/employee-groups")
async def create_group(payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    if not (payload.get("name") or "").strip() or not (payload.get("project_name") or "").strip():
        raise HTTPException(status_code=422, detail="name and project_name are required.")
    try:
        return te_groups.create_group(
            await _token(user), name=payload["name"], project_name=payload["project_name"],
            description=payload.get("description"), employee_ids=payload.get("employee_ids"),
        )
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.put("/employee-groups/{group_id}")
async def update_group(group_id: int, payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_groups.update_group(await _token(user), group_id, payload)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.delete("/employee-groups/{group_id}")
async def delete_group(group_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        te_groups.delete_group(await _token(user), group_id)
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.post("/group-trainings/assign")
async def assign_group_training(payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    if not payload.get("group_id") or not payload.get("training_id"):
        raise HTTPException(status_code=422, detail="group_id and training_id are required.")
    try:
        return te_groups.assign_training_to_group(
            await _token(user), group_id=payload["group_id"], training_id=payload["training_id"],
            training_start_date=payload.get("training_start_date"),
            training_end_date=payload.get("training_end_date"),
        )
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Reports ───────────────────────────────────────────────────────────────────

@router.get("/reports/overview")
async def reports_overview(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_reports.get_overview(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/top-trainings")
async def reports_top_trainings(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_reports.get_top_trainings(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/top-employees")
async def reports_top_employees(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_reports.get_top_employees(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/category-performance")
async def reports_category_performance(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_reports.get_category_performance(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/department-performance")
async def reports_department_performance(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_reports.get_department_performance(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/monthly-completions")
async def reports_monthly_completions(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_reports.get_monthly_completions(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/reports/course-enrollments")
async def reports_course_enrollments(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_reports.get_course_enrollments(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Analytics (login activity) ──────────────────────────────────────────────────

@router.get("/analytics/login-overview")
async def analytics_login_overview(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_analytics.get_login_overview(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/analytics/login-trends")
async def analytics_login_trends(
    period: str = Query("daily"),
    months: int = Query(1, ge=1, le=12),
    user: CurrentUser = Depends(get_current_user),
):
    _guard_enabled()
    try:
        return te_analytics.get_login_trends(await _token(user), period=period, months=months)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── MCQ question bank (authoring only — not the exam-attempt flow) ─────────────

@router.get("/mcq-questions")
async def list_mcq_questions(
    training_level_id: int = Query(...),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    is_active: Optional[bool] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    _guard_enabled()
    try:
        return te_mcq.list_questions(await _token(user), training_level_id=training_level_id,
                                     skip=skip, limit=limit, is_active=is_active)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.post("/mcq-questions")
async def create_mcq_question(payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    for field in ("training_level_id", "question_text", "option_a", "option_b", "option_c", "option_d", "correct_option"):
        if not payload.get(field):
            raise HTTPException(status_code=422, detail=f"{field} is required.")
    try:
        return te_mcq.create_question(await _token(user), payload)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.put("/mcq-questions/{question_id}")
async def update_mcq_question(question_id: int, payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_mcq.update_question(await _token(user), question_id, payload)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.delete("/mcq-questions/{question_id}")
async def delete_mcq_question(question_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        te_mcq.delete_question(await _token(user), question_id)
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.put("/mcq-questions/{question_id}/toggle")
async def toggle_mcq_question(question_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_mcq.toggle_question(await _token(user), question_id)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/certificates")
async def my_certificates(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_mcq.get_my_certificates(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Users ────────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    _guard_enabled()
    try:
        return te_users.list_users(await _token(user), skip=skip, limit=limit, search=search, role=role)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/users/stats")
async def users_stats(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_users.get_users_stats(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.get("/users/filter-options")
async def users_filter_options(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_users.get_filter_options(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.put("/users/{email}/toggle-active")
async def toggle_user_active(email: str, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_users.toggle_active(await _token(user), email)
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


# ── Role Mappings (admin only) ───────────────────────────────────────────────────

@router.get("/role-mappings")
async def list_role_mappings(user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        return te_role_mappings.list_role_mappings(await _token(user))
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.post("/role-mappings")
async def create_role_mapping(payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    if not payload.get("email") or not payload.get("role"):
        raise HTTPException(status_code=422, detail="email and role are required.")
    try:
        return te_role_mappings.create_role_mapping(await _token(user), email=payload["email"], role=payload["role"])
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.put("/role-mappings/{mapping_id}")
async def update_role_mapping(mapping_id: int, payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    if not payload.get("role"):
        raise HTTPException(status_code=422, detail="role is required.")
    try:
        return te_role_mappings.update_role_mapping(await _token(user), mapping_id, role=payload["role"])
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)


@router.delete("/role-mappings/{mapping_id}")
async def delete_role_mapping(mapping_id: int, user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    try:
        te_role_mappings.delete_role_mapping(await _token(user), mapping_id)
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        _te_error(e)
