"""
HR Skill APIs — clean endpoints consumed by the HR agent as tools
and callable by any external client.

Each endpoint does one thing: call the appropriate service and return
structured JSON. No LLM, no agent logic here.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user
from app.hr_service import HRService
from app.services.policy_service import PolicyService

router = APIRouter(prefix="/api/skills/hr", tags=["Skills - HR"])


# ── Request bodies ─────────────────────────────────────────────────────────────

class ApplyLeaveRequest(BaseModel):
    start_date: str           # YYYY-MM-DD
    end_date: str             # YYYY-MM-DD
    leave_type: str           # e.g. "Casual Leave"
    reason: str


class HRQueryRequest(BaseModel):
    category: str             # e.g. "Payroll", "Attendance"
    subject: str
    description: str


class GrievanceRequest(BaseModel):
    category: str
    description: str
    is_anonymous: bool = False


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/policy-search")
def policy_search(
    query: str = Query(..., description="Natural language policy question"),
    limit: int = Query(3, ge=1, le=10),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Search HR/IT/company policies using hybrid semantic + keyword search."""
    results = PolicyService.search_policies(query, limit=limit)
    found = bool(results and "No policies found" not in results)
    return {"query": query, "found": found, "results": results}


@router.get("/leave-balance")
def leave_balance(current_user: CurrentUser = Depends(get_current_user)):
    """Get the current user's leave balance across all leave types."""
    balance = HRService.get_leave_balance(current_user.email)
    return {"email": current_user.email, "balance": balance}


@router.post("/apply-leave")
def apply_leave(
    body: ApplyLeaveRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Submit a leave application. Sends approval request to the reporting manager."""
    result = HRService.apply_leave(
        email=current_user.email,
        start_date=body.start_date,
        end_date=body.end_date,
        leave_type=body.leave_type,
        reason=body.reason,
    )
    return {"status": "success", "message": result}


@router.post("/hr-query")
def hr_query(
    body: HRQueryRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Raise an HR query ticket (payroll issue, attendance correction, etc.)."""
    result = HRService.submit_hr_query(
        email=current_user.email,
        category=body.category,
        subject=body.subject,
        description=body.description,
    )
    return {"status": "success", "message": result}


@router.post("/grievance")
def submit_grievance(
    body: GrievanceRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Submit an employee grievance. Supports anonymous submissions."""
    result = HRService.submit_grievance(
        email=current_user.email,
        category=body.category,
        description=body.description,
        is_anonymous=body.is_anonymous,
    )
    return {"status": "success", "message": result}


@router.get("/team-absence")
def team_absence(
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get team absence summary. Only available to managers."""
    result = HRService.get_team_absence(
        manager_email=current_user.email,
        from_date_str=from_date or "",
        to_date_str=to_date or "",
    )
    return {"absences": result}
