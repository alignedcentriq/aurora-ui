from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user, require_admin
from app.database import get_db
from app.models import HITLRequest, ITTicket
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
