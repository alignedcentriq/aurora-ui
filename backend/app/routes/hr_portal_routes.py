import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.auth import CurrentUser, require_hr
from app.database import get_db
from app.models import Leave, Employee, Grievance

router = APIRouter(prefix="/api/portal/hr", tags=["HR Portal"])


@router.get("/leaves")
def list_leaves(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    q = db.query(Leave, Employee).join(Employee, Leave.employee_id == Employee.id)
    if status:
        q = q.filter(Leave.status == status)
    rows = q.order_by(Leave.created_at.desc()).all()
    return [
        {
            "id": leave.id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "leave_type": leave.leave_type,
            "start_date": leave.start_date.isoformat(),
            "end_date": leave.end_date.isoformat(),
            "days": (leave.end_date - leave.start_date).days + 1,
            "status": leave.status,
            "reason": leave.reason,
            "created_at": leave.created_at.isoformat(),
        }
        for leave, emp in rows
    ]



# ── Grievances ────────────────────────────────────────────────────────────────

@router.get("/grievances")
def list_grievances(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    q = db.query(Grievance)
    if status:
        q = q.filter(Grievance.status == status)
    grievances = q.order_by(Grievance.submitted_at.desc()).all()
    results = []
    for g in grievances:
        employee_name = None
        if g.employee_id and not g.is_anonymous:
            emp = db.query(Employee).filter(Employee.id == g.employee_id).first()
            if emp:
                employee_name = emp.name
        results.append({
            "id": g.id,
            "reference_id": g.reference_id,
            "category": g.category,
            "description": g.description,
            "is_anonymous": g.is_anonymous,
            "employee_name": employee_name,
            "status": g.status,
            "resolved_by": g.resolved_by,
            "resolution_notes": g.resolution_notes,
            "submitted_at": g.submitted_at.isoformat(),
            "resolved_at": g.resolved_at.isoformat() if g.resolved_at else None,
        })
    return results


class ResolveGrievanceBody(BaseModel):
    status: str   # Under Review, Resolved, Closed
    resolution_notes: Optional[str] = None


@router.put("/grievances/{reference_id}/resolve")
def resolve_grievance(
    reference_id: str,
    body: ResolveGrievanceBody,
    user: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    valid = {"Under Review", "Resolved", "Closed"}
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use: {', '.join(valid)}")
    g = db.query(Grievance).filter(Grievance.reference_id == reference_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Grievance not found.")
    g.status = body.status
    g.resolved_by = user.email
    if body.resolution_notes:
        g.resolution_notes = body.resolution_notes
    if body.status in {"Resolved", "Closed"}:
        g.resolved_at = datetime.datetime.utcnow()
    db.commit()
    return {"message": f"Grievance {reference_id} updated to {body.status}."}
