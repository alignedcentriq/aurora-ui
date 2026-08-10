"""
Proxy for the real TechElevate login-analytics endpoints.

Confirmed real paths:
  GET /analytics/login-overview
  GET /analytics/login-trends?period=daily&months=N
  GET /analytics/all-logins?page=N&page_size=N
"""

from . import _client as c


def get_login_overview(token: str) -> dict:
    return c.get(token, "/analytics/login-overview")


def get_login_trends(token: str, *, period: str = "daily", months: int = 1) -> dict:
    return c.get(token, "/analytics/login-trends", params={"period": period, "months": months})


def get_all_logins(token: str, *, page: int = 1, page_size: int = 50) -> dict:
    return c.get(token, "/analytics/all-logins", params={"page": page, "page_size": page_size})
