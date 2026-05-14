from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ITTicket, HITLRequest
from app.services.it_service import ITService
from typing import List

router = APIRouter(prefix="/api/it", tags=["IT Support"])

@router.post("/hitl/complete")
def complete_hitl(ticket_id: str, admin_email: str):
    """IT Admin endpoint to complete a pending HITL request (e.g. providing an admin password)."""
    return ITService.mark_admin_password_provided(ticket_id, admin_email)

@router.get("/hitl/pending")
def get_pending_hitl(db: Session = Depends(get_db)):
    """List all pending Human-In-The-Loop requests."""
    return db.query(HITLRequest).filter(HITLRequest.status == "Pending").all()

@router.get("/tickets")
def list_tickets(status: str = None, email: str = None, db: Session = Depends(get_db)):
    """List IT support tickets, optionally filtered by status or employee email."""
    query = db.query(ITTicket)
    if status:
        query = query.filter(ITTicket.status == status)
    if email:
        from app.models import Employee
        emp = db.query(Employee).filter(Employee.email == email).first()
        if emp:
            query = query.filter(ITTicket.employee_id == emp.id)
    return query.all()
