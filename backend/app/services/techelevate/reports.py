"""
Proxy for the real TechElevate reports endpoints (core subset — the real backend has a much
larger reports surface; this covers the dashboard-level reports Insights.jsx renders).

Confirmed real paths:
  GET /reports/overview
  GET /reports/top-trainings
  GET /reports/top-employees
  GET /reports/category-performance
  GET /reports/department-performance
  GET /reports/monthly-completions
  GET /reports/course-enrollments
"""

from . import _client as c


def get_overview(token: str) -> dict:
    return c.get(token, "/reports/overview")


def get_top_trainings(token: str) -> list:
    return c.get(token, "/reports/top-trainings")


def get_top_employees(token: str) -> list:
    return c.get(token, "/reports/top-employees")


def get_category_performance(token: str) -> list:
    return c.get(token, "/reports/category-performance")


def get_department_performance(token: str) -> list:
    return c.get(token, "/reports/department-performance")


def get_monthly_completions(token: str) -> list:
    return c.get(token, "/reports/monthly-completions")


def get_course_enrollments(token: str) -> list:
    return c.get(token, "/reports/course-enrollments")
