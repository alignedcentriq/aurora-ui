"""
Employee self-service attendance routes.
Any logged-in user can view their own monthly attendance summary and calendar.
"""

from typing import Optional

from fastapi import APIRouter, Depends

from app.auth import CurrentUser, get_current_user
from app.services import attendance_service

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])


@router.get("/my")
def get_my_attendance_summary(
    month: Optional[str] = "",
    year: Optional[str] = "",
    user: CurrentUser = Depends(get_current_user),
):
    return attendance_service.summary(user.email, month or "", year or "")


@router.get("/my/calendar")
def get_my_attendance_calendar(
    month: Optional[str] = "",
    year: Optional[str] = "",
    user: CurrentUser = Depends(get_current_user),
):
    return attendance_service.calendar_records(user.email, month or "", year or "")
