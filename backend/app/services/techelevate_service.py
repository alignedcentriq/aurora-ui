"""
TechElevate Training Portal API service.

TechElevate (https://training.alignedautomation.com/api) is secured with the
same Azure AD app as Alchemy (App ID: 4a7dad8b-1372-499d-ade0-a91fe84ae4d6).
Tokens are obtained via oauth_service.get_techelevate_token().

Confirmed endpoints (from HAR analysis 2026-06-22):
  GET /trainings?limit=N            list trainings with embedded levels[]
  GET /trainings/stats              {total_trainings, with_levels, single_level, ...}
  GET /training-levels/{id}         level detail + exam questions
  GET /assignments?skip&limit&...   paginated assignment list (admin)
  GET /assignments/stats            {total, completed, in_progress, pending, average_score}
  GET /assignments/{id}/evaluations-detailed
  GET /assignments/{id}/level-dates
  GET /users?limit=N                all users
  GET /users/me                     current user profile + role
  GET /users/filter-options         {departments, designations}
  GET /employees/all-for-group      flat employee list for group assignment
  GET /employee-groups?limit=N      employee groups
  GET /employee-groups/stats
  GET /reports/overview             dashboard KPIs
  GET /reports/top-employees
  GET /reports/top-trainings
  GET /reports/category-performance
  GET /reports/department-performance
  GET /reports/top-employees-by-training
  GET /reports/training-details
  GET /reports/monthly-completions
  GET /reports/course-enrollments
  GET /analytics/login-overview
  GET /analytics/login-trends?period=daily&months=N
  GET /analytics/all-logins?page=N&page_size=N
"""

import logging

import httpx

from app.config import settings

log = logging.getLogger("aurora-logger")

_BASE = settings.TECHELEVATE_BASE_URL.rstrip("/")

_CONNECT_MSG = (
    "Please connect your Microsoft account first. "
    "Go to **Settings > Connected Accounts** and click **Connect Microsoft**."
)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _check(resp: httpx.Response, label: str) -> dict | list:
    if resp.status_code in (401, 403):
        raise PermissionError("not_connected")
    if not resp.is_success:
        log.warning("[techelevate] %s → %s %s", label, resp.status_code, resp.text[:200])
        resp.raise_for_status()
    return resp.json()


# ── Trainings ────────────────────────────────────────────────────────────────

def list_trainings(token: str, skip: int = 0, limit: int = 100) -> dict:
    """GET /trainings — list with embedded levels[]."""
    with httpx.Client(timeout=20) as c:
        resp = c.get(f"{_BASE}/trainings", headers=_headers(token),
                     params={"skip": skip, "limit": limit})
    return _check(resp, "trainings")


def get_training_stats(token: str) -> dict:
    """GET /trainings/stats — {total_trainings, with_levels, single_level, total_duration_minutes}."""
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/trainings/stats", headers=_headers(token))
    return _check(resp, "trainings/stats")


def get_training_level(token: str, level_id: int) -> dict:
    """GET /training-levels/{id} — level detail including content and exam questions."""
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/training-levels/{level_id}", headers=_headers(token))
    return _check(resp, f"training-levels/{level_id}")


# ── Assignments ──────────────────────────────────────────────────────────────

def list_assignments(
    token: str,
    *,
    skip: int = 0,
    limit: int = 50,
    sort_by: str = "user_name",
    sort_order: str = "asc",
    training_id: int | None = None,
    user_email: str | None = None,
    status: str | None = None,
    department: str | None = None,
) -> dict:
    """GET /assignments — paginated list (admin view)."""
    params: dict = {"skip": skip, "limit": limit, "sort_by": sort_by, "sort_order": sort_order}
    if training_id:
        params["training_id"] = training_id
    if user_email:
        params["user_id"] = user_email
    if status:
        params["status"] = status
    if department:
        params["department"] = department
    with httpx.Client(timeout=20) as c:
        resp = c.get(f"{_BASE}/assignments", headers=_headers(token), params=params)
    return _check(resp, "assignments")


def get_assignment_stats(token: str) -> dict:
    """GET /assignments/stats — {total, completed, in_progress, pending, average_score}."""
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/assignments/stats", headers=_headers(token))
    return _check(resp, "assignments/stats")


def get_assignment_evaluations(token: str, assignment_id: int) -> list:
    """GET /assignments/{id}/evaluations-detailed — MCQ + practical scores per level."""
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/assignments/{assignment_id}/evaluations-detailed",
                     headers=_headers(token))
    data = _check(resp, f"assignments/{assignment_id}/evaluations-detailed")
    return data if isinstance(data, list) else []


def get_assignment_level_dates(token: str, assignment_id: int) -> dict:
    """GET /assignments/{id}/level-dates — {level_id: {start_date, due_date}}."""
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/assignments/{assignment_id}/level-dates",
                     headers=_headers(token))
    return _check(resp, f"assignments/{assignment_id}/level-dates")


def get_my_assignments(token: str, user_email: str) -> dict:
    """Fetch assignments for a specific employee (employee self-view)."""
    return list_assignments(token, user_email=user_email, limit=200)


# ── Users ─────────────────────────────────────────────────────────────────────

def get_me(token: str) -> dict:
    """GET /users/me — caller's profile including role ('admin' | 'employee')."""
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/users/me", headers=_headers(token))
    return _check(resp, "users/me")


def list_users(
    token: str,
    *,
    skip: int = 0,
    limit: int = 1000,
    search: str | None = None,
    department: str | None = None,
    role: str | None = None,
) -> dict:
    """GET /users — paginated employee list."""
    params: dict = {"skip": skip, "limit": limit}
    if search:
        params["search"] = search
    if department:
        params["department"] = department
    if role:
        params["role"] = role
    with httpx.Client(timeout=20) as c:
        resp = c.get(f"{_BASE}/users", headers=_headers(token), params=params)
    return _check(resp, "users")


def get_user_filter_options(token: str) -> dict:
    """GET /users/filter-options — {departments, designations}."""
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/users/filter-options", headers=_headers(token))
    return _check(resp, "users/filter-options")


def list_employees_for_group(token: str) -> dict:
    """GET /employees/all-for-group — flat employee list for group assignment."""
    with httpx.Client(timeout=20) as c:
        resp = c.get(f"{_BASE}/employees/all-for-group", headers=_headers(token))
    return _check(resp, "employees/all-for-group")


# ── Employee Groups ───────────────────────────────────────────────────────────

def list_employee_groups(token: str, limit: int = 1000) -> dict:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/employee-groups", headers=_headers(token),
                     params={"limit": limit})
    return _check(resp, "employee-groups")


def get_employee_group_stats(token: str) -> dict:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/employee-groups/stats", headers=_headers(token))
    return _check(resp, "employee-groups/stats")


# ── Reports ───────────────────────────────────────────────────────────────────

def get_reports_overview(token: str) -> dict:
    """GET /reports/overview — high-level KPIs for the admin dashboard."""
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/reports/overview", headers=_headers(token))
    return _check(resp, "reports/overview")


def get_top_employees(token: str) -> list:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/reports/top-employees", headers=_headers(token))
    data = _check(resp, "reports/top-employees")
    return data if isinstance(data, list) else []


def get_top_trainings(token: str) -> list:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/reports/top-trainings", headers=_headers(token))
    data = _check(resp, "reports/top-trainings")
    return data if isinstance(data, list) else []


def get_category_performance(token: str) -> list:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/reports/category-performance", headers=_headers(token))
    data = _check(resp, "reports/category-performance")
    return data if isinstance(data, list) else []


def get_department_performance(token: str) -> list:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/reports/department-performance", headers=_headers(token))
    data = _check(resp, "reports/department-performance")
    return data if isinstance(data, list) else []


def get_top_employees_by_training(token: str) -> dict:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/reports/top-employees-by-training", headers=_headers(token))
    return _check(resp, "reports/top-employees-by-training")


def get_training_details_report(token: str) -> list:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/reports/training-details", headers=_headers(token))
    data = _check(resp, "reports/training-details")
    return data if isinstance(data, list) else []


def get_monthly_completions(token: str) -> list:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/reports/monthly-completions", headers=_headers(token))
    data = _check(resp, "reports/monthly-completions")
    return data if isinstance(data, list) else []


def get_course_enrollments(token: str) -> list:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/reports/course-enrollments", headers=_headers(token))
    data = _check(resp, "reports/course-enrollments")
    return data if isinstance(data, list) else []


# ── Analytics ─────────────────────────────────────────────────────────────────

def get_login_overview(token: str) -> dict:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/analytics/login-overview", headers=_headers(token))
    return _check(resp, "analytics/login-overview")


def get_login_trends(token: str, period: str = "daily", months: int = 1) -> dict:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/analytics/login-trends", headers=_headers(token),
                     params={"period": period, "months": months})
    return _check(resp, "analytics/login-trends")


def get_all_logins(token: str, page: int = 1, page_size: int = 50) -> dict:
    with httpx.Client(timeout=15) as c:
        resp = c.get(f"{_BASE}/analytics/all-logins", headers=_headers(token),
                     params={"page": page, "page_size": page_size})
    return _check(resp, "analytics/all-logins")
