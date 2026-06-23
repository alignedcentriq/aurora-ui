from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, require_pmo
from app.services.udemy_service import UdemyService
from app.services.skill_gap_overlay_service import SkillSupplyService

router = APIRouter(prefix="/api/portal/pmo", tags=["PMO Portal"])


class RejectBody(BaseModel):
    reason: str = ""


# ── Skill Supply (Alchemy gap × allocation overlay) ───────────────────────────

@router.get("/skill-supply")
def skill_supply(
    top_n: int = 10,
    user: CurrentUser = Depends(require_pmo),
):
    """Top hardest-to-staff skills: Alchemy market demand crossed with live
    allocation availability, tagged BUY / TRAIN / REDEPLOY / STAFFABLE."""
    return SkillSupplyService.analyze(user_email=user.email, top_n=max(1, min(top_n, 25)))


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
