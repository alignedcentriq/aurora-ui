"""
Manager Portal routes — My Team page.

Most endpoints use require_has_reports (any user who has at least one direct report).
Onboarding (background-check / drug-test / client onboarding) and PMO Requests (VDI
provision / revoke) are restricted to Functional Managers only.

Sections:
  /has-team             — lightweight check: does the caller have any reports? (no gate)
  /attendance*          — whole-hierarchy attendance report + email automation
  /team                 — list team members (for dropdowns & overview)
  /team/allocations     — project allocations for all team members
  /team/skills          — skill sets for all team members
  /onboarding           — initiate & list client-side onboarding requests  [FM only]
  /pmo-requests         — VDI provision / revoke requests to PMO           [FM only]
"""

import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user, require_functional_manager, require_has_reports
from app.database import SessionLocal
from app.models import Employee, EmployeeAllocation, EmployeeSkill, OnboardingRequest, PMOTeamRequest
from app.services import attendance_schedule_service, attendance_service
from app.services.attendance_service import descendants, resolve_employee
from app.services import email_service

router = APIRouter(prefix="/api/portal/manager", tags=["Manager Portal"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_team(manager_email: str):
    """Return (manager, team_list) or raise 404/400 as appropriate."""
    db = SessionLocal()
    try:
        manager = resolve_employee(db, manager_email)
        if not manager:
            return None, []
        team = descendants(db, manager.id)
        return manager, team
    finally:
        db.close()


def _onboarding_dict(r: OnboardingRequest) -> dict:
    return {
        "id": r.id,
        "ref_id": f"ONB-{r.id:04d}",
        "employee_name": r.employee_name,
        "employee_email": r.employee_email,
        "steps": r.steps or {},
        "client_name": r.client_name,
        "notes": r.notes,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _pmo_req_dict(r: PMOTeamRequest) -> dict:
    type_labels = {"vdi_provision": "VDI Provision", "vdi_revoke": "VDI Revoke / Access Revocation"}
    return {
        "id": r.id,
        "ref_id": f"PMO-{r.id:04d}",
        "request_type": r.request_type,
        "request_type_label": type_labels.get(r.request_type, r.request_type),
        "employee_name": r.employee_name,
        "employee_email": r.employee_email,
        "details": r.details,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


# ── Live whole-hierarchy attendance report ────────────────────────────────────

@router.get("/has-team")
def has_team(user: CurrentUser = Depends(get_current_user)):
    """Returns {has_team: bool} — used by the frontend to decide whether to show the My Team nav."""
    from app.database import SessionLocal
    from app.models import Employee
    if user.role == "super admin":
        return {"has_team": True}
    db = SessionLocal()
    try:
        mgr = db.query(Employee).filter(Employee.email == user.email).first()
        if not mgr:
            return {"has_team": False}
        return {"has_team": db.query(Employee).filter(Employee.manager_id == mgr.id).first() is not None}
    finally:
        db.close()


@router.get("/attendance")
def get_team_attendance(
    month: Optional[str] = "",
    year: Optional[str] = "",
    user: CurrentUser = Depends(require_has_reports),
):
    report = attendance_service.team_report(user.email, month or "", year or "")
    if not report.get("success"):
        return report
    return report


class EmailNowRequest(BaseModel):
    month: Optional[str] = ""
    year: Optional[str] = ""
    recipients: Optional[list[str]] = None


@router.post("/attendance/email")
def email_team_attendance(
    body: EmailNowRequest,
    user: CurrentUser = Depends(require_has_reports),
):
    result = attendance_schedule_service.send_report_now(
        user.email,
        recipients=body.recipients,
        month=body.month or "",
        year=body.year or "",
        automated=False,
    )
    if not result.get("success"):
        return result
    return result


# ── Schedule automations ───────────────────────────────────────────────────────

class ScheduleBody(BaseModel):
    frequency: str
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    hour: Optional[int] = 8
    minute: Optional[int] = 0
    recipients: Optional[list[str]] = None
    period_mode: Optional[str] = "prev_period"
    active: Optional[bool] = True


@router.get("/attendance/schedules")
def list_schedules(user: CurrentUser = Depends(require_has_reports)):
    return attendance_schedule_service.list_for_manager(user.email)


@router.post("/attendance/schedules")
def create_schedule(
    body: ScheduleBody,
    user: CurrentUser = Depends(require_has_reports),
):
    result = attendance_schedule_service.create(user.email, body.model_dump())
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "invalid"))
    return result["schedule"]


@router.patch("/attendance/schedules/{schedule_id}")
def update_schedule(
    schedule_id: int,
    body: dict,
    user: CurrentUser = Depends(require_has_reports),
):
    result = attendance_schedule_service.update(user.email, schedule_id, body)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "not_found"))
    return result["schedule"]


@router.delete("/attendance/schedules/{schedule_id}")
def delete_schedule(
    schedule_id: int,
    user: CurrentUser = Depends(require_has_reports),
):
    result = attendance_schedule_service.delete(user.email, schedule_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "not_found"))
    return {"success": True}


# ── User search (for recipient picker) ────────────────────────────────────────

@router.get("/users/search")
def search_users(
    q: str = "",
    user: CurrentUser = Depends(require_has_reports),
):
    """Search employees by name or email — for the attendance schedule recipient picker."""
    from sqlalchemy import or_
    q = (q or "").strip()
    if len(q) < 2:
        return []
    db = SessionLocal()
    try:
        rows = (
            db.query(Employee.name, Employee.email)
            .filter(
                Employee.email.isnot(None),
                or_(
                    Employee.name.ilike(f"%{q}%"),
                    Employee.email.ilike(f"%{q}%"),
                ),
            )
            .order_by(Employee.name)
            .limit(15)
            .all()
        )
        return [{"name": r.name or r.email, "email": r.email} for r in rows if r.email]
    finally:
        db.close()


# ── Team roster ───────────────────────────────────────────────────────────────

@router.get("/team")
def get_team(user: CurrentUser = Depends(require_has_reports)):
    """Flat list of all employees in the manager's hierarchy (for dropdowns)."""
    manager, team = _get_team(user.email)
    if not manager:
        return []
    return [
        {
            "id": e.id,
            "name": e.name,
            "email": e.email or "",
            "department": e.department or "",
            "designation": e.designation or "",
        }
        for e in sorted(team, key=lambda e: e.name or "")
    ]


# ── Project allocations ───────────────────────────────────────────────────────

@router.get("/team/allocations")
def get_team_allocations(user: CurrentUser = Depends(require_has_reports)):
    """All active project allocations for the manager's whole hierarchy."""
    manager, team = _get_team(user.email)
    if not manager or not team:
        return []

    team_names = {e.name for e in team if e.name}

    db = SessionLocal()
    try:
        rows = (
            db.query(EmployeeAllocation)
            .filter(EmployeeAllocation.employee_name.in_(team_names))
            .order_by(EmployeeAllocation.employee_name, EmployeeAllocation.project_name)
            .all()
        )
        result = []
        for r in rows:
            result.append({
                "id": r.id,
                "employee_name": r.employee_name,
                "project_name": r.project_name,
                "sub_project": r.sub_project,
                "client_master": r.client_master,
                "project_lead": r.project_lead,
                "completion_status": r.completion_status,
                "efforts_percent": r.efforts_percent,
                "billability_percent": r.billability_percent,
                "project_status": r.project_status,
                "billing": r.billing,
                "project_type": r.project_type,
                "allocation_date": r.allocation_date.isoformat() if r.allocation_date else None,
                "expected_end_date": r.expected_end_date.isoformat() if r.expected_end_date else None,
                "status": r.status,
            })
        return result
    finally:
        db.close()


# ── Skills ────────────────────────────────────────────────────────────────────

@router.get("/team/skills")
def get_team_skills(user: CurrentUser = Depends(require_has_reports)):
    """Skill sets for all employees in the manager's hierarchy."""
    manager, team = _get_team(user.email)
    if not manager or not team:
        return []

    team_ids = [e.id for e in team]

    db = SessionLocal()
    try:
        rows = (
            db.query(EmployeeSkill, Employee)
            .join(Employee, EmployeeSkill.employee_id == Employee.id)
            .filter(EmployeeSkill.employee_id.in_(team_ids))
            .order_by(Employee.name, EmployeeSkill.is_primary.desc(), EmployeeSkill.skill)
            .all()
        )
        result = []
        for skill, emp in rows:
            result.append({
                "employee_id": emp.id,
                "employee_name": emp.name,
                "employee_email": emp.email or "",
                "skill": skill.skill,
                "certification": skill.certification,
                "is_primary": skill.is_primary,
                "years_experience": skill.years_experience,
                "last_used": skill.last_used.isoformat() if skill.last_used else None,
            })
        return result
    finally:
        db.close()


# ── Team readiness + weekly digest (deterministic SQL; no LLM) ────────────────

@router.get("/team/digest")
def get_team_digest(user: CurrentUser = Depends(require_has_reports)):
    """Weekly operational brief: rolloffs, bench, overdue/soon training, and
    allocation-vs-training conflicts across the manager's hierarchy."""
    manager, team = _get_team(user.email)
    if not manager or not team:
        return {"ok": True, "team_size": 0, "rolling_off": [], "on_bench": [],
                "training_overdue": [], "training_due_soon": [], "load_training_conflicts": []}
    db = SessionLocal()
    try:
        from app.services import team_readiness_service
        return team_readiness_service.weekly_digest(db, team)
    finally:
        db.close()


class ReadinessBody(BaseModel):
    skills: str


@router.post("/team/readiness")
def post_team_readiness(
    body: ReadinessBody,
    user: CurrentUser = Depends(require_has_reports),
):
    """For required skills, classify each report ready / one-course-away / gap."""
    manager, team = _get_team(user.email)
    if not manager or not team:
        return {"ok": True, "required_skills": [], "summary": {}, "rows": []}
    db = SessionLocal()
    try:
        from app.services import team_readiness_service
        return team_readiness_service.readiness_for_project(db, team, body.skills)
    finally:
        db.close()


class AssignTrainingBody(BaseModel):
    employee_id: Optional[int] = None
    email: Optional[str] = None
    training_id: int
    due_date: Optional[str] = None


@router.post("/team/readiness/assign")
def assign_team_readiness_training(
    body: AssignTrainingBody,
    user: CurrentUser = Depends(require_has_reports),
):
    """Manager-approved enrollment for one team readiness suggestion."""
    db = SessionLocal()
    try:
        from app.services import techelevate_local_service as te
        emp = te._resolve_employee(db, employee_id=body.employee_id, email=body.email)
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found")

        due = None
        if body.due_date:
            try:
                due = datetime.datetime.fromisoformat(body.due_date).date()
            except ValueError:
                due = None

        a = te.assign_training(
            db, training_id=body.training_id, employee=emp,
            due_date=due, assigned_by=user.email
        )
        if not a:
            raise HTTPException(status_code=400, detail="Could not assign training")
        return {"ok": True, "message": "Training assigned successfully"}
    finally:
        db.close()


class RequestUdemyBody(BaseModel):
    employee_id: Optional[int] = None
    email: Optional[str] = None
    course_name: str
    skill: str


@router.post("/team/readiness/request-udemy")
def request_team_readiness_udemy(
    body: RequestUdemyBody,
    user: CurrentUser = Depends(require_has_reports),
):
    """Manager-approved Udemy license request for a missing skill."""
    from app.services.udemy_service import UdemyService
    db = SessionLocal()
    try:
        from app.services import techelevate_local_service as te
        emp = te._resolve_employee(db, employee_id=body.employee_id, email=body.email)
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found")
            
        justification = f"Manager requested training for missing skill: {body.skill}"
        msg = UdemyService.request_license(
            email=emp.email,
            justification=justification,
            course_name=body.course_name,
            platform="Udemy"
        )
        return {"ok": True, "message": msg}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ── Onboarding requests ───────────────────────────────────────────────────────

class OnboardingBody(BaseModel):
    employee_name: str
    employee_email: Optional[str] = None
    drug_test: bool = False
    background_check: bool = False
    client_onboarding: bool = False
    client_name: Optional[str] = None
    notes: Optional[str] = None


@router.get("/onboarding")
def list_onboarding(user: CurrentUser = Depends(require_functional_manager)):
    db = SessionLocal()
    try:
        rows = (
            db.query(OnboardingRequest)
            .filter(OnboardingRequest.created_by == user.email)
            .order_by(OnboardingRequest.created_at.desc())
            .all()
        )
        return [_onboarding_dict(r) for r in rows]
    finally:
        db.close()


@router.post("/onboarding")
def create_onboarding(
    body: OnboardingBody,
    user: CurrentUser = Depends(require_functional_manager),
):
    if not any([body.drug_test, body.background_check, body.client_onboarding]):
        raise HTTPException(status_code=400, detail="Select at least one onboarding step.")

    db = SessionLocal()
    try:
        req = OnboardingRequest(
            employee_name=body.employee_name.strip(),
            employee_email=(body.employee_email or "").strip() or None,
            steps={
                "drug_test": body.drug_test,
                "background_check": body.background_check,
                "client_onboarding": body.client_onboarding,
            },
            client_name=(body.client_name or "").strip() or None,
            notes=(body.notes or "").strip() or None,
            status="Pending",
            created_by=user.email,
        )
        db.add(req)
        db.commit()
        db.refresh(req)
        ref_id = f"ONB-{req.id:04d}"

        manager = resolve_employee(db, user.email)
        manager_name = manager.name if manager else user.email

        email_service.send_onboarding_request_email(
            user_email=user.email,
            manager_name=manager_name,
            employee_name=req.employee_name,
            employee_email=req.employee_email or "",
            steps=req.steps,
            client_name=req.client_name or "",
            notes=req.notes or "",
            ref_id=ref_id,
        )
        return _onboarding_dict(req)
    finally:
        db.close()


@router.patch("/onboarding/{req_id}")
def update_onboarding_status(
    req_id: int,
    body: dict,
    user: CurrentUser = Depends(require_functional_manager),
):
    db = SessionLocal()
    try:
        req = db.query(OnboardingRequest).filter(
            OnboardingRequest.id == req_id,
            OnboardingRequest.created_by == user.email,
        ).first()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found.")
        allowed = {"Pending", "In Progress", "Completed"}
        new_status = body.get("status", "")
        if new_status not in allowed:
            raise HTTPException(status_code=400, detail=f"Status must be one of {allowed}")
        req.status = new_status
        req.updated_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(req)
        return _onboarding_dict(req)
    finally:
        db.close()


# ── PMO requests (VDI provision / revoke) ─────────────────────────────────────

class PMORequestBody(BaseModel):
    request_type: str  # vdi_provision | vdi_revoke
    employee_name: str
    employee_email: Optional[str] = None
    details: Optional[str] = None


@router.get("/pmo-requests")
def list_pmo_requests(user: CurrentUser = Depends(require_functional_manager)):
    db = SessionLocal()
    try:
        rows = (
            db.query(PMOTeamRequest)
            .filter(PMOTeamRequest.created_by == user.email)
            .order_by(PMOTeamRequest.created_at.desc())
            .all()
        )
        return [_pmo_req_dict(r) for r in rows]
    finally:
        db.close()


@router.post("/pmo-requests")
def create_pmo_request(
    body: PMORequestBody,
    user: CurrentUser = Depends(require_functional_manager),
):
    allowed_types = {"vdi_provision", "vdi_revoke"}
    if body.request_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"request_type must be one of {allowed_types}")

    db = SessionLocal()
    try:
        req = PMOTeamRequest(
            request_type=body.request_type,
            employee_name=body.employee_name.strip(),
            employee_email=(body.employee_email or "").strip() or None,
            details=(body.details or "").strip() or None,
            status="Pending",
            created_by=user.email,
        )
        db.add(req)
        db.commit()
        db.refresh(req)
        ref_id = f"PMO-{req.id:04d}"

        manager = resolve_employee(db, user.email)
        manager_name = manager.name if manager else user.email

        email_service.send_pmo_team_request_email(
            user_email=user.email,
            manager_name=manager_name,
            employee_name=req.employee_name,
            employee_email=req.employee_email or "",
            request_type=req.request_type,
            details=req.details or "",
            ref_id=ref_id,
        )
        return _pmo_req_dict(req)
    finally:
        db.close()
