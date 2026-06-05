"""
Manager Portal routes — whole-hierarchy attendance reporting + email automation.

All endpoints are gated to Functional Managers (require_functional_manager). The acting
manager is always taken from the authenticated user's email; a manager can only see/manage
their own hierarchy and their own schedules.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, require_functional_manager
from app.services import attendance_schedule_service, attendance_service

router = APIRouter(prefix="/api/portal/manager", tags=["Manager Portal"])


# ── Live whole-hierarchy attendance report ────────────────────────────────────

@router.get("/attendance")
def get_team_attendance(
    month: Optional[str] = "",
    year: Optional[str] = "",
    user: CurrentUser = Depends(require_functional_manager),
):
    report = attendance_service.team_report(user.email, month or "", year or "")
    if not report.get("success"):
        # no_team / manager_not_found → 200 with the payload so the UI can show a message.
        return report
    return report


class EmailNowRequest(BaseModel):
    month: Optional[str] = ""
    year: Optional[str] = ""
    recipients: Optional[list[str]] = None


@router.post("/attendance/email")
def email_team_attendance(
    body: EmailNowRequest,
    user: CurrentUser = Depends(require_functional_manager),
):
    result = attendance_schedule_service.send_report_now(
        user.email,
        recipients=body.recipients,
        month=body.month or "",
        year=body.year or "",
        automated=False,
    )
    if not result.get("success"):
        return result
    return result


# ── Schedule automations ───────────────────────────────────────────────────────

class ScheduleBody(BaseModel):
    frequency: str  # daily | weekly | monthly | custom
    day_of_week: Optional[int] = None
    day_of_month: Optional[int] = None
    hour: Optional[int] = 8
    recipients: Optional[list[str]] = None
    period_mode: Optional[str] = "prev_period"
    active: Optional[bool] = True


@router.get("/attendance/schedules")
def list_schedules(user: CurrentUser = Depends(require_functional_manager)):
    return attendance_schedule_service.list_for_manager(user.email)


@router.post("/attendance/schedules")
def create_schedule(
    body: ScheduleBody,
    user: CurrentUser = Depends(require_functional_manager),
):
    result = attendance_schedule_service.create(user.email, body.model_dump())
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "invalid"))
    return result["schedule"]


@router.patch("/attendance/schedules/{schedule_id}")
def update_schedule(
    schedule_id: int,
    body: dict,
    user: CurrentUser = Depends(require_functional_manager),
):
    result = attendance_schedule_service.update(user.email, schedule_id, body)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "not_found"))
    return result["schedule"]


@router.delete("/attendance/schedules/{schedule_id}")
def delete_schedule(
    schedule_id: int,
    user: CurrentUser = Depends(require_functional_manager),
):
    result = attendance_schedule_service.delete(user.email, schedule_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "not_found"))
    return {"success": True}
