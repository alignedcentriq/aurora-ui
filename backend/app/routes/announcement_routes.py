import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List

from app.auth import CurrentUser, get_current_user, require_admin, require_domain_manager
from app.services.announcement_service import AnnouncementService

router = APIRouter(prefix="/api/announcements", tags=["announcements"])

_UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads" / "announcements"
_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB


class ImageAction(BaseModel):
    type: str  # "url" | "form" | "app"
    value: str  # URL string or form/app identifier
    label: Optional[str] = None


class CreateAnnouncementRequest(BaseModel):
    title: str
    body: str
    category: str = "General"
    created_by_domain: str
    target_audience: str = "all"
    expires_days: Optional[int] = None
    image_url: Optional[str] = None
    image_action: Optional[ImageAction] = None
    email_recipients: Optional[List[str]] = None


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


@router.post("/upload-image")
async def upload_announcement_image(
    file: UploadFile = File(...),
    _: CurrentUser = Depends(require_domain_manager),
):
    """Upload an image for use in an announcement body. Returns a public URL."""
    content_type = file.content_type or ""
    if content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, GIF, and WebP images are allowed")

    data = await file.read()
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be under 10 MB")

    _UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "png"
    filename = f"{uuid.uuid4().hex}.{ext}"
    dest = _UPLOADS_DIR / filename
    dest.write_bytes(data)

    return {"url": f"/uploads/announcements/{filename}"}


@router.get("")
def list_announcements(
    include_inactive: bool = False,
    user: CurrentUser = Depends(get_current_user),
):
    return AnnouncementService.list_all(include_inactive=include_inactive, user_role=user.role)


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
        image_action=req.image_action.model_dump() if req.image_action else None,
        email_recipients=req.email_recipients or None,
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
    recall: bool = Query(False),
    user: CurrentUser = Depends(require_domain_manager),
):
    result = AnnouncementService.deactivate(announcement_id, user.email, recall=recall)
    if "not found" in result.lower():
        raise HTTPException(status_code=404, detail=result)
    return {"message": result}


@router.get("/users/search")
def search_users_for_recipients(
    q: str = "",
    _: CurrentUser = Depends(require_domain_manager),
):
    """Search employees by name or email for the announcement recipient picker."""
    from sqlalchemy import or_
    from app.database import SessionLocal
    from app.models import Employee
    q = (q or "").strip()
    if len(q) < 2:
        return []
    db = SessionLocal()
    try:
        rows = (
            db.query(Employee.name, Employee.email)
            .filter(
                Employee.email.isnot(None),
                or_(
                    Employee.name.ilike(f"%{q}%"),
                    Employee.email.ilike(f"%{q}%"),
                ),
            )
            .order_by(Employee.name)
            .limit(15)
            .all()
        )
        return [{"name": r.name or r.email, "email": r.email} for r in rows if r.email]
    finally:
        db.close()
