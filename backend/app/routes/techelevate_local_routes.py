"""
Local TechElevate LMS routes.

Backed entirely by our own DB (see techelevate_local_service) — no external token
needed. Powers the in-house training experience AND the upskilling flywheel:
trainings are skill-tagged, MCQ submissions are graded here, and a pass writes the
training's skills back to the employee as *verified* EmployeeSkills.

This is intentionally separate from techelevate_routes.py (the external API proxy,
inert until a Microsoft token is available) so the two never collide.

Prefix: /api/portal/te-local
"""

import os
import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.database import get_db
from app.models import Employee
from app.services import techelevate_local_service as te

router = APIRouter(prefix="/api/portal/te-local", tags=["TechElevate (Local)"])

# Roles allowed to view admin panel (assignments, groups, enrollments).
_ADMIN_ROLES = {"hr", "pmo", "admin", "super admin", "functional manager"}
# Roles allowed to create/delete trainings, assign courses, and manage content.
_LMS_WRITE_ROLES = {"pmo", "super admin"}

# Uploaded course documents live here and are served back via the /uploads static mount.
_TE_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "te_local")
_MAX_DOC_BYTES = 50 * 1024 * 1024  # 50 MB
_ALLOWED_DOC_EXTS = {"pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md", "csv"}


def _guard_enabled():
    if not te.local_enabled():
        raise HTTPException(status_code=503, detail="Local TechElevate is disabled (set TECHELEVATE_LOCAL=true).")


def _guard_admin(user: CurrentUser):
    if (user.role or "").lower() not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="This action is restricted to HR / PMO / Admin / Managers.")


def _can_manage_lms(user: CurrentUser) -> bool:
    """PMO, Super Admin, or users with explicit lms_manage capability."""
    role = (user.role or "").lower()
    if role in _LMS_WRITE_ROLES:
        return True
    extras = getattr(user, "extra_capabilities", None) or []
    return "lms_manage" in extras


def _guard_lms_write(user: CurrentUser):
    if not _can_manage_lms(user):
        raise HTTPException(status_code=403, detail="Only PMO, Super Admin, or users with LMS management privileges can perform this action.")


# ── Status ─────────────────────────────────────────────────────────────────────

@router.get("/status")
async def status(user: CurrentUser = Depends(get_current_user)):
    return {
        "local_enabled": te.local_enabled(),
        "can_manage": _can_manage_lms(user),
        "can_view_admin": (user.role or "").lower() in _ADMIN_ROLES,
        "portal_url": getattr(settings, "TECHELEVATE_PORTAL_URL", ""),
    }


# ── Trainings ──────────────────────────────────────────────────────────────────

@router.get("/trainings")
async def list_trainings(
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _guard_enabled()
    return {"results": te.list_trainings(db, search=search)}


@router.get("/trainings/stats")
async def training_stats(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    return te.training_stats(db)


@router.get("/trainings/{training_id}")
async def get_training(training_id: int, db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    t = te.get_training(db, training_id, with_questions=True)
    if not t:
        raise HTTPException(status_code=404, detail="Training not found.")
    return t


@router.post("/trainings/generate")
async def generate_training_draft(payload: dict = Body(...),
                                  user: CurrentUser = Depends(get_current_user)):
    """LLM-draft a training course (title, description, category, duration, pass %,
    skill tags, and optionally multi-level structure) from a plain-English description.

    Returns a DRAFT only — nothing is persisted. The admin reviews it in the wizard
    and saves through the normal POST create endpoint.
    """
    _guard_enabled()
    _guard_lms_write(user)

    description = (payload.get("description") or "").strip()
    if not description:
        raise HTTPException(status_code=422, detail="Describe the training you want to create (a sentence is enough).")

    from functools import partial
    from starlette.concurrency import run_in_threadpool
    from app.services import llm_controls_service as llm_controls
    from app.services.llm_json import invoke_json

    model = llm_controls.get_llm("general", default_timeout=45)
    # Keep the prompt and expected output small so the local model responds fast.
    # Levels are auto-computed below — don't ask the model to generate them.
    prompt = (
        "Corporate LMS training designer. Given the description, output ONLY a compact JSON object.\n"
        f"Description: {description}\n"
        'JSON shape: {"title":"5-8 word title","description":"2 sentence learner overview",'
        '"category":"Technical|Governance & Compliance|Business","duration_minutes":120,'
        '"pass_percentage":60,"skill_tags":["Skill1","Skill2"],"multi_level":false}\n'
        "Rules: title≤10 words; category pick one; duration 30-480; pass 50-80; "
        "skill_tags 2-4 concrete skills; multi_level true only for topics with clear beginner→advanced progression. "
        "Output raw JSON only, no fences."
    )
    draft = await run_in_threadpool(partial(invoke_json, model, prompt, 1))
    if draft is None:
        raise HTTPException(status_code=502, detail="Couldn't draft the course — the shared LLM timed out. Try again or fill in the fields manually.")

    tags = draft.get("skill_tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    result: dict = {
        "title": str(draft.get("title") or "").strip()[:150],
        "description": str(draft.get("description") or "").strip()[:500],
        "category": str(draft.get("category") or "Technical").strip(),
        "duration_minutes": min(max(int(draft.get("duration_minutes") or 120), 15), 960),
        "pass_percentage": min(max(int(draft.get("pass_percentage") or 60), 10), 100),
        "skill_tags": tags[:8],
        "multi_level": bool(draft.get("multi_level")),
    }
    if result["category"] not in ("Technical", "Governance & Compliance", "Business"):
        result["category"] = "Technical"

    if result["multi_level"]:
        # Auto-generate standard 3-level progression without an extra LLM call.
        per_level = max(30, result["duration_minutes"] // 3)
        result["levels"] = [
            {"name": "Beginner",     "duration_minutes": per_level, "pass_percentage": max(50, result["pass_percentage"] - 10), "description": ""},
            {"name": "Intermediate", "duration_minutes": per_level, "pass_percentage": result["pass_percentage"],               "description": ""},
            {"name": "Advanced",     "duration_minutes": per_level, "pass_percentage": min(90, result["pass_percentage"] + 10), "description": ""},
        ]
    else:
        result["levels"] = []

    return result


@router.post("/trainings")
async def create_training(payload: dict = Body(...), db: Session = Depends(get_db),
                          user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_lms_write(user)
    if not (payload.get("title") or "").strip():
        raise HTTPException(status_code=422, detail="title is required.")
    return te.create_training(db, payload, created_by=user.email)


@router.delete("/trainings/{training_id}")
async def delete_training(training_id: int, db: Session = Depends(get_db),
                          user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_lms_write(user)
    if not te.delete_training(db, training_id):
        raise HTTPException(status_code=404, detail="Training not found.")
    return {"deleted": True}


@router.get("/trainings/{training_id}/questions")
async def list_questions(training_id: int, manage: bool = Query(False),
                         db: Session = Depends(get_db),
                         user: CurrentUser = Depends(get_current_user)):
    """MCQ questions. Answers are hidden unless an LMS manager passes manage=true."""
    _guard_enabled()
    reveal = bool(manage) and _can_manage_lms(user)
    return {"results": te.list_questions(db, training_id, reveal=reveal)}


@router.post("/trainings/{training_id}/questions")
async def add_question(training_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    """Add an MCQ question to a training."""
    _guard_enabled()
    _guard_lms_write(user)
    if not (payload.get("question") or "").strip():
        raise HTTPException(status_code=422, detail="question is required.")
    out = te.add_question(db, training_id, payload)
    if out is None:
        raise HTTPException(status_code=404, detail="Training not found.")
    return out


@router.delete("/questions/{question_id}")
async def delete_question(question_id: int, db: Session = Depends(get_db),
                          user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_lms_write(user)
    if not te.delete_question(db, question_id):
        raise HTTPException(status_code=404, detail="Question not found.")
    return {"deleted": True}


@router.post("/trainings/{training_id}/questions/generate")
async def generate_questions(training_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                             user: CurrentUser = Depends(get_current_user)):
    """AI-draft MCQs grounded in the course's materials (uploaded docs, Udemy videos, links).

    Returns DRAFTS only — nothing is persisted. The admin reviews/edits them and saves via the
    bulk endpoint. (The actual exam is sat on the real TechElevate portal; this only authors it.)
    """
    _guard_enabled()
    _guard_lms_write(user)
    from functools import partial
    from starlette.concurrency import run_in_threadpool
    out = await run_in_threadpool(
        partial(
            te.generate_questions,
            db, training_id,
            level_id=payload.get("level_id"),
            count=payload.get("count") or 5,
            difficulty=(payload.get("difficulty") or "mixed"),
        )
    )
    err = out.get("error")
    if err == "training_not_found":
        raise HTTPException(status_code=404, detail="Training not found.")
    if err:
        raise HTTPException(status_code=502, detail="Couldn't draft questions — the model timed out or returned unusable output. Try again or reduce the question count.")
    return out


@router.post("/trainings/{training_id}/questions/bulk")
async def bulk_add_questions(training_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                             user: CurrentUser = Depends(get_current_user)):
    """Persist a reviewed batch of MCQs (typically AI-drafted then edited by the admin)."""
    _guard_enabled()
    _guard_lms_write(user)
    items = payload.get("questions") or []
    if not items:
        raise HTTPException(status_code=422, detail="questions[] is required.")
    saved = te.bulk_add_questions(db, training_id, items, level_id=payload.get("level_id"))
    return {"saved": saved, "count": len(saved)}


# ── Learning content (course materials) ────────────────────────────────────────

@router.get("/trainings/{training_id}/content")
async def list_content(training_id: int, db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    return {"results": te.list_content(db, training_id)}


@router.post("/trainings/{training_id}/content")
async def add_content(training_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                      user: CurrentUser = Depends(get_current_user)):
    """Attach a link / Udemy course / video material (by URL) to a course or one of its levels."""
    _guard_enabled()
    _guard_lms_write(user)
    if not (payload.get("title") or payload.get("url")):
        raise HTTPException(status_code=422, detail="A title or url is required.")
    out = te.add_content(db, training_id, payload)
    if out is None:
        raise HTTPException(status_code=404, detail="Training not found.")
    return out


@router.post("/trainings/{training_id}/content/upload")
async def upload_content_document(
    training_id: int,
    file: UploadFile = File(...),
    title: str = Form(""),
    description: str = Form(""),
    level_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    """Upload a course document (PDF/DOCX/PPTX/…). Saves the file, serves it via /uploads, and
    attaches it as a 'document' material. Its text is later extracted to ground AI question drafts."""
    _guard_enabled()
    _guard_lms_write(user)
    if not te.get_training(db, training_id):
        raise HTTPException(status_code=404, detail="Training not found.")

    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in _ALLOWED_DOC_EXTS:
        raise HTTPException(status_code=415, detail=f"Unsupported file type. Allowed: {', '.join(sorted(_ALLOWED_DOC_EXTS))}.")

    data = await file.read()
    if len(data) > _MAX_DOC_BYTES:
        raise HTTPException(status_code=413, detail="File must be under 50 MB.")

    os.makedirs(_TE_UPLOAD_DIR, exist_ok=True)
    stored = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(_TE_UPLOAD_DIR, stored), "wb") as fh:
        fh.write(data)

    out = te.add_content(db, training_id, {
        "kind": "document",
        "title": (title or "").strip() or (file.filename or "Document"),
        "url": f"/uploads/te_local/{stored}",
        "description": (description or "").strip(),
        "file_name": file.filename,
        "level_id": level_id,
    })
    if out is None:
        raise HTTPException(status_code=404, detail="Training not found.")
    return out


@router.delete("/content/{content_id}")
async def delete_content(content_id: int, db: Session = Depends(get_db),
                         user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_lms_write(user)
    if not te.delete_content(db, content_id):
        raise HTTPException(status_code=404, detail="Content not found.")
    return {"deleted": True}


@router.get("/trainings/{training_id}/enrollments")
async def training_enrollments(training_id: int, db: Session = Depends(get_db),
                               user: CurrentUser = Depends(get_current_user)):
    """Who is enrolled in this training, with their status + score."""
    _guard_enabled()
    return {"results": te.list_assignments(db, training_id=training_id, limit=500)}


# ── Employee search (group / assignment pickers) ──────────────────────────────

@router.get("/employees")
async def search_employees(search: Optional[str] = Query(None), db: Session = Depends(get_db),
                           user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_lms_write(user)
    return {"results": te.search_employees(db, search)}


# ── Employee groups (bulk assignment) ─────────────────────────────────────────

@router.get("/groups")
async def list_groups(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_lms_write(user)
    return {"results": te.list_groups(db), "stats": te.group_stats(db)}


@router.post("/groups")
async def create_group(payload: dict = Body(...), db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_lms_write(user)
    if not (payload.get("name") or "").strip():
        raise HTTPException(status_code=422, detail="name is required.")
    return te.create_group(db, payload, created_by=user.email)


@router.delete("/groups/{group_id}")
async def delete_group(group_id: int, db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_lms_write(user)
    if not te.delete_group(db, group_id):
        raise HTTPException(status_code=404, detail="Group not found.")
    return {"deleted": True}


@router.post("/groups/{group_id}/assign")
async def assign_group(group_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    """Assign a training to every member of a group."""
    _guard_enabled()
    _guard_lms_write(user)
    training_id = payload.get("training_id")
    if not training_id:
        raise HTTPException(status_code=422, detail="training_id is required.")
    out = te.assign_group_training(db, group_id, int(training_id), assigned_by=user.email)
    if out.get("error"):
        raise HTTPException(status_code=404, detail=out["error"])
    return out


# ── Assignments ────────────────────────────────────────────────────────────────

@router.get("/assignments")
async def list_assignments(
    training_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _guard_enabled()
    return {"results": te.list_assignments(db, training_id=training_id, status=status,
                                           department=department)}


@router.get("/assignments/stats")
async def assignment_stats(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    return te.assignment_stats(db)


@router.get("/assignments/my")
async def my_assignments(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    return {"results": te.my_assignments(db, user.email)}


@router.post("/assignments")
async def assign_training(payload: dict = Body(...), db: Session = Depends(get_db),
                          user: CurrentUser = Depends(get_current_user)):
    """Assign a training to one or more employees (by id or email)."""
    _guard_enabled()
    _guard_lms_write(user)
    training_id = payload.get("training_id")
    targets = payload.get("employees") or []
    if not training_id or not targets:
        raise HTTPException(status_code=422, detail="training_id and employees[] are required.")
    created = []
    for tgt in targets:
        emp = te._resolve_employee(
            db,
            employee_id=tgt.get("employee_id") if isinstance(tgt, dict) else None,
            email=(tgt.get("email") if isinstance(tgt, dict) else tgt),
        )
        if not emp:
            continue
        a = te.assign_training(db, training_id=int(training_id), employee=emp,
                               assigned_by=user.email)
        if a:
            created.append(emp.email)
    db.commit()
    return {"assigned": created, "count": len(created)}


@router.post("/assignments/{assignment_id}/evaluate")
async def evaluate(assignment_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                   user: CurrentUser = Depends(get_current_user)):
    """Submit MCQ answers {answers: {question_id: 'A'}}; grades + (on pass) writes
    verified skills back to the employee."""
    _guard_enabled()
    result = te.submit_evaluation(db, assignment_id, payload.get("answers") or {})
    err = result.get("error")
    if err == "no_questions":
        raise HTTPException(
            status_code=400,
            detail="This course has no assessment questions yet. "
                   "The instructor needs to add MCQ questions before learners can be evaluated.",
        )
    if err:
        raise HTTPException(status_code=400, detail=err)
    return result


@router.post("/assignments/{assignment_id}/status")
async def set_status(assignment_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                     user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_lms_write(user)
    new_status = payload.get("status")
    if new_status not in {"Assigned", "In Progress", "Completed", "Failed"}:
        raise HTTPException(status_code=422, detail="Invalid status.")
    out = te.set_assignment_status(db, assignment_id, new_status, score=payload.get("score"))
    if not out:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    return out


# ── Flywheel: recommend trainings for a skill (internal ▸ Udemy fallback) ──────

@router.get("/recommend")
async def recommend(
    skill: str = Query(..., description="Skill / topic to upskill on"),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    _guard_enabled()
    internal = te.recommend_for_skill(db, skill, limit=5)
    udemy_results: list = []
    if not internal:
        try:
            from app.services import udemy_business_service as udemy
            if udemy.configured():
                udemy_results = udemy.search_courses(skill, page=1, page_size=5).get("results", [])
        except Exception:
            udemy_results = []
    return {
        "skill": skill,
        "internal": internal,
        "udemy_fallback": udemy_results,
        "source": "internal" if internal else ("udemy" if udemy_results else "none"),
    }
