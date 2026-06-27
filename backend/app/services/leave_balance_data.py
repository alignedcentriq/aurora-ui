"""
Leave Balance Data (CSV-backed)
-------------------------------
Real per-employee leave balances sourced from a Zoho People export
(``app/data/leave_balances.csv``). This is the demo/offline source of truth for
"what's my leave balance" while live Zoho API access is pending.

The CSV has one row per employee × leave type with columns:
    Employee Record ID, Employee ID, Employee Name, Leave Type ID, Leave Code,
    Leave Name, Leave Category, Unit, Booked, Balance, ...

We expose a lookup keyed by:
  - employee code  (e.g. "AASPL-1333")   — primary, stable
  - normalised name (e.g. "shubham kulkarni") — fallback when only a name is known

``balances_for(...)`` returns the SAME shape as ``zoho_demo_data.leave_balances()``
so the agent tools and UI behave identically:
    [{"type": "Casual Leave (New)", "total": 3.0, "used": 1.0, "balance": 2.0}, ...]
"""

import csv
import os
import threading

_CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "leave_balances.csv")

# Categories that aren't real leave entitlements (markers Zoho keeps in the report).
_SKIP_CATEGORIES = {"ABSENT", "COMPENSATORY_OFF"}

_lock = threading.Lock()
_by_code: dict[str, list[dict]] | None = None
_by_name: dict[str, list[dict]] | None = None


def _norm_name(name: str) -> str:
    return " ".join((name or "").lower().split())


def _to_float(val) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def _load() -> None:
    """Parse the CSV once into in-memory indexes (code → balances, name → balances)."""
    global _by_code, _by_name
    by_code: dict[str, list[dict]] = {}
    by_name: dict[str, list[dict]] = {}

    if not os.path.exists(_CSV_PATH):
        _by_code, _by_name = {}, {}
        return

    with open(_CSV_PATH, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            code = (row.get("Employee ID") or "").strip()
            name = (row.get("Employee Name") or "").strip()
            if not code and not name:
                continue

            category = (row.get("Leave Category") or "").strip().upper()
            if category in _SKIP_CATEGORIES:
                continue

            booked = _to_float(row.get("Booked"))
            balance = _to_float(row.get("Balance"))
            # Drop leave types the employee has no stake in (0 used, 0 remaining).
            if booked == 0 and balance == 0:
                continue

            entry = {
                "type": (row.get("Leave Name") or row.get("Leave Code") or "Leave").strip(),
                "total": round(booked + balance, 2),
                "used": round(booked, 2),
                "balance": round(balance, 2),
            }
            by_code.setdefault(code, []).append(entry)
            by_name.setdefault(_norm_name(name), []).append(entry)

    _by_code, _by_name = by_code, by_name


def _ensure_loaded() -> None:
    if _by_code is None:
        with _lock:
            if _by_code is None:
                _load()


def balances_for(employee_code: str = "", name: str = "") -> list[dict] | None:
    """
    Return the leave-balance list for an employee, or None if not found.

    Looks up by employee code (AASPL-####) first, then by normalised name.
    """
    _ensure_loaded()
    if employee_code:
        hit = _by_code.get(employee_code.strip())
        if hit:
            return hit
    if name:
        hit = _by_name.get(_norm_name(name))
        if hit:
            return hit
    return None


def has_data() -> bool:
    _ensure_loaded()
    return bool(_by_code)
