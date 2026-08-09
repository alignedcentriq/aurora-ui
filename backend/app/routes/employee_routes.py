import datetime
import time
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import Response as RawResponse
from typing import Optional
from app.services.employee_service import EmployeeService
from app.database import SessionLocal
from app.models import Employee, EmployeeSkill, EmployeeZohoProfile
from pydantic import BaseModel
from app.auth import CurrentUser, get_current_user, require_non_employee, require_strict_pmo
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
        ParkingSticker, FacilityComplaint, Reimbursement,
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

        # 1. Leaves — always read live from the Zoho vt_leave_details view
        #    (system-of-record); nothing kept locally.
        zoho_leaves = []
        try:
            from app.services import zoho_leave_service
            zoho_leaves = zoho_leave_service.fetch_leave_history(emp.employee_id)
        except Exception:
            pass  # Zoho view unavailable must never break the requests page

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
                    "id": f"zoho-{idx}",
                    "leave_type": z.get("type"),
                    "status": z.get("status"),
                    "start_date": z.get("from"),
                    "end_date": z.get("to"),
                    "reason": z.get("reason") or "",
                    "days": z.get("days"),
                    "created_at": z.get("from"),
                }
                for idx, z in enumerate(zoho_leaves)
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


def _shape_allocation_projects(rows: list, latest: "datetime.date | None") -> list[dict]:
    """Group one person's raw allocation rows into DirProject-shaped entries.

    Each `row` needs project_name/client_master/delivery_manager/project_status/
    allocation_date. Rows spanning several months collapse to one entry per project:
    start_date is the first month they appear on it; end_date is the last month IF
    they've since rolled off it (absent from the latest available snapshot) — left
    blank while still current, matching how an open-ended Alchemy project reads.

    `status` follows the same latest-month rule as the project-detail popup's team
    list: a genuinely completed project reads "Completed" for everyone; otherwise a
    person absent from the latest month reads "Inactive" for THEM specifically, even
    if the project itself is still "Ongoing" for the rest of the team."""
    from app.services.allocation_snapshot_service import _project_completed

    by_project: dict[str, dict] = {}
    for r in rows:
        name = (r["project_name"] or "").strip()
        if not name or name.lower() == "no allocation":
            continue
        key = name.lower()
        entry = by_project.setdefault(key, {"name": name, "first": r["allocation_date"]})
        entry["last"] = r["allocation_date"]
        # Later rows win for the descriptive fields — the most recent month's client/
        # manager/status is the most accurate if any of these drifted over time.
        entry["client"] = r["client_master"] or entry.get("client", "")
        entry["manager"] = r["delivery_manager"] or entry.get("manager", "")
        entry["status"] = r["project_status"] or entry.get("status", "")

    out = []
    for entry in by_project.values():
        current = bool(latest) and entry.get("last") == latest
        raw_status = entry.get("status", "") or ""
        if _project_completed(raw_status):
            status = "Completed"
        elif current:
            status = raw_status
        else:
            status = "Inactive"
        out.append({
            "name": entry["name"],
            "role": "",
            "client": entry.get("client", "") or "",
            "manager": entry.get("manager", "") or "",
            "status": status,
            "start_date": entry["first"].isoformat() if entry.get("first") else "",
            "end_date": "" if current else (entry["last"].isoformat() if entry.get("last") else ""),
            "skills_used": "",
        })
    return out


def _merge_projects(existing: list[dict], additions: list[dict]) -> list[dict]:
    """Append `additions` whose (normalized) name isn't already in `existing`, then
    resort by recency — the shared no-duplicates rule for the profile's Projects list."""
    if not additions:
        return existing
    seen = {(p.get("name") or "").strip().lower() for p in existing}
    merged = list(existing)
    for p in additions:
        key = (p.get("name") or "").strip().lower()
        if key and key not in seen:
            merged.append(p)
            seen.add(key)
    merged.sort(key=lambda p: (p.get("end_date") or p.get("start_date") or ""), reverse=True)
    return merged


def _attach_allocations(employees: list[dict]) -> None:
    """Bundle each employee's distinct project allocations (from employee_allocations,
    keyed by employee_id == directory employee_code) so the grid can filter/search by
    project the person was actually staffed on — far broader coverage (~1.3k people)
    than the Alchemy profile `projects`, which only ~200 have.

    Also merges allocation-derived entries into `projects` itself (the DirProject list
    the profile popup renders) — same shape as the Alchemy ones, deduped by project
    name — so a profile's Projects section shows both sources instead of only Alchemy's.

    Also bundles current availability from the LATEST allocation snapshot: allocated %
    (sum of efforts across real projects), free capacity, and an `available` flag
    (free capacity > 0, or sitting on the 'No Allocation' bench). Fail-soft."""
    try:
        from app.models import SCHEMA
        from sqlalchemy import text
        codes = [c for c in {(e.get("employee_code") or "").strip() for e in employees} if c]
        names = [n for n in {(e.get("name") or "").strip().lower() for e in employees} if n]
        if not codes and not names:
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
            latest = db.execute(
                text(f'SELECT max(allocation_date) FROM "{SCHEMA}".employee_allocations')
            ).scalar()
            # Raw per-row detail (id OR name match) to shape into DirProject entries below.
            detail_rows = db.execute(
                text(
                    f'SELECT employee_id, lower(employee_name) AS lname, project_name, '
                    f'client_master, delivery_manager, project_status, allocation_date '
                    f'FROM "{SCHEMA}".employee_allocations '
                    f"WHERE employee_id = ANY(:codes) OR lower(employee_name) = ANY(:names)"
                ),
                {"codes": codes, "names": names},
            ).mappings().all()
            from app.services import allocation_snapshot_service as snap
            leading_map = snap.leading_projects_map(db)
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
        detail_by_id: dict[str, list] = {}
        detail_by_name: dict[str, list] = {}
        for r in detail_rows:
            if r["employee_id"]:
                detail_by_id.setdefault(r["employee_id"], []).append(r)
            if r["lname"]:
                detail_by_name.setdefault(r["lname"], []).append(r)

        for e in employees:
            code = e.get("employee_code")
            dept = (e.get("department") or "").strip().upper()
            is_management = any(
                dept.startswith(p) for p in (
                    "HR", "HUMAN RESOURCES", "HUMAN",
                    "IT", "INFORMATION TECHNOLOGY",
                    "PMO", "PROJECT MANAGEMENT", "PROGRAM MANAGEMENT", "PORTFOLIO MANAGEMENT",
                    "ADMIN", "ADMINISTRATION"
                )
            )

            hit = by_code.get(code)
            if hit is not None:
                e["allocation_projects"] = hit["projects"]
                e["allocation_clients"] = hit["clients"]

            if is_management:
                e["allocated_percent"] = 0.0
                e["availability_percent"] = 0.0
                e["available"] = False
            else:
                av = avail_by_code.get(code)
                if av is not None:
                    e["allocated_percent"] = av["allocated_percent"]
                    e["availability_percent"] = av["availability_percent"]
                    e["available"] = av["available"]
                else:
                    # No row staffed under their own name this month — but Project Lead /
                    # Delivery Manager is a role recorded on OTHER people's rows, so a
                    # Director/Lead with no staffed row can still be actively managing
                    # several projects. Don't report them as fully free without evidence
                    # either way; flag the involvement instead of guessing a load number.
                    led = leading_map.get((e.get("name") or "").strip().lower())
                    if led:
                        e["leading_projects"] = led
                        e["allocated_percent"] = 0.0
                        e["availability_percent"] = None
                        e["available"] = False
                    else:
                        e["allocated_percent"] = 0.0
                        e["availability_percent"] = 100.0
                        e["available"] = True

            person_rows = detail_by_id.get(code) or detail_by_name.get((e.get("name") or "").strip().lower())
            if person_rows and e.get("projects") is not None:
                e["projects"] = _merge_projects(e["projects"], _shape_allocation_projects(person_rows, latest))
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


@router.get("/celebrations")
def employee_celebrations(days: int = 14, user: CurrentUser = Depends(get_current_user)):
    """Upcoming birthdays and work anniversaries for the home page sidebar widget.

    Live off the same Zoho view the Employee Directory uses. Birthdays are day+month
    only (never year, so age is never exposed) — see zoho_directory_service._fmt_birthday.
    """
    from app.services import zoho_directory_service
    return zoho_directory_service.fetch_upcoming_celebrations(days=days)


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
def directory_enrichment(employee_code: str, name: str = "", user: CurrentUser = Depends(get_current_user)):
    """Skills + projects for a directory person: Alchemy profile projects merged with
    this person's allocation-derived project history (see _shape_allocation_projects),
    deduped by project name. Returns {available, skills, projects}. `available` is true
    if EITHER source has data, so a person with no Alchemy profile still gets a Projects
    section from allocations alone. Fail-soft."""
    from app.models import SCHEMA
    from app.services import alchemy_service
    from sqlalchemy import text

    result = alchemy_service.get_profile_enrichment(employee_code)

    name = (name or "").strip()
    code = (employee_code or "").strip()
    db = SessionLocal()
    try:
        rows = db.execute(
            text(
                f'SELECT employee_id, project_name, client_master, delivery_manager, '
                f'project_status, allocation_date '
                f'FROM "{SCHEMA}".employee_allocations '
                f"WHERE employee_id = :code OR (:name <> '' AND lower(employee_name) = lower(:name))"
            ),
            {"code": code, "name": name},
        ).mappings().all()
        latest = db.execute(
            text(f'SELECT max(allocation_date) FROM "{SCHEMA}".employee_allocations')
        ).scalar()
    except Exception:
        rows, latest = [], None
    finally:
        db.close()

    alloc_projects = _shape_allocation_projects(rows, latest) if rows else []
    if alloc_projects:
        merged = _merge_projects(result.get("projects") or [], alloc_projects)
        result = {**result, "available": True, "projects": merged}
    return result


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
    different people, so neither alone is complete. Each member's status follows the
    latest allocation month: absent from it → "Inactive" for them specifically (even
    if the project is still "Ongoing" for the rest of the team), a genuinely completed
    project reads "Completed" for everyone. Powers the click-through popup on a
    profile's project row. Fail-soft → {available: false} when nothing matches."""
    from app.models import SCHEMA
    from app.services.allocation_snapshot_service import _project_completed
    from sqlalchemy import text
    pn = (name or "").strip()
    if not pn:
        return {"available": False, "project_name": name}
    db = SessionLocal()
    try:
        latest = db.execute(
            text(f'SELECT max(allocation_date) FROM "{SCHEMA}".employee_allocations')
        ).scalar()
        alloc = db.execute(
            text(
                f"SELECT employee_id, max(employee_name) AS name, "
                f"max(efforts_percent) AS efforts, max(billability_percent) AS billability, "
                f"bool_or(allocation_date = :latest) AS active "
                f'FROM "{SCHEMA}".employee_allocations '
                f"WHERE project_name = :pn AND employee_id IS NOT NULL "
                f"GROUP BY employee_id"
            ),
            {"pn": pn, "latest": latest},
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
    project_completed = _project_completed((meta or {}).get("project_status"))
    merged: dict[str, dict] = {}
    for m in alloc:
        merged[m["employee_id"]] = {
            "employee_id": m["employee_id"],
            "name": m["name"] or names.get(m["employee_id"]) or "",
            "efforts": m["efforts"],
            "billability": m["billability"],
            # Absent from the latest allocation month → inactive for THEM, even if the
            # project itself is still ongoing for the rest of the team.
            "status": "Completed" if project_completed else ("Active" if m["active"] else "Inactive"),
            "role": "",
        }
    for r in alch:
        code = r["code"]
        if code in merged:
            merged[code]["role"] = r["role"] or merged[code]["role"]
        else:
            # Alchemy-only member: no allocation row to check against the latest month,
            # so default to Active unless the project itself is known to be completed.
            merged[code] = {
                "employee_id": code,
                "name": names.get(code) or "",
                "efforts": None,
                "billability": None,
                "status": "Completed" if project_completed else "Active",
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



# ── Alchemy self-service routes (authenticated user manages their OWN profile) ──
# Thin shims that acquire the user's personal Alchemy token (from their stored
# Microsoft refresh token) and forward to the alchemy_service helpers.
# Returns {"error": "not_connected"} when the user hasn't linked Microsoft yet.

def _get_user_alchemy_token(user_email: str) -> str | None:
    """Synchronously get the calling user's personal Alchemy token."""
    try:
        from app.services.email_service import _run_coro
        from app.services.oauth_service import get_alchemy_token
        return _run_coro(get_alchemy_token(user_email))
    except Exception:
        return None


def _alchemy_employee_id_or_error(token: str, user_email: str):
    """Resolve the user's Alchemy employee ID, raising 400 if it can't be found."""
    from app.services import alchemy_service
    eid = alchemy_service.resolve_employee_id(token, user_email)
    if not eid:
        raise HTTPException(status_code=400, detail="Could not resolve your Alchemy employee ID. Make sure your profile is set up in Alchemy.")
    return eid


@router.get("/alchemy/catalog")
def alchemy_skills_catalog(user: CurrentUser = Depends(get_current_user)):
    """Return the full Alchemy skills catalog (used for the skill picker when adding a skill).
    Uses the service token so even users without Microsoft connected can see the catalog."""
    from app.services import alchemy_service
    tok = alchemy_service.get_service_token()
    if not tok:
        raise HTTPException(status_code=503, detail="Alchemy catalog unavailable — no service account connected.")
    try:
        skills = alchemy_service.list_skills(tok)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Alchemy catalog fetch failed: {exc}")
    # Normalize to {id, name, category, description, image_url}
    out = []
    for s in skills:
        sid = s.get("skillId") or s.get("id")
        if sid is None:
            continue
        out.append({
            "id": int(sid),
            "name": s.get("skillName") or s.get("name") or "",
            "category": s.get("skillCategoryName") or s.get("category") or "",
            "description": s.get("skillDescription") or "",
            "image_url": s.get("skillImageUrl") or "",
        })
    out.sort(key=lambda x: x["name"].lower())
    return {"skills": out}


@router.get("/alchemy/me/skills")
def alchemy_my_skills(user: CurrentUser = Depends(get_current_user)):
    """Fetch the current user's live Alchemy skills list."""
    tok = _get_user_alchemy_token(user.email)
    if not tok:
        return {"error": "not_connected", "skills": []}
    from app.services import alchemy_service
    try:
        eid = _alchemy_employee_id_or_error(tok, user.email)
        raw = alchemy_service.get_my_skills(tok, eid)
        skills = raw if isinstance(raw, list) else []
        normalized = []
        for s in skills:
            sid = s.get("skillId") or s.get("skill_id")
            normalized.append({
                "skill_id": int(sid) if sid is not None else None,
                "name": s.get("skill_name") or s.get("skillName") or "",
                "category": s.get("skill_category_name") or s.get("skillCategoryName") or "",
                "competency": s.get("competency") or "",
                "certified": str(s.get("certified") or "").strip().lower() == "yes",
                "certificate_url": s.get("certificate_url") or s.get("certificate_link") or "",
                "primary_skill": bool(s.get("primary_skill")),
                "secondary_skill": bool(s.get("secondary_skill")),
                "primary_interest": bool(s.get("primary_interest")),
                "instructor": bool(s.get("instructor_flag")),
                "years_experience": str(s.get("yoe") or "").strip(),
                "last_used": s.get("last_used") or "",
                "approval_status": s.get("approval_status") or "",
            })
        return {"skills": normalized}
    except HTTPException:
        raise
    except PermissionError:
        return {"error": "not_connected", "skills": []}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Alchemy fetch failed: {exc}")


class AlchemyAddSkillRequest(BaseModel):
    skill_id: int
    competency: str = "Beginner"
    certified: str = "No"
    last_used: Optional[str] = None      # YYYY-MM-DD or None
    yoe: str = "0.00"
    primary_skill: bool = False
    secondary_skill: bool = False
    primary_interest: bool = False
    instructor_flag: bool = False


@router.post("/alchemy/me/skills")
def alchemy_add_my_skill(body: AlchemyAddSkillRequest, user: CurrentUser = Depends(get_current_user)):
    """Add a new skill to the current user's Alchemy profile."""
    tok = _get_user_alchemy_token(user.email)
    if not tok:
        return {"error": "not_connected"}
    from app.services import alchemy_service
    try:
        eid = _alchemy_employee_id_or_error(tok, user.email)
        result = alchemy_service.add_user_skill(
            tok, eid, body.skill_id,
            competency=body.competency,
            certified=body.certified,
            last_used=body.last_used or None,
            yoe=body.yoe,
            primary_skill=body.primary_skill,
            secondary_skill=body.secondary_skill,
            primary_interest=body.primary_interest,
            instructor_flag=body.instructor_flag,
        )
        # Bust the enrichment cache for this user so the directory picks up the change.
        try:
            alchemy_service._cache_upsert(eid, [], [])  # mark stale by clearing
        except Exception:
            pass
        return {"ok": True, "result": result}
    except HTTPException:
        raise
    except PermissionError:
        return {"error": "not_connected"}
    except Exception as exc:
        msg = str(exc)
        if "already declared" in msg.lower():
            raise HTTPException(status_code=409, detail="You already have this skill. Use the edit action to update it.")
        raise HTTPException(status_code=502, detail=f"Alchemy error: {msg}")


@router.put("/alchemy/me/skills/{skill_id}")
def alchemy_update_my_skill(
    skill_id: int,
    body: AlchemyAddSkillRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Update an existing skill on the current user's Alchemy profile."""
    tok = _get_user_alchemy_token(user.email)
    if not tok:
        return {"error": "not_connected"}
    from app.services import alchemy_service
    try:
        eid = _alchemy_employee_id_or_error(tok, user.email)
        result = alchemy_service.update_user_skill(
            tok, eid, skill_id,
            competency=body.competency,
            certified=body.certified,
            last_used=body.last_used or None,
            yoe=body.yoe,
            primary_skill=body.primary_skill,
            secondary_skill=body.secondary_skill,
            primary_interest=body.primary_interest,
            instructor_flag=body.instructor_flag,
        )
        return {"ok": True, "result": result}
    except HTTPException:
        raise
    except PermissionError:
        return {"error": "not_connected"}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Alchemy error: {exc}")


@router.delete("/alchemy/me/skills/{skill_id}")
def alchemy_delete_my_skill(skill_id: int, user: CurrentUser = Depends(get_current_user)):
    """Remove a skill from the current user's Alchemy profile."""
    tok = _get_user_alchemy_token(user.email)
    if not tok:
        return {"error": "not_connected"}
    from app.services import alchemy_service
    try:
        eid = _alchemy_employee_id_or_error(tok, user.email)
        alchemy_service.delete_user_skill(tok, eid, skill_id)
        return {"ok": True}
    except HTTPException:
        raise
    except PermissionError:
        return {"error": "not_connected"}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Alchemy error: {exc}")



# ── PMO Allocation Management endpoints (Strict PMO role access only) ─────────

class SaveManualAllocationRequest(BaseModel):
    employee_id: Optional[str] = None
    employee_name: str
    project_name: str
    project_lead: Optional[str] = None
    delivery_manager: Optional[str] = None
    efforts_percent: float = 0.0
    billability_percent: float = 0.0
    allocation_date: Optional[str] = None  # YYYY-MM-DD
    project_status: str = "Ongoing"
    client_master: Optional[str] = None
    billing: str = "Billable"
    status: str = "Active"


@router.get("/{email_or_code}/allocations")
def get_employee_allocations(email_or_code: str, user: CurrentUser = Depends(require_strict_pmo)):
    """Fetch all allocations for a specific employee, including manual overrides."""
    db = SessionLocal()
    try:
        from app.models import EmployeeAllocation, ManualEmployeeAllocation
        # Resolve employee
        emp = db.query(Employee).filter(
            or_(Employee.employee_id == email_or_code, Employee.email.ilike(email_or_code))
        ).first()
        
        # Query employee_allocations
        query = db.query(EmployeeAllocation)
        if emp:
            query = query.filter(
                or_(
                    EmployeeAllocation.employee_id == emp.employee_id,
                    EmployeeAllocation.employee_name.ilike(emp.name)
                )
            )
        else:
            query = query.filter(
                or_(
                    EmployeeAllocation.employee_id == email_or_code,
                    EmployeeAllocation.employee_name.ilike(email_or_code)
                )
            )
        allocs = query.all()

        # Query manual overrides
        m_query = db.query(ManualEmployeeAllocation)
        if emp:
            m_query = m_query.filter(
                or_(
                    ManualEmployeeAllocation.employee_id == emp.employee_id,
                    ManualEmployeeAllocation.employee_name.ilike(emp.name)
                )
            )
        else:
            m_query = m_query.filter(
                or_(
                    ManualEmployeeAllocation.employee_id == email_or_code,
                    ManualEmployeeAllocation.employee_name.ilike(email_or_code)
                )
            )
        manuals = m_query.all()

        return {
            "allocations": [
                {
                    "id": a.id,
                    "employee_id": a.employee_id,
                    "employee_name": a.employee_name,
                    "project_name": a.project_name,
                    "project_lead": a.project_lead or "",
                    "delivery_manager": a.delivery_manager or "",
                    "efforts_percent": a.efforts_percent or 0.0,
                    "billability_percent": a.billability_percent or 0.0,
                    "allocation_date": a.allocation_date.isoformat() if a.allocation_date else None,
                    "project_status": a.project_status or "Ongoing",
                    "client_master": a.client_master or "",
                    "billing": a.billing or "Billable",
                    "status": a.status or "Active",
                    "is_manual": False,
                }
                for a in allocs
            ],
            "manuals": [
                {
                    "id": m.id,
                    "employee_id": m.employee_id,
                    "employee_name": m.employee_name,
                    "project_name": m.project_name,
                    "project_lead": m.project_lead or "",
                    "delivery_manager": m.delivery_manager or "",
                    "efforts_percent": m.efforts_percent or 0.0,
                    "billability_percent": m.billability_percent or 0.0,
                    "allocation_date": m.allocation_date.isoformat() if m.allocation_date else None,
                    "project_status": m.project_status or "Ongoing",
                    "client_master": m.client_master or "",
                    "billing": m.billing or "Billable",
                    "status": m.status or "Active",
                    "is_deleted": m.is_deleted,
                    "is_manual": True,
                }
                for m in manuals
            ]
        }
    finally:
        db.close()


@router.post("/allocations/manual")
def add_manual_allocation(body: SaveManualAllocationRequest, user: CurrentUser = Depends(require_strict_pmo)):
    """Create a manual override for employee allocation."""
    db = SessionLocal()
    try:
        from app.models import ManualEmployeeAllocation
        from app.services.zoho_allocation_sync_service import reapply_manual_allocations
        
        adate = None
        if body.allocation_date:
            try:
                adate = datetime.date.fromisoformat(body.allocation_date[:10])
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid allocation_date format. Must be YYYY-MM-DD.")
        else:
            adate = datetime.date.today().replace(day=1)

        m = ManualEmployeeAllocation(
            employee_id=body.employee_id,
            employee_name=body.employee_name,
            project_name=body.project_name,
            project_lead=body.project_lead,
            delivery_manager=body.delivery_manager,
            efforts_percent=body.efforts_percent,
            billability_percent=body.billability_percent,
            allocation_date=adate,
            project_status=body.project_status,
            client_master=body.client_master,
            billing=body.billing,
            status=body.status,
            is_deleted=False,
            created_by=user.email,
        )
        db.add(m)
        db.commit()
        db.refresh(m)

        reapply_manual_allocations(db)
        return {"status": "ok", "id": m.id}
    finally:
        db.close()


@router.put("/allocations/manual/{manual_id}")
def update_manual_allocation(manual_id: int, body: SaveManualAllocationRequest, user: CurrentUser = Depends(require_strict_pmo)):
    """Update an existing manual override."""
    db = SessionLocal()
    try:
        from app.models import ManualEmployeeAllocation
        from app.services.zoho_allocation_sync_service import reapply_manual_allocations

        m = db.query(ManualEmployeeAllocation).filter(ManualEmployeeAllocation.id == manual_id).first()
        if not m:
            raise HTTPException(status_code=404, detail="Manual allocation not found.")

        m.project_lead = body.project_lead
        m.delivery_manager = body.delivery_manager
        m.efforts_percent = body.efforts_percent
        m.billability_percent = body.billability_percent
        m.project_status = body.project_status
        m.client_master = body.client_master
        m.billing = body.billing
        m.status = body.status
        m.is_deleted = False
        db.commit()

        reapply_manual_allocations(db)
        return {"status": "ok"}
    finally:
        db.close()


@router.delete("/allocations/manual/{manual_id}")
def delete_manual_allocation(manual_id: int, user: CurrentUser = Depends(require_strict_pmo)):
    """Soft-delete/mask a manual allocation override."""
    db = SessionLocal()
    try:
        from app.models import ManualEmployeeAllocation, EmployeeAllocation
        from app.services.zoho_allocation_sync_service import reapply_manual_allocations

        m = db.query(ManualEmployeeAllocation).filter(ManualEmployeeAllocation.id == manual_id).first()
        if not m:
            raise HTTPException(status_code=404, detail="Manual allocation override not found.")

        has_zoho = db.query(EmployeeAllocation).filter(
            EmployeeAllocation.project_name == m.project_name,
            EmployeeAllocation.allocation_date == m.allocation_date,
            or_(
                EmployeeAllocation.employee_id == m.employee_id,
                EmployeeAllocation.employee_name == m.employee_name
            )
        ).first()

        if has_zoho:
            m.is_deleted = True
            db.commit()
        else:
            db.delete(m)
            db.commit()

        reapply_manual_allocations(db)
        return {"status": "ok"}
    finally:
        db.close()


@router.delete("/allocations/zoho/{allocation_id}")
def delete_zoho_allocation(allocation_id: int, user: CurrentUser = Depends(require_strict_pmo)):
    """Mask/delete a Zoho allocation by creating a manual override with is_deleted=True."""
    db = SessionLocal()
    try:
        from app.models import EmployeeAllocation, ManualEmployeeAllocation
        from app.services.zoho_allocation_sync_service import reapply_manual_allocations

        a = db.query(EmployeeAllocation).filter(EmployeeAllocation.id == allocation_id).first()
        if not a:
            raise HTTPException(status_code=404, detail="Allocation not found.")

        m = ManualEmployeeAllocation(
            employee_id=a.employee_id,
            employee_name=a.employee_name,
            project_name=a.project_name,
            project_lead=a.project_lead,
            delivery_manager=a.delivery_manager,
            efforts_percent=0.0,
            billability_percent=0.0,
            allocation_date=a.allocation_date,
            project_status=a.project_status,
            client_master=a.client_master,
            billing=a.billing,
            status=a.status,
            is_deleted=True,
            created_by=user.email,
        )
        db.add(m)
        db.commit()

        reapply_manual_allocations(db)
        return {"status": "ok"}
    finally:
        db.close()


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
