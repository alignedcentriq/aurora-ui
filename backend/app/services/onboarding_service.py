"""Employee onboarding journey — progress tracking + the document/induction sub-flows.

The journey *definition* is static code (services/onboarding_template.py); this service owns
the per-employee *state*: it seeds a journey for a new hire, computes progress, auto-completes
steps from real signals (an IT ticket resolved, all joining docs uploaded), records uploaded
documents + emails them to HR, and rolls everything up for the HR tracker.

Design echoes nudge_service / HRService: static methods, pure DB look-ups for detection (no
LLM), and best-effort side effects (HR email) that never block the recorded state. Manual
step completion flows through the action registry (catalog/onboarding_step.py) so it gets a
durable receipt + one-click undo like every other write.
"""

from __future__ import annotations

import base64
import datetime
import logging
import os
from typing import Optional

from app.config import settings
from app.database import SessionLocal
from app.models import (
    Employee,
    ITTicket,
    OnboardingJourney,
    OnboardingStepProgress,
    OnboardingDocSubmission,
)
from app.services import onboarding_template as tmpl

log = logging.getLogger("aurora-logger")

# Where uploaded files + (optional HR-authored) blank templates live. Mirrors main.py's
# _uploads_dir mount at /uploads, so saved files are also reachable as static URLs.
_UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads")
_DOCS_DIR = os.path.join(_UPLOADS_DIR, "onboarding_docs")
_TEMPLATES_DIR = os.path.join(_UPLOADS_DIR, "onboarding_templates")

# Default chapters used for the primary induction video.
_DEFAULT_CHAPTERS: tuple[dict, ...] = (
    {"title": "Welcome", "start": 0},
    {"title": "Who we are", "start": 45},
    {"title": "How we work", "start": 120},
    {"title": "Meet the teams", "start": 210},
    {"title": "Your first week", "start": 300},
    {"title": "Where to get help", "start": 380},
)


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


# ── New-hire detection ─────────────────────────────────────────────────────────

def is_new_hire(emp: Employee) -> bool:
    """True if the employee joined within ONBOARDING_WINDOW_DAYS (future joining dates count
    too — pre-boarding). Employees with no joining_date are treated as not-new."""
    jd = getattr(emp, "joining_date", None)
    if not jd:
        return False
    days_since = (_now().date() - jd).days
    return days_since <= settings.ONBOARDING_WINDOW_DAYS


# ── Journey lifecycle ────────────────────────────────────────────────────────────

def _seed_steps(db, journey: OnboardingJourney) -> None:
    """Create one OnboardingStepProgress row per template step that's missing (idempotent —
    safe to call again after the template grows a new step)."""
    have = {s.step_key for s in journey.steps}
    for step in tmpl.all_steps():
        if step.key not in have:
            db.add(OnboardingStepProgress(journey_id=journey.id, step_key=step.key, status="pending"))


def ensure_journey(db, emp: Employee) -> OnboardingJourney:
    """Get-or-create this employee's journey and make sure every template step is seeded."""
    journey = (
        db.query(OnboardingJourney)
        .filter(OnboardingJourney.employee_id == emp.id)
        .first()
    )
    if journey is None:
        journey = OnboardingJourney(employee_id=emp.id, status="active", started_at=_now())
        db.add(journey)
        db.flush()  # need journey.id to seed steps
    _seed_steps(db, journey)
    db.commit()
    db.refresh(journey)
    return journey


def _step_map(journey: OnboardingJourney) -> dict[str, OnboardingStepProgress]:
    return {s.step_key: s for s in journey.steps}


def _mark(row: OnboardingStepProgress, status: str, by: Optional[str] = None) -> None:
    row.status = status
    if status == "done":
        row.completed_at = _now()
        row.completed_by = by
    elif status == "pending":
        row.completed_at = None
        row.completed_by = None


# ── Auto-detectors (pure DB look-ups, no side effects) ──────────────────────────

def _it_ticket_resolved(db, journey: OnboardingJourney) -> bool:
    """The IT-setup step auto-completes once the hire has any Resolved/Closed IT ticket
    raised on/after the journey started (their setup ticket)."""
    since = journey.started_at or journey.created_at or _now()
    return (
        db.query(ITTicket)
        .filter(
            ITTicket.employee_id == journey.employee_id,
            ITTicket.status.in_(("Resolved", "Closed")),
            ITTicket.created_at >= since,
        )
        .first()
        is not None
    )


def _docs_submitted(db, journey: OnboardingJourney) -> bool:
    """The documents step auto-completes once every required doc has at least one submission."""
    submitted = {
        d.doc_key
        for d in db.query(OnboardingDocSubmission)
        .filter(OnboardingDocSubmission.journey_id == journey.id)
        .all()
    }
    return tmpl.required_doc_keys().issubset(submitted)


_AUTO_DETECTORS = {
    "it_ticket_resolved": _it_ticket_resolved,
    "docs_submitted": _docs_submitted,
}


def recompute(db, journey: OnboardingJourney) -> OnboardingJourney:
    """Run every auto-signal, flip matching not-yet-done steps to done, and set the journey
    to completed once all required steps are done. Manual steps are untouched."""
    steps = _step_map(journey)
    changed = False
    for step in tmpl.all_steps():
        if not step.auto_signal:
            continue
        row = steps.get(step.key)
        if row is None or row.status == "done":
            continue
        detector = _AUTO_DETECTORS.get(step.auto_signal)
        if detector and detector(db, journey):
            _mark(row, "done", by="system")
            changed = True

    # Journey completion: all REQUIRED steps done.
    required = tmpl.required_step_keys()
    done = {k for k, s in steps.items() if s.status in ("done", "skipped")}
    all_required_done = required.issubset(done)
    if all_required_done and journey.status != "completed":
        journey.status = "completed"
        journey.completed_at = _now()
        changed = True
    elif not all_required_done and journey.status == "completed":
        journey.status = "active"
        journey.completed_at = None
        changed = True

    if changed:
        db.commit()
        db.refresh(journey)
    return journey


# ── Manual step completion (called by the action registry) ──────────────────────

def mark_step(db, journey: OnboardingJourney, step_key: str, status: str,
              actor_email: str) -> OnboardingStepProgress:
    """Set a single step's status. Raises ValueError on an unknown step. Recomputes the
    journey afterwards so completion reflects the change."""
    if tmpl.get_step(step_key) is None:
        raise ValueError(f"Unknown onboarding step: {step_key}")
    row = (
        db.query(OnboardingStepProgress)
        .filter(OnboardingStepProgress.journey_id == journey.id,
                OnboardingStepProgress.step_key == step_key)
        .first()
    )
    if row is None:
        row = OnboardingStepProgress(journey_id=journey.id, step_key=step_key)
        db.add(row)
    _mark(row, status, by=actor_email)
    db.commit()
    db.refresh(row)
    recompute(db, journey)
    return row


# ── Documents: templates, upload, email-to-HR ────────────────────────────────────

def template_file_path(doc_key: str) -> Optional[str]:
    """Return the path to an HR-authored blank template for this doc, if one was dropped into
    uploads/onboarding_templates/ (any extension). None → the route generates a text template."""
    if not os.path.isdir(_TEMPLATES_DIR):
        return None
    for fname in os.listdir(_TEMPLATES_DIR):
        if os.path.splitext(fname)[0] == doc_key:
            return os.path.join(_TEMPLATES_DIR, fname)
    return None


def generate_text_template(doc_key: str) -> tuple[str, str]:
    """Build a simple fillable text template from the doc's declared fields. Returns
    (filename, text). Used when no HR-authored template file exists yet."""
    doc = tmpl.get_doc(doc_key)
    if doc is None:
        raise ValueError(f"Unknown document: {doc_key}")
    lines = [
        doc.name.upper(),
        "=" * len(doc.name),
        "",
        doc.description,
        "",
        "Please fill in the fields below, then upload this document.",
        "",
    ]
    if doc.fields:
        for fld in doc.fields:
            lines.append(f"{fld}: ____________________________________________")
            lines.append("")
    else:
        lines.append("(Attach the requested document — no fields to fill.)")
        lines.append("")
    lines += ["", "Signature: ____________________      Date: ______________"]
    return f"{doc_key}.txt", "\n".join(lines)


def submit_document(db, journey: OnboardingJourney, doc_key: str, content: bytes,
                    original_name: str, content_type: str, actor_email: str) -> dict:
    """Save an uploaded filled document, email it to HR (best-effort), record the submission,
    and recompute the documents step. Returns a small result dict for the route."""
    doc = tmpl.get_doc(doc_key)
    if doc is None:
        raise ValueError(f"Unknown document: {doc_key}")

    emp = db.query(Employee).filter(Employee.id == journey.employee_id).first()
    emp_email = (emp.email if emp else actor_email) or actor_email

    # 1. Persist to disk under uploads/onboarding_docs/<email>/<doc_key>__<original>.
    safe_dir = os.path.join(_DOCS_DIR, emp_email.replace("/", "_").replace("\\", "_"))
    os.makedirs(safe_dir, exist_ok=True)
    safe_name = f"{doc_key}__{os.path.basename(original_name or 'document')}"
    file_path = os.path.join(safe_dir, safe_name)
    with open(file_path, "wb") as fh:
        fh.write(content)

    # 2. Record (one row per upload; a re-upload adds a fresh row, latest wins for display).
    sub = OnboardingDocSubmission(
        journey_id=journey.id,
        doc_key=doc_key,
        file_path=file_path,
        original_name=original_name,
        status="submitted",
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    # 3. Email HR with the file attached + ring the Teams bell. Best-effort: a failure here
    #    leaves the submission recorded and visible in the HR tracker.
    emailed = _email_doc_to_hr(emp, doc, content, original_name or safe_name, content_type)
    if emailed:
        sub.status = "emailed"
        sub.emailed_to = settings.ONBOARDING_HR_EMAIL
        db.commit()

    recompute(db, journey)
    return {"id": sub.id, "doc_key": doc_key, "status": sub.status, "emailed": emailed}


def _email_doc_to_hr(emp: Optional[Employee], doc: "tmpl.OnboardingDoc", content: bytes,
                     filename: str, content_type: str) -> bool:
    """Send the filled document to HR with the file attached, and ping HR's Teams feed.
    Returns True only if the email actually went out."""
    hr_email = settings.ONBOARDING_HR_EMAIL
    if not hr_email:
        log.info("[onboarding] no ONBOARDING_HR_EMAIL/NOTIFY_TO_EMAIL set — doc saved, not emailed")
        return False

    emp_name = (emp.name if emp else None) or (emp.email if emp else "A new joiner")
    emp_email = emp.email if emp else ""
    sender = settings.PARKING_REMINDER_SENDER or emp_email or hr_email
    subject = f"Onboarding document — {doc.name} — {emp_name}"
    body = (
        f"<p><b>{emp_name}</b>{f' ({emp_email})' if emp_email else ''} has submitted an "
        f"onboarding document.</p>"
        f"<p><b>Document:</b> {doc.name}<br/>"
        f"<b>Submitted:</b> {_now().strftime('%d %b %Y %H:%M')} UTC</p>"
        f"<p>The completed file is attached.</p>"
    )
    try:
        from app.services.email_service import _send_html, notify_teams_activity
        b64 = base64.b64encode(content).decode("ascii")
        ctype = content_type or "application/octet-stream"
        ok = _send_html(sender, hr_email, subject, body, files={filename: (b64, ctype)})
        if ok:
            try:
                notify_teams_activity(sender, hr_email,
                                      f"New onboarding document from {emp_name}",
                                      f"<p>{doc.name}</p>")
            except Exception:
                pass
        return bool(ok)
    except Exception as exc:
        log.warning("[onboarding] HR email failed for doc %s: %s", doc.doc_key, exc)
        return False


# ── Read models (for routes) ─────────────────────────────────────────────────────

def _progress_pct(steps: dict[str, OnboardingStepProgress]) -> int:
    required = tmpl.required_step_keys()
    if not required:
        return 100
    done = sum(1 for k in required if steps.get(k) and steps[k].status in ("done", "skipped"))
    return round(100 * done / len(required))


def _next_step_key(steps: dict[str, OnboardingStepProgress]) -> Optional[str]:
    for step in tmpl.all_steps():
        row = steps.get(step.key)
        if row is None or row.status not in ("done", "skipped"):
            return step.key
    return None


def _doc_status_for(db, journey: OnboardingJourney) -> list[dict]:
    """Per-document submission state for this journey, in template order."""
    subs: dict[str, OnboardingDocSubmission] = {}
    for s in (db.query(OnboardingDocSubmission)
              .filter(OnboardingDocSubmission.journey_id == journey.id)
              .order_by(OnboardingDocSubmission.submitted_at.asc()).all()):
        subs[s.doc_key] = s  # keep latest (asc order → last write wins)
    out = []
    for doc in tmpl.all_docs():
        sub = subs.get(doc.doc_key)
        d = doc.to_dict()
        d.update({
            "submitted": sub is not None,
            "status": sub.status if sub else "not_started",
            "original_name": sub.original_name if sub else None,
            "submitted_at": sub.submitted_at.isoformat() if sub and sub.submitted_at else None,
            "has_template_file": template_file_path(doc.doc_key) is not None,
        })
        out.append(d)
    return out


def get_for_employee(email: str) -> Optional[dict]:
    """The new hire's full journey view: steps (definition + status), progress, next step,
    and per-document state. Returns None if the employee isn't found. Auto-creates + recomputes."""
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            return None
        journey = ensure_journey(db, emp)
        recompute(db, journey)
        steps = _step_map(journey)

        step_views = []
        for step in tmpl.all_steps():
            row = steps.get(step.key)
            view = step.to_dict()
            view.update({
                "status": row.status if row else "pending",
                "completed_at": row.completed_at.isoformat() if row and row.completed_at else None,
            })
            step_views.append(view)

        return {
            "employee_name": emp.name,
            "employee_email": emp.email,
            "is_new_hire": is_new_hire(emp),
            "status": journey.status,
            "progress_pct": _progress_pct(steps),
            "next_step": _next_step_key(steps),
            "started_at": journey.started_at.isoformat() if journey.started_at else None,
            "completed_at": journey.completed_at.isoformat() if journey.completed_at else None,
            "steps": step_views,
            "documents": _doc_status_for(db, journey),
        }
    finally:
        db.close()


def get_journey_for(email: str):
    """Return (db, employee, journey) for a write path; caller owns the db (must close).
    Returns (db, None, None) if the employee isn't found."""
    db = SessionLocal()
    emp = db.query(Employee).filter(Employee.email == email).first()
    if not emp:
        db.close()
        return None, None, None
    journey = ensure_journey(db, emp)
    return db, emp, journey


def induction_videos() -> list[dict]:
    """Return all induction videos available for new hires.

    The primary video comes from INDUCTION_VIDEO_URL / INDUCTION_VIDEO_TITLE settings.
    Additional videos can be supplied via INDUCTION_EXTRA_VIDEOS_JSON — a JSON array where
    each object has: title (str), url (str), description? (str), chapters? (list).
    """
    videos: list[dict] = []

    if settings.INDUCTION_VIDEO_URL:
        videos.append({
            "id": "primary",
            "title": settings.INDUCTION_VIDEO_TITLE or "Welcome to the team",
            "description": "Company-wide welcome and orientation for all new joiners.",
            "url": settings.INDUCTION_VIDEO_URL,
            "chapters": [dict(c) for c in _DEFAULT_CHAPTERS],
        })

    extras_raw = getattr(settings, "INDUCTION_EXTRA_VIDEOS_JSON", "") or ""
    if extras_raw:
        import json as _json
        try:
            for v in _json.loads(extras_raw):
                if v.get("url") and v.get("title"):
                    videos.append({
                        "id": v.get("id", v["title"].lower().replace(" ", "_")),
                        "title": v["title"],
                        "description": v.get("description", ""),
                        "url": v["url"],
                        "chapters": v.get("chapters", []),
                    })
        except Exception:
            pass

    return videos


# ── HR roll-up ───────────────────────────────────────────────────────────────────

def overview() -> dict:
    """Every active/recent new-hire journey for the HR tracker, plus simple summary counts."""
    db = SessionLocal()
    try:
        journeys = (
            db.query(OnboardingJourney, Employee)
            .join(Employee, OnboardingJourney.employee_id == Employee.id)
            .order_by(OnboardingJourney.started_at.desc())
            .all()
        )
        stall_cutoff = _now() - datetime.timedelta(days=settings.ONBOARDING_STALL_DAYS)
        rows = []
        completed = 0
        for journey, emp in journeys:
            steps = _step_map(journey)
            pct = _progress_pct(steps)
            if journey.status == "completed":
                completed += 1
            # Stalled = active, not complete, and nothing happened recently.
            last_activity = max(
                [s.updated_at or s.created_at for s in journey.steps] + [journey.started_at or journey.created_at],
                default=journey.created_at,
            )
            stalled = (journey.status == "active" and pct < 100
                       and last_activity is not None and last_activity < stall_cutoff)
            docs_submitted = (
                db.query(OnboardingDocSubmission.doc_key)
                .filter(OnboardingDocSubmission.journey_id == journey.id)
                .distinct().count()
            )
            rows.append({
                "employee_name": emp.name,
                "employee_email": emp.email,
                "department": emp.department,
                "designation": emp.designation,
                "joining_date": emp.joining_date.isoformat() if emp.joining_date else None,
                "status": journey.status,
                "progress_pct": pct,
                "next_step": _next_step_key(steps),
                "docs_submitted": docs_submitted,
                "docs_required": len(tmpl.required_doc_keys()),
                "stalled": stalled,
                "started_at": journey.started_at.isoformat() if journey.started_at else None,
            })
        return {
            "total": len(rows),
            "completed": completed,
            "active": len(rows) - completed,
            "stalled": sum(1 for r in rows if r["stalled"]),
            "journeys": rows,
        }
    finally:
        db.close()
