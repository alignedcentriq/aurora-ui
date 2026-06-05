"""
Zoho Demo Data
--------------
Realistic mock fixtures used when settings.ZOHO_DEMO_MODE is true. Lets the full Zoho
experience (leave, attendance, timesheet, appraisal, training, expense, recruit) be
demoed convincingly while real API access is pending org approval.

Each function returns data in the EXACT shape the matching real service returns, so the
agent tools and UI behave identically to production. Data is deterministic (no randomness)
so a demo looks the same every run; attendance/timesheet flex with the current date so
they always look "current".

Flip ZOHO_DEMO_MODE to false once the Zoho admin enables API access — nothing else changes.
"""

import datetime


def _display_name(email: str) -> str:
    """Best-effort human name from an email local part (e.g. shivam.sharma -> Shivam Sharma)."""
    local = (email or "there").split("@")[0]
    parts = [p for p in local.replace("_", ".").split(".") if p]
    return " ".join(p.capitalize() for p in parts) or "Employee"


# ── Leave (leave_balance_sync.get_or_refresh → balances list) ────────────────────

def leave_balances() -> list[dict]:
    return [
        {"type": "Casual Leave",            "total": 12.0, "used": 4.0,  "balance": 8.0},
        {"type": "Sick Leave",              "total": 12.0, "used": 3.0,  "balance": 9.0},
        {"type": "Earned / Privilege Leave","total": 18.0, "used": 6.0,  "balance": 12.0},
        {"type": "Work From Home",          "total": 24.0, "used": 10.0, "balance": 14.0},
    ]


# ── Attendance (zoho_people_service.get_attendance_summary) ──────────────────────

def attendance_summary(month: str = "", year: str = "") -> dict:
    today = datetime.date.today()
    m = int(month) if month else today.month
    y = int(year) if year else today.year
    # Always show a full, substantial month so the demo looks real even early in the month.
    # Split: 18 present + 3 WFH + 1 absent = 22 working days; 2 of the present days were late.
    label = datetime.date(y, m, 1).strftime("%B %Y")
    return {"success": True, "month": label, "present": 18, "absent": 1, "wfh": 3, "late": 2}


# ── Timesheet (zoho_people_service.get_timesheet) ────────────────────────────────

def timesheet(week_start: str = "") -> dict:
    if week_start:
        try:
            start = datetime.date.fromisoformat(week_start)
        except ValueError:
            start = datetime.date.today()
    else:
        t = datetime.date.today()
        start = t - datetime.timedelta(days=t.weekday())
    start = start - datetime.timedelta(days=start.weekday())  # snap to Monday
    end = start + datetime.timedelta(days=6)

    jobs = [
        ("Centriq AI — Feature Development", "Agent routing + tool wiring"),
        ("Centriq AI — Feature Development", "RAG pipeline tuning"),
        ("Internal — Code Review",           "PR reviews & pairing"),
        ("Centriq AI — Bug Fixes",           "Connected accounts OAuth"),
        ("Internal — Team Sync",             "Sprint planning & standups"),
    ]
    logs = []
    total = 0.0
    for i in range(5):  # Mon–Fri
        day = start + datetime.timedelta(days=i)
        hours = 8.0 if i != 4 else 7.5
        job, notes = jobs[i]
        logs.append({"date": day.isoformat(), "hours": hours, "job": job, "notes": notes})
        total += hours
    return {
        "success": True,
        "week_start": start.isoformat(),
        "week_end": end.isoformat(),
        "logs": logs,
        "total_hours": round(total, 2),
    }


# ── Appraisal (zoho_people_service.get_appraisal_status) ─────────────────────────

def appraisal_status() -> dict:
    y = datetime.date.today().year
    return {
        "success": True,
        "cycles": [{
            "name": f"H1 {y} Performance Review",
            "status": "In Progress",
            "start_date": f"{y}-01-01",
            "end_date": f"{y}-06-30",
            "due_date": f"{y}-06-25",
        }],
    }


# ── Training (zoho_people_service.get_training_records) ──────────────────────────

def training_records() -> dict:
    y = datetime.date.today().year
    return {
        "success": True,
        "completed": [
            {"name": "Secure Coding Fundamentals", "status": "Completed", "start_date": f"{y}-02-10", "end_date": f"{y}-02-12", "trainer": "InfoSec Team"},
            {"name": "Effective Communication",    "status": "Completed", "start_date": f"{y}-03-05", "end_date": f"{y}-03-06", "trainer": "L&D Team"},
        ],
        "upcoming": [
            {"name": "Advanced LLM Application Design", "status": "Scheduled", "start_date": f"{y}-07-15", "end_date": f"{y}-07-17", "trainer": "AI CoE"},
        ],
    }


# ── Expense (zoho_expense_service) ───────────────────────────────────────────────

def expense_reports(status: str = "") -> dict:
    reports = [
        {"name": "Client Visit — Travel (Pune)",  "status": "Reimbursed", "total": 8450.0,  "currency": "INR", "reimbursable": 8450.0,  "submitted_date": "2026-04-18"},
        {"name": "Team Offsite — Meals",           "status": "Approved",   "total": 5200.0,  "currency": "INR", "reimbursable": 5200.0,  "submitted_date": "2026-05-09"},
        {"name": "Conference — Registration",      "status": "Submitted",  "total": 12000.0, "currency": "INR", "reimbursable": 12000.0, "submitted_date": "2026-05-28"},
    ]
    if status:
        reports = [r for r in reports if status.lower() in r["status"].lower()]
    return {"success": True, "reports": reports}


def reimbursement_status() -> dict:
    reports = expense_reports()["reports"]
    pending = [r for r in reports if r["status"].lower() in ("submitted", "approved")]
    reimbursed_total = sum(r["reimbursable"] for r in reports if r["status"].lower() == "reimbursed")
    pending_total = sum(r["reimbursable"] for r in pending)
    return {
        "success": True,
        "pending": pending,
        "pending_total": round(pending_total, 2),
        "reimbursed_total": round(reimbursed_total, 2),
    }


# ── Recruit (zoho_recruit_service) ───────────────────────────────────────────────

def open_positions() -> dict:
    y = datetime.date.today().year
    return {
        "success": True,
        "positions": [
            {"title": "Senior Backend Engineer (Python)", "status": "Open",        "city": "Pune",      "openings": "2", "date_opened": f"{y}-05-02"},
            {"title": "AI/ML Engineer",                    "status": "Open",        "city": "Hyderabad", "openings": "1", "date_opened": f"{y}-05-15"},
            {"title": "Product Designer",                  "status": "In-progress", "city": "Remote",    "openings": "1", "date_opened": f"{y}-04-28"},
        ],
    }


def candidate_status(email: str = "") -> dict:
    if not email:
        return {"success": True, "candidates": []}
    return {
        "success": True,
        "candidates": [{
            "name": _display_name(email),
            "email": email,
            "status": "Interview Scheduled",
            "applied_for": "Senior Backend Engineer (Python)",
        }],
    }
