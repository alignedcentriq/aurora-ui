"""
Attendance Schedule Service
---------------------------
Manages a manager's recurring "email me my team's attendance" automations
(AttendanceSchedule rows) and runs the ones that are due.

Times are SERVER-LOCAL wall-clock — `hour` is the hour-of-day the manager picked.
Schedules persist in the DB so they survive backend restarts; the startup loop in
main.py calls `run_due()` periodically (the backend runs single-process, no --reload).

Reporting period by cadence (the underlying attendance summary is monthly):
  - monthly + period_mode="prev_period" -> the previous calendar month
  - everything else                      -> the current month-to-date
"""

import datetime

from app.database import SessionLocal
from app.models import AttendanceSchedule, Employee
from app.services import attendance_report, attendance_service, email_service

VALID_FREQ = {"daily", "weekly", "monthly", "custom"}


# ── period / next-run math ────────────────────────────────────────────────────

def _add_month(dt: datetime.datetime) -> datetime.datetime:
    y, mo = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    return dt.replace(year=y, month=mo)


def _report_period(frequency: str, period_mode: str, now: datetime.datetime) -> tuple[int, int]:
    """Return (month, year) the report should cover for a run at `now`."""
    if frequency == "monthly" and period_mode == "prev_period":
        first = now.replace(day=1)
        prev = first - datetime.timedelta(days=1)
        return prev.month, prev.year
    return now.month, now.year


def compute_next_run(
    frequency: str,
    day_of_week,
    day_of_month,
    hour,
    after: datetime.datetime,
    minute: int = 0,
) -> datetime.datetime:
    """First scheduled run strictly after `after`, honoring the cadence fields.

    custom resolves to weekly (if day_of_week given) else monthly (if day_of_month given)
    else daily — so it's a flexible superset of the other cadences.
    """
    hour = int(hour) if hour is not None else 8
    hour = min(max(hour, 0), 23)
    minute = max(0, min(59, int(minute or 0)))
    freq = frequency
    if freq == "custom":
        if day_of_week is not None:
            freq = "weekly"
        elif day_of_month is not None:
            freq = "monthly"
        else:
            freq = "daily"

    if freq == "daily":
        cand = after.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if cand <= after:
            cand += datetime.timedelta(days=1)
        while cand.weekday() >= 5:  # skip Sat/Sun — weekday morning report
            cand += datetime.timedelta(days=1)
        return cand

    if freq == "weekly":
        dow = int(day_of_week) if day_of_week is not None else 0
        dow = min(max(dow, 0), 6)
        cand = after.replace(hour=hour, minute=minute, second=0, microsecond=0)
        cand += datetime.timedelta(days=(dow - cand.weekday()) % 7)
        if cand <= after:
            cand += datetime.timedelta(days=7)
        return cand

    # monthly
    dom = int(day_of_month) if day_of_month is not None else 1
    dom = min(max(dom, 1), 28)  # 28 keeps it valid in every month
    cand = after.replace(day=dom, hour=hour, minute=minute, second=0, microsecond=0)
    if cand <= after:
        cand = _add_month(cand)
    return cand


# ── serialization ─────────────────────────────────────────────────────────────

def _to_dict(s: AttendanceSchedule) -> dict:
    return {
        "id": s.id,
        "manager_email": s.manager_email,
        "frequency": s.frequency,
        "day_of_week": s.day_of_week,
        "day_of_month": s.day_of_month,
        "hour": s.hour,
        "minute": s.minute or 0,
        "recipients": [r.strip() for r in (s.recipients or "").split(",") if r.strip()],
        "period_mode": s.period_mode,
        "active": s.active,
        "next_run": s.next_run.isoformat() if s.next_run else None,
        "last_run": s.last_run.isoformat() if s.last_run else None,
        "last_status": s.last_status,
    }


def _recipients_list(s: AttendanceSchedule) -> list[str]:
    recips = [r.strip() for r in (s.recipients or "").split(",") if r.strip()]
    return recips or [s.manager_email]


# ── CRUD ──────────────────────────────────────────────────────────────────────

def list_for_manager(manager_email: str) -> list[dict]:
    db = SessionLocal()
    try:
        rows = (
            db.query(AttendanceSchedule)
            .filter(AttendanceSchedule.manager_email == manager_email.lower())
            .order_by(AttendanceSchedule.id.desc())
            .all()
        )
        return [_to_dict(s) for s in rows]
    finally:
        db.close()


def create(manager_email: str, payload: dict) -> dict:
    freq = (payload.get("frequency") or "monthly").lower()
    if freq not in VALID_FREQ:
        return {"success": False, "error": "invalid_frequency"}

    db = SessionLocal()
    try:
        manager = attendance_service.resolve_employee(db, manager_email)
        recipients = payload.get("recipients") or []
        if isinstance(recipients, str):
            recipients = [r.strip() for r in recipients.split(",") if r.strip()]

        now = datetime.datetime.now()
        sched = AttendanceSchedule(
            manager_email=manager_email.lower(),
            manager_id=manager.id if manager else None,
            frequency=freq,
            day_of_week=payload.get("day_of_week"),
            day_of_month=payload.get("day_of_month"),
            hour=payload.get("hour", 8),
            minute=payload.get("minute", 0),
            recipients=",".join(recipients),
            period_mode=payload.get("period_mode", "prev_period"),
            active=payload.get("active", True),
        )
        sched.next_run = compute_next_run(
            sched.frequency, sched.day_of_week, sched.day_of_month, sched.hour, now,
            minute=sched.minute,
        )
        db.add(sched)
        db.commit()
        db.refresh(sched)
        return {"success": True, "schedule": _to_dict(sched)}
    finally:
        db.close()


def update(manager_email: str, schedule_id: int, payload: dict) -> dict:
    db = SessionLocal()
    try:
        sched = (
            db.query(AttendanceSchedule)
            .filter(
                AttendanceSchedule.id == schedule_id,
                AttendanceSchedule.manager_email == manager_email.lower(),
            )
            .first()
        )
        if not sched:
            return {"success": False, "error": "not_found"}

        for field in ("frequency", "day_of_week", "day_of_month", "hour", "minute", "period_mode", "active"):
            if field in payload:
                setattr(sched, field, payload[field])
        if "recipients" in payload:
            recipients = payload["recipients"] or []
            if isinstance(recipients, str):
                recipients = [r.strip() for r in recipients.split(",") if r.strip()]
            sched.recipients = ",".join(recipients)

        # Recompute next_run from cadence whenever timing fields or active flag change.
        sched.next_run = compute_next_run(
            sched.frequency, sched.day_of_week, sched.day_of_month, sched.hour,
            datetime.datetime.now(),
            minute=sched.minute or 0,
        )
        db.commit()
        db.refresh(sched)
        return {"success": True, "schedule": _to_dict(sched)}
    finally:
        db.close()


def delete(manager_email: str, schedule_id: int) -> dict:
    db = SessionLocal()
    try:
        sched = (
            db.query(AttendanceSchedule)
            .filter(
                AttendanceSchedule.id == schedule_id,
                AttendanceSchedule.manager_email == manager_email.lower(),
            )
            .first()
        )
        if not sched:
            return {"success": False, "error": "not_found"}
        db.delete(sched)
        db.commit()
        return {"success": True}
    finally:
        db.close()


# ── delivery ──────────────────────────────────────────────────────────────────

def send_report_now(manager_email: str, recipients=None, month: str = "", year: str = "",
                    automated: bool = False) -> dict:
    """Build + email the whole-hierarchy report immediately. Used by the 'Email me now'
    action and reused by the scheduler. Returns {success, sent, headcount?} or an error."""
    report = attendance_service.team_report(manager_email, month, year)
    if not report.get("success"):
        return report

    try:
        xlsx = attendance_report.build_team_xlsx(report)
    except Exception:
        xlsx = None

    recips = recipients or [manager_email]
    if isinstance(recips, str):
        recips = [r.strip() for r in recips.split(",") if r.strip()] or [manager_email]

    sent = email_service.send_team_attendance_report(
        manager_email, recips, report, xlsx, automated=automated
    )
    return {
        "success": True,
        "sent": bool(sent),
        "headcount": report["headcount"],
        "period": report["period"],
        "recipients": recips,
    }


def run_due(now: datetime.datetime | None = None) -> int:
    """Run every active schedule whose next_run has passed. Returns how many fired.
    Called from the startup background loop. Always advances next_run (even on failure)
    so a broken schedule can't hot-loop."""
    now = now or datetime.datetime.now()
    db = SessionLocal()
    try:
        due = (
            db.query(AttendanceSchedule)
            .filter(
                AttendanceSchedule.active == True,  # noqa: E712
                AttendanceSchedule.next_run != None,  # noqa: E711
                AttendanceSchedule.next_run <= now,
            )
            .all()
        )
        fired = 0
        for sched in due:
            month, year = _report_period(sched.frequency, sched.period_mode, now)
            recips = _recipients_list(sched)
            try:
                result = send_report_now(
                    sched.manager_email, recips, str(month), str(year), automated=True
                )
                if result.get("success") and result.get("sent"):
                    sched.last_status = "sent"
                elif result.get("error"):
                    sched.last_status = f"skipped:{result['error']}"
                else:
                    sched.last_status = "failed:send"
            except Exception as e:  # never let one bad schedule kill the loop
                sched.last_status = f"failed:{type(e).__name__}"
            sched.last_run = now
            sched.next_run = compute_next_run(
                sched.frequency, sched.day_of_week, sched.day_of_month, sched.hour, now
            )
            fired += 1
        db.commit()
        return fired
    finally:
        db.close()
