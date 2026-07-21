"""
Attendance Service
------------------
Aggregates attendance data into the monthly summary / calendar shapes the UI expects.

Data sources (in priority order):
  1. eSSL biometric DB — when ATTENDANCE_DBURL is configured, live punch records from
     the eSSL SQL Server view (dbo.vbUserTimeEntryLog) are used. Employee matching is
     by name (case-insensitive). WFH status is not available from eSSL (physical punches
     only); absent days are derived from weekdays with no punch record.
  2. Internal attendance table — fallback when eSSL is not configured (contains
     demo/seeded data).

Status derivation from eSSL:
  any check-in recorded → Present, regardless of hours worked
  no record on weekday  → Absent
  Late                  → check-in after LATE_THRESHOLD, on Present days
                          (cutoff from settings.ATTENDANCE_LATE_CUTOFF, default 13:00)
"""

import datetime

from sqlalchemy import func

from app.config import settings
from app.database import SessionLocal
from app.models import Attendance, Employee, Leave
from app.services.attendance_db_service import AttendanceSourceError

# Shown when eSSL is configured but unreachable — we degrade to this instead of
# silently reporting every employee Absent.
_SOURCE_UNAVAILABLE_MSG = (
    "Couldn't reach the biometric attendance system right now — attendance data is "
    "temporarily unavailable. Please try again shortly."
)


def _source_unavailable(**extra) -> dict:
    return {"success": False, "error": "attendance_source_unavailable",
            "message": _SOURCE_UNAVAILABLE_MSG, **extra}


def _parse_cutoff(raw: str) -> datetime.time:
    """Parse 'HH:MM' (24h) into a time; fall back to 13:00 on malformed input."""
    try:
        hh, mm = (raw or "").strip().split(":", 1)
        return datetime.time(int(hh), int(mm))
    except Exception:
        return datetime.time(13, 0)


LATE_THRESHOLD = _parse_cutoff(settings.ATTENDANCE_LATE_CUTOFF)


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


def _org_roster(db) -> list[str]:
    """All employee names in the org — passed to the eSSL name resolver so its fuzzy
    first+last fallback can detect global name collisions (see attendance_db_service)."""
    return [n for (n,) in db.query(Employee.name).all() if n]


def _essl_records(emp_name: str, start: datetime.date, end: datetime.date, roster=None):
    """eSSL records list, or None when eSSL is not configured (→ internal fallback).
    Propagates AttendanceSourceError if configured but unreachable, so the caller can
    degrade rather than mistake the failure for 'no punches → Absent'."""
    from app.services.attendance_db_service import is_configured, fetch_employee_records
    if not is_configured():
        return None
    return fetch_employee_records(emp_name, start, end, roster)


def _essl_team_records(emp_names: list[str], start: datetime.date, end: datetime.date, roster=None):
    """Batch eSSL fetch for a team; {} when not configured. Propagates
    AttendanceSourceError if configured but unreachable (see _essl_records)."""
    from app.services.attendance_db_service import is_configured, fetch_team_records
    if not is_configured():
        return {}
    return fetch_team_records(emp_names, start, end, roster)


def _summarise_essl(rows: list[dict], start: datetime.date, end: datetime.date) -> dict:
    """Aggregate a list of eSSL records into present/absent/wfh/late counts.
    Every eSSL row is Present by definition (see attendance_db_service._status_for_hours) —
    half_day is always 0 here and kept only for shape-compatibility with the internal-table
    summary, which can still report it."""
    punched_dates = {r["date"] for r in rows if r.get("date")}
    present = absent = wfh = late = half_day = 0

    for r in rows:
        present += 1
        check_in = r.get("check_in")
        if check_in and check_in.time() > LATE_THRESHOLD:
            late += 1

    d = start
    while d <= end:
        if d.weekday() < 5 and d not in punched_dates:
            absent += 1
        d += datetime.timedelta(days=1)

    return {"present": present, "absent": absent, "wfh": wfh, "late": late, "half_day": half_day}


def _summary_for_employee(db, emp: Employee, month: str = "", year: str = "") -> dict:
    today = datetime.date.today()
    m = int(month) if month else today.month
    y = int(year) if year else today.year
    start, end = _month_bounds(y, m)
    end = min(end, today)

    essl_rows = _essl_records(emp.name, start, end, _org_roster(db))

    if essl_rows is not None:
        counts = _summarise_essl(essl_rows, start, end)
    else:
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
        counts = {"present": present, "absent": absent, "wfh": wfh, "late": late, "half_day": half_day}

    return {
        "success": True,
        "employee": emp.name,
        "email": emp.email,
        "month": datetime.date(y, m, 1).strftime("%B %Y"),
        **counts,
    }


def summary(query: str, month: str = "", year: str = "") -> dict:
    """Monthly attendance summary for an employee identified by email or name (no auth check)."""
    db = SessionLocal()
    try:
        emp = resolve_employee(db, query)
        if not emp:
            return {"success": False, "error": "employee_not_found", "query": query}
        return _summary_for_employee(db, emp, month, year)
    except AttendanceSourceError:
        return _source_unavailable(query=query)
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
    except AttendanceSourceError:
        return _source_unavailable(query=query)
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


def _calendar_days_for_employee(db, emp: Employee, m: int, y: int) -> list[dict]:
    """Build the day-by-day attendance list (weekdays up to today) for one employee.
    Shared by the self-service calendar and the manager drill-down."""
    today = datetime.date.today()
    start, end = _month_bounds(y, m)

    essl_rows = _essl_records(emp.name, start, end, _org_roster(db))

    days: list[dict] = []
    if essl_rows is not None:
        by_date = {r["date"]: r for r in essl_rows if r.get("date")}
        d = start
        while d <= min(end, today):
            if d.weekday() < 5:
                r = by_date.get(d)
                if r:
                    check_in = r.get("check_in")
                    check_out = r.get("check_out")
                    status = r.get("status", "Present")
                    is_late = (
                        status == "Present"
                        and check_in is not None
                        and check_in.time() > LATE_THRESHOLD
                    )
                    days.append({
                        "date": d.isoformat(),
                        "status": status,
                        "check_in": check_in.strftime("%H:%M") if check_in else None,
                        "check_out": check_out.strftime("%H:%M") if check_out else None,
                        "late": is_late,
                    })
                else:
                    days.append({
                        "date": d.isoformat(),
                        "status": "Absent",
                        "check_in": None,
                        "check_out": None,
                        "late": False,
                    })
            d += datetime.timedelta(days=1)
    else:
        rows = (
            db.query(Attendance)
            .filter(
                Attendance.employee_id == emp.id,
                Attendance.date >= start,
                Attendance.date <= end,
            )
            .order_by(Attendance.date)
            .all()
        )
        for r in rows:
            is_late = (
                r.status == "Present"
                and r.check_in is not None
                and r.check_in.time() > LATE_THRESHOLD
            )
            days.append({
                "date": r.date.isoformat(),
                "status": r.status or "",
                "check_in": r.check_in.strftime("%H:%M") if r.check_in else None,
                "check_out": r.check_out.strftime("%H:%M") if r.check_out else None,
                "late": is_late,
            })
    return days


def calendar_records(query: str, month: str = "", year: str = "") -> dict:
    """Day-by-day attendance records for a self-service calendar widget."""
    db = SessionLocal()
    try:
        emp = resolve_employee(db, query)
        if not emp:
            return {"success": False, "error": "employee_not_found", "query": query}

        today = datetime.date.today()
        m = int(month) if month else today.month
        y = int(year) if year else today.year

        return {
            "success": True,
            "employee": emp.name,
            "month": m,
            "year": y,
            "period": datetime.date(y, m, 1).strftime("%B %Y"),
            "days": _calendar_days_for_employee(db, emp, m, y),
        }
    except AttendanceSourceError:
        return _source_unavailable(query=query)
    finally:
        db.close()


def team_member_calendar(manager_email: str, query: str, month: str = "", year: str = "") -> dict:
    """
    Manager drill-down: the day-by-day calendar for one employee in the manager's org
    branch (self, direct, or transitive report — same scope as team_report). Used when a
    manager clicks a row in the attendance report to see which specific days were
    Present/Absent/Half-day.

    Returns the calendar_records shape on success, else:
      {"success": False, "error": "manager_not_found" | "employee_not_found" | "not_authorized"}
    """
    db = SessionLocal()
    try:
        manager = resolve_employee(db, manager_email)
        if not manager:
            return {"success": False, "error": "manager_not_found"}
        target = resolve_employee(db, query)
        if not target:
            return {"success": False, "error": "employee_not_found", "query": query}

        if target.id != manager.id:
            team_ids = {e.id for e in descendants(db, manager.id)}
            if target.id not in team_ids:
                return {
                    "success": False,
                    "error": "not_authorized",
                    "target": target.name,
                    "message": f"{target.name} is not in your team.",
                }

        today = datetime.date.today()
        m = int(month) if month else today.month
        y = int(year) if year else today.year

        return {
            "success": True,
            "employee": target.name,
            "email": target.email,
            "month": m,
            "year": y,
            "period": datetime.date(y, m, 1).strftime("%B %Y"),
            "days": _calendar_days_for_employee(db, target, m, y),
        }
    except AttendanceSourceError:
        return _source_unavailable(query=query)
    finally:
        db.close()


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

    When eSSL is configured, all team members' records are fetched in a single SQL
    round-trip (fetch_team_records) rather than one query per employee.

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

        name_by_id = {e.id: e.name for e in team}
        name_by_id[manager.id] = manager.name

        today = datetime.date.today()
        m = int(month) if month else today.month
        y = int(year) if year else today.year
        start, end = _month_bounds(y, m)
        end_clipped = min(end, today)

        # Batch-fetch eSSL records for all team members in one round-trip
        team_essl = _essl_team_records([e.name for e in team], start, end_clipped, _org_roster(db))
        use_essl = bool(team_essl)

        members = []
        totals = {"present": 0, "absent": 0, "wfh": 0, "late": 0, "half_day": 0}

        for emp in team:
            if use_essl:
                emp_rows = team_essl.get(emp.name.strip().lower(), [])
                counts = _summarise_essl(emp_rows, start, end_clipped)
                s = {
                    "success": True,
                    "employee": emp.name,
                    "email": emp.email,
                    "month": datetime.date(y, m, 1).strftime("%B %Y"),
                    **counts,
                }
            else:
                s = _summary_for_employee(db, emp, str(m), str(y))

            s["department"] = emp.department or ""
            s["designation"] = emp.designation or ""
            s["reports_to"] = name_by_id.get(emp.manager_id, "")
            members.append(s)
            for k in totals:
                totals[k] += s.get(k, 0)

        # The manager's OWN attendance — descendants() excludes the manager, so compute
        # it separately and return it as `self`. Kept OUT of team totals/headcount so the
        # team stats stay team-only; the UI pins it as a distinct "You" row.
        self_summary = _summary_for_employee(db, manager, str(m), str(y))
        self_summary["department"] = manager.department or ""
        self_summary["designation"] = manager.designation or ""
        # The manager's OWN manager sits ABOVE the team, so it isn't in name_by_id —
        # look it up directly.
        self_manager = (
            db.query(Employee).filter(Employee.id == manager.manager_id).first()
            if manager.manager_id
            else None
        )
        self_summary["reports_to"] = self_manager.name if self_manager else ""

        return {
            "success": True,
            "manager": manager.name,
            "manager_email": manager.email,
            "period": datetime.date(y, m, 1).strftime("%B %Y"),
            "month": m,
            "year": y,
            "headcount": len(members),
            "members": members,
            "self": self_summary,
            "totals": totals,
        }
    except AttendanceSourceError:
        return _source_unavailable(manager_email=manager_email)
    finally:
        db.close()


def _parse_day(date_str: str = "") -> datetime.date:
    """Parse 'YYYY-MM-DD'; falls back to today on blank/malformed input."""
    if not date_str:
        return datetime.date.today()
    try:
        return datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return datetime.date.today()


def company_snapshot(date_str: str = "") -> dict:
    """
    Whole-company attendance for a single day (HR-only view, unscoped by manager hierarchy).
    For each employee: an approved leave covering the day wins as "On Leave"; otherwise the
    day's punch/attendance status is used (or "Weekend" on Sat/Sun with no record, rather
    than a misleading "Absent").

    Returns:
      {"success": True, "date": "YYYY-MM-DD", "is_weekend": bool, "headcount": N,
       "members": [{"employee","email","department","designation","reports_to",
                     "status","leave_type","check_in","check_out","late"}],
       "totals": {"present","absent","wfh","half_day","on_leave","weekend","late"}}
    or {"success": False, "error": "attendance_source_unavailable", ...}
    """
    db = SessionLocal()
    try:
        day = _parse_day(date_str)
        is_weekend = day.weekday() >= 5

        employees = db.query(Employee).order_by(Employee.department, Employee.name).all()
        name_by_id = {e.id: e.name for e in employees}

        leaves = (
            db.query(Leave)
            .filter(Leave.status == "Approved", Leave.start_date <= day, Leave.end_date >= day)
            .all()
        )
        leave_by_emp_id = {l.employee_id: l for l in leaves}

        essl_team = _essl_team_records([e.name for e in employees], day, day, _org_roster(db))
        use_essl = bool(essl_team)

        internal_by_emp_id: dict[int, Attendance] = {}
        if not use_essl:
            rows = db.query(Attendance).filter(Attendance.date == day).all()
            internal_by_emp_id = {r.employee_id: r for r in rows}

        members = []
        totals = {"present": 0, "absent": 0, "wfh": 0, "half_day": 0, "on_leave": 0, "weekend": 0, "late": 0}

        for emp in employees:
            leave = leave_by_emp_id.get(emp.id)
            check_in = check_out = None
            leave_type = None
            is_late = False

            if leave:
                status = "On Leave"
                leave_type = leave.leave_type
            elif use_essl:
                rec = next(
                    (r for r in essl_team.get(emp.name.strip().lower(), []) if r.get("date") == day),
                    None,
                )
                if rec:
                    status = rec.get("status", "Present")
                    check_in = rec.get("check_in")
                    check_out = rec.get("check_out")
                    is_late = status == "Present" and check_in is not None and check_in.time() > LATE_THRESHOLD
                    check_in = check_in.strftime("%H:%M") if check_in else None
                    check_out = check_out.strftime("%H:%M") if check_out else None
                elif is_weekend:
                    status = "Weekend"
                else:
                    status = "Absent"
            else:
                rec = internal_by_emp_id.get(emp.id)
                if rec:
                    status = rec.status or "Present"
                    is_late = status == "Present" and rec.check_in is not None and rec.check_in.time() > LATE_THRESHOLD
                    check_in = rec.check_in.strftime("%H:%M") if rec.check_in else None
                    check_out = rec.check_out.strftime("%H:%M") if rec.check_out else None
                elif is_weekend:
                    status = "Weekend"
                else:
                    status = "Absent"

            members.append({
                "employee": emp.name,
                "email": emp.email,
                "department": emp.department or "",
                "designation": emp.designation or "",
                "reports_to": name_by_id.get(emp.manager_id, ""),
                "status": status,
                "leave_type": leave_type,
                "check_in": check_in,
                "check_out": check_out,
                "late": is_late,
            })

            key = status.lower().replace("-", "_").replace(" ", "_")
            if key in totals:
                totals[key] += 1
            if is_late:
                totals["late"] += 1

        return {
            "success": True,
            "date": day.isoformat(),
            "is_weekend": is_weekend,
            "headcount": len(members),
            "members": members,
            "totals": totals,
        }
    except AttendanceSourceError:
        return _source_unavailable(date=date_str)
    finally:
        db.close()
