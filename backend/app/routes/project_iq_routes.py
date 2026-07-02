"""
Project IQ routes — Project DNA browse / search / build / review.

Project DNA is structured delivery knowledge extracted from the ingested project
corpus (transcripts + project files under the SharePoint Project Showcase category).
Browsing/searching is open to any non-employee (delivery, pre-sales, staffing,
managers); rebuilding and reviewing DNA is restricted to PMO/admin.

Internal-only: no client-facing proposal/case-study generation here.

Prefix: /api/project-iq
"""

import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.auth import CurrentUser, require_non_employee, require_pmo
from app.database import SessionLocal
from app.models import AiRequestLog
from app.services import project_iq_service as piq

router = APIRouter(prefix="/api/project-iq", tags=["Project IQ"])


def _log_query(user_email: str, domain: str, route_method: str, query_text: str,
              result_count: int, start: float) -> None:
    """Best-effort Observability log for a Project IQ NL query — these endpoints are
    hit directly from ProjectIQPortal and never touch the /api/chat pipeline, so without
    this they're invisible in the AI Observability dashboard."""
    db: Session = SessionLocal()
    try:
        db.add(AiRequestLog(
            session_id=f"project-iq-{user_email}",
            user_email=user_email,
            user_message=query_text,
            domain=domain,
            route_method=route_method,
            response_text=f"{result_count} result(s)",
            response_length=result_count,
            total_latency_ms=int((time.time() - start) * 1000),
        ))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


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
    start = time.time()
    hits = piq.find_similar_projects(
        req.description, limit=max(1, min(req.limit, 10)), reviewed_only=req.reviewed_only,
    )
    piq.record_queries([h.get("slug") for h in hits])  # triage signal: what people actually look for
    _log_query(user.email, "project_iq", "project_iq_search", req.description, len(hits), start)
    return {"query": req.description, "results": hits}


@router.post("/agentic-dna-search")
async def agentic_dna_search(req: SearchRequest, user: CurrentUser = Depends(require_non_employee)):
    """Deep DNA Search via Agentic RAG multi-hop traversal."""
    start = time.time()
    result = piq.agentic_dna_search(req.description)
    _log_query(user.email, "project_iq", "project_iq_agentic_search", req.description, len(result.get("profiles", [])), start)
    return {"query": req.description, "answer": result.get("answer"), "results": result.get("profiles", [])}


@router.get("/analytics")
async def analytics(user: CurrentUser = Depends(require_non_employee)):
    """Portfolio rollups: capability/tech/integration frequency, industry & health mix."""
    return piq.portfolio_analytics()


@router.post("/link-evidence")
async def link_evidence(
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_pmo),
):
    """(Re)link every DNA fact to its source chunk for drill-through (PMO/admin)."""
    background_tasks.add_task(piq.link_all_evidence)
    return {"status": "started"}


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
    start = time.time()
    results = piq.lessons_for(topic)
    _log_query(user.email, "project_iq", "project_iq_lessons", topic, len(results), start)
    return {"topic": topic, "lessons": results}


@router.get("/experts")
async def experts(skills: str, user: CurrentUser = Depends(require_non_employee)):
    start = time.time()
    results = piq.find_experts(skills)
    _log_query(user.email, "project_iq", "project_iq_experts", skills, len(results), start)
    return {"skills": skills, "experts": results}


@router.get("/assets")
async def assets(need: str, user: CurrentUser = Depends(require_non_employee)):
    start = time.time()
    results = piq.find_reusable_assets(need)
    _log_query(user.email, "project_iq", "project_iq_assets", need, len(results), start)
    return {"need": need, "assets": results}


# ── Phase 2 endpoints ─────────────────────────────────────────────────────────

@router.get("/recurring-risks")
async def recurring_risks(
    min_projects: int = 2,
    user: CurrentUser = Depends(require_non_employee),
):
    """Cross-project lessons / risks that recur in ≥ min_projects — delivery watch-list."""
    return {"risks": piq.recurring_risks(min_projects=min_projects)}


@router.get("/available-experts")
async def available_experts(
    skills: str,
    user: CurrentUser = Depends(require_non_employee),
):
    """Experts in *skills* cross-referenced with current allocation availability."""
    return {"skills": skills, "experts": piq.find_available_experts(skills)}


class KickoffBriefRequest(BaseModel):
    description: str


@router.post("/kickoff-brief")
async def kickoff_brief(
    req: KickoffBriefRequest,
    user: CurrentUser = Depends(require_non_employee),
):
    """Generate a delivery kickoff brief from similar past project DNA."""
    return piq.generate_kickoff_brief(req.description)


@router.get("/training-recs")
async def training_recs(
    slug: str,
    user: CurrentUser = Depends(require_non_employee),
):
    """Map lessons from a project's DNA to Udemy course recommendations."""
    return piq.lessons_to_training(slug)
