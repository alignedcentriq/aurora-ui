"""
Proxy for the real TechElevate employee-groups endpoints.

Confirmed real paths:
  GET    /employee-groups?skip&limit&search&project_name&sort_by&sort_order
  GET    /employee-groups/stats
  GET    /employee-groups/{id}
  POST   /employee-groups           admin only — {name, description, project_name, employee_ids[]}
  PUT    /employee-groups/{id}      admin only
  DELETE /employee-groups/{id}      admin only
  POST   /group-trainings/assign    admin only — {group_id, training_id, training_start_date, training_end_date}
"""

from . import _client as c


def list_groups(token: str, *, skip: int = 0, limit: int = 100, search: str | None = None) -> dict:
    params: dict = {"skip": skip, "limit": limit}
    if search:
        params["search"] = search
    return c.get(token, "/employee-groups", params=params)


def get_group_stats(token: str) -> dict:
    return c.get(token, "/employee-groups/stats")


def get_group(token: str, group_id: int) -> dict:
    return c.get(token, f"/employee-groups/{group_id}")


def create_group(token: str, *, name: str, project_name: str, description: str | None = None,
                 employee_ids: list[str] | None = None) -> dict:
    payload = {"name": name, "project_name": project_name, "description": description,
               "employee_ids": employee_ids or []}
    return c.post(token, "/employee-groups", json=payload)


def update_group(token: str, group_id: int, payload: dict) -> dict:
    return c.put(token, f"/employee-groups/{group_id}", json=payload)


def delete_group(token: str, group_id: int) -> None:
    return c.delete(token, f"/employee-groups/{group_id}")


def assign_training_to_group(token: str, *, group_id: int, training_id: int,
                             training_start_date: str | None = None,
                             training_end_date: str | None = None) -> dict:
    payload: dict = {"group_id": group_id, "training_id": training_id}
    if training_start_date:
        payload["training_start_date"] = training_start_date
    if training_end_date:
        payload["training_end_date"] = training_end_date
    return c.post(token, "/group-trainings/assign", json=payload)
