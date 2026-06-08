import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.auth import CurrentUser, require_hr
from app.database import get_db
from app.models import Employee, Grievance, HRQuery, LeaveBalance, LeaveType

router = APIRouter(prefix="/api/portal/hr", tags=["HR Portal"])


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


# ── Comp Off Credit ──────────────────────────────────────────────────────────

class CompOffCreditBody(BaseModel):
    employee_email: str
    days: float
    reason: Optional[str] = "Compensatory off credited"


@router.post("/comp-off/credit")
def credit_comp_off(
    body: CompOffCreditBody,
    user: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    from app.hr_service import HRService
    emp = HRService.get_employee_by_email(db, body.employee_email)
    year = datetime.date.today().year

    lt = db.query(LeaveType).filter(LeaveType.code == "CO").first()
    if not lt:
        raise HTTPException(status_code=404, detail="Compensatory Off leave type not found.")

    lb = db.query(LeaveBalance).filter(
        LeaveBalance.employee_id == emp.id,
        LeaveBalance.leave_type_id == lt.id,
        LeaveBalance.year == year,
    ).first()

    if not lb:
        lb = LeaveBalance(
            employee_id=emp.id, leave_type_id=lt.id, year=year,
            entitled=0, used=0, balance=0, earned=0,
        )
        db.add(lb)

    lb.earned += body.days
    lb.balance = lb.entitled + lb.earned - lb.used
    db.commit()

    return {
        "message": f"Credited {body.days} comp off day(s) to {emp.name}.",
        "new_balance": lb.balance,
        "total_earned": lb.earned,
    }


# ── HR Queries ───────────────────────────────────────────────────────────────

@router.get("/queries")
def list_hr_queries(
    status: Optional[str] = None,
    employee_email: Optional[str] = None,
    _: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    q = db.query(HRQuery, Employee).join(Employee, HRQuery.employee_id == Employee.id)
    if status:
        q = q.filter(HRQuery.status == status)
    if employee_email:
        q = q.filter(Employee.email == employee_email)
    rows = q.order_by(HRQuery.created_at.desc()).all()
    return [
        {
            "id": query.id,
            "reference_id": query.reference_id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "category": query.category,
            "subject": query.subject,
            "description": query.description,
            "status": query.status,
            "priority": query.priority,
            "response": query.response,
            "responded_by": query.responded_by,
            "responded_at": query.responded_at.isoformat() if query.responded_at else None,
            "created_at": query.created_at.isoformat(),
        }
        for query, emp in rows
    ]


class RespondQueryBody(BaseModel):
    response: str


@router.patch("/queries/{query_id}/respond")
def respond_to_query(
    query_id: int,
    body: RespondQueryBody,
    user: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    query = db.query(HRQuery).filter(HRQuery.id == query_id).first()
    if not query:
        raise HTTPException(status_code=404, detail="HR query not found.")

    query.response = body.response
    query.responded_by = user.email
    query.responded_at = datetime.datetime.utcnow()
    query.status = "Resolved"
    db.commit()

    # Notify employee
    try:
        emp = db.query(Employee).filter(Employee.id == query.employee_id).first()
        if emp:
            from app.services.email_service import _send, _nl2br
            import html as html_mod
            subject = f"[HR Response] {query.reference_id} — {query.category}"
            html_body = f"""
            <html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
              <div style="background:#0A2540;padding:20px 24px;">
                <h2 style="color:#00D4AA;margin:0;font-size:18px;">HR Query Response — Centriq AI</h2>
              </div>
              <div style="padding:24px;">
                <p>Hi {html_mod.escape(emp.name)},</p>
                <p>HR has responded to your query <strong>{html_mod.escape(query.reference_id)}</strong>:</p>
                <table cellpadding="8" style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
                  <tr><td style="background:#f5f5f5;font-weight:bold;width:140px;">Category</td><td>{html_mod.escape(query.category)}</td></tr>
                  <tr><td style="background:#f5f5f5;font-weight:bold;">Subject</td><td>{html_mod.escape(query.subject)}</td></tr>
                  <tr><td style="background:#f5f5f5;font-weight:bold;vertical-align:top;">Response</td><td>{_nl2br(body.response)}</td></tr>
                </table>
                <p style="color:#888;font-size:12px;">This is an automated notification from Centriq AI.</p>
              </div>
            </body></html>
            """
            _send(to=emp.email, subject=subject, html_body=html_body)
    except Exception as e:
        pass

    return {"message": f"Response sent for {query.reference_id}."}


@router.patch("/queries/{query_id}/close")
def close_query(
    query_id: int,
    user: CurrentUser = Depends(require_hr),
    db: Session = Depends(get_db),
):
    query = db.query(HRQuery).filter(HRQuery.id == query_id).first()
    if not query:
        raise HTTPException(status_code=404, detail="HR query not found.")
    query.status = "Closed"
    db.commit()
    return {"message": f"Query {query.reference_id} closed."}
