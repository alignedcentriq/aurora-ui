"""
Attendance Service
------------------
Aggregates the internal daily `attendance` table (app.models.Attendance) into the monthly
summary shape the attendance tools/UI expect: present / absent / wfh / late counts.

"Late" is derived from the check-in time (after LATE_THRESHOLD) on Present days, since the
table has no explicit late flag. Works for the logged-in user OR any employee (by name/email).

This is internal DB data, so it powers the demo regardless of Zoho API availability.
"""

import datetime

from sqlalchemy import func

from app.database import SessionLocal
from app.models import Attendance, Employee

LATE_THRESHOLD = datetime.time(9, 30)


def _month_bounds(year: int, month: int) -> tuple[datetime.date, datetime.date]:
    start = datetime.date(year, month, 1)
    if month == 12:
        end = datetime.date(year, 12, 31)
    else:
        end = datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)
    return start, end


def resolve_employee(db, query: str):
    """Find an employee by exact email, else partial name match (first hit)."""
    q = (query or "").strip()
    if not q:
        return None
    emp = db.query(Employee).filter(func.lower(Employee.email) == q.lower()).first()
    if emp:
        return emp
    return db.query(Employee).filter(Employee.name.ilike(f"%{q}%")).first()


def _summary_for_employee(db, emp: Employee, month: str = "", year: str = "") -> dict:
    today = datetime.date.today()
    m = int(month) if month else today.month
    y = int(year) if year else today.year
    start, end = _month_bounds(y, m)
    end = min(end, today)  # don't count days in the future

    rows = (
        db.query(Attendance)
        .filter(
            Attendance.employee_id == emp.id,
            Attendance.date >= start,
            Attendance.date <= end,
        )
        .all()
    )

    present = absent = wfh = late = half_day = 0
    for r in rows:
        status = (r.status or "").strip()
        if status == "Present":
            present += 1
            if r.check_in and r.check_in.time() > LATE_THRESHOLD:
                late += 1
        elif status == "Absent":
            absent += 1
        elif status == "WFH":
            wfh += 1
        elif status == "Half-day":
            half_day += 1

    return {
        "success": True,
        "employee": emp.name,
        "email": emp.email,
        "month": datetime.date(y, m, 1).strftime("%B %Y"),
        "present": present,
        "absent": absent,
        "wfh": wfh,
        "late": late,
        "half_day": half_day,
    }


def summary(query: str, month: str = "", year: str = "") -> dict:
    """Monthly attendance summary for an employee identified by email or name (no auth check)."""
    db = SessionLocal()
    try:
        emp = resolve_employee(db, query)
        if not emp:
            return {"success": False, "error": "employee_not_found", "query": query}
        return _summary_for_employee(db, emp, month, year)
    finally:
        db.close()


def summary_for_manager(requester_email: str, query: str, month: str = "", year: str = "") -> dict:
    """
    Manager-gated attendance summary. The requester may view attendance only for themselves
    or their OWN DIRECT reportees (employees whose manager_id == the requester's id).

    Returns the normal summary dict on success, else:
      {"success": False, "error": "employee_not_found" | "requester_not_found" | "not_authorized", ...}
    """
    db = SessionLocal()
    try:
        target = resolve_employee(db, query)
        if not target:
            return {"success": False, "error": "employee_not_found", "query": query}

        requester = resolve_employee(db, requester_email)
        if not requester:
            return {"success": False, "error": "requester_not_found"}

        is_self = target.id == requester.id
        is_direct_report = target.manager_id == requester.id
        if not (is_self or is_direct_report):
            return {
                "success": False,
                "error": "not_authorized",
                "target": target.name,
                "message": f"{target.name} is not in your team — you can only view your direct reportees.",
            }

        return _summary_for_employee(db, target, month, year)
    finally:
        db.close()
