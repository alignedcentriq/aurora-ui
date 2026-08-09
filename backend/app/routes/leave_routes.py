"""
Leave endpoints backed by the live Zoho leave-tracker DB views (people schema).

See services/zoho_leave_service.py for the underlying fetchers and
services/leave_balance_sync.py for the balance cache/fallback chain.
"""

import datetime

from fastapi import APIRouter, Depends, Query

from app.auth import CurrentUser, get_current_user
from app.database import SessionLocal
from app.services import zoho_leave_service

router = APIRouter(prefix="/api/leave", tags=["leave"])


@router.get("/types")
async def get_leave_types():
    """Active leave-type catalog. Empty list if the Zoho leave DB isn't configured."""
    return {"types": zoho_leave_service.fetch_leave_types()}


@router.get("/balance")
async def get_leave_balance(user: CurrentUser = Depends(get_current_user)):
    """Structured leave balances for the signed-in user (same source as the assistant)."""
    from app.services import leave_balance_sync
    return leave_balance_sync.get_or_refresh(user.email)


@router.get("/history")
async def get_leave_history(user: CurrentUser = Depends(get_current_user)):
    """Individual leave requests for the signed-in user, newest first."""
    db = SessionLocal()
    try:
        from app.models import Employee
        emp = db.query(Employee).filter(Employee.email == user.email).first()
        code = emp.employee_id if emp else ""
    finally:
        db.close()
    return {"history": zoho_leave_service.fetch_leave_history(code) if code else []}


@router.get("/holidays")
async def get_holidays(
    year: int | None = Query(None),
    user: CurrentUser = Depends(get_current_user),
):
    """Company holiday calendar for the given year (default: current year), scoped to
    the signed-in user's work location when known."""
    db = SessionLocal()
    try:
        from app.models import Employee
        emp = db.query(Employee).filter(Employee.email == user.email).first()
        location = emp.location if emp else None
    finally:
        db.close()
    target_year = year or datetime.date.today().year
    holidays = zoho_leave_service.fetch_holidays(target_year, location)
    if not holidays and location:
        # No holidays tagged for this location — fall back to the full company list
        # rather than showing an empty calendar.
        holidays = zoho_leave_service.fetch_holidays(target_year)
    return {"holidays": holidays}
