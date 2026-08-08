"""
Zoho leave-tracker source (types, balances, request history, holidays).

Same reporting Postgres server as services/zoho_directory_service.py (ZOHO_DBURL),
same "people" schema, same design: raw SQL against read-only VIEWs, columns read
case-insensitively, fail-soft (returns [] on any error or when unconfigured) so
callers can fall back to the CSV/synthetic sources gracefully.

Views (see app/config.py):
  ZOHO_LEAVE_TYPES_VIEW    = people.vt_leave_types     (leave-type catalog)
  ZOHO_LEAVE_BALANCES_VIEW = people.vt_leave_balances  (per-employee booked/balance)
  ZOHO_LEAVE_DETAILS_VIEW  = people.vt_leave_details   (individual leave requests)
  ZOHO_HOLIDAY_LIST_VIEW   = people.vt_holiday_list    (company holiday calendar)

Employee join keys:
  - vt_leave_balances."Employee ID" is the Zoho employee code (e.g. "AASPL-1741"),
    same as vb_employees."EmployeeId" and the local Employee.employee_id column.
  - vt_leave_details."Employee ID" is instead the numeric Zoho record id (matches
    vb_employees.employee_id), so leave history needs an extra code -> numeric-id
    lookup via the employee directory view.
"""

import datetime

from sqlalchemy import text

from app.config import settings
from app.services.zoho_directory_service import _get_engine, _g, is_configured

# Categories that aren't real leave entitlements (markers Zoho keeps in the report).
# Compensatory Off IS a real, usable leave type — only "Absent" is a bookkeeping marker.
_SKIP_CATEGORIES = {"ABSENT"}


def _to_float(val) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def _fetch_rows(view: str) -> list[dict]:
    engine = _get_engine()
    if engine is None:
        return []
    try:
        with engine.connect() as conn:
            result = conn.execute(text(f"SELECT * FROM {view}"))
            return [{str(k).lower(): v for k, v in m.items()} for m in result.mappings().all()]
    except Exception:
        return []


def fetch_leave_types() -> list[dict]:
    """Active leave types: [{"id": "<zoho id>", "name": "Casual Leave", "category": "Paid"}, ...]."""
    view = (settings.ZOHO_LEAVE_TYPES_VIEW or "people.vt_leave_types").strip()
    out = []
    for row in _fetch_rows(view):
        if _g(row, "is leave type enabled").lower() not in ("yes", "true", "1"):
            continue
        out.append({
            "id": _g(row, "id"),
            "name": _g(row, "leave type"),
            "category": _g(row, "type of leave"),
        })
    return out


def fetch_leave_balances(employee_code: str) -> list[dict]:
    """
    Per-employee leave balances, matching the shape the rest of the app already expects
    (see services/leave_balance_data.py):
        [{"type": "Casual Leave (New)", "total": 3.0, "used": 1.0, "balance": 2.0}, ...]
    """
    code = (employee_code or "").strip()
    if not code:
        return []
    view = (settings.ZOHO_LEAVE_BALANCES_VIEW or "people.vt_leave_balances").strip()
    out = []
    for row in _fetch_rows(view):
        if _g(row, "employee id") != code:
            continue
        category = _g(row, "leave category").upper()
        if category in _SKIP_CATEGORIES:
            continue
        booked = _to_float(row.get("booked"))
        balance = _to_float(row.get("balance"))
        if booked == 0 and balance == 0:
            continue
        out.append({
            "type": _g(row, "leave name", "leave code") or "Leave",
            "total": round(booked + balance, 2),
            "used": round(booked, 2),
            "balance": round(balance, 2),
        })
    return out


def _employee_numeric_id(employee_code: str) -> str:
    """Resolve an "AASPL-####" code to the numeric Zoho record id used by vt_leave_details."""
    code = (employee_code or "").strip()
    if not code:
        return ""
    engine = _get_engine()
    if engine is None:
        return ""
    view = (settings.ZOHO_VIEW or "vb_employees").strip()
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text(f'SELECT employee_id FROM {view} WHERE "EmployeeId" = :code'),
                {"code": code},
            )
            row = result.first()
            return str(row[0]) if row and row[0] is not None else ""
    except Exception:
        return ""


def fetch_leave_history(employee_code: str, limit: int = 20) -> list[dict]:
    """
    Individual leave requests for one employee, newest first:
        [{"type": "Sick Leave", "from": "2026-08-04", "to": "2026-08-04",
          "days": 1.0, "status": "Pending", "reason": "..."}, ...]
    """
    numeric_id = _employee_numeric_id(employee_code)
    if not numeric_id:
        return []

    view = (settings.ZOHO_LEAVE_DETAILS_VIEW or "people.vt_leave_details").strip()
    type_names = {t["id"]: t["name"] for t in fetch_leave_types()}

    rows = []
    for row in _fetch_rows(view):
        if _g(row, "employee id") != numeric_id:
            continue
        from_dt = row.get("from")
        rows.append({
            "type": type_names.get(_g(row, "leave type"), _g(row, "leave type")),
            "from": from_dt.date().isoformat() if isinstance(from_dt, datetime.datetime) else str(from_dt or ""),
            "to": (row.get("to").date().isoformat() if isinstance(row.get("to"), datetime.datetime) else str(row.get("to") or "")),
            "days": _to_float(row.get("leave taken")),
            "status": _g(row, "approval status"),
            "reason": _g(row, "reason for leave"),
            "_sort": from_dt if isinstance(from_dt, datetime.datetime) else datetime.datetime.min,
        })

    rows.sort(key=lambda r: r["_sort"], reverse=True)
    for r in rows:
        r.pop("_sort", None)
    return rows[:limit]


def fetch_holidays(year: int | None = None, location_name: str | None = None) -> list[dict]:
    """
    Company holidays for a given year (default: current year), optionally filtered by
    work location: [{"name": "Good Friday", "date": "2026-04-03", "location": "Pune"}, ...]
    """
    target_year = year or datetime.date.today().year
    view = (settings.ZOHO_HOLIDAY_LIST_VIEW or "people.vt_holiday_list").strip()
    loc_filter = (location_name or "").strip().lower()

    out = []
    for row in _fetch_rows(view):
        d = row.get("date")
        if not isinstance(d, (datetime.date, datetime.datetime)):
            continue
        if d.year != target_year:
            continue
        loc = _g(row, "locationname")
        if loc_filter and loc_filter not in loc.lower():
            continue
        out.append({
            "name": _g(row, "name"),
            "date": d.date().isoformat() if isinstance(d, datetime.datetime) else d.isoformat(),
            "location": loc,
        })

    out.sort(key=lambda h: h["date"])
    return out


__all__ = [
    "is_configured",
    "fetch_leave_types",
    "fetch_leave_balances",
    "fetch_leave_history",
    "fetch_holidays",
]
