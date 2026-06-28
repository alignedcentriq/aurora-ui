from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, require_pmo
from app.database import get_db
from sqlalchemy.orm import Session
from app.services.udemy_service import UdemyService
from app.services.skill_gap_overlay_service import SkillSupplyService
from app.services import bench_upskill_service

router = APIRouter(prefix="/api/portal/pmo", tags=["PMO Portal"])


class RejectBody(BaseModel):
    reason: str = ""


class BenchAssignBody(BaseModel):
    employee_id: Optional[int] = None
    email: Optional[str] = None
    training_id: int
    due_date: Optional[str] = None


# ── Skill Supply (Alchemy gap × allocation overlay) ───────────────────────────

@router.get("/skill-supply")
def skill_supply(
    top_n: int = 10,
    user: CurrentUser = Depends(require_pmo),
):
    """Top hardest-to-staff skills: Alchemy market demand crossed with live
    allocation availability, tagged BUY / TRAIN / REDEPLOY / STAFFABLE."""
    return SkillSupplyService.analyze(user_email=user.email, top_n=max(1, min(top_n, 25)))


# ── Bench → Upskill engine (deterministic SQL; no LLM) ────────────────────────

@router.get("/bench-upskill")
def bench_upskill(
    limit: int = 25,
    user: CurrentUser = Depends(require_pmo),
    db: Session = Depends(get_db),
):
    """Bench / rolling-off people matched to an internal course that teaches an
    in-demand skill they lack (demand = skills held by people on billable work)."""
    return bench_upskill_service.suggestions(db, limit=max(1, min(limit, 100)))


@router.post("/bench-upskill/assign")
def bench_upskill_assign(
    body: BenchAssignBody,
    user: CurrentUser = Depends(require_pmo),
    db: Session = Depends(get_db),
):
    """Manager-approved enrollment for one bench suggestion."""
    res = bench_upskill_service.approve_and_assign(
        db, employee_id=body.employee_id, email=body.email, training_id=body.training_id,
        due_date=body.due_date, assigned_by=user.email,
    )
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Could not assign."))
    return res


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
