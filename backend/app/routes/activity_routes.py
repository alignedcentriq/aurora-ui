"""Activity feed (header bell) + Audit Trail (Control Hub, Super Admin only).

GET /feed  — org-wide, last 30 days, short form. Admin + Super Admin.
GET /audit — org-wide, unbounded, full detail (incl. old/new value), filterable +
             paginated. Super Admin only.
"""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.auth import CurrentUser, require_admin, require_super_admin

router = APIRouter(prefix="/api/activity", tags=["Activity"])


@router.get("/feed")
async def get_activity_feed(user: CurrentUser = Depends(require_admin)):
    """Last-30-days activity feed for the header Activity bell."""
    from app.services import activity_log_service
    entries = await asyncio.to_thread(activity_log_service.list_feed)
    return {"entries": entries}


@router.get("/audit")
async def get_audit_trail(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    category: Optional[str] = Query(None),
    actor_email: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    user: CurrentUser = Depends(require_super_admin),
):
    """Full, unbounded audit trail — who / what / when / old value / new value."""
    from app.services import activity_log_service
    return await asyncio.to_thread(
        activity_log_service.list_audit,
        page, limit, category, actor_email, severity, from_date, to_date,
    )
