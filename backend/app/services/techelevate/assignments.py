"""
Proxy for the real TechElevate assignments endpoints (CRUD + stats + evaluations).

Confirmed real paths:
  GET    /assignments?skip&limit&sort_by&sort_order&search&user_id&training_id&group_id&status
  GET    /assignments/stats                      admin/instructor only
  GET    /assignments/{id}
  POST   /assignments                             {training_id, current_level_id, user_id, ...}
  PUT    /assignments/{id}                        {status, current_level_id, ...}
  DELETE /assignments/{id}
  GET    /assignments/{id}/evaluations-detailed

TechElevate scopes GET /assignments itself: admins may pass user_id for anyone, employees are
always scoped to their own email regardless of what's passed.
"""

from . import _client as c


def list_assignments(
    token: str,
    *,
    skip: int = 0,
    limit: int = 200,
    sort_by: str = "id",
    sort_order: str = "desc",
    search: str | None = None,
    user_id: str | None = None,
    training_id: int | None = None,
    status: str | None = None,
) -> dict:
    params: dict = {"skip": skip, "limit": limit, "sort_by": sort_by, "sort_order": sort_order}
    if search:
        params["search"] = search
    if user_id:
        params["user_id"] = user_id
    if training_id:
        params["training_id"] = training_id
    if status:
        params["status"] = status
    return c.get(token, "/assignments", params=params)


def get_my_assignments(token: str, email: str) -> dict:
    """Assignments for the calling employee. TechElevate scopes non-admin callers to
    their own email regardless of user_id, so this is just a readable alias."""
    return list_assignments(token, user_id=email, limit=200)


def get_assignment_stats(token: str) -> dict:
    return c.get(token, "/assignments/stats")


def get_assignment(token: str, assignment_id: int) -> dict:
    return c.get(token, f"/assignments/{assignment_id}")


def create_assignment(
    token: str,
    *,
    training_id: int,
    current_level_id: int,
    user_id: str,
    training_start_date: str | None = None,
    training_end_date: str | None = None,
    status: str = "assigned",
    group_id: int | None = None,
    instructor_id: str | None = None,
) -> dict:
    payload: dict = {
        "training_id": training_id,
        "current_level_id": current_level_id,
        "user_id": user_id,
        "status": status,
    }
    if training_start_date:
        payload["training_start_date"] = training_start_date
    if training_end_date:
        payload["training_end_date"] = training_end_date
    if group_id:
        payload["group_id"] = group_id
    if instructor_id:
        payload["instructor_id"] = instructor_id
    return c.post(token, "/assignments", json=payload)


def update_assignment(token: str, assignment_id: int, payload: dict) -> dict:
    return c.put(token, f"/assignments/{assignment_id}", json=payload)


def delete_assignment(token: str, assignment_id: int) -> None:
    return c.delete(token, f"/assignments/{assignment_id}")


def get_evaluations_detailed(token: str, assignment_id: int) -> list:
    return c.get(token, f"/assignments/{assignment_id}/evaluations-detailed")
