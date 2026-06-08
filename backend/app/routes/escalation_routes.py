"""
Escalation API — lets users raise a support ticket when the assistant fails them.

POST /api/escalate    — submit an escalation (any authenticated user)
GET  /api/escalations — list escalations (admin / IT / HR / PMO only)
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models import Escalation
from app.services.escalation_service import create_escalation, _contact_for

router = APIRouter(prefix="/api", tags=["Escalation"])

_STAFF_ROLES = {"admin", "hr", "it", "pmo", "super admin", "functional manager"}


class EscalationRequest(BaseModel):
    domain: Optional[str] = None
    original_query: Optional[str] = None
    error_type: Optional[str] = None      # "error" | "no_response" | "unsatisfied"
    description: Optional[str] = None
    priority: str = "Medium"              # Low | Medium | High
    session_id: Optional[str] = None


class EscalationResponse(BaseModel):
    reference_id: str
    status: str
    department: str
    message: str


@router.post("/escalate", response_model=EscalationResponse)
def submit_escalation(
    body: EscalationRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dept_label, _ = _contact_for(body.domain)

    esc = create_escalation(
        db,
        user_email=current_user.email,
        user_name=None,
        domain=body.domain,
        original_query=body.original_query,
        error_type=body.error_type,
        description=body.description,
        priority=body.priority,
        session_id=body.session_id,
        sender_email=current_user.email,
    )

    return EscalationResponse(
        reference_id=esc.reference_id,
        status=esc.status,
        department=dept_label,
        message=f"Your escalation {esc.reference_id} has been raised. {dept_label} will contact you shortly.",
    )


@router.get("/escalations")
def list_escalations(
    status: Optional[str] = None,
    domain: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role not in _STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Staff access required.")

    q = db.query(Escalation)
    if status:
        q = q.filter(Escalation.status == status)
    if domain:
        q = q.filter(Escalation.domain == domain)

    total = q.count()
    items = (
        q.order_by(Escalation.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "total": total,
        "items": [
            {
                "id": e.id,
                "reference_id": e.reference_id,
                "user_email": e.user_email,
                "user_name": e.user_name,
                "domain": e.domain,
                "priority": e.priority,
                "status": e.status,
                "error_type": e.error_type,
                "original_query": e.original_query,
                "description": e.description,
                "notified_to": e.notified_to,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in items
        ],
    }


@router.patch("/escalations/{reference_id}/status")
def update_escalation_status(
    reference_id: str,
    body: dict,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role not in _STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Staff access required.")

    esc = db.query(Escalation).filter(Escalation.reference_id == reference_id).first()
    if not esc:
        raise HTTPException(status_code=404, detail="Escalation not found.")

    new_status = body.get("status")
    if new_status not in ("Open", "Acknowledged", "Resolved"):
        raise HTTPException(status_code=400, detail="Invalid status.")

    esc.status = new_status
    db.commit()
    return {"reference_id": esc.reference_id, "status": esc.status}


@router.get("/escalate/matrix")
def get_escalation_matrix(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return the escalation matrix so the frontend can display contact info per domain."""
    domains = ["hr", "admin", "it_support", "pmo", "functional_manager", "general"]
    return [
        {"domain": d, "department": _contact_for(d)[0]}
        for d in domains
    ]
