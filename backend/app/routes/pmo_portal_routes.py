from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, require_pmo
from app.services.udemy_service import UdemyService

router = APIRouter(prefix="/api/portal/pmo", tags=["PMO Portal"])


class RejectBody(BaseModel):
    reason: str = ""


# ── Udemy Licenses ────────────────────────────────────────────────────────────

@router.get("/udemy")
def list_udemy_requests(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_pmo),
):
    return UdemyService.list_requests(status)


@router.put("/udemy/{req_id}/approve")
def approve_udemy_request(
    req_id: int,
    user: CurrentUser = Depends(require_pmo),
):
    res = UdemyService.approve(req_id, decided_by=user.email)
    if not res.get("ok"):
        raise HTTPException(status_code=404, detail=res.get("error", "Request not found."))
    return {"message": f"{res.get('platform', 'Udemy')} license request approved."}


@router.put("/udemy/{req_id}/reject")
def reject_udemy_request(
    req_id: int,
    body: RejectBody,
    user: CurrentUser = Depends(require_pmo),
):
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required to decline this request.")
    res = UdemyService.reject(req_id, decided_by=user.email, reason=reason)
    if not res.get("ok"):
        raise HTTPException(status_code=404, detail=res.get("error", "Request not found."))
    return {"message": f"{res.get('platform', 'Udemy')} license request declined."}
