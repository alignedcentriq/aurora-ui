"""
Power Automate callback endpoints — called by PA flows when an admin acts on a Teams card.
Auth: X-PA-Secret header must match settings.PA_CALLBACK_SECRET.
"""

import datetime
import logging
from fastapi import APIRouter, Header, HTTPException, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Reimbursement, Employee

logger = logging.getLogger("aurora-logger")

router = APIRouter(prefix="/api/pa/callback", tags=["PA Callbacks"])


def _verify_secret(x_pa_secret: str = Header(default="")) -> None:
    if not settings.PA_CALLBACK_SECRET:
        return
    if x_pa_secret != settings.PA_CALLBACK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid PA secret.")


@router.post("/reimbursement/{id}/approve")
def pa_approve_reimbursement(
    id: int,
    db: Session = Depends(get_db),
    _: None = Depends(_verify_secret),
):
    r = db.query(Reimbursement).filter(Reimbursement.id == id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reimbursement not found.")
    if r.status != "Pending":
        return {"message": f"Already {r.status}."}

    r.status = "Approved"
    r.approved_by = "power-automate"
    r.updated_at = datetime.datetime.utcnow()
    db.commit()

    emp = db.query(Employee).filter(Employee.id == r.employee_id).first()
    if emp:
        try:
            from app.services.admin_service import AdminService
            AdminService._fire_webhook(settings.PA_WEBHOOK_REIMBURSEMENT_DECISION, {
                "event": "reimbursement_decision",
                "reimbursement_id": r.id,
                "employee_name": emp.name,
                "employee_email": emp.email,
                "type": r.type,
                "amount": float(r.amount),
                "decision": "Approved",
                "decided_by": "power-automate",
                "decided_at": datetime.datetime.utcnow().isoformat() + "Z",
            })
        except Exception:
            pass

    logger.info(f"PA callback: reimbursement #{id} approved")
    return {"message": "Reimbursement approved."}


@router.post("/reimbursement/{id}/reject")
def pa_reject_reimbursement(
    id: int,
    db: Session = Depends(get_db),
    _: None = Depends(_verify_secret),
):
    r = db.query(Reimbursement).filter(Reimbursement.id == id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reimbursement not found.")
    if r.status != "Pending":
        return {"message": f"Already {r.status}."}

    r.status = "Rejected"
    r.updated_at = datetime.datetime.utcnow()
    db.commit()

    emp = db.query(Employee).filter(Employee.id == r.employee_id).first()
    if emp:
        try:
            from app.services.admin_service import AdminService
            AdminService._fire_webhook(settings.PA_WEBHOOK_REIMBURSEMENT_DECISION, {
                "event": "reimbursement_decision",
                "reimbursement_id": r.id,
                "employee_name": emp.name,
                "employee_email": emp.email,
                "type": r.type,
                "amount": float(r.amount),
                "decision": "Rejected",
                "decided_by": "power-automate",
                "decided_at": datetime.datetime.utcnow().isoformat() + "Z",
            })
        except Exception:
            pass

    logger.info(f"PA callback: reimbursement #{id} rejected")
    return {"message": "Reimbursement rejected."}
