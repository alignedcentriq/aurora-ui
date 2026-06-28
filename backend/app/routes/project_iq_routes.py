"""
Project IQ routes — Project DNA browse / search / build / review.

Project DNA is structured delivery knowledge extracted from the ingested project
corpus (transcripts + project files under the SharePoint Project Showcase category).
Browsing/searching is open to any non-employee (delivery, pre-sales, staffing,
managers); rebuilding and reviewing DNA is restricted to PMO/admin.

Internal-only: no client-facing proposal/case-study generation here.

Prefix: /api/project-iq
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, require_non_employee, require_pmo
from app.services import project_iq_service as piq

router = APIRouter(prefix="/api/project-iq", tags=["Project IQ"])


class SearchRequest(BaseModel):
    description: str
    limit: int = 3
    reviewed_only: bool = False


class ReviewRequest(BaseModel):
    review_status: str = "reviewed"   # reviewed | draft
    edits: dict | None = None


@router.get("/profiles")
async def list_profiles(
    review_status: str | None = None,
    user: CurrentUser = Depends(require_non_employee),
):
    """List Project DNA cards (optionally filtered by review_status)."""
    return {"profiles": piq.list_profiles(review_status=review_status)}


@router.get("/profiles/{slug}")
async def get_profile(slug: str, user: CurrentUser = Depends(require_non_employee)):
    """Full Project DNA card for one project, with all child facts."""
    profile = piq.get_profile(slug)
    if not profile:
        raise HTTPException(status_code=404, detail="No Project DNA for that project yet.")
    return profile


@router.post("/search")
async def search(req: SearchRequest, user: CurrentUser = Depends(require_non_employee)):
    """'Have we done this before?' — ranked similar past projects for a description."""
    hits = piq.find_similar_projects(
        req.description, limit=max(1, min(req.limit, 10)), reviewed_only=req.reviewed_only,
    )
    return {"query": req.description, "results": hits}


@router.post("/profiles/{slug}/rebuild")
async def rebuild_one(
    slug: str,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_pmo),
):
    """Re-extract DNA for one project from its ingested corpus (PMO/admin only)."""
    background_tasks.add_task(piq.extract_project_dna, slug)
    return {"status": "started", "slug": slug}


@router.post("/rebuild-all")
async def rebuild_all(
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_pmo),
):
    """Re-extract DNA for every project found in the corpus (PMO/admin only)."""
    background_tasks.add_task(piq.build_all_dna)
    return {"status": "started"}


@router.post("/profiles/{slug}/review")
async def review(slug: str, req: ReviewRequest, user: CurrentUser = Depends(require_pmo)):
    """Human-in-the-loop: mark a DNA card reviewed and optionally edit top-level fields."""
    result = piq.set_review(slug, reviewer=user.email, review_status=req.review_status, edits=req.edits)
    if not result:
        raise HTTPException(status_code=404, detail="No Project DNA for that project yet.")
    return result


# Convenience read endpoints powering the page's Lessons / Experts / Assets sections.

@router.get("/lessons")
async def lessons(topic: str, user: CurrentUser = Depends(require_non_employee)):
    return {"topic": topic, "lessons": piq.lessons_for(topic)}


@router.get("/experts")
async def experts(skills: str, user: CurrentUser = Depends(require_non_employee)):
    return {"skills": skills, "experts": piq.find_experts(skills)}


@router.get("/assets")
async def assets(need: str, user: CurrentUser = Depends(require_non_employee)):
    return {"need": need, "assets": piq.find_reusable_assets(need)}
