"""
Travel Management Routes

Public:
  GET  /api/travel/rm-approve/{token}  — RM click-to-approve (email link)
  GET  /api/travel/rm-reject/{token}   — RM click-to-reject (email link)

Employee (authenticated):
  GET  /api/travel/my-requests         — own travel requests
  GET  /api/travel/my-expenses         — own expense claims
  POST /api/travel/expense             — submit post-trip expense claim

Admin (require_admin):
  GET  /api/portal/admin/travel                     — list all requests
  PUT  /api/portal/admin/travel/{id}/approve        — approve with trip details
  PUT  /api/portal/admin/travel/{id}/reject         — reject
  GET  /api/portal/admin/travel/expenses            — list expense claims
  PUT  /api/portal/admin/travel/expenses/{id}/approve
  PUT  /api/portal/admin/travel/expenses/{id}/reject
  GET  /api/portal/admin/travel/settings            — get global expense limit
  PUT  /api/portal/admin/travel/settings            — set global expense limit
"""

import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from app.auth import CurrentUser, require_admin, get_current_user
from app.database import get_db
from app.models import TravelRequest, TravelExpenseClaim, Employee
from app.services import travel_service as ts

router = APIRouter(tags=["Travel"])
admin_router = APIRouter(prefix="/api/portal/admin/travel", tags=["Admin Travel"])


# ── RM Approval (public token links, sent by email) ───────────────────────────

@router.get("/api/travel/rm-approve/{token}", response_class=HTMLResponse)
def rm_approve(token: str):
    result = ts.rm_approve(token)
    if result["ok"]:
        return HTMLResponse(f"""
        <html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
        <h2 style="color:#16A34A;">&#10003; Travel Request Approved</h2>
        <p>{result['message']}</p>
        <p style="color:#6b7280;font-size:13px;">You can close this tab.</p>
        </body></html>""")
    return HTMLResponse(f"""
    <html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
    <h2 style="color:#dc2626;">&#10007; Unable to Approve</h2>
    <p>{result['message']}</p>
    </body></html>""", status_code=400)


class RmRejectBody(BaseModel):
    reason: str = ""


@router.get("/api/travel/rm-reject/{token}", response_class=HTMLResponse)
def rm_reject_get(token: str):
    """Show a simple rejection form when RM clicks the reject link."""
    return HTMLResponse(f"""
    <html><head><meta charset="utf-8">
    <style>body{{font-family:sans-serif;max-width:480px;margin:60px auto;}}
    input,textarea{{width:100%;padding:8px;margin:8px 0;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;}}
    button{{background:#dc2626;color:#fff;padding:10px 24px;border:none;border-radius:4px;cursor:pointer;font-size:14px;}}
    </style></head>
    <body>
    <h2>Reject Travel Request</h2>
    <p>Please provide a reason for rejection (optional):</p>
    <form method="POST" action="/api/travel/rm-reject/{token}">
      <textarea name="reason" rows="4" placeholder="Reason for rejection..."></textarea>
      <button type="submit">Confirm Rejection</button>
    </form>
    </body></html>""")


@router.post("/api/travel/rm-reject/{token}", response_class=HTMLResponse)
async def rm_reject_post(token: str, request_obj: Request):
    reason = ""
    try:
        form = await request_obj.form()
        reason = form.get("reason", "")
    except Exception:
        pass
    result = ts.rm_reject(token, reason)
    if result["ok"]:
        return HTMLResponse(f"""
        <html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
        <h2 style="color:#dc2626;">Travel Request Rejected</h2>
        <p>{result['message']}</p>
        <p style="color:#6b7280;font-size:13px;">You can close this tab.</p>
        </body></html>""")
    return HTMLResponse(f"""
    <html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
    <h2>Error</h2><p>{result['message']}</p>
    </body></html>""", status_code=400)


# ── Employee routes (authenticated) ───────────────────────────────────────────

@router.get("/api/travel/my-requests")
def my_travel_requests(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.email == user.email).first()
    if not emp:
        return []
    reqs = db.query(TravelRequest).filter(
        TravelRequest.employee_id == emp.id
    ).order_by(TravelRequest.created_at.desc()).all()
    status_labels = {
        "pending_rm": "Pending RM Approval",
        "rm_approved": "RM Approved — Pending Admin",
        "rm_rejected": "Rejected by RM",
        "admin_approved": "Approved",
        "admin_rejected": "Rejected by Admin",
        "completed": "Completed",
    }
    return [
        {
            "id": r.id,
            "ref_id": r.ref_id,
            "from_location": r.from_location,
            "to_destination": r.to_destination,
            "travel_date": r.travel_date.isoformat() if r.travel_date else None,
            "return_date": r.return_date.isoformat() if r.return_date else None,
            "is_international": r.is_international,
            "accommodation_required": r.accommodation_required,
            "estimated_cost": r.estimated_cost,
            "business_reason": r.business_reason,
            "status": r.status,
            "status_label": status_labels.get(r.status, r.status),
            "ticket_details": r.ticket_details,
            "hotel_details": r.hotel_details,
            "visa_status": r.visa_status,
            "expense_limit": r.expense_limit,
            "expense_limit_currency": r.expense_limit_currency or "INR",
            "rejection_reason": r.rm_rejection_reason or r.admin_rejection_reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in reqs
    ]


@router.get("/api/travel/my-expenses")
def my_expense_claims(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    emp = db.query(Employee).filter(Employee.email == user.email).first()
    if not emp:
        return []
    claims = db.query(TravelExpenseClaim, TravelRequest).join(
        TravelRequest, TravelExpenseClaim.travel_request_id == TravelRequest.id
    ).filter(TravelExpenseClaim.employee_id == emp.id).order_by(TravelExpenseClaim.created_at.desc()).all()
    return [
        {
            "id": c.id, "ref_id": c.ref_id,
            "travel_ref": r.ref_id,
            "from_location": r.from_location,
            "to_destination": r.to_destination,
            "amount": c.amount,
            "currency": c.currency or "INR",
            "breakdown": c.breakdown,
            "over_limit_reason": c.over_limit_reason,
            "expense_limit": r.expense_limit,
            "expense_limit_currency": r.expense_limit_currency or "INR",
            "status": c.status,
            "rejection_reason": c.rejection_reason,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c, r in claims
    ]


class SubmitTravelBody(BaseModel):
    employee_email: str = ""
    business_reason: str
    from_location: str
    to_destination: str
    travel_date: str
    return_date: str = ""
    is_international: bool = False
    visa_required: bool = False
    mode_of_travel: str = "Flight"
    accommodation_required: bool = False
    estimated_cost: float = 0.0
    notes: str = ""


@router.post("/api/travel/submit")
def submit_travel(body: SubmitTravelBody, user: CurrentUser = Depends(get_current_user)):
    result = ts.submit_travel_request(
        employee_email=user.email,
        business_reason=body.business_reason,
        from_location=body.from_location,
        to_destination=body.to_destination,
        travel_date=body.travel_date,
        return_date=body.return_date,
        is_international=body.is_international,
        visa_required=body.visa_required,
        mode_of_travel=body.mode_of_travel,
        accommodation_required=body.accommodation_required,
        estimated_cost=body.estimated_cost,
        notes=body.notes,
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Failed"))
    return result


class SubmitExpenseBody(BaseModel):
    travel_ref_id: str
    amount: float
    currency: str = "INR"
    breakdown: str = ""
    over_limit_reason: str = ""


@router.post("/api/travel/expense")
def submit_expense(body: SubmitExpenseBody, user: CurrentUser = Depends(get_current_user)):
    result = ts.submit_expense_claim(
        employee_email=user.email,
        travel_ref_id=body.travel_ref_id,
        amount=body.amount,
        currency=body.currency,
        breakdown=body.breakdown,
        over_limit_reason=body.over_limit_reason,
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Failed"))
    return result


# ── Admin routes ───────────────────────────────────────────────────────────────

@admin_router.get("")
def list_travel(status: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    return ts.list_travel_requests(status_filter=status or "")


class AdminApproveBody(BaseModel):
    expense_limit: Optional[float] = None
    expense_limit_currency: str = "INR"
    ticket_details: str = ""
    hotel_details: str = ""
    visa_status: str = ""


@admin_router.put("/{id}/approve")
def admin_approve(id: int, body: AdminApproveBody, user: CurrentUser = Depends(require_admin)):
    result = ts.admin_approve_travel(
        travel_id=id,
        decided_by=user.email,
        expense_limit=body.expense_limit,
        expense_limit_currency=body.expense_limit_currency,
        ticket_details=body.ticket_details,
        hotel_details=body.hotel_details,
        visa_status=body.visa_status,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("detail", "Failed"))
    return result


class RejectBody(BaseModel):
    reason: str = ""


@admin_router.put("/{id}/reject")
def admin_reject(id: int, body: RejectBody, user: CurrentUser = Depends(require_admin)):
    result = ts.admin_reject_travel(id, user.email, body.reason)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("detail", "Failed"))
    return result


@admin_router.get("/expenses")
def list_expenses(status: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    return ts.list_expense_claims(status_filter=status or "")


@admin_router.put("/expenses/{id}/approve")
def approve_expense(id: int, user: CurrentUser = Depends(require_admin)):
    result = ts.admin_approve_expense(id, user.email)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("detail", "Failed"))
    return result


@admin_router.put("/expenses/{id}/reject")
def reject_expense(id: int, body: RejectBody, user: CurrentUser = Depends(require_admin)):
    result = ts.admin_reject_expense(id, user.email, body.reason)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("detail", "Failed"))
    return result


class TravelSettingsBody(BaseModel):
    global_expense_limit: Optional[float] = None
    global_expense_limit_currency: str = "INR"


@admin_router.get("/settings")
def get_settings(_: CurrentUser = Depends(require_admin)):
    return ts.get_travel_settings()


@admin_router.put("/settings")
def update_settings(body: TravelSettingsBody, _: CurrentUser = Depends(require_admin)):
    return ts.set_global_expense_limit(body.global_expense_limit, body.global_expense_limit_currency)
