import datetime
import time
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import Response as RawResponse
from typing import Optional
from app.services.employee_service import EmployeeService
from app.database import SessionLocal
from app.models import Employee, EmployeeSkill, EmployeeZohoProfile
from pydantic import BaseModel
from app.auth import CurrentUser, get_current_user, require_non_employee
from sqlalchemy import or_

router = APIRouter(prefix="/api/employees", tags=["employees"])

# Certification file upload limits
_MAX_CERT_BYTES = 10 * 1024 * 1024  # 10 MB


def _serialize_skill(s: EmployeeSkill) -> dict:
    return {
        "id": s.id,
        "skill": s.skill,
        "certification": s.certification or "",
        "is_primary": bool(s.is_primary),
        "years_experience": s.years_experience,
        "last_used": s.last_used.isoformat() if s.last_used else None,
        "has_cert_file": bool(s.cert_file_data),
        "cert_file_name": s.cert_file_name or "",
    }


def _serialize(e: Employee, skills: list[EmployeeSkill]) -> dict:
    return {
        "id": e.id,
        "employee_id": e.employee_id,
        "name": e.name,
        "email": e.email,
        "department": e.department or "",
        "designation": e.designation or "",
        "location": e.location or "",
        "role": e.role or "Employee",
        "skills": [
            {"skill": s.skill, "certification": s.certification or ""}
            for s in skills
        ],
    }


def _get_or_create_employee(db, email: str) -> Employee:
    """Get-or-create a placeholder employee stub by email (never return 'not found').

    This is a fallback for routes that need *some* Employee row to hang data off of
    (e.g. viewing the Skills tab) — it is NOT a "new employee joined" event and must
    never trigger onboarding kickoff (welcome email / manager-call invite). Those only
    fire from a deliberate employee-creation action — see PeopleService.add_employee /
    PeopleService.import_employees, which call welcome_service.kickoff_new_hire().
    """
    emp = db.query(Employee).filter(Employee.email == email).first()
    if not emp:
        name = email.split("@")[0].replace(".", " ").replace("_", " ").title()
        emp = Employee(
            employee_id=f"EMP{abs(hash(email)) % 9000 + 1000}",
            name=name,
            email=email,
            department="General",
            designation="Employee",
            joining_date=datetime.date.today(),
            employment_type="Full-time",
            shift_type="Day",
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
    return emp


def _sync_zoho_profile(db, emp: Employee) -> None:
    """Mirror the employee's structured skills into the Zoho directory columns so
    the manager-facing People page stays current. skill_set = primary-first skill
    names; tags = certification names."""
    skills = (
        db.query(EmployeeSkill)
        .filter(EmployeeSkill.employee_id == emp.id)
        .order_by(EmployeeSkill.is_primary.desc(), EmployeeSkill.skill)
        .all()
    )
    skill_names = [s.skill for s in skills if s.skill]
    cert_names = [s.certification for s in skills if s.certification]

    profile = (
        db.query(EmployeeZohoProfile)
        .filter(EmployeeZohoProfile.employee_id == emp.id)
        .first()
    )
    if not profile:
        profile = (
            db.query(EmployeeZohoProfile)
            .filter(EmployeeZohoProfile.official_email == emp.email)
            .first()
        )
    if not profile:
        profile = EmployeeZohoProfile(employee_id=emp.id, official_email=emp.email)
        db.add(profile)

    profile.skill_set = ", ".join(skill_names) if skill_names else None
    profile.tags = ", ".join(cert_names) if cert_names else None
    db.commit()


def _validate_cert_file(file: UploadFile, data: bytes) -> None:
    ct = (file.content_type or "").lower()
    if not (ct.startswith("image/") or ct == "application/pdf"):
        raise HTTPException(status_code=400, detail="Certification file must be an image or PDF.")
    if len(data) > _MAX_CERT_BYTES:
        raise HTTPException(status_code=400, detail="Certification file must be 10 MB or smaller.")


@router.get("")
def list_employees(
    q: str = "",
    location: Optional[str] = None,
    department: Optional[str] = None,
    skill: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """List employees with their skills/certifications. Supports search and filters."""
    db = SessionLocal()
    try:
        query = db.query(Employee)
        if q:
            term = f"%{q}%"
            query = query.filter(or_(Employee.name.ilike(term), Employee.email.ilike(term)))
        if location:
            query = query.filter(Employee.location.ilike(f"%{location}%"))
        if department:
            query = query.filter(Employee.department.ilike(f"%{department}%"))
        if skill:
            query = query.filter(
                Employee.id.in_(
                    db.query(EmployeeSkill.employee_id).filter(EmployeeSkill.skill.ilike(f"%{skill}%"))
                )
            )

        total = query.count()
        rows = query.order_by(Employee.name).offset(offset).limit(min(limit, 200)).all()

        ids = [e.id for e in rows]
        skills_by_emp: dict[int, list[EmployeeSkill]] = {i: [] for i in ids}
        if ids:
            for s in db.query(EmployeeSkill).filter(EmployeeSkill.employee_id.in_(ids)).all():
                skills_by_emp[s.employee_id].append(s)

        return {
            "total": total,
            "count": len(rows),
            "offset": offset,
            "employees": [_serialize(e, skills_by_emp.get(e.id, [])) for e in rows],
        }
    finally:
        db.close()


@router.get("/autocomplete")
def autocomplete_employees(q: str = "", limit: int = 8):
    db = SessionLocal()
    try:
        query = db.query(Employee)
        if q:
            term = f"%{q}%"
            query = query.filter(
                or_(Employee.name.ilike(term), Employee.email.ilike(term))
            )
        results = query.limit(limit).all()
        return [
            {
                "id": e.id,
                "name": e.name,
                "email": e.email,
                "department": e.department or "",
                "designation": e.designation or "",
            }
            for e in results
        ]
    finally:
        db.close()


@router.get("/search")
def search_employees(
    q: str = "",
    function: Optional[str] = None,
    designation: Optional[str] = None,
    limit: int = 20,
):
    result = EmployeeService.search_directory(
        query=q,
        function=function,
        designation=designation,
        limit=limit,
    )
    return {"result": result}


@router.get("/profile")
def get_profile(identifier: str):
    return {"result": EmployeeService.get_profile(identifier)}


@router.get("/org-chart")
def get_org_chart(name_or_email: str):
    return {"result": EmployeeService.get_org_chart(name_or_email)}


@router.get("/team")
def get_team(manager: str):
    return {"result": EmployeeService.get_team_roster(manager)}


@router.get("/skills")
def find_by_skill(skill: str):
    return {"result": EmployeeService.find_skills_expert(skill)}


@router.get("/headcount")
def headcount(function: Optional[str] = None):
    return {"result": EmployeeService.get_department_headcount(function)}


def _parse_date(val: Optional[str]) -> Optional[datetime.date]:
    if not val or not val.strip():
        return None
    try:
        return datetime.date.fromisoformat(val.strip()[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="last_used must be a YYYY-MM-DD date.")


def _parse_float(val: Optional[str]) -> Optional[float]:
    if val is None or str(val).strip() == "":
        return None
    try:
        return float(val)
    except ValueError:
        raise HTTPException(status_code=400, detail="years_experience must be a number.")


# ── Self-serve skills editor (scoped to the authenticated user) ────────────────

@router.get("/me/skills")
def my_skills(user: CurrentUser = Depends(get_current_user)):
    """Current user's structured skills with per-skill metadata."""
    db = SessionLocal()
    try:
        emp = _get_or_create_employee(db, user.email)
        skills = (
            db.query(EmployeeSkill)
            .filter(EmployeeSkill.employee_id == emp.id)
            .order_by(EmployeeSkill.is_primary.desc(), EmployeeSkill.skill)
            .all()
        )
        return {"skills": [_serialize_skill(s) for s in skills]}
    finally:
        db.close()


@router.post("/me/skills")
async def add_my_skill(
    skill: str = Form(...),
    certification: Optional[str] = Form(None),
    years_experience: Optional[str] = Form(None),
    last_used: Optional[str] = Form(None),
    is_primary: bool = Form(False),
    cert_file: Optional[UploadFile] = File(None),
    user: CurrentUser = Depends(get_current_user),
):
    """Add a new skill for the current user, with an optional certification file."""
    skill = (skill or "").strip()
    if not skill:
        raise HTTPException(status_code=400, detail="Skill name is required.")
    yexp = _parse_float(years_experience)
    lused = _parse_date(last_used)

    db = SessionLocal()
    try:
        emp = _get_or_create_employee(db, user.email)
        row = EmployeeSkill(
            employee_id=emp.id,
            skill=skill,
            certification=(certification or "").strip() or None,
            years_experience=yexp,
            last_used=lused,
            is_primary=bool(is_primary),
        )
        if cert_file is not None:
            data = await cert_file.read()
            if data:
                _validate_cert_file(cert_file, data)
                row.cert_file_data = data
                row.cert_file_name = cert_file.filename
                row.cert_content_type = cert_file.content_type
        db.add(row)
        db.commit()
        db.refresh(row)

        if is_primary:
            # enforce single primary
            db.query(EmployeeSkill).filter(
                EmployeeSkill.employee_id == emp.id, EmployeeSkill.id != row.id
            ).update({EmployeeSkill.is_primary: False})
            db.commit()

        _sync_zoho_profile(db, emp)
        return _serialize_skill(row)
    finally:
        db.close()


@router.patch("/me/skills/{skill_id}")
async def update_my_skill(
    skill_id: int,
    skill: Optional[str] = Form(None),
    certification: Optional[str] = Form(None),
    years_experience: Optional[str] = Form(None),
    last_used: Optional[str] = Form(None),
    is_primary: Optional[bool] = Form(None),
    cert_file: Optional[UploadFile] = File(None),
    user: CurrentUser = Depends(get_current_user),
):
    """Update one of the current user's skills (ownership enforced)."""
    db = SessionLocal()
    try:
        emp = _get_or_create_employee(db, user.email)
        row = (
            db.query(EmployeeSkill)
            .filter(EmployeeSkill.id == skill_id, EmployeeSkill.employee_id == emp.id)
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Skill not found.")

        if skill is not None and skill.strip():
            row.skill = skill.strip()
        if certification is not None:
            row.certification = certification.strip() or None
        if years_experience is not None:
            row.years_experience = _parse_float(years_experience)
        if last_used is not None:
            row.last_used = _parse_date(last_used)
        if is_primary is not None:
            row.is_primary = bool(is_primary)
        if cert_file is not None:
            data = await cert_file.read()
            if data:
                _validate_cert_file(cert_file, data)
                row.cert_file_data = data
                row.cert_file_name = cert_file.filename
                row.cert_content_type = cert_file.content_type
        db.commit()
        db.refresh(row)

        if is_primary:
            db.query(EmployeeSkill).filter(
                EmployeeSkill.employee_id == emp.id, EmployeeSkill.id != row.id
            ).update({EmployeeSkill.is_primary: False})
            db.commit()

        _sync_zoho_profile(db, emp)
        return _serialize_skill(row)
    finally:
        db.close()


@router.post("/me/skills/{skill_id}/primary")
def set_primary_skill(skill_id: int, user: CurrentUser = Depends(get_current_user)):
    """Mark a skill as primary, clearing the flag on the user's other skills."""
    db = SessionLocal()
    try:
        emp = _get_or_create_employee(db, user.email)
        row = (
            db.query(EmployeeSkill)
            .filter(EmployeeSkill.id == skill_id, EmployeeSkill.employee_id == emp.id)
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Skill not found.")
        db.query(EmployeeSkill).filter(EmployeeSkill.employee_id == emp.id).update(
            {EmployeeSkill.is_primary: False}
        )
        row.is_primary = True
        db.commit()
        _sync_zoho_profile(db, emp)
        return {"ok": True, "primary_skill_id": row.id}
    finally:
        db.close()


@router.delete("/me/skills/{skill_id}")
def delete_my_skill(skill_id: int, user: CurrentUser = Depends(get_current_user)):
    """Remove one of the current user's skills."""
    db = SessionLocal()
    try:
        emp = _get_or_create_employee(db, user.email)
        row = (
            db.query(EmployeeSkill)
            .filter(EmployeeSkill.id == skill_id, EmployeeSkill.employee_id == emp.id)
            .first()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Skill not found.")
        db.delete(row)
        db.commit()
        _sync_zoho_profile(db, emp)
        return {"ok": True}
    finally:
        db.close()


@router.get("/me/skills/{skill_id}/cert-file")
def get_cert_file(skill_id: int, user: CurrentUser = Depends(get_current_user)):
    """Stream the certification file the user uploaded for a skill."""
    db = SessionLocal()
    try:
        emp = _get_or_create_employee(db, user.email)
        row = (
            db.query(EmployeeSkill)
            .filter(EmployeeSkill.id == skill_id, EmployeeSkill.employee_id == emp.id)
            .first()
        )
        if not row or not row.cert_file_data:
            raise HTTPException(status_code=404, detail="Certification file not found.")
        return RawResponse(
            content=row.cert_file_data,
            media_type=row.cert_content_type or "application/octet-stream",
            headers={
                "Cache-Control": "private, max-age=3600",
                "Content-Disposition": f'inline; filename="{row.cert_file_name or "certification"}"',
            },
        )
    finally:
        db.close()


class UpdateRoleRequest(BaseModel):
    role: str


@router.get("/roles/assigned")
def list_assigned_roles(
    _: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        # Fetch all employees who have a non-null and non-Employee role
        rows = db.query(Employee).filter(
            Employee.role != None,
            Employee.role != "Employee"
        ).order_by(Employee.name).all()
        
        return [
            {
                "id": e.id,
                "name": e.name,
                "email": e.email,
                "role": e.role,
                "designation": e.designation or "",
                "department": e.department or "",
            }
            for e in rows
        ]
    finally:
        db.close()


@router.put("/{email}/role")
def update_employee_role(
    email: str,
    req: UpdateRoleRequest,
    user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found")
        
        old_role = emp.role or "Employee"
        new_role = req.role.strip()
        
        valid_roles_capitalized = {
            "employee": "Employee",
            "hr": "HR",
            "it": "IT",
            "pmo": "PMO",
            "admin": "Admin",
            "functional manager": "Functional Manager",
            "super admin": "Super Admin"
        }
        normalized_role = valid_roles_capitalized.get(new_role.lower())
        if not normalized_role:
            raise HTTPException(status_code=400, detail=f"Invalid role: {new_role}")
            
        emp.role = normalized_role
        db.commit()
        
        # Get Admin name
        admin_emp = db.query(Employee).filter(Employee.email == user.email).first()
        admin_name = admin_emp.name if admin_emp else user.email.split("@")[0].replace(".", " ").replace("_", " ").title()
        
        # Create activity announcement (target_audience="non-employee")
        from app.services.announcement_service import AnnouncementService
        AnnouncementService.create(
            title=f"{admin_name} added {emp.name} as {normalized_role}",
            body=f"{emp.name} ({email}) has been assigned the role of {normalized_role} (previously {old_role}).",
            category="Activity",
            created_by=user.email,
            created_by_domain="admin",
            target_audience="non-employee",
        )
        
        return {"status": "ok", "message": f"Updated role to {normalized_role}"}
    finally:
        db.close()



_IT_TICKET_OPEN_STATUSES = {"Open", "Awaiting Approval", "In Progress"}


async def _sync_it_ticket_ref(db, ticket, user_email: str) -> None:
    """Best-effort: look up the ManageEngine request id + live status for one open ticket
    from the user's helpdesk lifecycle emails, and persist it. Silently no-ops if the user
    hasn't connected Microsoft or nothing matches — the ticket just keeps its local status.

    ponytail: one Graph mail search per open ticket lacking a ref id. Fine at today's
    volume (a handful of open tickets per user); if that stops being true, fetch the
    mailbox once per request and match all open tickets against it instead.
    """
    from app.services import oauth_service, helpdesk_mail

    try:
        token = await oauth_service.get_valid_token(user_email.lower().strip(), "microsoft")
        if not token:
            return
        found = await helpdesk_mail.find_request_status(token, ticket.subject or "")
        if not found:
            return
        ticket.external_ref_id = found["request_id"]
        status_map = {"logged": "Open", "assigned": "In Progress", "approved": "In Progress",
                      "resolved": "Resolved", "closed": "Closed"}
        mapped = status_map.get(found["status"])
        if mapped:
            ticket.status = mapped
        db.commit()
    except Exception:
        pass  # sync failure must never break the requests page


@router.get("/me/requests")
async def my_requests(
    user: CurrentUser = Depends(get_current_user),
):
    from app.models import (
        Leave, ParkingSticker, FacilityComplaint, Reimbursement,
        TravelRequest, TravelExpenseClaim, UdemyLicenseRequest,
        HRQuery, Grievance, Escalation, FormSubmission, FormTemplate, ITTicket
    )

    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == user.email).first()
        if not emp:
            return {
                "leaves": [],
                "parking": [],
                "complaints": [],
                "reimbursements": [],
                "travel_requests": [],
                "travel_expenses": [],
                "udemy": [],
                "hr_queries": [],
                "grievances": [],
                "escalations": [],
                "form_submissions": [],
                "it_tickets": []
            }

        # 1. Leaves
        leaves = db.query(Leave).filter(Leave.employee_id == emp.id).order_by(Leave.created_at.desc()).all()

        # 2. Parking Stickers
        parking = db.query(ParkingSticker).filter(ParkingSticker.employee_id == emp.id).order_by(ParkingSticker.valid_from.desc()).all()

        # 3. Facility Complaints
        complaints = db.query(FacilityComplaint).filter(FacilityComplaint.employee_id == emp.id).order_by(FacilityComplaint.created_at.desc()).all()

        # 4. Reimbursements
        reimbs = db.query(Reimbursement).filter(Reimbursement.employee_id == emp.id).order_by(Reimbursement.created_at.desc()).all()

        # 5. Travel Requests
        travel_reqs = db.query(TravelRequest).filter(TravelRequest.employee_id == emp.id).order_by(TravelRequest.created_at.desc()).all()

        # 6. Travel Expense Claims
        travel_expenses = db.query(TravelExpenseClaim).filter(TravelExpenseClaim.employee_id == emp.id).order_by(TravelExpenseClaim.created_at.desc()).all()

        # 7. Udemy License Requests
        udemy = db.query(UdemyLicenseRequest).filter(UdemyLicenseRequest.employee_id == emp.id).order_by(UdemyLicenseRequest.created_at.desc()).all()

        # 8. HR Queries
        hr_queries = db.query(HRQuery).filter(HRQuery.employee_id == emp.id).order_by(HRQuery.created_at.desc()).all()

        # 9. Grievances
        grievances = db.query(Grievance).filter(Grievance.employee_id == emp.id).order_by(Grievance.submitted_at.desc()).all()

        # 10. Escalations
        escalations = db.query(Escalation).filter(Escalation.user_email == emp.email).order_by(Escalation.created_at.desc()).all()

        # 11a. IT Tickets — sync open ones lacking a ManageEngine ref against the mailbox first.
        it_tickets = db.query(ITTicket).filter(ITTicket.employee_id == emp.id).order_by(ITTicket.created_at.desc()).all()
        for t in it_tickets:
            if t.status in _IT_TICKET_OPEN_STATUSES:
                await _sync_it_ticket_ref(db, t, emp.email)

        # 11. Dynamic Form Library submissions (any admin-defined form, current or future).
        #     Joined to the template so the UI can label + filter by the originating form.
        form_subs = (
            db.query(FormSubmission, FormTemplate)
            .join(FormTemplate, FormSubmission.form_template_id == FormTemplate.id)
            .filter(
                (FormSubmission.employee_id == emp.id)
                | (FormSubmission.employee_email == emp.email)
            )
            .order_by(FormSubmission.submitted_at.desc())
            .all()
        )

        return {
            "leaves": [
                {
                    "id": l.id,
                    "leave_type": l.leave_type,
                    "status": l.status,
                    "start_date": str(l.start_date) if l.start_date else None,
                    "end_date": str(l.end_date) if l.end_date else None,
                    "reason": l.reason or "",
                    "days": ((l.end_date - l.start_date).days + 1) if l.start_date and l.end_date else 1,
                    "created_at": l.created_at.isoformat() if hasattr(l, "created_at") and l.created_at else None,
                }
                for l in leaves
            ],
            "parking": [
                {
                    "id": p.id,
                    "vehicle_type": p.vehicle_type,
                    "vehicle_number": p.vehicle_number,
                    "vehicle_make": p.vehicle_make or "",
                    "vehicle_model": p.vehicle_model or "",
                    "status": p.status,
                    "sticker_number": p.sticker_number or "Pending",
                    "valid_from": p.valid_from.isoformat() if p.valid_from else None,
                    "valid_until": p.valid_until.isoformat() if p.valid_until else None,
                }
                for p in parking
            ],
            "complaints": [
                {
                    "id": c.id,
                    "ticket_id": c.ticket_id,
                    "category": c.category,
                    "description": c.description,
                    "location": c.location,
                    "priority": c.priority,
                    "status": c.status,
                    "resolution_notes": c.resolution_notes or "",
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                }
                for c in complaints
            ],
            "reimbursements": [
                {
                    "id": r.id,
                    "type": r.type,
                    "amount": r.amount,
                    "reason": r.reason or "",
                    "status": r.status,
                    "approved_by": r.approved_by or "",
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in reimbs
            ],
            "travel_requests": [
                {
                    "id": t.id,
                    "ref_id": t.ref_id,
                    "from_location": t.from_location,
                    "to_destination": t.to_destination,
                    "travel_date": t.travel_date.isoformat() if t.travel_date else None,
                    "return_date": t.return_date.isoformat() if t.return_date else None,
                    "is_international": t.is_international,
                    "visa_required": t.visa_required,
                    "mode_of_travel": t.mode_of_travel,
                    "accommodation_required": t.accommodation_required,
                    "estimated_cost": t.estimated_cost,
                    "notes": t.notes or "",
                    "status": t.status,
                    "expense_limit": t.expense_limit,
                    "ticket_details": t.ticket_details or "",
                    "hotel_details": t.hotel_details or "",
                    "visa_status": t.visa_status or "",
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                }
                for t in travel_reqs
            ],
            "travel_expenses": [
                {
                    "id": e.id,
                    "ref_id": e.ref_id,
                    "travel_request_id": e.travel_request_id,
                    "amount": e.amount,
                    "breakdown": e.breakdown or "",
                    "over_limit_reason": e.over_limit_reason or "",
                    "status": e.status,
                    "approved_by": e.approved_by or "",
                    "rejection_reason": e.rejection_reason or "",
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in travel_expenses
            ],
            "udemy": [
                {
                    "id": u.id,
                    "platform": u.platform or "Udemy",
                    "course_name": u.course_name or "",
                    "justification": u.justification or "",
                    "status": u.status,
                    "decided_by": u.decided_by or "",
                    "decision_reason": u.decision_reason or "",
                    "created_at": u.created_at.isoformat() if u.created_at else None,
                }
                for u in udemy
            ],
            "hr_queries": [
                {
                    "id": q.id,
                    "reference_id": q.reference_id,
                    "category": q.category,
                    "subject": q.subject,
                    "description": q.description,
                    "status": q.status,
                    "priority": q.priority,
                    "response": q.response or "",
                    "responded_by": q.responded_by or "",
                    "responded_at": q.responded_at.isoformat() if q.responded_at else None,
                    "created_at": q.created_at.isoformat() if q.created_at else None,
                }
                for q in hr_queries
            ],
            "grievances": [
                {
                    "id": g.id,
                    "reference_id": g.reference_id,
                    "category": g.category,
                    "description": g.description,
                    "status": g.status,
                    "resolved_by": g.resolved_by or "",
                    "resolution_notes": g.resolution_notes or "",
                    "submitted_at": g.submitted_at.isoformat() if g.submitted_at else None,
                }
                for g in grievances
            ],
            "escalations": [
                {
                    "id": e.id,
                    "reference_id": e.reference_id,
                    "domain": e.domain or "",
                    "original_query": e.original_query or "",
                    "error_type": e.error_type or "",
                    "description": e.description or "",
                    "priority": e.priority,
                    "status": e.status,
                    "notified_to": e.notified_to or "",
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in escalations
            ],
            "form_submissions": [
                {
                    "id": s.id,
                    "reference_id": s.reference_id or f"FRM-{s.id}",
                    "form_template_id": s.form_template_id,
                    "form_name": t.name,
                    "category": t.category or "",
                    "field_values": s.field_values or {},
                    "status": s.status or "Pending",
                    "admin_remarks": s.admin_remarks or "",
                    "reviewed_by": s.reviewed_by or "",
                    "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                }
                for s, t in form_subs
            ],
            "it_tickets": [
                {
                    "id": t.id,
                    "ticket_id": t.ticket_id,
                    "category": t.category or "",
                    "subject": t.subject or "",
                    "description": t.description or "",
                    "priority": t.priority or "Medium",
                    "status": t.status,
                    "external_ref_id": t.external_ref_id or "",
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                }
                for t in it_tickets
            ]
        }
    finally:
        db.close()


def _attach_enrichment(employees: list[dict]) -> None:
    """Merge cached Alchemy skills/projects into directory rows in place, so the client
    has everything in one payload (no per-profile fetch). Only rows present in the cache
    get `skills`/`projects`; others are left without (the client lazy-loads those).
    Fail-soft — any error leaves the directory untouched."""
    try:
        from app.services import alchemy_service
        codes = [e.get("employee_code") for e in employees if e.get("employee_code")]
        cache = alchemy_service.get_cached_enrichment_map(codes)
        attached = 0
        for e in employees:
            hit = cache.get(e.get("employee_code"))
            if hit is not None:
                e["skills"] = hit["skills"]
                e["projects"] = hit["projects"]
                attached += 1
        # Full-coverage convergence: if any roster row has no cached enrichment yet,
        # kick a deduped background fill so subsequent loads bundle skills for everyone.
        # Non-blocking — this request still returns immediately with whatever is cached.
        if codes and attached < len(codes):
            alchemy_service.kick_enrichment_fill_async()
    except Exception:
        pass


def _attach_allocations(employees: list[dict]) -> None:
    """Bundle each employee's distinct project allocations (from employee_allocations,
    keyed by employee_id == directory employee_code) so the grid can filter/search by
    project the person was actually staffed on — far broader coverage (~1.3k people)
    than the Alchemy profile `projects`, which only ~200 have.

    Also bundles current availability from the LATEST allocation snapshot: allocated %
    (sum of efforts across real projects), free capacity, and an `available` flag
    (free capacity > 0, or sitting on the 'No Allocation' bench). Fail-soft."""
    try:
        from app.models import SCHEMA
        from sqlalchemy import text
        codes = [e.get("employee_code") for e in employees if e.get("employee_code")]
        codes = [c for c in {(c or "").strip() for c in codes} if c]
        if not codes:
            return
        db = SessionLocal()
        try:
            rows = db.execute(
                text(
                    f'SELECT employee_id, '
                    f'array_agg(DISTINCT project_name) FILTER '
                    f"(WHERE project_name IS NOT NULL AND project_name <> ''), "
                    f'array_agg(DISTINCT client_master) FILTER '
                    f"(WHERE client_master IS NOT NULL AND client_master <> '') "
                    f'FROM "{SCHEMA}".employee_allocations '
                    f'WHERE employee_id = ANY(:codes) GROUP BY employee_id'
                ),
                {"codes": codes},
            ).all()
            # Current allocation from the latest monthly snapshot.
            avail = db.execute(
                text(
                    f"SELECT employee_id, "
                    f"sum(CASE WHEN project_name = 'No Allocation' THEN 0 "
                    f"ELSE coalesce(efforts_percent, 0) END) AS allocated, "
                    f"bool_or(project_name = 'No Allocation') AS on_bench "
                    f'FROM "{SCHEMA}".employee_allocations '
                    f"WHERE employee_id = ANY(:codes) AND allocation_date = "
                    f"(SELECT max(allocation_date) FROM \"{SCHEMA}\".employee_allocations) "
                    f"GROUP BY employee_id"
                ),
                {"codes": codes},
            ).all()
        finally:
            db.close()
        by_code = {r[0]: {"projects": r[1] or [], "clients": r[2] or []} for r in rows}
        avail_by_code = {}
        for r in avail:
            allocated = float(r[1] or 0)
            free = max(0.0, 100.0 - allocated)
            avail_by_code[r[0]] = {
                "allocated_percent": round(allocated, 1),
                "availability_percent": round(free, 1),
                "available": bool(r[2]) or free > 0,
            }
        for e in employees:
            hit = by_code.get(e.get("employee_code"))
            if hit is not None:
                e["allocation_projects"] = hit["projects"]
                e["allocation_clients"] = hit["clients"]
            av = avail_by_code.get(e.get("employee_code"))
            if av is not None:
                e["allocated_percent"] = av["allocated_percent"]
                e["availability_percent"] = av["availability_percent"]
                e["available"] = av["available"]
            else:
                e["allocated_percent"] = 0.0
                e["availability_percent"] = 100.0
                e["available"] = True
    except Exception:
        pass


def _compose_directory() -> tuple[list[dict], str]:
    """Build the flat all-staff directory (employees list + source label).

    Primary source (when ZOHO_DBURL is configured) is the live Zoho People profile
    VIEW on the separate HR Postgres server — the authoritative roster with full
    coverage of employee code, designation, department, managers, phone and
    birthday (see services/zoho_directory_service.py).

    Fallback source is the synced MS365 / Azure AD directory enriched per-person by
    the local Zoho HR overlay + Employee row, used when the Zoho DB is unset or
    unreachable.
    """
    from app.services import zoho_directory_service

    # Live HR view is the source of truth when configured; fall back to MS365 only
    # if it's unset or returns nothing (connection error / empty).
    if zoho_directory_service.is_configured():
        employees = zoho_directory_service.fetch_directory()
        if employees:
            _attach_enrichment(employees)
            _attach_allocations(employees)
            return employees, "zoho"

    from app.models import MS365User
    from app.services.ms365_service import _is_non_human

    db = SessionLocal()
    try:
        # Zoho HR overlay keyed by email (rich fields; sparse in this DB).
        zoho: dict[str, EmployeeZohoProfile] = {}
        for p in db.query(EmployeeZohoProfile).all():
            key = (p.official_email or "").lower().strip()
            if key:
                zoho[key] = p

        # Employee table keyed by email (AASPL code + office location).
        emp_by_email: dict[str, Employee] = {}
        for e in db.query(Employee).all():
            if e.email:
                emp_by_email[e.email.lower().strip()] = e

        rows = db.query(MS365User).order_by(MS365User.name).all()
        out = []
        for r in rows:
            email = (r.email or "").lower().strip()
            name = r.name or email
            if not email or _is_non_human(name, email):
                continue
            if r.account_enabled is False:
                continue
            z = zoho.get(email)
            emp = emp_by_email.get(email)
            out.append({
                "name": name,
                "email": r.email,
                "employee_code": (emp.employee_id if emp else "") or "",
                "designation": r.job_title or (z.designation if z else "") or "",
                "department": r.department or (z.function if z else "") or "",
                "location": r.office_location or (emp.location if emp else "")
                            or (z.sub_location if z else "") or "",
                "city": r.city or "",
                "reporting_manager": r.manager_name or (z.reporting_manager if z else "") or "",
                "functional_manager": (z.functional_manager if z else "") or "",
                "phone": r.mobile_phone or r.business_phone or (z.work_phone if z else "") or "",
                "extension": (z.extension if z else "") or "",
                "nick_name": "",   # not synced
                "birthday": "",    # DOB not synced
            })
        out.sort(key=lambda x: x["name"].lower())
        _attach_enrichment(out)
        _attach_allocations(out)
        return out, "ms365"
    finally:
        db.close()


@router.get("/directory")
def employee_directory(user: CurrentUser = Depends(get_current_user)):
    """Flat all-staff directory that mirrors the company PowerApps Employee Directory.

    Open to every authenticated user; photos load via the public MS365 photo proxy
    keyed by email. See `_compose_directory` for how sources are combined.
    """
    employees, source = _compose_directory()
    return {"count": len(employees), "employees": employees, "source": source}


class DirectoryQueryRequest(BaseModel):
    query: str


@router.post("/directory/query")
def employee_directory_query(req: DirectoryQueryRequest, user: CurrentUser = Depends(get_current_user)):
    """Free-text directory search fallback: translates `query` into SQL over the
    composed directory via an LLM and returns matching employee codes.

    Used by the copilot sidebar's /directory intercept when its instant regex parser
    (multi-skill/project/year-range phrasing) can't find a filterable dimension —
    see directory_query_service for why SQL-over-the-composed-payload beats guessing
    at fixed fields. Returns {"matched": false} for non-filter queries or when the
    model's SQL doesn't pass validation, so the frontend can fall back further."""
    from app.services import directory_query_service
    start = time.time()
    employees, _source = _compose_directory()
    result = directory_query_service.run_query(employees, req.query)

    # Observability: this NL directory filter bypasses /api/chat, so record it here
    # (+ a Langfuse trace) — otherwise sidebar /directory queries are invisible.
    try:
        from app.services.observability_log import log_ai_interaction
        matched = bool(result.get("matched")) if isinstance(result, dict) else False
        codes = (result.get("employee_codes") or result.get("codes") or []) if isinstance(result, dict) else []
        log_ai_interaction(
            session_id=f"directory-{user.email}",
            user_email=user.email,
            user_message=req.query,
            domain="directory",
            route_method="directory_nl_query",
            response_text=f"{'matched' if matched else 'no match'}: {len(codes)} employee(s)",
            response_length=len(codes),
            start=start,
            tags=["directory"],
        )
    except Exception:
        pass

    return result


@router.get("/directory/{employee_code}/enrichment")
def directory_enrichment(employee_code: str, user: CurrentUser = Depends(get_current_user)):
    """Skills + projects for a directory person, pulled live from Alchemy by AASPL code.

    Returns {available, skills, projects}. Fail-soft: available=false when Alchemy
    has no service token configured / is unreachable, so the profile still renders.
    """
    from app.services import alchemy_service
    return alchemy_service.get_profile_enrichment(employee_code)


@router.get("/skill-detail")
def employee_skill_detail(name: str, user: CurrentUser = Depends(get_current_user)):
    """What a skill is (Alchemy catalog description) + everyone in the org who has it.

    Powers the click-through popup on a profile's skill pill. Returns the skill's
    description/category/image, headline counts, and the peer list (name + competency +
    years). Fail-soft → {available: false} when Alchemy is unreachable / has no match."""
    from app.services import alchemy_service
    tok = alchemy_service.get_service_token()
    if not tok:
        return {"available": False, "skill_name": name}
    sid, canonical = alchemy_service.resolve_skill_id(tok, name)
    if not sid:
        return {"available": False, "skill_name": name}
    try:
        det = alchemy_service.get_skill_details(tok, sid)
    except Exception:
        return {"available": False, "skill_name": canonical or name}
    emps = det.get("employees") if isinstance(det, dict) else None
    emps = emps or []

    def _exp(e):
        try:
            return float(e.get("experience") or 0)
        except (TypeError, ValueError):
            return 0.0

    peers = sorted(emps, key=_exp, reverse=True)[:100]
    peers = [
        {
            "employee_id": e.get("employee_id"),
            "name": e.get("name"),
            "competency": e.get("competency") or "",
            "experience": e.get("experience") or "",
            "last_used": e.get("last_used") or "",
        }
        for e in peers
    ]
    return {
        "available": True,
        "skill_name": det.get("skill_name") or canonical or name,
        "description": det.get("skill_description") or "",
        "image_url": det.get("skill_image_url") or "",
        "category": det.get("skill_category") or "",
        "total_employees": det.get("total_employees") or len(emps),
        "certified_count": det.get("certified_count") or 0,
        "instructor_count": det.get("instructor_count") or 0,
        "expert_count": det.get("expert_count") or 0,
        "peers": peers,
    }


@router.get("/project-detail")
def employee_project_detail(name: str, user: CurrentUser = Depends(get_current_user)):
    """Project overview + the team that worked on it. Members come from BOTH the
    allocation records (employee_allocations) AND the Alchemy project history
    (alchemy_profile_cache.projects), merged by employee code — the two sources cover
    different people, so neither alone is complete. Powers the click-through popup on a
    profile's project row. Fail-soft → {available: false} when nothing matches."""
    from app.models import SCHEMA
    from sqlalchemy import text
    pn = (name or "").strip()
    if not pn:
        return {"available": False, "project_name": name}
    db = SessionLocal()
    try:
        alloc = db.execute(
            text(
                f"SELECT employee_id, max(employee_name) AS name, "
                f"max(efforts_percent) AS efforts, max(billability_percent) AS billability, "
                f"bool_or(completion_status ILIKE 'Done') AS done "
                f'FROM "{SCHEMA}".employee_allocations '
                f"WHERE project_name = :pn AND employee_id IS NOT NULL "
                f"GROUP BY employee_id"
            ),
            {"pn": pn},
        ).mappings().all()
        meta = db.execute(
            text(
                f"SELECT client_master, project_status, project_lead, delivery_manager, "
                f"project_type FROM \"{SCHEMA}\".employee_allocations "
                f"WHERE project_name = :pn GROUP BY client_master, project_status, "
                f"project_lead, delivery_manager, project_type "
                f"ORDER BY max(allocation_date) DESC NULLS LAST LIMIT 1"
            ),
            {"pn": pn},
        ).mappings().first()
        # Alchemy project history: anyone whose cached profile lists this project.
        alch = db.execute(
            text(
                f"SELECT c.employee_code AS code, max(p->>'role') AS role "
                f'FROM "{SCHEMA}".alchemy_profile_cache c, '
                f"jsonb_array_elements(c.projects) p "
                f"WHERE p->>'name' = :pn GROUP BY c.employee_code"
            ),
            {"pn": pn},
        ).mappings().all()
        # Resolve names for Alchemy-only codes (allocation rows already carry names).
        alch_codes = [r["code"] for r in alch if r["code"]]
        names: dict[str, str] = {}
        if alch_codes:
            nrows = db.execute(
                text(
                    f'SELECT employee_id, name FROM "{SCHEMA}".employees '
                    f"WHERE employee_id = ANY(:codes)"
                ),
                {"codes": alch_codes},
            ).all()
            names = {r[0]: r[1] for r in nrows}
    finally:
        db.close()

    # Merge by employee code; allocation data wins for billability/status, Alchemy
    # contributes role and any people allocations missed.
    merged: dict[str, dict] = {}
    for m in alloc:
        merged[m["employee_id"]] = {
            "employee_id": m["employee_id"],
            "name": m["name"] or names.get(m["employee_id"]) or "",
            "efforts": m["efforts"],
            "billability": m["billability"],
            "done": bool(m["done"]),
            "role": "",
        }
    for r in alch:
        code = r["code"]
        if code in merged:
            merged[code]["role"] = r["role"] or merged[code]["role"]
        else:
            merged[code] = {
                "employee_id": code,
                "name": names.get(code) or "",
                "efforts": None,
                "billability": None,
                "done": False,
                "role": r["role"] or "",
            }
    members = sorted(merged.values(), key=lambda x: (x["name"] or "").lower())

    if not members and not meta:
        return {"available": False, "project_name": pn}
    return {
        "available": True,
        "project_name": pn,
        "client": (meta or {}).get("client_master") or "",
        "status": (meta or {}).get("project_status") or "",
        "lead": (meta or {}).get("project_lead") or "",
        "delivery_manager": (meta or {}).get("delivery_manager") or "",
        "project_type": (meta or {}).get("project_type") or "",
        "member_count": len(members),
        "members": members,
    }


@router.post("/admin/rewire-manager-hierarchy")
def rewire_manager_hierarchy_endpoint(user: CurrentUser = Depends(require_non_employee)):
    """Re-wire Employee.manager_id from Zoho reporting_manager_email.
    Useful after a Zoho CSV import or when team hierarchy shows empty in the portal."""
    from app.services.manager_service import rewire_manager_hierarchy
    result = rewire_manager_hierarchy()
    return {"success": True, **result}


# NOTE: keep this LAST — a bare /{employee_id} path param would otherwise shadow
# the static routes above (e.g. /autocomplete would be parsed as an id).
@router.get("/{employee_id}")
def get_employee(employee_id: int):
    """Fetch a single employee by primary-key id, with skills/certifications."""
    db = SessionLocal()
    try:
        e = db.query(Employee).filter(Employee.id == employee_id).first()
        if not e:
            raise HTTPException(status_code=404, detail=f"Employee {employee_id} not found")
        skills = db.query(EmployeeSkill).filter(EmployeeSkill.employee_id == e.id).all()
        return _serialize(e, skills)
    finally:
        db.close()
