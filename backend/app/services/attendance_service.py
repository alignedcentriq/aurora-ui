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


def descendants(db, manager_id: int) -> list[Employee]:
    """
    All employees beneath `manager_id` in the reporting tree — direct reportees AND
    their reportees, recursively (the manager's whole org branch). Breadth-first with a
    visited-set so a malformed cycle in manager_id can't loop forever. Excludes the
    manager themselves. Ordered by department then name for a stable report.
    """
    found: dict[int, Employee] = {}
    frontier = [manager_id]
    seen_managers = {manager_id}
    while frontier:
        rows = db.query(Employee).filter(Employee.manager_id.in_(frontier)).all()
        next_frontier = []
        for e in rows:
            if e.id in found or e.id == manager_id:
                continue
            found[e.id] = e
            if e.id not in seen_managers:
                seen_managers.add(e.id)
                next_frontier.append(e.id)
        frontier = next_frontier
    return sorted(found.values(), key=lambda e: ((e.department or "").lower(), (e.name or "").lower()))


def team_report(manager_email: str, month: str = "", year: str = "") -> dict:
    """
    Whole-hierarchy attendance report for a manager: a per-employee monthly summary for
    EVERY employee beneath them in the reporting tree (transitive reports), plus org-wide
    totals.

    Scope note: this is reporting-only visibility over the manager's own org branch and
    intentionally goes beyond the direct-reportee limit used for leave approvals
    (feedback_hr_approval_scope) — per product decision (2026-06-04), whole-hierarchy
    attendance reporting is allowed for functional managers. Do NOT narrow this back to
    direct reports without checking that decision.

    Returns:
      {"success": True, "manager": ..., "manager_email": ..., "period": "June 2026",
       "month": 6, "year": 2026, "headcount": N,
       "members": [ {..._summary_for_employee fields..., "reports_to": "Name",
                     "department": "...", "designation": "..."} ],
       "totals": {"present","absent","wfh","late","half_day"}}
    or {"success": False, "error": "manager_not_found" | "no_team", ...}
    """
    db = SessionLocal()
    try:
        manager = resolve_employee(db, manager_email)
        if not manager:
            return {"success": False, "error": "manager_not_found", "query": manager_email}

        team = descendants(db, manager.id)
        if not team:
            return {
                "success": False,
                "error": "no_team",
                "manager": manager.name,
                "message": "No employees report up to you — nothing to report.",
            }

        # Resolve manager names for the "reports_to" column without N extra round-trips.
        name_by_id = {e.id: e.name for e in team}
        name_by_id[manager.id] = manager.name

        today = datetime.date.today()
        m = int(month) if month else today.month
        y = int(year) if year else today.year

        members = []
        totals = {"present": 0, "absent": 0, "wfh": 0, "late": 0, "half_day": 0}
        for emp in team:
            s = _summary_for_employee(db, emp, str(m), str(y))
            s["department"] = emp.department or ""
            s["designation"] = emp.designation or ""
            s["reports_to"] = name_by_id.get(emp.manager_id, "")
            members.append(s)
            for k in totals:
                totals[k] += s.get(k, 0)

        return {
            "success": True,
            "manager": manager.name,
            "manager_email": manager.email,
            "period": datetime.date(y, m, 1).strftime("%B %Y"),
            "month": m,
            "year": y,
            "headcount": len(members),
            "members": members,
            "totals": totals,
        }
    finally:
        db.close()
