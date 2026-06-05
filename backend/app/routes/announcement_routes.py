from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, get_current_user, require_admin, require_domain_manager
from app.services.announcement_service import AnnouncementService

router = APIRouter(prefix="/api/announcements", tags=["announcements"])


class CreateAnnouncementRequest(BaseModel):
    title: str
    body: str
    category: str = "General"
    created_by_domain: str
    target_audience: str = "all"
    expires_days: Optional[int] = None
    image_url: Optional[str] = None


class SuggestAnnouncementRequest(BaseModel):
    title: str
    category: str = "General"


class UpdateAnnouncementRequest(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    expires_days: Optional[int] = None


@router.post("/suggest")
def suggest_announcement_body(
    req: SuggestAnnouncementRequest,
    _: CurrentUser = Depends(require_domain_manager),
):
    """Use the LLM to draft an announcement body from the given title and category."""
    from app.services import llm_controls_service as llm_controls

    # General tier (creative, temperature 0.7) from the live IT-tunable params.
    model = llm_controls.get_llm("general", default_timeout=60)
    prompt = (
        f"Write a professional company announcement for the following:\n"
        f"Title: {req.title}\nCategory: {req.category}\n\n"
        f"Format it as 3 short paragraphs separated by blank lines:\n"
        f"1. Opening: 1-2 sentences introducing the announcement clearly.\n"
        f"2. Details: 2-3 sentences with the key information, dates, or action required.\n"
        f"3. Closing: 1 sentence inviting questions or wishing the team well.\n\n"
        f"Rules:\n"
        f"- No subject line, no greeting (Dear team / Hi all), no sign-off (Regards / Thanks).\n"
        f"- Direct company voice. Plain text — no markdown, no bullet points, no asterisks.\n"
        f"- Keep each paragraph concise. Total length: 6-8 sentences maximum."
    )
    response = model.invoke(prompt)
    return {"body": response.content.strip()}


@router.get("")
def list_announcements(
    include_inactive: bool = False,
    _: CurrentUser = Depends(get_current_user),
):
    return AnnouncementService.list_all(include_inactive=include_inactive)


@router.post("")
def create_announcement(
    req: CreateAnnouncementRequest,
    user: CurrentUser = Depends(require_domain_manager),
):
    result = AnnouncementService.create(
        title=req.title,
        body=req.body,
        category=req.category,
        created_by=user.email,
        created_by_domain=req.created_by_domain,
        target_audience=req.target_audience,
        expires_days=req.expires_days,
        image_url=req.image_url or None,
    )
    return {"message": result}


@router.put("/{announcement_id}")
def update_announcement(
    announcement_id: int,
    req: UpdateAnnouncementRequest,
    user: CurrentUser = Depends(require_domain_manager),
):
    result = AnnouncementService.update(
        announcement_id=announcement_id,
        updated_by=user.email,
        title=req.title,
        body=req.body,
        category=req.category,
        expires_days=req.expires_days,
    )
    if "not found" in result.lower():
        raise HTTPException(status_code=404, detail=result)
    return {"message": result}


@router.delete("/{announcement_id}")
def deactivate_announcement(
    announcement_id: int,
    user: CurrentUser = Depends(require_domain_manager),
):
    result = AnnouncementService.deactivate(announcement_id, user.email)
    if "not found" in result.lower():
        raise HTTPException(status_code=404, detail=result)
    return {"message": result}
