"""
Local TechElevate LMS service.

The external TechElevate API is unreachable in this environment (no stored Microsoft
refresh token), so this module backs the same training experience with our own DB —
and, crucially, closes the upskilling flywheel:

    Alchemy gap  →  recommend training (internal ▸ Udemy)
        ↑                                   │
        └──  verified EmployeeSkill  ←  complete + pass (MCQ graded here)

Each training carries `skill_tags` (Alchemy-aligned skill names). When an employee's
assignment reaches a passing score, those skills are written back once as *verified*
EmployeeSkill rows (certification = "TechElevate: <title>") — which resource matching
and the PMO Skill Supply overlay already read.
"""

import datetime
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Employee,
    EmployeeSkill,
    TeAssignment,
    TeGroup,
    TeMcqQuestion,
    TeTraining,
    TeTrainingLevel,
)

log = logging.getLogger("aurora-logger")


def local_enabled() -> bool:
    return bool(settings.TECHELEVATE_LOCAL)


# ── Seed catalog (mirrors the 8 trainings from the TechElevate portal spec) ────
# Each entry is skill-tagged with Alchemy-aligned skill names so completion feeds
# the flywheel. `levels` present → multi-level training; otherwise single-level.

_SEED_TRAININGS = [
    {
        "title": "Prompt Engineering",
        "description": "Craft effective prompts for LLMs — zero/few-shot, chain-of-thought, structured output, and evaluation.",
        "category": "Technical", "duration_minutes": 240, "pass_percentage": 60,
        "skill_tags": ["Prompt Engineering", "Generative AI"],
        "video_link": "https://www.youtube.com/watch?v=dOxUroR57xs",
        "questions": [
            {"question": "Which technique encourages a model to reason step by step?",
             "options": {"A": "Few-shot", "B": "Chain-of-thought", "C": "Temperature 0", "D": "Top-p"},
             "correct_answer": "B", "marks": 1,
             "explanation": "Chain-of-thought prompting elicits intermediate reasoning steps."},
            {"question": "What does a lower temperature value generally produce?",
             "options": {"A": "More random output", "B": "More deterministic output", "C": "Longer output", "D": "Faster output"},
             "correct_answer": "B", "marks": 1},
            {"question": "Few-shot prompting works by providing the model with…",
             "options": {"A": "Fine-tuning data", "B": "A system reboot", "C": "A few worked examples", "D": "A larger context window"},
             "correct_answer": "C", "marks": 1},
        ],
    },
    {
        "title": "Gen AI & Agentic AI",
        "description": "Build generative-AI and agentic systems — tool use, planning, RAG, and multi-agent orchestration.",
        "category": "Technical", "duration_minutes": 360, "pass_percentage": 65,
        "skill_tags": ["Generative AI", "Agentic AI", "LLM", "RAG"],
        "questions": [
            {"question": "RAG augments an LLM with…",
             "options": {"A": "Retrieved external context", "B": "More parameters", "C": "A GPU", "D": "A fine-tune"},
             "correct_answer": "A", "marks": 1},
            {"question": "An 'agent' in agentic AI is best described as an LLM that can…",
             "options": {"A": "Only chat", "B": "Call tools and act in a loop", "C": "Render images", "D": "Compress text"},
             "correct_answer": "B", "marks": 1},
        ],
    },
    {
        "title": "Python Programming Mastery",
        "description": "From fundamentals to advanced Python — data structures, OOP, async, packaging, and testing.",
        "category": "Technical", "duration_minutes": 900, "pass_percentage": 60,
        "skill_tags": ["Python"],
        "video_link": "https://www.youtube.com/watch?v=rfscVS0vtbw",
        "levels": [
            {"name": "Basic", "duration_minutes": 300, "pass_percentage": 60,
             "description": "Syntax, types, control flow, functions, collections."},
            {"name": "Intermediate", "duration_minutes": 300, "pass_percentage": 65,
             "description": "OOP, modules, error handling, comprehensions, file I/O."},
            {"name": "Advanced", "duration_minutes": 300, "pass_percentage": 70,
             "description": "Async, decorators, typing, packaging, testing."},
        ],
        "questions": [
            {"question": "Which built-in returns an immutable ordered sequence?",
             "options": {"A": "list", "B": "tuple", "C": "set", "D": "dict"},
             "correct_answer": "B", "marks": 1},
            {"question": "What keyword defines a coroutine in modern Python?",
             "options": {"A": "yield", "B": "def", "C": "async def", "D": "lambda"},
             "correct_answer": "C", "marks": 1},
            {"question": "Which structure stores unique, unordered items?",
             "options": {"A": "list", "B": "tuple", "C": "set", "D": "str"},
             "correct_answer": "C", "marks": 1},
        ],
    },
    {
        "title": "Machine Learning with Python",
        "description": "Supervised and unsupervised ML with scikit-learn — features, models, evaluation, and tuning.",
        "category": "Technical", "duration_minutes": 720, "pass_percentage": 65,
        "skill_tags": ["Machine Learning", "Python", "Data Science"],
        "levels": [
            {"name": "Basic", "duration_minutes": 240, "pass_percentage": 60,
             "description": "ML concepts, scikit-learn, train/test split."},
            {"name": "Intermediate", "duration_minutes": 240, "pass_percentage": 65,
             "description": "Pipelines, cross-validation, metrics."},
            {"name": "Advanced", "duration_minutes": 240, "pass_percentage": 70,
             "description": "Ensembles, hyperparameter tuning, deployment."},
        ],
        "questions": [
            {"question": "Which metric is appropriate for an imbalanced classification problem?",
             "options": {"A": "Accuracy", "B": "F1-score", "C": "Mean", "D": "R²"},
             "correct_answer": "B", "marks": 1},
            {"question": "Splitting data into train/test sets primarily guards against…",
             "options": {"A": "Underfitting", "B": "Overfitting/leakage", "C": "Slow training", "D": "Bias only"},
             "correct_answer": "B", "marks": 1},
        ],
    },
    {
        "title": "DevOps Fundamentals and Advanced Practices",
        "description": "CI/CD, containers, infrastructure as code, and observability for reliable delivery.",
        "category": "Technical", "duration_minutes": 600, "pass_percentage": 60,
        "skill_tags": ["DevOps", "CI/CD", "Docker", "Kubernetes"],
        "questions": [
            {"question": "A container image is best described as…",
             "options": {"A": "A VM", "B": "A packaged app + dependencies", "C": "A load balancer", "D": "A database"},
             "correct_answer": "B", "marks": 1},
            {"question": "CI primarily automates…",
             "options": {"A": "Manual QA", "B": "Build & test on every change", "C": "Server provisioning", "D": "Incident paging"},
             "correct_answer": "B", "marks": 1},
        ],
    },
    {
        "title": "Enterprise Governance & Compliance Playbook",
        "description": "Data governance, regulatory compliance, risk, and audit readiness for enterprise teams.",
        "category": "Governance & Compliance", "duration_minutes": 180, "pass_percentage": 70,
        "skill_tags": ["Governance", "Compliance", "Risk Management"],
        "questions": [
            {"question": "The principle of least privilege means granting…",
             "options": {"A": "All access by default", "B": "Only the access needed", "C": "Admin to everyone", "D": "No access ever"},
             "correct_answer": "B", "marks": 1},
        ],
    },
    {
        "title": "Business Technology Solutions Mastery",
        "description": "Translate business needs into technology solutions — requirements, stakeholders, and delivery.",
        "category": "Business", "duration_minutes": 300, "pass_percentage": 60,
        "skill_tags": ["Business Analysis", "Stakeholder Management", "Solution Design"],
        "questions": [
            {"question": "A good requirement is…",
             "options": {"A": "Ambiguous", "B": "Specific & testable", "C": "Undocumented", "D": "Technical only"},
             "correct_answer": "B", "marks": 1},
        ],
    },
    {
        "title": "Data Engineering Foundations",
        "description": "Build robust data pipelines — modelling, SQL, ETL/ELT, and orchestration.",
        "category": "Technical", "duration_minutes": 480, "pass_percentage": 65,
        "skill_tags": ["Data Engineering", "SQL", "ETL"],
        "questions": [
            {"question": "ETL stands for…",
             "options": {"A": "Extract, Transform, Load", "B": "Encode, Test, Log", "C": "Export, Trim, Link", "D": "Evaluate, Train, Learn"},
             "correct_answer": "A", "marks": 1},
        ],
    },
]


# ── Serialisation ─────────────────────────────────────────────────────────────

def _training_dict(t: TeTraining, *, with_questions: bool = False) -> dict:
    out = {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "category": t.category,
        "type": t.training_type,
        "duration_minutes": t.duration_minutes,
        "pass_percentage": t.pass_percentage,
        "max_attempts": t.max_attempts,
        "video_link": t.video_link,
        "skill_tags": t.skill_tags or [],
        "photo_url": t.photo_url,
        "levels": [
            {"id": lv.id, "name": lv.name, "sort_order": lv.sort_order,
             "duration_minutes": lv.duration_minutes, "pass_percentage": lv.pass_percentage,
             "description": lv.description}
            for lv in t.levels
        ],
        "created_by": t.created_by,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
    if with_questions:
        out["questions"] = [_question_dict(q, reveal=False) for q in t.questions]
    return out


def _question_dict(q: TeMcqQuestion, *, reveal: bool = False) -> dict:
    out = {
        "id": q.id, "training_id": q.training_id, "level_id": q.level_id,
        "question": q.question, "options": q.options or {}, "marks": q.marks,
    }
    if reveal:
        out["correct_answer"] = q.correct_answer
        out["explanation"] = q.explanation
    return out


def _assignment_dict(a: TeAssignment) -> dict:
    return {
        "id": a.id,
        "training_id": a.training_id,
        "training_title": a.training.title if a.training else None,
        "category": a.training.category if a.training else None,
        "employee_id": a.employee_id,
        "employee_email": a.employee_email,
        "employee_name": a.employee_name,
        "department": a.department,
        "status": a.status,
        "score": a.score,
        "attempts": a.attempts,
        "start_date": a.start_date.isoformat() if a.start_date else None,
        "due_date": a.due_date.isoformat() if a.due_date else None,
        "completed_at": a.completed_at.isoformat() if a.completed_at else None,
        "skill_tags": (a.training.skill_tags or []) if a.training else [],
    }


# ── Trainings: CRUD + stats ───────────────────────────────────────────────────

def list_trainings(db: Session, *, search: Optional[str] = None) -> list[dict]:
    q = db.query(TeTraining)
    if search:
        like = f"%{search.lower()}%"
        q = q.filter(TeTraining.title.ilike(like))
    return [_training_dict(t) for t in q.order_by(TeTraining.title).all()]


def get_training(db: Session, training_id: int, *, with_questions: bool = False) -> Optional[dict]:
    t = db.get(TeTraining, training_id)
    return _training_dict(t, with_questions=with_questions) if t else None


def training_stats(db: Session) -> dict:
    rows = db.query(TeTraining).all()
    with_levels = sum(1 for t in rows if t.training_type == "levels")
    total_minutes = sum((t.duration_minutes or 0) for t in rows)
    return {
        "total_trainings": len(rows),
        "with_levels": with_levels,
        "single_level": len(rows) - with_levels,
        "total_duration_minutes": total_minutes,
        "categories": len({t.category for t in rows if t.category}),
    }


def create_training(db: Session, data: dict, *, created_by: Optional[str] = None) -> dict:
    levels = data.get("levels") or []
    questions = data.get("questions") or []
    t = TeTraining(
        title=data["title"],
        description=data.get("description"),
        category=data.get("category"),
        training_type="levels" if levels else "single",
        duration_minutes=int(data.get("duration_minutes") or 0),
        pass_percentage=float(data.get("pass_percentage") or 60),
        max_attempts=int(data.get("max_attempts") or 3),
        video_link=data.get("video_link"),
        skill_tags=[s for s in (data.get("skill_tags") or []) if s],
        photo_url=data.get("photo_url"),
        created_by=created_by,
    )
    db.add(t)
    db.flush()
    for i, lv in enumerate(levels):
        db.add(TeTrainingLevel(
            training_id=t.id, name=lv.get("name") or f"Level {i + 1}", sort_order=i,
            duration_minutes=int(lv.get("duration_minutes") or 0),
            pass_percentage=float(lv.get("pass_percentage") or 60),
            description=lv.get("description"),
        ))
    for q in questions:
        db.add(TeMcqQuestion(
            training_id=t.id, question=q["question"], options=q.get("options") or {},
            correct_answer=q.get("correct_answer"), marks=int(q.get("marks") or 1),
            explanation=q.get("explanation"),
        ))
    db.commit()
    db.refresh(t)
    return _training_dict(t, with_questions=True)


def delete_training(db: Session, training_id: int) -> bool:
    t = db.get(TeTraining, training_id)
    if not t:
        return False
    db.delete(t)
    db.commit()
    return True


# ── Assignments: create / list / stats ────────────────────────────────────────

def _resolve_employee(db: Session, *, employee_id: Optional[int] = None,
                      email: Optional[str] = None) -> Optional[Employee]:
    if employee_id:
        return db.get(Employee, employee_id)
    if email:
        return db.query(Employee).filter(Employee.email.ilike(email)).first()
    return None


def assign_training(db: Session, *, training_id: int, employee: Employee,
                    start_date=None, due_date=None, status: str = "Assigned",
                    assigned_by: Optional[str] = None) -> Optional[TeAssignment]:
    """Create (or return existing) an assignment for one employee. Idempotent on
    (training_id, employee_id)."""
    t = db.get(TeTraining, training_id)
    if not t or not employee:
        return None
    existing = db.query(TeAssignment).filter(
        TeAssignment.training_id == training_id,
        TeAssignment.employee_id == employee.id,
    ).first()
    if existing:
        return existing
    a = TeAssignment(
        training_id=training_id, employee_id=employee.id, employee_email=employee.email,
        employee_name=employee.name, department=employee.department,
        status=status, start_date=start_date, due_date=due_date, assigned_by=assigned_by,
    )
    db.add(a)
    db.flush()
    return a


def list_assignments(db: Session, *, training_id: Optional[int] = None,
                     email: Optional[str] = None, status: Optional[str] = None,
                     department: Optional[str] = None, limit: int = 200) -> list[dict]:
    q = db.query(TeAssignment).join(TeTraining)
    if training_id:
        q = q.filter(TeAssignment.training_id == training_id)
    if email:
        q = q.filter(TeAssignment.employee_email.ilike(email))
    if status:
        q = q.filter(TeAssignment.status == status)
    if department:
        q = q.filter(TeAssignment.department == department)
    rows = q.order_by(TeAssignment.updated_at.desc()).limit(limit).all()
    return [_assignment_dict(a) for a in rows]


def assignment_stats(db: Session) -> dict:
    rows = db.query(TeAssignment).all()
    completed = [a for a in rows if a.status == "Completed"]
    in_progress = sum(1 for a in rows if a.status == "In Progress")
    pending = sum(1 for a in rows if a.status == "Assigned")
    scored = [a.score for a in rows if a.score is not None]
    total = len(rows)
    return {
        "total_users": len({a.employee_id for a in rows}),
        "total_assignments": total,
        "completed": len(completed),
        "in_progress": in_progress,
        "pending": pending,
        "completion_rate": round(len(completed) / total * 100, 2) if total else 0,
        "average_score": round(sum(scored) / len(scored), 1) if scored else 0,
    }


def my_assignments(db: Session, email: str) -> list[dict]:
    return list_assignments(db, email=email, limit=200)


# ── MCQ evaluation → score → pass/fail → verified-skill write-back ────────────

def list_questions(db: Session, training_id: int, *, reveal: bool = False) -> list[dict]:
    rows = db.query(TeMcqQuestion).filter(TeMcqQuestion.training_id == training_id).all()
    return [_question_dict(q, reveal=reveal) for q in rows]


def submit_evaluation(db: Session, assignment_id: int, answers: dict) -> dict:
    """Grade an MCQ attempt. `answers` = {question_id: "A".."D"}. Sets the assignment
    score/status and, on a pass, writes the training's skill_tags back as verified
    EmployeeSkills. Returns a result summary."""
    a = db.get(TeAssignment, assignment_id)
    if not a:
        return {"error": "assignment_not_found"}
    questions = db.query(TeMcqQuestion).filter(TeMcqQuestion.training_id == a.training_id).all()
    if not questions:
        return {"error": "no_questions"}

    total_marks = sum(q.marks for q in questions)
    earned = 0
    answers = {str(k): (v or "").strip().upper() for k, v in (answers or {}).items()}
    for q in questions:
        if answers.get(str(q.id)) == (q.correct_answer or "").upper():
            earned += q.marks
    pct = round(earned / total_marks * 100, 1) if total_marks else 0.0
    passed = pct >= (a.training.pass_percentage if a.training else 60)

    a.score = pct
    a.attempts = (a.attempts or 0) + 1
    a.status = "Completed" if passed else "Failed"
    a.completed_at = datetime.datetime.utcnow() if passed else a.completed_at

    applied_skills: list[str] = []
    if passed:
        applied_skills = _apply_verified_skills(db, a)
    db.commit()

    return {
        "assignment_id": a.id,
        "score": pct,
        "passed": passed,
        "status": a.status,
        "earned_marks": earned,
        "total_marks": total_marks,
        "skills_verified": applied_skills,
    }


def set_assignment_status(db: Session, assignment_id: int, status: str,
                          score: Optional[float] = None) -> Optional[dict]:
    """Manually move an assignment (admin action). 'Completed' triggers skill write-back."""
    a = db.get(TeAssignment, assignment_id)
    if not a:
        return None
    a.status = status
    if score is not None:
        a.score = score
    if status == "Completed":
        a.completed_at = a.completed_at or datetime.datetime.utcnow()
        _apply_verified_skills(db, a)
    db.commit()
    return _assignment_dict(a)


def _apply_verified_skills(db: Session, a: TeAssignment) -> list[str]:
    """Write the completed training's skill_tags back to the employee as verified
    EmployeeSkills. Idempotent (guarded by `skills_applied`; never duplicates a skill)."""
    if a.skills_applied or not a.training or not a.employee_id:
        return []
    tags = a.training.skill_tags or []
    if not tags:
        a.skills_applied = True
        return []
    existing = {
        (s.skill or "").strip().lower()
        for s in db.query(EmployeeSkill).filter(EmployeeSkill.employee_id == a.employee_id).all()
    }
    added: list[str] = []
    cert = f"TechElevate: {a.training.title}"
    today = datetime.date.today()
    for skill in tags:
        if (skill or "").strip().lower() in existing:
            continue
        db.add(EmployeeSkill(
            employee_id=a.employee_id, skill=skill, certification=cert,
            last_used=today,
        ))
        added.append(skill)
    a.skills_applied = True
    if added:
        log.info("[techelevate-local] verified %d skill(s) for emp %s via '%s': %s",
                 len(added), a.employee_id, a.training.title, added)
    return added


# ── Flywheel: recommend internal trainings for a skill (Udemy is the fallback) ─

def recommend_for_skill(db: Session, skill: str, *, limit: int = 5) -> list[dict]:
    """Internal trainings whose skill_tags / title / description match the skill.
    Empty result → caller should fall back to the Udemy catalog."""
    needle = (skill or "").strip().lower()
    if not needle:
        return []
    out: list[tuple[int, TeTraining]] = []
    for t in db.query(TeTraining).all():
        tags = [s.lower() for s in (t.skill_tags or [])]
        score = 0
        if any(needle == tag for tag in tags):
            score = 3
        elif any(needle in tag or tag in needle for tag in tags):
            score = 2
        elif needle in (t.title or "").lower() or needle in (t.description or "").lower():
            score = 1
        if score:
            out.append((score, t))
    out.sort(key=lambda x: (-x[0], x[1].title))
    return [_training_dict(t) for _, t in out[:limit]]


# ── MCQ authoring ─────────────────────────────────────────────────────────────

def add_question(db: Session, training_id: int, data: dict) -> Optional[dict]:
    t = db.get(TeTraining, training_id)
    if not t:
        return None
    q = TeMcqQuestion(
        training_id=training_id,
        level_id=data.get("level_id"),
        question=data["question"],
        options=data.get("options") or {},
        correct_answer=(data.get("correct_answer") or "").strip().upper() or None,
        marks=int(data.get("marks") or 1),
        explanation=data.get("explanation"),
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return _question_dict(q, reveal=True)


def delete_question(db: Session, question_id: int) -> bool:
    q = db.get(TeMcqQuestion, question_id)
    if not q:
        return False
    db.delete(q)
    db.commit()
    return True


# ── Employee search (for group / assignment pickers) ──────────────────────────

def search_employees(db: Session, search: Optional[str] = None, *, limit: int = 25) -> list[dict]:
    q = db.query(Employee).filter(Employee.email.isnot(None))
    if search:
        like = f"%{search.lower()}%"
        q = q.filter(
            Employee.name.ilike(like)
            | Employee.email.ilike(like)
            | Employee.employee_id.ilike(like)
            | Employee.department.ilike(like)
        )
    return [
        {"employee_id": e.id, "code": e.employee_id, "name": e.name,
         "email": e.email, "department": e.department, "designation": e.designation}
        for e in q.order_by(Employee.name).limit(limit).all()
    ]


# ── Employee groups (bulk assignment) ─────────────────────────────────────────

def _group_dict(g: TeGroup, *, training_count: int = 0) -> dict:
    members = g.members or []
    return {
        "id": g.id, "name": g.name, "project_name": g.project_name,
        "description": g.description, "photo_url": g.photo_url,
        "members": members, "member_count": len(members),
        "training_count": training_count,
        "created_by": g.created_by,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }


def list_groups(db: Session) -> list[dict]:
    return [_group_dict(g) for g in db.query(TeGroup).order_by(TeGroup.name).all()]


def group_stats(db: Session) -> dict:
    groups = db.query(TeGroup).all()
    unique = set()
    for g in groups:
        for m in (g.members or []):
            if m.get("email"):
                unique.add(m["email"].lower())
    return {"total_groups": len(groups), "unique_employees": len(unique)}


def create_group(db: Session, data: dict, *, created_by: Optional[str] = None) -> dict:
    members = []
    for m in (data.get("members") or []):
        emp = _resolve_employee(
            db,
            employee_id=m.get("employee_id") if isinstance(m, dict) else None,
            email=(m.get("email") if isinstance(m, dict) else m),
        )
        if emp:
            members.append({"employee_id": emp.id, "name": emp.name,
                            "email": emp.email, "department": emp.department})
    g = TeGroup(
        name=data["name"], project_name=data.get("project_name"),
        description=data.get("description"), photo_url=data.get("photo_url"),
        members=members, created_by=created_by,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return _group_dict(g)


def delete_group(db: Session, group_id: int) -> bool:
    g = db.get(TeGroup, group_id)
    if not g:
        return False
    db.delete(g)
    db.commit()
    return True


def assign_group_training(db: Session, group_id: int, training_id: int,
                          *, start_date=None, due_date=None,
                          assigned_by: Optional[str] = None) -> dict:
    """Assign a training to every member of a group."""
    g = db.get(TeGroup, group_id)
    if not g:
        return {"error": "group_not_found"}
    assigned = []
    for m in (g.members or []):
        emp = db.get(Employee, m.get("employee_id")) if m.get("employee_id") else None
        if not emp:
            continue
        a = assign_training(db, training_id=training_id, employee=emp,
                            start_date=start_date, due_date=due_date, assigned_by=assigned_by)
        if a:
            assigned.append(emp.email)
    db.commit()
    return {"assigned": assigned, "count": len(assigned)}


# ── Seeding ───────────────────────────────────────────────────────────────────

def seed_local_data(db: Session) -> None:
    """Idempotently seed the 8-training catalog, then a realistic spread of
    assignments/completions so analytics and the flywheel show live numbers."""
    if not local_enabled():
        return
    try:
        _seed_trainings(db)
        # Sample assignments add verified skills to REAL employees — opt-in only,
        # so a shared DB gets the catalog without mutating live skill profiles.
        if settings.TECHELEVATE_SEED_ASSIGNMENTS:
            _seed_assignments(db)
    except Exception as e:
        db.rollback()
        log.warning("[techelevate-local] seed failed: %s", e)


def _seed_trainings(db: Session) -> None:
    for spec in _SEED_TRAININGS:
        if db.query(TeTraining).filter(TeTraining.title == spec["title"]).first():
            continue
        create_training(db, spec, created_by="system")


def _seed_assignments(db: Session) -> None:
    # Only seed once — if any assignment exists, assume it's done.
    if db.query(TeAssignment).first():
        return
    employees = db.query(Employee).filter(Employee.email.isnot(None)).limit(40).all()
    trainings = db.query(TeTraining).order_by(TeTraining.id).all()
    if not employees or not trainings:
        return
    today = datetime.date.today()
    # Deterministic spread: each employee gets 1-2 trainings; ~1 in 3 completed.
    for idx, emp in enumerate(employees):
        picks = [trainings[idx % len(trainings)]]
        if idx % 2 == 0:
            picks.append(trainings[(idx + 3) % len(trainings)])
        for j, t in enumerate(picks):
            a = assign_training(
                db, training_id=t.id, employee=emp,
                start_date=today - datetime.timedelta(days=30),
                due_date=today + datetime.timedelta(days=30),
                assigned_by="system",
            )
            if a is None:
                continue
            phase = (idx + j) % 3
            if phase == 0:
                # Completed + passed → drives skill write-back
                a.status = "Completed"
                a.score = 70 + ((idx * 7 + j * 3) % 26)   # 70-95
                a.attempts = 1
                a.completed_at = datetime.datetime.utcnow()
                _apply_verified_skills(db, a)
            elif phase == 1:
                a.status = "In Progress"
    db.commit()
