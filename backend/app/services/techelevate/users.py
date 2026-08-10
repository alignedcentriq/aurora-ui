"""
Proxy for the real TechElevate users endpoints.

Confirmed real paths (all admin/instructor only unless noted):
  GET /users?skip&limit&sort_by&sort_order&search&role&is_active&...
  GET /users/stats
  GET /users/filter-options
  PUT /users/{email}/toggle-active     admin only
"""

from . import _client as c


def list_users(token: str, *, skip: int = 0, limit: int = 20, search: str | None = None,
               role: str | None = None) -> dict:
    params: dict = {"skip": skip, "limit": limit}
    if search:
        params["search"] = search
    if role:
        params["role"] = role
    return c.get(token, "/users", params=params)


def get_users_stats(token: str) -> dict:
    return c.get(token, "/users/stats")


def get_filter_options(token: str) -> dict:
    return c.get(token, "/users/filter-options")


def toggle_active(token: str, email: str) -> dict:
    return c.put(token, f"/users/{email}/toggle-active")
