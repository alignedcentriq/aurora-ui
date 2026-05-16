from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, get_current_user, require_admin
from app.services.announcement_service import AnnouncementService

router = APIRouter(prefix="/api/announcements", tags=["announcements"])


class CreateAnnouncementRequest(BaseModel):
    title: str
    body: str
    category: str = "General"
    created_by_domain: str
    target_audience: str = "all"
    expires_days: Optional[int] = None


@router.get("")
def list_announcements(
    include_inactive: bool = False,
    _: CurrentUser = Depends(get_current_user),
):
    return AnnouncementService.list_all(include_inactive=include_inactive)


@router.post("")
def create_announcement(
    req: CreateAnnouncementRequest,
    admin: CurrentUser = Depends(require_admin),
):
    result = AnnouncementService.create(
        title=req.title,
        body=req.body,
        category=req.category,
        created_by=admin.email,
        created_by_domain=req.created_by_domain,
        target_audience=req.target_audience,
        expires_days=req.expires_days,
    )
    return {"message": result}


@router.delete("/{announcement_id}")
def deactivate_announcement(
    announcement_id: int,
    admin: CurrentUser = Depends(require_admin),
):
    result = AnnouncementService.deactivate(announcement_id, admin.email)
    if "not found" in result.lower():
        raise HTTPException(status_code=404, detail=result)
    return {"message": result}
