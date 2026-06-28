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
    TeContentItem,
    TeGroup,
    TeMcqQuestion,
    TeTraining,
    TeTrainingLevel,
)

log = logging.getLogger("aurora-logger")

CONTENT_KINDS = {"document", "link", "udemy", "video"}


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

def _content_dict(c: TeContentItem) -> dict:
    return {
        "id": c.id,
        "training_id": c.training_id,
        "level_id": c.level_id,
        "kind": c.kind,
        "title": c.title,
        "url": c.url,
        "description": c.description,
        "file_name": c.file_name,
        "sort_order": c.sort_order,
    }


def _training_dict(t: TeTraining, *, with_questions: bool = False,
                   with_content: bool = False) -> dict:
    content = sorted(t.content_items, key=lambda c: (c.level_id or 0, c.sort_order, c.id))
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
        "content_count": len(content),
        "levels": [
            {"id": lv.id, "name": lv.name, "sort_order": lv.sort_order,
             "duration_minutes": lv.duration_minutes, "pass_percentage": lv.pass_percentage,
             "description": lv.description,
             "content": [_content_dict(c) for c in content if c.level_id == lv.id]}
            for lv in t.levels
        ],
        "created_by": t.created_by,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
    if with_content:
        # Course-level materials (single-level courses, or materials not tied to a level).
        out["content"] = [_content_dict(c) for c in content if c.level_id is None]
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
        # Tells the learner UI whether there's an assessment ready to take.
        "has_questions": len(a.training.questions) > 0 if a.training else False,
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
    return _training_dict(t, with_questions=with_questions, with_content=True) if t else None


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
    # Map a level's position in the incoming list → its new DB id, so content/questions
    # that reference a level by index (the client doesn't know ids yet) can be linked.
    level_ids: list[int] = []
    for i, lv in enumerate(levels):
        row = TeTrainingLevel(
            training_id=t.id, name=lv.get("name") or f"Level {i + 1}", sort_order=i,
            duration_minutes=int(lv.get("duration_minutes") or 0),
            pass_percentage=float(lv.get("pass_percentage") or 60),
            description=lv.get("description"),
        )
        db.add(row)
        db.flush()
        level_ids.append(row.id)
        # A level may carry its own materials inline.
        for j, c in enumerate(lv.get("content") or []):
            _add_content_row(db, training_id=t.id, level_id=row.id, data=c, sort_order=j)
    # Course-level content (single-level courses, or materials with an explicit level_index).
    for j, c in enumerate(data.get("content") or []):
        li = c.get("level_index")
        level_id = level_ids[li] if isinstance(li, int) and 0 <= li < len(level_ids) else None
        _add_content_row(db, training_id=t.id, level_id=level_id, data=c, sort_order=j)
    for q in questions:
        li = q.get("level_index")
        level_id = level_ids[li] if isinstance(li, int) and 0 <= li < len(level_ids) else q.get("level_id")
        db.add(TeMcqQuestion(
            training_id=t.id, level_id=level_id,
            question=q["question"], options=q.get("options") or {},
            correct_answer=(q.get("correct_answer") or "").strip().upper() or None,
            marks=int(q.get("marks") or 1), explanation=q.get("explanation"),
        ))
    db.commit()
    db.refresh(t)
    return _training_dict(t, with_questions=True, with_content=True)


def _add_content_row(db: Session, *, training_id: int, level_id: Optional[int],
                     data: dict, sort_order: int = 0) -> Optional[TeContentItem]:
    """Insert one content item. Skips empties; coerces unknown kinds to 'link'."""
    title = (data.get("title") or "").strip()
    url = (data.get("url") or "").strip() or None
    if not title and not url:
        return None
    kind = (data.get("kind") or "link").strip().lower()
    if kind not in CONTENT_KINDS:
        kind = "link"
    row = TeContentItem(
        training_id=training_id, level_id=level_id, kind=kind,
        title=title or url or "Untitled", url=url,
        description=(data.get("description") or "").strip() or None,
        file_name=(data.get("file_name") or "").strip() or None,
        sort_order=int(data.get("sort_order") if data.get("sort_order") is not None else sort_order),
    )
    db.add(row)
    return row


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
    EmployeeSkills. Idempotent (guarded by `skills_applied`; never duplicates a skill).

    ARB #52 — learning flywheel: after writing verified skills, emits a SkillGapSignal
    to the InsightBus so Resource Finder and Skill Supply are immediately aware that
    this person now has the skill. The signal is best-effort and never blocks the commit.
    """
    if a.skills_applied or not a.training or not a.employee_id:
        return []
    tags = a.training.skill_tags or []
    if not tags:
        a.skills_applied = True
        return []

    # Resolve employee email for the InsightBus signal (best-effort)
    from app.models import Employee
    emp = db.query(Employee).filter(Employee.id == a.employee_id).first()
    emp_email = getattr(emp, "email", None) or ""

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
        # ARB #52 flywheel: emit signals so downstream (Resource Finder, Skill Supply, manager)
        # can react to newly verified skills without polling.
        _emit_verified_skill_signals(added, emp_email, a.training.title)
    return added


def _emit_verified_skill_signals(skills: list[str], emp_email: str, course_title: str) -> None:
    """Emit SkillGapSignal(s) to the InsightBus after a skill is verified.

    Each newly verified skill may close a known gap — the bus's skill_gap_to_training
    reactor will surface a nudge to relevant managers.  Best-effort; never raises.
    """
    try:
        from app.services.insight_bus import InsightBus, SkillGapSignal
        for skill in skills:
            # gap_count=-1 signals a gap CLOSURE (one more person now has the skill).
            # Reactors can check gap_count < 0 to differentiate closure from gap signals.
            sig = SkillGapSignal(
                skill=skill,
                gap_count=-1,   # negative = gap closure
                recommended_action="verified",
                candidate_emails=[emp_email] if emp_email else [],
                context={
                    "course_title": course_title,
                    "event": "skill_verified",
                    "emp_email": emp_email,
                },
            )
            InsightBus.emit(sig)
    except Exception:
        log.debug("[techelevate-local] InsightBus emit failed (non-fatal)")


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


def bulk_add_questions(db: Session, training_id: int, items: list[dict],
                       *, level_id: Optional[int] = None) -> list[dict]:
    """Persist a reviewed batch of MCQs (e.g. AI-drafted then edited). Returns the saved rows."""
    t = db.get(TeTraining, training_id)
    if not t:
        return []
    saved: list[dict] = []
    for it in items or []:
        question = (it.get("question") or "").strip()
        options = it.get("options") or {}
        if not question or not isinstance(options, dict) or len(options) < 2:
            continue
        correct = (it.get("correct_answer") or "").strip().upper() or None
        if correct and correct not in options:
            correct = None
        q = TeMcqQuestion(
            training_id=training_id, level_id=it.get("level_id", level_id),
            question=question, options=options, correct_answer=correct,
            marks=int(it.get("marks") or 1), explanation=(it.get("explanation") or "").strip() or None,
        )
        db.add(q)
        db.flush()
        saved.append(_question_dict(q, reveal=True))
    db.commit()
    return saved


# ── Learning content (materials) CRUD ─────────────────────────────────────────

def list_content(db: Session, training_id: int) -> list[dict]:
    rows = (db.query(TeContentItem)
            .filter(TeContentItem.training_id == training_id)
            .order_by(TeContentItem.level_id, TeContentItem.sort_order, TeContentItem.id)
            .all())
    return [_content_dict(c) for c in rows]


def add_content(db: Session, training_id: int, data: dict) -> Optional[dict]:
    t = db.get(TeTraining, training_id)
    if not t:
        return None
    row = _add_content_row(db, training_id=training_id, level_id=data.get("level_id"),
                           data=data, sort_order=int(data.get("sort_order") or 0))
    if row is None:
        return None
    db.commit()
    db.refresh(row)
    return _content_dict(row)


def delete_content(db: Session, content_id: int) -> bool:
    c = db.get(TeContentItem, content_id)
    if not c:
        return False
    db.delete(c)
    db.commit()
    return True


# ── AI MCQ drafting (grounded in the course's materials) ──────────────────────

def extract_document_text(path: str, *, max_chars: int = 6000) -> str:
    """Best-effort plain-text extraction from an uploaded document (PDF / DOCX / TXT) so the
    AI can ground questions in its actual content. Returns '' on any failure — never raises."""
    import os
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    try:
        if ext == "pdf":
            import pdfplumber
            parts: list[str] = []
            with pdfplumber.open(path) as pdf:
                for page in pdf.pages:
                    parts.append(page.extract_text() or "")
                    if sum(len(p) for p in parts) >= max_chars:
                        break
            return "\n".join(parts)[:max_chars]
        if ext in ("docx", "doc"):
            import docx
            doc = docx.Document(path)
            return "\n".join(p.text for p in doc.paragraphs)[:max_chars]
        if ext in ("txt", "md", "csv"):
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                return fh.read(max_chars)
    except Exception as e:
        log.debug("[techelevate-local] doc extract failed for %s: %s", path, e)
    return ""


def _content_grounding(db: Session, training_id: int, level_id: Optional[int]) -> str:
    """Assemble a compact study-context string from a course's materials (titles, descriptions,
    Udemy/video references, and extracted document text) to ground the MCQ generator."""
    import os
    rows = db.query(TeContentItem).filter(TeContentItem.training_id == training_id)
    if level_id is not None:
        rows = rows.filter(TeContentItem.level_id == level_id)
    parts: list[str] = []
    uploads_root = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")
    for c in rows.order_by(TeContentItem.sort_order, TeContentItem.id).all():
        label = {"udemy": "Udemy course/video", "video": "Video",
                 "document": "Document", "link": "Resource"}.get(c.kind, "Resource")
        line = f"- [{label}] {c.title}"
        if c.description:
            line += f": {c.description}"
        parts.append(line)
        # Pull text out of uploaded documents living under /uploads.
        if c.kind == "document" and c.url and c.url.startswith("/uploads/"):
            fpath = os.path.join(uploads_root, c.url[len("/uploads/"):])
            text = extract_document_text(fpath)
            if text.strip():
                parts.append(f"  Content excerpt:\n{text.strip()[:3000]}")
    return "\n".join(parts)[:8000]


def generate_questions(db: Session, training_id: int, *, level_id: Optional[int] = None,
                       count: int = 5, difficulty: str = "mixed") -> dict:
    """AI-draft MCQs grounded in the course's materials. Returns DRAFTS only (not persisted);
    an admin reviews/edits them and saves via bulk_add_questions. The actual exam is sat on the
    real TechElevate portal — this is purely the authoring aid."""
    from app.services import llm_controls_service as llm_controls
    from app.services.llm_json import invoke_json

    t = db.get(TeTraining, training_id)
    if not t:
        return {"error": "training_not_found"}

    count = max(1, min(int(count or 5), 15))
    level_name = ""
    if level_id is not None:
        lv = db.get(TeTrainingLevel, level_id)
        level_name = lv.name if lv else ""

    grounding = _content_grounding(db, training_id, level_id)
    skills = ", ".join(t.skill_tags or []) or "the course topic"
    scope = f'"{t.title}"' + (f" — {level_name} level" if level_name else "")

    materials_block = (
        f"Base the questions on these course materials:\n{grounding}\n\n"
        if grounding.strip()
        else "No materials were provided, so base the questions on the course title and skills below.\n\n"
    )

    prompt = (
        "You are an assessment author for a corporate technical-training portal. Write "
        f"{count} multiple-choice questions to test mastery of {scope}.\n\n"
        f"Target skills: {skills}.\n"
        f"Difficulty: {difficulty}.\n\n"
        f"{materials_block}"
        "Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:\n"
        '{"questions": [{"question": "…", "options": {"A": "…", "B": "…", "C": "…", "D": "…"}, '
        '"correct_answer": "A", "marks": 1, "explanation": "one sentence why it is correct"}]}\n\n'
        "Rules:\n"
        "- Exactly 4 options (A, B, C, D) per question; exactly one is correct.\n"
        "- Questions must be answerable from the materials/topic above — no trick or trivia questions.\n"
        "- Vary the correct letter across questions. Keep options plausible and roughly equal length.\n"
        f"- Produce exactly {count} questions."
    )

    model = llm_controls.get_llm("general", default_timeout=90)
    draft = invoke_json(model, prompt, attempts=2)
    if not draft or not isinstance(draft.get("questions"), list):
        return {"error": "generation_failed"}

    cleaned = _sanitize_generated_questions(draft["questions"], level_id=level_id)
    if not cleaned:
        return {"error": "generation_failed"}
    return {"questions": cleaned, "grounded": bool(grounding.strip()),
            "training_id": training_id, "level_id": level_id}


def _sanitize_generated_questions(raw: list, *, level_id: Optional[int] = None) -> list[dict]:
    """Coerce LLM-drafted questions into the strict MCQ shape, dropping anything unusable."""
    out: list[dict] = []
    for q in raw:
        if not isinstance(q, dict):
            continue
        question = str(q.get("question") or "").strip()
        opts_raw = q.get("options") or {}
        if not question or not isinstance(opts_raw, dict):
            continue
        options: dict[str, str] = {}
        for key in ("A", "B", "C", "D"):
            val = str(opts_raw.get(key) or opts_raw.get(key.lower()) or "").strip()
            if val:
                options[key] = val
        if len(options) < 2:
            continue
        correct = str(q.get("correct_answer") or "").strip().upper()[:1]
        if correct not in options:
            correct = next(iter(options))
        out.append({
            "question": question,
            "options": options,
            "correct_answer": correct,
            "marks": int(q.get("marks") or 1) if str(q.get("marks") or "1").isdigit() else 1,
            "explanation": str(q.get("explanation") or "").strip() or None,
            "level_id": level_id,
        })
    return out


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
        # Promote the spec's intro video into a real course material so seeded courses
        # ship with curriculum (not just an empty catalog card).
        spec = dict(spec)
        if spec.get("video_link") and not spec.get("content"):
            item = {"kind": "video", "title": f"{spec['title']} — intro video",
                    "url": spec["video_link"]}
            # Multi-level courses surface materials per level, so pin the intro to level 1.
            if spec.get("levels"):
                item["level_index"] = 0
            spec["content"] = [item]
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
