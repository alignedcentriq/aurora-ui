import datetime
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
    """Get-or-create employee by email (never return 'not found')."""
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
        # Notify HR about the new employee so they can send a welcome email
        try:
            from app.services.welcome_service import notify_hr_new_employee
            notify_hr_new_employee(emp.email, emp.name, db)
        except Exception as _e:
            pass
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



@router.get("/me/requests")
def my_requests(
    user: CurrentUser = Depends(get_current_user),
):
    from app.models import (
        Leave, ParkingSticker, FacilityComplaint, Reimbursement,
        TravelRequest, TravelExpenseClaim, UdemyLicenseRequest,
        HRQuery, Grievance, Escalation
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
                "escalations": []
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
            ]
        }
    finally:
        db.close()


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
