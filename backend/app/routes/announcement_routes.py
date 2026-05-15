from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.services.announcement_service import AnnouncementService

router = APIRouter(prefix="/api/announcements", tags=["announcements"])


class CreateAnnouncementRequest(BaseModel):
    title: str
    body: str
    category: str = "General"
    created_by: str
    created_by_domain: str
    target_audience: str = "all"
    expires_days: Optional[int] = None


@router.get("")
def list_announcements(domain: Optional[str] = None, include_inactive: bool = False):
    return AnnouncementService.list_all(include_inactive=include_inactive)


@router.post("")
def create_announcement(req: CreateAnnouncementRequest):
    result = AnnouncementService.create(
        title=req.title,
        body=req.body,
        category=req.category,
        created_by=req.created_by,
        created_by_domain=req.created_by_domain,
        target_audience=req.target_audience,
        expires_days=req.expires_days,
    )
    return {"message": result}


@router.delete("/{announcement_id}")
def deactivate_announcement(announcement_id: int, requested_by: str = "admin"):
    result = AnnouncementService.deactivate(announcement_id, requested_by)
    if "not found" in result.lower():
        raise HTTPException(status_code=404, detail=result)
    return {"message": result}
