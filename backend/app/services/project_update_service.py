"""
Biweekly Project-Update Service
-------------------------------
Drives the PMO-controlled biweekly "what are you working on?" form.

Flow:
  1. run_due() (called from the startup loop) emails a form link to every *eligible*
     employee — i.e. anyone who does NOT already have an Active allocation.
  2. The employee fills the in-app form; submit() stores an AUDITED DRAFT
     (ProjectUpdateSubmission, status="submitted") and emails the Reporting Manager
     approve/reject links. NOTHING is written to employee_allocations here.
  3. The RM clicks Approve → app.main._finalize_decision calls approve(), which is the
     ONLY path that upserts employee_allocations (with today's timestamp). Reject() never
     touches allocation data.

PMO config (enable/cadence/hour/activity options/last-run bookkeeping) lives in the
CompanySettings key-value store, same as the parking reminder cadence.
"""

import datetime
import json
import secrets

from sqlalchemy import or_, func

from app.config import settings
from app.database import SessionLocal
from app.models import (
    ApprovalToken,
    Employee,
    EmployeeAllocation,
    ProjectUpdateSubmission,
)
from app.services import email_service
from app.services.company_settings_service import CompanySettingsService

# ── config keys ───────────────────────────────────────────────────────────────
K_ACTIVE = "project_update_active"
K_CADENCE = "project_update_cadence_days"
K_HOUR = "project_update_hour"
K_OPTIONS = "project_update_activity_options"
K_LAST_RUN = "project_update_last_run"

DEFAULT_OPTIONS = ["Project", "Learning", "PoC"]
DEFAULT_CADENCE = 14
DEFAULT_HOUR = 9


# ── config CRUD ─────────────────────────────────────────────────────────────--

def activity_options() -> list[str]:
    raw = CompanySettingsService.get(K_OPTIONS)
    if raw:
        try:
            opts = json.loads(raw)
            if isinstance(opts, list) and opts:
                return [str(o) for o in opts]
        except (ValueError, TypeError):
            pass
    return list(DEFAULT_OPTIONS)


def get_config() -> dict:
    return {
        "active": CompanySettingsService.get(K_ACTIVE) == "true",
        "cadence_days": int(CompanySettingsService.get(K_CADENCE) or DEFAULT_CADENCE),
        "hour": int(CompanySettingsService.get(K_HOUR) or DEFAULT_HOUR),
        "activity_options": activity_options(),
        "last_run": CompanySettingsService.get(K_LAST_RUN) or None,
    }


def set_config(payload: dict, updated_by: str = "") -> dict:
    if "active" in payload:
        CompanySettingsService.set(K_ACTIVE, "true" if payload["active"] else "false", updated_by)
    if "cadence_days" in payload:
        try:
            CompanySettingsService.set(K_CADENCE, str(max(1, int(payload["cadence_days"]))), updated_by)
        except (ValueError, TypeError):
            pass
    if "hour" in payload:
        try:
            CompanySettingsService.set(K_HOUR, str(min(max(int(payload["hour"]), 0), 23)), updated_by)
        except (ValueError, TypeError):
            pass
    if "activity_options" in payload:
        opts = [str(o).strip() for o in (payload["activity_options"] or []) if str(o).strip()]
        CompanySettingsService.set(K_OPTIONS, json.dumps(opts or DEFAULT_OPTIONS), updated_by)
    return get_config()


# ── period math ─────────────────────────────────────────────────────────────--

def current_period(now: datetime.date | None = None) -> tuple[datetime.date, datetime.date, str]:
    """The fortnight ending today (period_start, period_end, human label)."""
    end = now or datetime.date.today()
    start = end - datetime.timedelta(days=13)
    label = f"{start.strftime('%b %d')} – {end.strftime('%b %d, %Y')}"
    return start, end, label


# ── eligibility (the skip-rule) ───────────────────────────────────────────────

def eligible_employees(db) -> list[Employee]:
    """Employees who do NOT have an Active allocation — the ones we ask.

    Anyone with an EmployeeAllocation whose completion_status or status is 'Active'
    is considered already up to date and is skipped.
    """
    active = (
        db.query(EmployeeAllocation)
        .filter(
            or_(
                func.lower(EmployeeAllocation.completion_status) == "active",
                func.lower(EmployeeAllocation.status) == "active",
            )
        )
        .all()
    )
    active_names = {a.employee_name.strip().lower() for a in active if a.employee_name}
    active_ids = {a.employee_id for a in active if a.employee_id}

    emps = db.query(Employee).filter(Employee.email.isnot(None), Employee.email != "").all()
    return [
        e for e in emps
        if (e.name or "").strip().lower() not in active_names
        and e.employee_id not in active_ids
    ]


# ── serialization ─────────────────────────────────────────────────────────────

def _to_dict(s: ProjectUpdateSubmission) -> dict:
    return {
        "id": s.id,
        "employee_name": s.employee_name,
        "employee_email": s.employee_email,
        "period_start": s.period_start.isoformat() if s.period_start else None,
        "period_end": s.period_end.isoformat() if s.period_end else None,
        "activity_type": s.activity_type,
        "project_name": s.project_name,
        "expected_end_date": s.expected_end_date.isoformat() if s.expected_end_date else None,
        "duration_text": s.duration_text,
        "details": s.details,
        "filled_by_email": s.filled_by_email,
        "filled_at": s.filled_at.isoformat() if s.filled_at else None,
        "status": s.status,
        "approved_by_email": s.approved_by_email,
        "approved_at": s.approved_at.isoformat() if s.approved_at else None,
        "decision_reason": s.decision_reason,
    }


def _parse_date(value) -> datetime.date | None:
    if not value:
        return None
    try:
        return datetime.datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError:
        return None


# ── employee-facing: submit a draft ───────────────────────────────────────────

def submit(employee_email: str, payload: dict) -> dict:
    """Create an audited draft and email the Reporting Manager for approval.
    Does NOT write to employee_allocations."""
    from app.hr_service import HRService

    activity = (payload.get("activity_type") or "").strip()
    if activity not in activity_options():
        return {"success": False, "error": "invalid_activity"}
    project_name = (payload.get("project_name") or "").strip() or None
    if activity == "Project" and not project_name:
        return {"success": False, "error": "project_name_required"}

    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(func.lower(Employee.email) == employee_email.lower()).first()
        if not emp:
            return {"success": False, "error": "employee_not_found"}

        start, end, label = current_period()
        sub = ProjectUpdateSubmission(
            employee_id=emp.id,
            employee_email=emp.email,
            employee_name=emp.name,
            period_start=start,
            period_end=end,
            activity_type=activity,
            project_name=project_name,
            expected_end_date=_parse_date(payload.get("expected_end_date")),
            duration_text=(payload.get("duration_text") or "").strip() or None,
            details=(payload.get("details") or "").strip() or None,
            filled_by_email=emp.email,
            filled_at=datetime.datetime.utcnow(),
            status="submitted",
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)

        # Mint approve/reject tokens for the Reporting Manager and email them.
        try:
            manager_email = HRService._find_manager_email(db, emp)
            expires = datetime.datetime.utcnow() + datetime.timedelta(hours=24)
            approve_tok = secrets.token_urlsafe(32)
            reject_tok = secrets.token_urlsafe(32)
            db.add(ApprovalToken(
                token=approve_tok, entity_type="project_update", entity_id=sub.id,
                action="approve", approver_email=manager_email, employee_email=emp.email, expires_at=expires,
            ))
            db.add(ApprovalToken(
                token=reject_tok, entity_type="project_update", entity_id=sub.id,
                action="reject", approver_email=manager_email, employee_email=emp.email, expires_at=expires,
            ))
            db.commit()
            email_service.send_project_update_approval_request(
                user_email=emp.email,
                approver_email=manager_email,
                employee_name=emp.name,
                employee_email=emp.email,
                activity_type=activity,
                project_name=project_name or "",
                duration_text=sub.duration_text or (sub.expected_end_date.isoformat() if sub.expected_end_date else ""),
                details=sub.details or "",
                period=label,
                approve_url=f"{settings.APP_BASE_URL}/api/approve/{approve_tok}",
                reject_url=f"{settings.APP_BASE_URL}/api/approve/{reject_tok}",
                submission_id=sub.id,
            )
        except Exception as e:
            print(f"[project_update] approval email error (non-fatal): {e}")

        return {"success": True, "submission_id": sub.id}
    finally:
        db.close()


def list_for_employee(employee_email: str) -> list[dict]:
    db = SessionLocal()
    try:
        rows = (
            db.query(ProjectUpdateSubmission)
            .filter(func.lower(ProjectUpdateSubmission.employee_email) == employee_email.lower())
            .order_by(ProjectUpdateSubmission.id.desc())
            .all()
        )
        return [_to_dict(s) for s in rows]
    finally:
        db.close()


def list_submissions(status: str | None = None) -> list[dict]:
    db = SessionLocal()
    try:
        q = db.query(ProjectUpdateSubmission)
        if status and status.lower() != "all":
            q = q.filter(func.lower(ProjectUpdateSubmission.status) == status.lower())
        rows = q.order_by(ProjectUpdateSubmission.id.desc()).all()
        return [_to_dict(s) for s in rows]
    finally:
        db.close()


# ── approval (called from app.main._finalize_decision) ─────────────────────────

def approve(db, submission_id: int, approved_by: str) -> ProjectUpdateSubmission | None:
    """Approve a draft and upsert it into employee_allocations — the ONLY writer to
    main allocation data. Uses the caller's db session (commit is the caller's)."""
    sub = db.query(ProjectUpdateSubmission).filter(ProjectUpdateSubmission.id == submission_id).first()
    if not sub:
        return None

    emp = db.query(Employee).filter(Employee.id == sub.employee_id).first()
    emp_code = emp.employee_id if emp else None
    alloc_project = sub.project_name or sub.activity_type

    alloc = None
    if emp_code:
        alloc = (
            db.query(EmployeeAllocation)
            .filter(
                EmployeeAllocation.employee_id == emp_code,
                EmployeeAllocation.project_name == alloc_project,
            )
            .first()
        )
    if alloc is None:
        alloc = (
            db.query(EmployeeAllocation)
            .filter(
                func.lower(EmployeeAllocation.employee_name) == (sub.employee_name or "").lower(),
                EmployeeAllocation.project_name == alloc_project,
            )
            .first()
        )

    today = datetime.date.today()
    if alloc is None:
        alloc = EmployeeAllocation(
            employee_id=emp_code,
            employee_name=sub.employee_name,
            project_name=alloc_project,
        )
        db.add(alloc)
    alloc.project_type = sub.activity_type
    alloc.completion_status = "Active"
    alloc.status = "Active"
    alloc.allocation_date = today
    alloc.expected_end_date = sub.expected_end_date
    alloc.reporting_manager = approved_by

    sub.status = "approved"
    sub.approved_by_email = approved_by
    sub.approved_at = datetime.datetime.utcnow()
    db.flush()
    sub.allocation_id = alloc.id
    return sub


def reject(db, submission_id: int, approved_by: str, reason: str) -> ProjectUpdateSubmission | None:
    """Reject a draft — never touches allocation data. Uses the caller's db session."""
    sub = db.query(ProjectUpdateSubmission).filter(ProjectUpdateSubmission.id == submission_id).first()
    if not sub:
        return None
    sub.status = "rejected"
    sub.approved_by_email = approved_by
    sub.approved_at = datetime.datetime.utcnow()
    sub.decision_reason = reason
    return sub


# ── scheduler ─────────────────────────────────────────────────────────────────

def _sender() -> str:
    return getattr(settings, "PROJECT_UPDATE_SENDER", "") or settings.NOTIFY_TO_EMAIL


def run_due(now: datetime.datetime | None = None, force: bool = False) -> int:
    """If active and the cadence has elapsed (or force=True), email the form link to all
    eligible employees. Returns how many emails were sent. Always advances last_run when
    it fires so a stuck run can't hot-loop. Called every minute from the startup loop."""
    cfg = get_config()
    if not force and not cfg["active"]:
        return 0

    today = (now or datetime.datetime.now()).date()
    if not force:
        last = _parse_date(cfg["last_run"])
        if last and (today - last).days < cfg["cadence_days"]:
            return 0

    sender = _sender()
    if not sender:
        print("[project_update] no sender configured (PROJECT_UPDATE_SENDER / NOTIFY_TO_EMAIL) — skipping")
        return 0

    _, _, label = current_period(today)
    form_link = f"{settings.APP_BASE_URL.rstrip('/')}/project-update"

    db = SessionLocal()
    try:
        targets = eligible_employees(db)
    finally:
        db.close()

    sent = 0
    for e in targets:
        try:
            if email_service.send_project_update_form_email(sender, e.name, e.email, form_link, label):
                sent += 1
        except Exception as ex:  # never let one bad recipient kill the run
            print(f"[project_update] send error for {e.email}: {ex}")

    CompanySettingsService.set(K_LAST_RUN, today.isoformat(), "scheduler")
    print(f"[project_update] form sent to {sent}/{len(targets)} eligible employees")
    return sent
