"""
Microsoft 365 REST endpoints for the room booking widget.

These are called directly by the frontend widget — no LLM involved.
Auth: user must have a connected Microsoft account (OAuth2 delegated token).
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user

router = APIRouter(prefix="/api/ms365", tags=["MS365"])


async def _require_token(user: CurrentUser) -> str:
    """Resolve the user's Microsoft OAuth token or raise 401."""
    try:
        from app.services.oauth_service import get_valid_token
        token = await get_valid_token(user.email.lower().strip(), "microsoft")
        if not token:
            raise HTTPException(
                status_code=401,
                detail="Microsoft account not connected. Go to Settings → Connected Accounts to link your account.",
            )
        return token
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Failed to get Microsoft token: {e}")


# ── Rooms ──────────────────────────────────────────────────────────────────────

@router.get("/rooms")
async def list_rooms(user: CurrentUser = Depends(get_current_user)):
    """Return all meeting rooms in the organisation's directory."""
    token = await _require_token(user)
    from app.services.ms365_service import fetch_rooms
    result = await fetch_rooms(token)
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "Failed to fetch rooms"))
    return result


# ── Availability ───────────────────────────────────────────────────────────────

class AvailabilityRequest(BaseModel):
    room_emails: list[str]
    start: str   # ISO 8601, e.g. "2026-05-30T14:00:00"
    end: str     # ISO 8601, e.g. "2026-05-30T15:00:00"


@router.post("/rooms/availability")
async def check_availability(
    body: AvailabilityRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Check free/busy for a list of rooms over a time window."""
    token = await _require_token(user)
    from app.services.ms365_service import check_room_availability
    result = await check_room_availability(token, body.room_emails, body.start, body.end)
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "Availability check failed"))
    return result


# ── Book ───────────────────────────────────────────────────────────────────────

class BookRequest(BaseModel):
    room_email: str
    room_name: str
    subject: str
    start: str   # ISO 8601
    end: str     # ISO 8601
    attendee_emails: Optional[list[str]] = None
    is_online_meeting: bool = False


@router.post("/rooms/book")
async def book_room(
    body: BookRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a calendar event and reserve the room resource."""
    token = await _require_token(user)
    from app.services.ms365_service import book_room as _book
    result = await _book(
        token=token,
        room_email=body.room_email,
        room_name=body.room_name,
        subject=body.subject,
        start=body.start,
        end=body.end,
        attendee_emails=body.attendee_emails,
        is_online_meeting=body.is_online_meeting,
    )
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "Room booking failed"))
    return result


# ── My Room Bookings ───────────────────────────────────────────────────────────

@router.get("/my-room-bookings")
async def my_room_bookings(
    days: int = 7,
    user: CurrentUser = Depends(get_current_user),
):
    """List the user's upcoming room bookings (next N days)."""
    token = await _require_token(user)
    from app.services.ms365_service import fetch_my_room_bookings
    result = await fetch_my_room_bookings(token, days=days)
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "Failed to fetch bookings"))
    return result


# ── Org Users ──────────────────────────────────────────────────────────────────

@router.post("/users/sync")
async def sync_users(user: CurrentUser = Depends(get_current_user)):
    """Pull all @alignedautomation.com users from Azure AD and upsert into the database."""
    from app.services.ms365_service import sync_users_to_db
    result = await sync_users_to_db()
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "Sync failed"))
    return result


@router.get("/users")
async def list_users(
    department: str = "",
    search: str = "",
    user: CurrentUser = Depends(get_current_user),
):
    """List org users from the database (run /users/sync first to populate)."""
    from app.database import SessionLocal
    from app.models import MS365User
    db = SessionLocal()
    try:
        q = db.query(MS365User)
        if department:
            q = q.filter(MS365User.department.ilike(f"%{department}%"))
        if search:
            q = q.filter(
                MS365User.name.ilike(f"%{search}%") |
                MS365User.email.ilike(f"%{search}%")
            )
        rows = q.order_by(MS365User.name).all()
        users = [
            {
                "name": r.name,
                "email": r.email,
                "job_title": r.job_title,
                "department": r.department,
                "office_location": r.office_location,
                "employee_id": r.employee_id,
                "employee_type": r.employee_type,
                "company_name": r.company_name,
                "mobile_phone": r.mobile_phone,
                "business_phone": r.business_phone,
                "city": r.city,
                "state": r.state,
                "country": r.country,
                "account_enabled": r.account_enabled,
                "hire_date": r.hire_date.isoformat() if r.hire_date else None,
                "manager_email": r.manager_email,
                "manager_name": r.manager_name,
            }
            for r in rows
        ]
        return {"count": len(users), "users": users}
    finally:
        db.close()


# ── User profile / hierarchy (on-demand Graph lookup, requires User.Read.All) ────

@router.get("/users/{email}/profile")
async def get_user_profile(email: str, user: CurrentUser = Depends(get_current_user)):
    """Look up any org user's full profile by email/UPN, live from Graph."""
    from app.services.ms365_service import fetch_user_by_email
    result = await fetch_user_by_email(email)
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "User lookup failed"))
    return result


@router.get("/users/{email}/manager")
async def get_user_manager(email: str, user: CurrentUser = Depends(get_current_user)):
    """Return a user's manager from Azure AD."""
    from app.services.ms365_service import fetch_user_manager
    result = await fetch_user_manager(email)
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "Manager lookup failed"))
    return result


@router.get("/users/{email}/reports")
async def get_user_reports(email: str, user: CurrentUser = Depends(get_current_user)):
    """Return a user's direct reports from Azure AD."""
    from app.services.ms365_service import fetch_user_direct_reports
    result = await fetch_user_direct_reports(email)
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "Direct reports lookup failed"))
    return result


# ── Cancel Event ───────────────────────────────────────────────────────────────

@router.delete("/events/{event_id}")
async def delete_event(
    event_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Cancel a calendar event (deletes it and frees the room)."""
    token = await _require_token(user)
    from app.services.ms365_service import cancel_event
    result = await cancel_event(token, event_id)
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "Failed to cancel booking"))
    return result
