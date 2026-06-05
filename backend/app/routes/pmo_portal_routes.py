from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from app.auth import CurrentUser, require_pmo
from app.services.udemy_service import UdemyService
from app.services import project_update_service

router = APIRouter(prefix="/api/portal/pmo", tags=["PMO Portal"])


class RejectBody(BaseModel):
    reason: str = ""


class ProjectUpdateConfigBody(BaseModel):
    active: Optional[bool] = None
    cadence_days: Optional[int] = None
    hour: Optional[int] = None
    activity_options: Optional[List[str]] = None


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
    return {"message": "Udemy license request approved."}


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
    return {"message": "Udemy license request declined."}


# ── Biweekly Project-Update form ───────────────────────────────────────────────

@router.get("/project-update/config")
def get_project_update_config(_: CurrentUser = Depends(require_pmo)):
    return project_update_service.get_config()


@router.put("/project-update/config")
def set_project_update_config(
    body: ProjectUpdateConfigBody,
    user: CurrentUser = Depends(require_pmo),
):
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    return project_update_service.set_config(payload, updated_by=user.email)


@router.get("/project-update/submissions")
def list_project_update_submissions(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_pmo),
):
    return project_update_service.list_submissions(status)


@router.post("/project-update/run-now")
def run_project_update_now(_: CurrentUser = Depends(require_pmo)):
    sent = project_update_service.run_due(force=True)
    return {"message": f"Form sent to {sent} eligible employee(s).", "sent": sent}
