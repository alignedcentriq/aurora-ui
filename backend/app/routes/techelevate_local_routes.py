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

from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models import Employee
from app.services import techelevate_local_service as te

router = APIRouter(prefix="/api/portal/te-local", tags=["TechElevate (Local)"])

# Roles allowed to author trainings, assign, and move assignment status.
_ADMIN_ROLES = {"hr", "pmo", "admin", "super admin", "functional manager"}


def _guard_enabled():
    if not te.local_enabled():
        raise HTTPException(status_code=503, detail="Local TechElevate is disabled (set TECHELEVATE_LOCAL=true).")


def _guard_admin(user: CurrentUser):
    if (user.role or "").lower() not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="This action is restricted to HR / PMO / Admin / Managers.")


# ── Status ─────────────────────────────────────────────────────────────────────

@router.get("/status")
async def status(user: CurrentUser = Depends(get_current_user)):
    return {
        "local_enabled": te.local_enabled(),
        "can_manage": (user.role or "").lower() in _ADMIN_ROLES,
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


@router.post("/trainings")
async def create_training(payload: dict = Body(...), db: Session = Depends(get_db),
                          user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_admin(user)
    if not (payload.get("title") or "").strip():
        raise HTTPException(status_code=422, detail="title is required.")
    return te.create_training(db, payload, created_by=user.email)


@router.delete("/trainings/{training_id}")
async def delete_training(training_id: int, db: Session = Depends(get_db),
                          user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_admin(user)
    if not te.delete_training(db, training_id):
        raise HTTPException(status_code=404, detail="Training not found.")
    return {"deleted": True}


@router.get("/trainings/{training_id}/questions")
async def list_questions(training_id: int, manage: bool = Query(False),
                         db: Session = Depends(get_db),
                         user: CurrentUser = Depends(get_current_user)):
    """MCQ questions. Answers are hidden unless an admin passes manage=true."""
    _guard_enabled()
    reveal = bool(manage) and (user.role or "").lower() in _ADMIN_ROLES
    return {"results": te.list_questions(db, training_id, reveal=reveal)}


@router.post("/trainings/{training_id}/questions")
async def add_question(training_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    """Add an MCQ question to a training."""
    _guard_enabled()
    _guard_admin(user)
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
    _guard_admin(user)
    if not te.delete_question(db, question_id):
        raise HTTPException(status_code=404, detail="Question not found.")
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
    _guard_admin(user)
    return {"results": te.search_employees(db, search)}


# ── Employee groups (bulk assignment) ─────────────────────────────────────────

@router.get("/groups")
async def list_groups(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_admin(user)
    return {"results": te.list_groups(db), "stats": te.group_stats(db)}


@router.post("/groups")
async def create_group(payload: dict = Body(...), db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_admin(user)
    if not (payload.get("name") or "").strip():
        raise HTTPException(status_code=422, detail="name is required.")
    return te.create_group(db, payload, created_by=user.email)


@router.delete("/groups/{group_id}")
async def delete_group(group_id: int, db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_admin(user)
    if not te.delete_group(db, group_id):
        raise HTTPException(status_code=404, detail="Group not found.")
    return {"deleted": True}


@router.post("/groups/{group_id}/assign")
async def assign_group(group_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                       user: CurrentUser = Depends(get_current_user)):
    """Assign a training to every member of a group."""
    _guard_enabled()
    _guard_admin(user)
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
    _guard_admin(user)
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
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/assignments/{assignment_id}/status")
async def set_status(assignment_id: int, payload: dict = Body(...), db: Session = Depends(get_db),
                     user: CurrentUser = Depends(get_current_user)):
    _guard_enabled()
    _guard_admin(user)
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
