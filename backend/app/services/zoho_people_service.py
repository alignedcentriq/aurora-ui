"""
Zoho People Service — per-user delegated API calls.

All functions accept a valid Zoho OAuth2 access token obtained via
get_valid_token(email, "zoho") from oauth_service. Raises ValueError("not_connected")
on 401/403 so callers can prompt the user to reconnect.
"""

import datetime
import requests

from app.config import settings

_BASE = settings.ZOHO_BASE_URL or "https://people.zoho.com"


def _headers(token: str) -> dict:
    return {"Authorization": f"Zoho-oauthtoken {token}"}


def _check(resp: requests.Response):
    if resp.status_code in (401, 403):
        raise ValueError("not_connected")
    resp.raise_for_status()


def get_timesheet(token: str, week_start: str = "") -> dict:
    """
    Return timesheet logs for the week containing week_start (YYYY-MM-DD).
    Defaults to the current week if week_start is empty.

    Returns: {"success": True, "logs": [...], "total_hours": float}
    """
    if not week_start:
        today = datetime.date.today()
        week_start = (today - datetime.timedelta(days=today.weekday())).isoformat()

    try:
        start = datetime.date.fromisoformat(week_start)
    except ValueError:
        start = datetime.date.today() - datetime.timedelta(days=datetime.date.today().weekday())

    end = start + datetime.timedelta(days=6)

    resp = requests.get(
        f"{_BASE}/people/api/v2/timetracker/getTimeLogs",
        params={"dateFrom": start.isoformat(), "dateTo": end.isoformat()},
        headers=_headers(token),
        timeout=15,
    )
    _check(resp)
    data = resp.json()

    logs = []
    total_hours = 0.0
    for entry in data.get("data", []):
        hours = float(entry.get("hours", 0) or 0)
        total_hours += hours
        logs.append({
            "date": entry.get("workDate") or entry.get("date", ""),
            "hours": hours,
            "job": entry.get("jobName") or entry.get("job", ""),
            "notes": entry.get("notes") or entry.get("description", ""),
        })

    return {"success": True, "week_start": start.isoformat(), "week_end": end.isoformat(), "logs": logs, "total_hours": round(total_hours, 2)}


def get_attendance_summary(token: str, month: str = "", year: str = "") -> dict:
    """
    Return attendance summary for the given month/year (default: current month).

    Returns: {"success": True, "month": "June 2026", "present": int, "absent": int, "wfh": int, "late": int}
    """
    today = datetime.date.today()
    m = int(month) if month else today.month
    y = int(year) if year else today.year
    date_from = datetime.date(y, m, 1).isoformat()
    last_day = (datetime.date(y, m % 12 + 1, 1) - datetime.timedelta(days=1)) if m < 12 else datetime.date(y, 12, 31)
    date_to = min(last_day, today).isoformat()

    resp = requests.get(
        f"{_BASE}/people/api/v2/attendance/report",
        params={"dateFrom": date_from, "dateTo": date_to},
        headers=_headers(token),
        timeout=15,
    )
    _check(resp)
    data = resp.json()

    present = absent = wfh = late = 0
    for rec in data.get("data", []):
        status = (rec.get("attendanceStatus") or rec.get("status") or "").lower()
        if "present" in status or "work from office" in status:
            present += 1
        elif "absent" in status:
            absent += 1
        if "work from home" in status or "wfh" in status:
            wfh += 1
        if rec.get("lateIn") or "late" in status:
            late += 1

    month_label = datetime.date(y, m, 1).strftime("%B %Y")
    return {"success": True, "month": month_label, "present": present, "absent": absent, "wfh": wfh, "late": late}


def get_appraisal_status(token: str) -> dict:
    """
    Return the current appraisal cycle status for the user.

    Returns: {"success": True, "cycles": [...]}
    """
    resp = requests.get(
        f"{_BASE}/people/api/v2/performance/appraisals",
        headers=_headers(token),
        timeout=15,
    )
    _check(resp)
    data = resp.json()

    cycles = []
    for cycle in data.get("data", []):
        cycles.append({
            "name": cycle.get("cycleName") or cycle.get("name", ""),
            "status": cycle.get("status") or cycle.get("cycleStatus", ""),
            "start_date": cycle.get("startDate") or cycle.get("fromDate", ""),
            "end_date": cycle.get("endDate") or cycle.get("toDate", ""),
            "due_date": cycle.get("dueDate", ""),
        })

    return {"success": True, "cycles": cycles}


def get_training_records(token: str) -> dict:
    """
    Return completed and upcoming training programs.

    Returns: {"success": True, "completed": [...], "upcoming": [...]}
    """
    resp = requests.get(
        f"{_BASE}/people/api/v2/training/trainings",
        headers=_headers(token),
        timeout=15,
    )
    _check(resp)
    data = resp.json()

    completed = []
    upcoming = []
    today = datetime.date.today().isoformat()

    for t in data.get("data", []):
        record = {
            "name": t.get("trainingName") or t.get("name", ""),
            "status": t.get("status", ""),
            "start_date": t.get("startDate") or t.get("fromDate", ""),
            "end_date": t.get("endDate") or t.get("toDate", ""),
            "trainer": t.get("trainerName") or t.get("trainer", ""),
        }
        end = record["end_date"]
        if end and end < today:
            completed.append(record)
        else:
            upcoming.append(record)

    return {"success": True, "completed": completed, "upcoming": upcoming}
