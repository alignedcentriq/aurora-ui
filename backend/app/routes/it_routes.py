import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, get_current_user, require_admin, require_it
from app.database import get_db
from app.models import HITLRequest, ITTicket, Employee, SoftwareRequest
from app.services.it_service import ITService

router = APIRouter(prefix="/api/it", tags=["IT Support"])


@router.post("/hitl/complete")
def complete_hitl(
    ticket_id: str,
    admin: CurrentUser = Depends(require_admin),
):
    """Approve a pending HITL software-install request. Admin only."""
    return ITService.approve_hitl_request(ticket_id, admin.email)


@router.get("/hitl/pending")
def get_pending_hitl(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List pending Human-In-The-Loop requests. Admin only."""
    return db.query(HITLRequest).filter(HITLRequest.status == "Pending").all()


@router.get("/tickets")
def list_tickets(
    status: str = None,
    email: str = None,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List IT support tickets.
    Employees see only their own tickets.
    Admins may filter by any email or see all.
    """
    query = db.query(ITTicket)

    # Non-admins are scoped to their own tickets regardless of query param
    target_email = email if user.role == "admin" else user.email

    if target_email:
        from app.models import Employee
        emp = db.query(Employee).filter(Employee.email == target_email).first()
        if emp:
            query = query.filter(ITTicket.employee_id == emp.id)

    if status:
        query = query.filter(ITTicket.status == status)

    return query.all()


# ── IT Portal Endpoints (IT/Admin access) ─────────────────────────────────────

@router.get("/portal/tickets")
def portal_list_tickets(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    """All tickets with employee info — IT portal view."""
    q = db.query(ITTicket, Employee).join(Employee, ITTicket.employee_id == Employee.id)
    if status:
        q = q.filter(ITTicket.status == status)
    rows = q.order_by(ITTicket.created_at.desc()).all()
    return [
        {
            "id": t.id,
            "ticket_id": t.ticket_id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "category": t.category,
            "subject": t.subject,
            "description": t.description,
            "priority": t.priority,
            "status": t.status,
            "assigned_to": t.assigned_to,
            "resolution_notes": t.resolution_notes,
            "created_at": t.created_at.isoformat(),
        }
        for t, emp in rows
    ]


class UpdateTicketBody(BaseModel):
    status: str
    assigned_to: Optional[str] = None
    resolution_notes: Optional[str] = None


@router.put("/portal/tickets/{ticket_id}")
def portal_update_ticket(
    ticket_id: str,
    body: UpdateTicketBody,
    _: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    valid_statuses = {"Open", "Awaiting Approval", "In Progress", "Resolved", "Closed"}
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use: {', '.join(valid_statuses)}")
    ticket = db.query(ITTicket).filter(ITTicket.ticket_id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    ticket.status = body.status
    if body.assigned_to is not None:
        ticket.assigned_to = body.assigned_to
    if body.resolution_notes is not None:
        ticket.resolution_notes = body.resolution_notes
    if body.status in {"Resolved", "Closed"}:
        ticket.resolved_at = datetime.datetime.utcnow()
    db.commit()
    return {"message": f"Ticket {ticket_id} updated to {body.status}."}


@router.get("/portal/software-requests")
def portal_list_software_requests(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    q = db.query(SoftwareRequest, Employee).join(Employee, SoftwareRequest.employee_id == Employee.id)
    if status:
        q = q.filter(SoftwareRequest.status == status)
    rows = q.order_by(SoftwareRequest.id.desc()).all()
    return [
        {
            "id": sr.id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "software_name": sr.software_name,
            "version": sr.version,
            "justification": sr.justification,
            "requires_admin": sr.requires_admin,
            "status": sr.status,
            "approved_by": sr.approved_by,
        }
        for sr, emp in rows
    ]


@router.put("/portal/software-requests/{id}/approve")
def portal_approve_software(
    id: int,
    user: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    sr = db.query(SoftwareRequest).filter(SoftwareRequest.id == id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Software request not found.")
    sr.status = "Approved"
    sr.approved_by = user.email
    db.commit()
    return {"message": "Software request approved."}


@router.put("/portal/software-requests/{id}/reject")
def portal_reject_software(
    id: int,
    _: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    sr = db.query(SoftwareRequest).filter(SoftwareRequest.id == id).first()
    if not sr:
        raise HTTPException(status_code=404, detail="Software request not found.")
    sr.status = "Rejected"
    db.commit()
    return {"message": "Software request rejected."}
