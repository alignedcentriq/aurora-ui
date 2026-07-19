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
import re
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


# ── Document catalog (built-in docs + HR-managed custom sections/overrides) ───────
# The built-in checklist lives in onboarding_template (code). HR can add new sections,
# hide/soft-remove any doc, edit fields, and toggle "required" via OnboardingDocSection
# rows, which are merged over the built-ins here so the whole app sees one catalog.

def _merged_docs_list() -> list:
    """Return the effective ordered doc list = built-ins overridden/extended by DB sections,
    with soft-removed (is_active=False) docs dropped. Items are tmpl.OnboardingDoc instances."""
    from app.models import OnboardingDocSection

    order: list[str] = []
    by_key: dict[str, tmpl.OnboardingDoc] = {}
    sort_hint: dict[str, int] = {}
    for i, d in enumerate(tmpl.ONBOARDING_DOCS):
        by_key[d.doc_key] = d
        sort_hint[d.doc_key] = i
        order.append(d.doc_key)

    db = SessionLocal()
    try:
        rows = db.query(OnboardingDocSection).all()
    finally:
        db.close()

    hidden: set[str] = set()
    for r in rows:
        if not r.is_active:
            hidden.add(r.doc_key)
            continue
        by_key[r.doc_key] = tmpl.OnboardingDoc(
            doc_key=r.doc_key,
            name=r.name,
            description=r.description or "",
            fields=tuple(r.fields or ()),
            required=bool(r.required),
        )
        sort_hint[r.doc_key] = r.sort_order if r.sort_order is not None else 100
        if r.doc_key not in order:
            order.append(r.doc_key)

    keys = [k for k in order if k not in hidden]
    keys.sort(key=lambda k: (sort_hint.get(k, 100), k))
    return [by_key[k] for k in keys]


def all_docs() -> tuple:
    """Effective onboarding documents (built-in + HR customizations), in display order."""
    return tuple(_merged_docs_list())


def get_doc(doc_key: str):
    """Effective doc definition for a key (built-in or HR-managed), or None if unknown/hidden."""
    for d in _merged_docs_list():
        if d.doc_key == doc_key:
            return d
    return None


def required_doc_keys() -> set:
    """doc_keys of every effective required document."""
    return {d.doc_key for d in _merged_docs_list() if d.required}


# ── Step catalog (built-in journey + HR-managed custom steps/overrides) ───────────
# The built-in journey lives in onboarding_template (code). HR can add new steps, retitle/
# reorder/hide any step, and toggle "required" via OnboardingStepOverride rows, merged over
# the built-ins here so the whole app (journey view, progress, next-step) sees one sequence.

def _merged_steps_list() -> list:
    """Effective ordered step list = built-ins overridden/extended by DB rows, with
    soft-removed (is_active=False) steps dropped. Items are tmpl.OnboardingStep instances."""
    from app.models import OnboardingStepOverride

    order: list[str] = []
    by_key: dict[str, tmpl.OnboardingStep] = {}
    sort_hint: dict[str, int] = {}
    for i, s in enumerate(tmpl.STEPS):
        by_key[s.key] = s
        sort_hint[s.key] = s.order if s.order is not None else i
        order.append(s.key)

    db = SessionLocal()
    try:
        rows = db.query(OnboardingStepOverride).all()
    finally:
        db.close()

    hidden: set[str] = set()
    for r in rows:
        if not r.is_active:
            hidden.add(r.step_key)
            continue
        base = by_key.get(r.step_key)
        # Built-in kind/auto behavior is preserved (documents/video sub-flows can't be
        # retargeted); custom steps are manual/deeplink and never auto-complete.
        kind = base.kind if base else (r.kind or "manual")
        auto_signal = base.auto_signal if base else None
        sort_val = r.sort_order if r.sort_order is not None else (base.order if base else 100)
        by_key[r.step_key] = tmpl.OnboardingStep(
            key=r.step_key,
            title=(r.title if r.title is not None else (base.title if base else r.step_key)),
            description=(r.description if r.description is not None
                        else (base.description if base else "")) or "",
            category=(r.category if r.category is not None
                      else (base.category if base else "General")) or "General",
            order=sort_val,
            kind=kind,
            cta_label=(r.cta_label if r.cta_label is not None
                       else (base.cta_label if base else "Mark done")) or "Mark done",
            action_payload=(r.action_payload if r.action_payload is not None
                            else (dict(base.action_payload) if base else {})) or {},
            auto_signal=auto_signal,
            required=bool(r.required) if r.required is not None else (base.required if base else True),
        )
        sort_hint[r.step_key] = sort_val
        if r.step_key not in order:
            order.append(r.step_key)

    keys = [k for k in order if k not in hidden]
    keys.sort(key=lambda k: (sort_hint.get(k, 100), k))
    return [by_key[k] for k in keys]


def all_steps() -> tuple:
    """Effective onboarding steps (built-in + HR customizations), in display order."""
    return tuple(_merged_steps_list())


def get_step(step_key: str):
    """Effective step definition for a key (built-in or HR-managed), or None if unknown/hidden."""
    for s in _merged_steps_list():
        if s.key == step_key:
            return s
    return None


def required_step_keys() -> set:
    """keys of every effective required step."""
    return {s.key for s in _merged_steps_list() if s.required}


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
    for step in all_steps():
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
    return required_doc_keys().issubset(submitted)


_AUTO_DETECTORS = {
    "it_ticket_resolved": _it_ticket_resolved,
    "docs_submitted": _docs_submitted,
}


def recompute(db, journey: OnboardingJourney) -> OnboardingJourney:
    """Run every auto-signal, flip matching not-yet-done steps to done, and set the journey
    to completed once all required steps are done. Manual steps are untouched."""
    steps = _step_map(journey)
    changed = False
    for step in all_steps():
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
    required = required_step_keys()
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
    if get_step(step_key) is None:
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
    doc = get_doc(doc_key)
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


def render_filled_pdf(doc_key: str, field_values: dict, filled_by: str = "",
                      signature: str | None = None) -> bytes:
    """Render an in-app-filled document to a PDF from the doc's *declared* fields and the
    values the new hire typed. This is NOT extracted from any uploaded file — the fields come
    from the onboarding_template definition, so we always know the exact labels to render.

    `signature`, if given, is a PNG data URL (data:image/png;base64,...) drawn/typed in the
    app; it's embedded as the digital signature image at the bottom of the document."""
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image

    doc = get_doc(doc_key)
    if doc is None:
        raise ValueError(f"Unknown document: {doc_key}")

    buf = BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=A4, topMargin=22 * mm, bottomMargin=18 * mm,
                            leftMargin=20 * mm, rightMargin=20 * mm, title=doc.name)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("t", parent=styles["Title"], fontSize=18, spaceAfter=4)
    desc_style = ParagraphStyle("d", parent=styles["Normal"], fontSize=9.5,
                                textColor=colors.HexColor("#64748b"), spaceAfter=12)
    label_style = ParagraphStyle("l", parent=styles["Normal"], fontSize=9,
                                 textColor=colors.HexColor("#475569"))
    value_style = ParagraphStyle("v", parent=styles["Normal"], fontSize=11,
                                 textColor=colors.HexColor("#0f172a"))
    note_style = ParagraphStyle("n", parent=styles["Normal"], fontSize=8,
                                textColor=colors.HexColor("#94a3b8"), spaceBefore=16)

    story = [Paragraph(doc.name, title_style)]
    if doc.description:
        story.append(Paragraph(doc.description, desc_style))

    rows = []
    for fld in (doc.fields or ()):
        val = str(field_values.get(fld, "") or "").strip() or "—"
        rows.append([Paragraph(fld, label_style), Paragraph(val, value_style)])
    if rows:
        table = Table(rows, colWidths=[62 * mm, 100 * mm])
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.append(table)
    else:
        story.append(Paragraph("(No fields — this document is an attachment only.)", desc_style))

    # Digital signature block (drawn or typed in-app), embedded as an image.
    sig_bytes = _decode_data_url_png(signature)
    story.append(Spacer(1, 12 * mm))
    if sig_bytes:
        story.append(Paragraph("Signature", label_style))
        try:
            img = Image(BytesIO(sig_bytes))
            # Scale to a sensible signature size while preserving aspect ratio.
            max_w, max_h = 60 * mm, 22 * mm
            iw, ih = img.imageWidth, img.imageHeight
            scale = min(max_w / iw, max_h / ih) if iw and ih else 1
            img.drawWidth, img.drawHeight = iw * scale, ih * scale
            story.append(img)
        except Exception:
            pass

    stamp = datetime.datetime.now().strftime("%d %b %Y, %I:%M %p")
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(
        f"Digitally completed{' and signed' if sig_bytes else ''} in Centriq by "
        f"{filled_by or 'the new hire'} on {stamp}.", note_style))

    pdf.build(story)
    return buf.getvalue()


def _decode_data_url_png(data_url: str | None) -> bytes | None:
    """Decode a 'data:image/...;base64,XXXX' data URL to raw bytes. Returns None if absent/bad."""
    if not data_url or not isinstance(data_url, str) or "," not in data_url:
        return None
    try:
        return base64.b64decode(data_url.split(",", 1)[1])
    except Exception:
        return None


# ── Mail-merge into an HR-authored Word/Excel template ────────────────────────────
# If HR drops a real `.docx`/`.xlsx` template into uploads/onboarding_templates/<doc_key>.*,
# the new hire's typed values (and signature) are merged straight into THAT file — the same
# `{{ placeholder }}` convention already used for the SharePoint letter templates (see
# document_generation/template_engine.py), so the exact letterhead/layout HR authored is what
# reaches HR and what the employee sees, not a generic reportlab layout.
#
# Placeholder names: each declared field label is snake_cased, e.g. "Full name" -> {{ full_name }},
# "IFSC / SWIFT code" -> {{ ifsc_swift_code }}. The digital signature (drawn/typed/uploaded in
# the app) fills a reserved `{{ signature_image }}` placeholder as an embedded image. A few
# auto-filled vars are always available too: {{ employee_name }}, {{ today_date }},
# {{ company_name }}. Templates with no matching placeholders (or no template at all) fall back
# to the original app-generated PDF below.

def _placeholder_key(label: str) -> str:
    """Snake-case a field label into its `{{ }}` placeholder name."""
    return re.sub(r"[^a-zA-Z0-9]+", "_", (label or "").strip().lower()).strip("_")


def _merge_context(doc: "tmpl.OnboardingDoc", field_values: dict, auto_ctx: dict) -> dict:
    ctx = dict(auto_ctx)
    for fld in (doc.fields or ()):
        ctx[_placeholder_key(fld)] = str((field_values or {}).get(fld, "") or "")
    return ctx


def render_filled_docx(template_bytes: bytes, doc: "tmpl.OnboardingDoc", field_values: dict,
                       signature: str | None, auto_ctx: dict) -> bytes:
    """Mail-merge field values (+ signature image) into an HR-authored .docx template."""
    from io import BytesIO
    from docx.shared import Mm
    from docxtpl import DocxTemplate, InlineImage
    from jinja2 import Environment

    tpl = DocxTemplate(BytesIO(template_bytes))
    ctx = _merge_context(doc, field_values, auto_ctx)
    sig_bytes = _decode_data_url_png(signature)
    ctx["signature_image"] = InlineImage(tpl, BytesIO(sig_bytes), height=Mm(16)) if sig_bytes else ""

    env = Environment()
    env.undefined = type("_Blank", (env.undefined,), {"__str__": lambda self: "", "__html__": lambda self: ""})
    tpl.render(ctx, jinja_env=env)
    out = BytesIO()
    tpl.save(out)
    return out.getvalue()


def render_filled_xlsx(template_bytes: bytes, doc: "tmpl.OnboardingDoc", field_values: dict,
                       signature: str | None, auto_ctx: dict) -> bytes:
    """Mail-merge field values (+ signature image) into an HR-authored .xlsx template. Scans
    every cell for `{{ name }}` tokens and substitutes them; a cell that is exactly
    `{{ signature_image }}` is cleared and gets the signature picture anchored over it."""
    from io import BytesIO
    from openpyxl import load_workbook
    from openpyxl.drawing.image import Image as XLImage

    wb = load_workbook(BytesIO(template_bytes))
    ctx = _merge_context(doc, field_values, auto_ctx)
    sig_bytes = _decode_data_url_png(signature)
    token_re = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")

    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if not isinstance(cell.value, str) or "{{" not in cell.value:
                    continue
                if cell.value.strip().replace(" ", "") == "{{signature_image}}":
                    cell.value = None
                    if sig_bytes:
                        try:
                            img = XLImage(BytesIO(sig_bytes))
                            img.width, img.height = 160, 55
                            ws.add_image(img, cell.coordinate)
                        except Exception:
                            log.warning("[onboarding] couldn't embed signature image in xlsx template")
                    continue
                cell.value = token_re.sub(lambda m: ctx.get(m.group(1), ""), cell.value)

    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def fill_document(db, journey: OnboardingJourney, doc_key: str, field_values: dict,
                  actor_email: str, signature: str | None = None) -> dict:
    """New hire fills a document *in the app*. If HR authored a real .docx/.xlsx template for
    this doc, mail-merge the values (+ signature) straight into it, preserving HR's layout;
    otherwise fall back to rendering a generic PDF from the declared fields. Either way the
    result goes through the normal submission flow (save + email + record)."""
    doc = get_doc(doc_key)
    if doc is None:
        raise ValueError(f"Unknown document: {doc_key}")

    template_path = template_file_path(doc_key)
    ext = os.path.splitext(template_path)[1].lower() if template_path else ""

    emp = db.query(Employee).filter(Employee.id == journey.employee_id).first()
    auto_ctx = {
        "employee_name": (emp.name if emp else "") or actor_email,
        "today_date": _now().strftime("%d %b %Y"),
        "company_name": settings.DOC_COMPANY_NAME,
    }

    if ext == ".docx":
        with open(template_path, "rb") as fh:
            template_bytes = fh.read()
        out_bytes = render_filled_docx(template_bytes, doc, field_values or {}, signature, auto_ctx)
        original_name = f"{doc_key}_filled.docx"
        content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif ext == ".xlsx":
        with open(template_path, "rb") as fh:
            template_bytes = fh.read()
        out_bytes = render_filled_xlsx(template_bytes, doc, field_values or {}, signature, auto_ctx)
        original_name = f"{doc_key}_filled.xlsx"
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        out_bytes = render_filled_pdf(doc_key, field_values or {}, filled_by=actor_email,
                                      signature=signature)
        original_name = f"{doc_key}_filled.pdf"
        content_type = "application/pdf"

    return submit_document(
        db, journey, doc_key, out_bytes,
        original_name=original_name,
        content_type=content_type,
        actor_email=actor_email,
    )


def submit_document(db, journey: OnboardingJourney, doc_key: str, content: bytes,
                    original_name: str, content_type: str, actor_email: str) -> dict:
    """Save an uploaded filled document, email it to HR (best-effort), record the submission,
    and recompute the documents step. Returns a small result dict for the route."""
    doc = get_doc(doc_key)
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
    sub.attempt_count = (sub.attempt_count or 0) + 1
    sub.last_attempt_at = _now()
    if emailed:
        sub.status = "emailed"
        sub.emailed_to = settings.ONBOARDING_HR_EMAIL
    else:
        # Distinct from "submitted" — this was actually attempted and failed, so it's
        # surfaced to HR (with a resend action) instead of looking identical to "not
        # processed yet".
        sub.status = "failed"
    db.commit()

    recompute(db, journey)
    return {"id": sub.id, "doc_key": doc_key, "status": sub.status, "emailed": emailed}


def resend_doc_submission(submission_id: int) -> dict:
    """HR-triggered manual resend of a failed (or stuck) document-to-HR email.
    Re-reads the saved file from disk and retries _email_doc_to_hr."""
    db = SessionLocal()
    try:
        sub = db.query(OnboardingDocSubmission).filter(OnboardingDocSubmission.id == submission_id).first()
        if not sub:
            return {"ok": False, "error": "Submission not found."}

        doc = get_doc(sub.doc_key)
        if doc is None:
            return {"ok": False, "error": f"Unknown document type: {sub.doc_key}."}

        if not os.path.exists(sub.file_path):
            return {"ok": False, "error": "The uploaded file is no longer available on disk."}

        journey = db.query(OnboardingJourney).filter(OnboardingJourney.id == sub.journey_id).first()
        emp = db.query(Employee).filter(Employee.id == journey.employee_id).first() if journey else None

        with open(sub.file_path, "rb") as fh:
            content = fh.read()

        content_type = _guess_content_type(sub.file_path)
        emailed = _email_doc_to_hr(emp, doc, content, sub.original_name or os.path.basename(sub.file_path), content_type)

        sub.attempt_count = (sub.attempt_count or 0) + 1
        sub.last_attempt_at = _now()
        sub.status = "emailed" if emailed else "failed"
        if emailed:
            sub.emailed_to = settings.ONBOARDING_HR_EMAIL
        db.commit()

        return {"ok": emailed, "status": sub.status}
    finally:
        db.close()


def _guess_content_type(file_path: str) -> str:
    import mimetypes
    ctype, _ = mimetypes.guess_type(file_path)
    return ctype or "application/octet-stream"


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
    required = required_step_keys()
    if not required:
        return 100
    done = sum(1 for k in required if steps.get(k) and steps[k].status in ("done", "skipped"))
    return round(100 * done / len(required))


def _next_step_key(steps: dict[str, OnboardingStepProgress]) -> Optional[str]:
    for step in all_steps():
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
    for doc in all_docs():
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


def latest_submission(db, journey: OnboardingJourney, doc_key: str) -> Optional[OnboardingDocSubmission]:
    """The new hire's most recent submission row for a document (the exact file that was saved
    + emailed to HR), or None if they haven't submitted it yet."""
    return (
        db.query(OnboardingDocSubmission)
        .filter(OnboardingDocSubmission.journey_id == journey.id,
                OnboardingDocSubmission.doc_key == doc_key)
        .order_by(OnboardingDocSubmission.submitted_at.desc())
        .first()
    )


def get_for_employee(email: str) -> Optional[dict]:
    """The new hire's full journey view: steps (definition + status), progress, next step,
    and per-document state. Returns None if the employee isn't found. Auto-creates + recomputes."""
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            # Auto-create for demo/onboarding purposes if missing
            import uuid
            emp = Employee(
                employee_id=f"AA-{uuid.uuid4().hex[:6].upper()}",
                name=email.split("@")[0].replace(".", " ").title(),
                email=email,
                role="Employee",
                joining_date=_now().date(),
                department="IT",
                designation="Associate",
                location="Pune",
                employment_type="Full-time",
                pf_number="PF-123",
                insurance_plan="Standard",
                tax_regime="New",
                shift_type="Day",
            )
            db.add(emp)
            db.commit()
            db.refresh(emp)
            
        journey = ensure_journey(db, emp)
        recompute(db, journey)
        steps = _step_map(journey)

        step_views = []
        for step in all_steps():
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
            "assigned_device": journey.assigned_device,
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
        # Auto-create for demo/onboarding purposes if missing
        import uuid
        emp = Employee(
            employee_id=f"AA-{uuid.uuid4().hex[:6].upper()}",
            name=email.split("@")[0].replace(".", " ").title(),
            email=email,
            role="Employee",
            joining_date=_now().date(),
            department="IT",
            designation="Associate",
            location="Pune",
            employment_type="Full-time",
            pf_number="PF-123",
            insurance_plan="Standard",
            tax_regime="New",
            shift_type="Day",
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
        
    journey = ensure_journey(db, emp)
    return db, emp, journey


def _env_induction_videos() -> list[dict]:
    """Legacy env-var induction videos (INDUCTION_VIDEO_URL / INDUCTION_EXTRA_VIDEOS_JSON).
    Used only as a fallback when no admin-managed rows exist in the DB, for back-compat."""
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


def induction_videos() -> list[dict]:
    """Return all induction videos available for new hires.

    Primary source is the admin-managed InductionVideo table (Control Hub). If that table
    is empty, falls back to the legacy INDUCTION_VIDEO_URL / INDUCTION_EXTRA_VIDEOS_JSON
    env vars so existing deployments keep working until an admin adds the first video.
    """
    from app.models import InductionVideo

    db = SessionLocal()
    try:
        rows = (
            db.query(InductionVideo)
            .filter(InductionVideo.is_active == True)  # noqa: E712
            .order_by(InductionVideo.sort_order, InductionVideo.id)
            .all()
        )
        if rows:
            return [_serialize_video(v) for v in rows]
    finally:
        db.close()

    return _env_induction_videos()


def _serialize_video(v) -> dict:
    """Shape one InductionVideo row for both the new-hire player and the admin table."""
    return {
        "id": str(v.id),
        "title": v.title,
        "description": v.description or "",
        "url": v.url,
        "chapters": v.chapters or [],
        "uploaded_filename": v.uploaded_filename,
        "sort_order": v.sort_order or 0,
        "is_active": bool(v.is_active),
    }


# ── Induction video admin (Control Hub) ──────────────────────────────────────────

_INDUCTION_DIR = os.path.join(_UPLOADS_DIR, "induction")


def list_induction_videos_admin() -> list[dict]:
    """All induction videos (active + inactive) for the admin table, in display order."""
    from app.models import InductionVideo
    db = SessionLocal()
    try:
        rows = (
            db.query(InductionVideo)
            .order_by(InductionVideo.sort_order, InductionVideo.id)
            .all()
        )
        return [_serialize_video(v) for v in rows]
    finally:
        db.close()


def create_induction_video(data: dict, actor_email: str | None = None) -> dict:
    """Create an induction video row from an admin payload (title/url required)."""
    from app.models import InductionVideo
    db = SessionLocal()
    try:
        v = InductionVideo(
            title=(data.get("title") or "").strip(),
            description=(data.get("description") or "").strip() or None,
            url=(data.get("url") or "").strip(),
            uploaded_filename=data.get("uploaded_filename"),
            chapters=data.get("chapters") or [],
            sort_order=int(data.get("sort_order") or 0),
            is_active=bool(data.get("is_active", True)),
            created_by=actor_email,
        )
        db.add(v)
        db.commit()
        db.refresh(v)
        return _serialize_video(v)
    finally:
        db.close()


def update_induction_video(video_id: int, data: dict) -> dict | None:
    """Update an induction video row. Returns the updated dict, or None if not found."""
    from app.models import InductionVideo
    db = SessionLocal()
    try:
        v = db.query(InductionVideo).filter(InductionVideo.id == video_id).first()
        if v is None:
            return None
        if "title" in data:
            v.title = (data.get("title") or "").strip()
        if "description" in data:
            v.description = (data.get("description") or "").strip() or None
        if "url" in data:
            v.url = (data.get("url") or "").strip()
        if "uploaded_filename" in data:
            v.uploaded_filename = data.get("uploaded_filename")
        if "chapters" in data:
            v.chapters = data.get("chapters") or []
        if "sort_order" in data:
            v.sort_order = int(data.get("sort_order") or 0)
        if "is_active" in data:
            v.is_active = bool(data.get("is_active"))
        db.commit()
        db.refresh(v)
        return _serialize_video(v)
    finally:
        db.close()


def delete_induction_video(video_id: int) -> bool:
    """Delete an induction video row (and its uploaded file, if any). Returns True if deleted."""
    from app.models import InductionVideo
    db = SessionLocal()
    try:
        v = db.query(InductionVideo).filter(InductionVideo.id == video_id).first()
        if v is None:
            return False
        # Best-effort cleanup of a locally-uploaded file (url points under /uploads/induction/).
        if v.uploaded_filename and v.url and "/uploads/induction/" in v.url:
            try:
                fname = v.url.rsplit("/", 1)[-1]
                fpath = os.path.join(_INDUCTION_DIR, fname)
                if os.path.isfile(fpath):
                    os.remove(fpath)
            except Exception:
                pass
        db.delete(v)
        db.commit()
        return True
    finally:
        db.close()


def save_induction_upload(content: bytes, original_name: str) -> dict:
    """Save an uploaded video file under uploads/induction/ and return its public URL.

    Returns {"url": "/uploads/induction/<unique>", "uploaded_filename": original_name}.
    The URL is served by main.py's /uploads static mount.
    """
    import uuid
    os.makedirs(_INDUCTION_DIR, exist_ok=True)
    ext = os.path.splitext(original_name or "")[1].lower() or ".mp4"
    safe = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(_INDUCTION_DIR, safe), "wb") as f:
        f.write(content)
    return {"url": f"/uploads/induction/{safe}", "uploaded_filename": original_name or safe}


# ── Induction documents (reference PDFs/docs attached to the induction step) ───────

_INDUCTION_DOCS_DIR = os.path.join(_UPLOADS_DIR, "induction_docs")


def _serialize_induction_doc(d) -> dict:
    return {
        "id": str(d.id),
        "title": d.title,
        "description": d.description or "",
        "url": d.url,
        "uploaded_filename": d.uploaded_filename,
        "sort_order": d.sort_order or 0,
        "is_active": bool(d.is_active),
    }


def induction_documents() -> list[dict]:
    """Active induction reference documents for new hires (view/download in the induction step)."""
    from app.models import InductionDocument
    db = SessionLocal()
    try:
        rows = (
            db.query(InductionDocument)
            .filter(InductionDocument.is_active == True)  # noqa: E712
            .order_by(InductionDocument.sort_order, InductionDocument.id)
            .all()
        )
        return [_serialize_induction_doc(d) for d in rows]
    finally:
        db.close()


def list_induction_docs_admin() -> list[dict]:
    from app.models import InductionDocument
    db = SessionLocal()
    try:
        rows = (db.query(InductionDocument)
                .order_by(InductionDocument.sort_order, InductionDocument.id).all())
        return [_serialize_induction_doc(d) for d in rows]
    finally:
        db.close()


def create_induction_doc(data: dict, actor_email: str | None = None) -> dict:
    from app.models import InductionDocument
    db = SessionLocal()
    try:
        d = InductionDocument(
            title=(data.get("title") or "").strip(),
            description=(data.get("description") or "").strip() or None,
            url=(data.get("url") or "").strip(),
            uploaded_filename=data.get("uploaded_filename"),
            sort_order=int(data.get("sort_order") or 0),
            is_active=bool(data.get("is_active", True)),
            created_by=actor_email,
        )
        db.add(d)
        db.commit()
        db.refresh(d)
        return _serialize_induction_doc(d)
    finally:
        db.close()


def update_induction_doc(doc_id: int, data: dict) -> dict | None:
    from app.models import InductionDocument
    db = SessionLocal()
    try:
        d = db.query(InductionDocument).filter(InductionDocument.id == doc_id).first()
        if d is None:
            return None
        if "title" in data:
            d.title = (data.get("title") or "").strip()
        if "description" in data:
            d.description = (data.get("description") or "").strip() or None
        if "url" in data:
            d.url = (data.get("url") or "").strip()
        if "uploaded_filename" in data:
            d.uploaded_filename = data.get("uploaded_filename")
        if "sort_order" in data:
            d.sort_order = int(data.get("sort_order") or 0)
        if "is_active" in data:
            d.is_active = bool(data.get("is_active"))
        db.commit()
        db.refresh(d)
        return _serialize_induction_doc(d)
    finally:
        db.close()


def delete_induction_doc(doc_id: int) -> bool:
    from app.models import InductionDocument
    db = SessionLocal()
    try:
        d = db.query(InductionDocument).filter(InductionDocument.id == doc_id).first()
        if d is None:
            return False
        if d.uploaded_filename and d.url and "/uploads/induction_docs/" in d.url:
            try:
                fpath = os.path.join(_INDUCTION_DOCS_DIR, d.url.rsplit("/", 1)[-1])
                if os.path.isfile(fpath):
                    os.remove(fpath)
            except Exception:
                pass
        db.delete(d)
        db.commit()
        return True
    finally:
        db.close()


def save_induction_doc_upload(content: bytes, original_name: str) -> dict:
    """Save an uploaded induction document under uploads/induction_docs/ and return its URL."""
    import uuid
    os.makedirs(_INDUCTION_DOCS_DIR, exist_ok=True)
    ext = os.path.splitext(original_name or "")[1].lower() or ".pdf"
    safe = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(_INDUCTION_DOCS_DIR, safe), "wb") as f:
        f.write(content)
    return {"url": f"/uploads/induction_docs/{safe}", "uploaded_filename": original_name or safe}


# ── Day-1 quick links (curated apps/portals a new hire needs early) ────────────────

def _serialize_quick_link(l) -> dict:
    return {
        "id": str(l.id),
        "title": l.title,
        "url": l.url,
        "description": l.description or "",
        "category": l.category or "",
        "sort_order": l.sort_order or 0,
        "is_active": bool(l.is_active),
    }


def quick_links() -> list[dict]:
    """Active quick links for new hires (opened from the onboarding journey)."""
    from app.models import OnboardingQuickLink
    db = SessionLocal()
    try:
        rows = (
            db.query(OnboardingQuickLink)
            .filter(OnboardingQuickLink.is_active == True)  # noqa: E712
            .order_by(OnboardingQuickLink.sort_order, OnboardingQuickLink.id)
            .all()
        )
        return [_serialize_quick_link(l) for l in rows]
    finally:
        db.close()


def list_quick_links_admin() -> list[dict]:
    from app.models import OnboardingQuickLink
    db = SessionLocal()
    try:
        rows = (db.query(OnboardingQuickLink)
                .order_by(OnboardingQuickLink.sort_order, OnboardingQuickLink.id).all())
        return [_serialize_quick_link(l) for l in rows]
    finally:
        db.close()


def create_quick_link(data: dict, actor_email: str | None = None) -> dict:
    from app.models import OnboardingQuickLink
    db = SessionLocal()
    try:
        l = OnboardingQuickLink(
            title=(data.get("title") or "").strip(),
            url=(data.get("url") or "").strip(),
            description=(data.get("description") or "").strip() or None,
            category=(data.get("category") or "").strip() or None,
            sort_order=int(data.get("sort_order") or 0),
            is_active=bool(data.get("is_active", True)),
            created_by=actor_email,
        )
        db.add(l)
        db.commit()
        db.refresh(l)
        return _serialize_quick_link(l)
    finally:
        db.close()


def update_quick_link(link_id: int, data: dict) -> dict | None:
    from app.models import OnboardingQuickLink
    db = SessionLocal()
    try:
        l = db.query(OnboardingQuickLink).filter(OnboardingQuickLink.id == link_id).first()
        if l is None:
            return None
        if "title" in data:
            l.title = (data.get("title") or "").strip()
        if "url" in data:
            l.url = (data.get("url") or "").strip()
        if "description" in data:
            l.description = (data.get("description") or "").strip() or None
        if "category" in data:
            l.category = (data.get("category") or "").strip() or None
        if "sort_order" in data:
            l.sort_order = int(data.get("sort_order") or 0)
        if "is_active" in data:
            l.is_active = bool(data.get("is_active"))
        db.commit()
        db.refresh(l)
        return _serialize_quick_link(l)
    finally:
        db.close()


def delete_quick_link(link_id: int) -> bool:
    from app.models import OnboardingQuickLink
    db = SessionLocal()
    try:
        l = db.query(OnboardingQuickLink).filter(OnboardingQuickLink.id == link_id).first()
        if l is None:
            return False
        db.delete(l)
        db.commit()
        return True
    finally:
        db.close()


# ── Stalled-joiner reminder settings (runtime-editable, stored in CompanySettings) ──
# The cadence detector lives in nudge_service.detect_stalled_onboarding; HR tunes it here
# rather than via env vars, so no redeploy is needed. Defaults fall back to config.

_REMINDER_KEY = "onboarding_reminders"


def _reminder_defaults() -> dict:
    return {
        "enabled": True,
        "stall_days": int(settings.ONBOARDING_STALL_DAYS),
        "remind_hire": True,        # nudge the new hire about their next step
        "remind_manager": True,     # nudge the hire's manager to follow up
        "remind_hr": False,         # also nudge the HR mailbox
        "hr_email": settings.ONBOARDING_HR_EMAIL or "",
    }


def get_reminder_settings() -> dict:
    """Current stalled-joiner reminder config, merged over defaults."""
    import json
    from app.services.company_settings_service import CompanySettingsService

    cfg = _reminder_defaults()
    raw = CompanySettingsService.get(_REMINDER_KEY)
    if raw:
        try:
            stored = json.loads(raw)
            if isinstance(stored, dict):
                cfg.update({k: stored[k] for k in cfg if k in stored})
        except Exception:
            pass
    # Coerce types defensively (the store is text).
    cfg["enabled"] = bool(cfg["enabled"])
    cfg["remind_hire"] = bool(cfg["remind_hire"])
    cfg["remind_manager"] = bool(cfg["remind_manager"])
    cfg["remind_hr"] = bool(cfg["remind_hr"])
    try:
        cfg["stall_days"] = max(1, int(cfg["stall_days"]))
    except (TypeError, ValueError):
        cfg["stall_days"] = int(settings.ONBOARDING_STALL_DAYS)
    cfg["hr_email"] = (cfg.get("hr_email") or "").strip()
    return cfg


def set_reminder_settings(data: dict, actor_email: str = "") -> dict:
    """Persist (partial) reminder config; returns the full merged, validated config."""
    import json
    from app.services.company_settings_service import CompanySettingsService

    cfg = get_reminder_settings()
    for key in ("enabled", "remind_hire", "remind_manager", "remind_hr"):
        if key in data:
            cfg[key] = bool(data[key])
    if "stall_days" in data:
        try:
            cfg["stall_days"] = max(1, int(data["stall_days"]))
        except (TypeError, ValueError):
            pass
    if "hr_email" in data:
        cfg["hr_email"] = (data.get("hr_email") or "").strip()
    CompanySettingsService.set(_REMINDER_KEY, json.dumps(cfg), updated_by=actor_email)
    return cfg


# ── Journey step admin (HR adds/edits/hides/reorders onboarding steps) ────────────

def list_steps_admin() -> list[dict]:
    """Full HR management view of the journey: every step — built-in and HR-added, incl.
    soft-removed ones — with its effective title/description/category/CTA/required, whether
    it's active, whether it's a built-in, its kind, and whether it auto-completes."""
    from app.models import OnboardingStepOverride

    builtin_keys = {s.key for s in tmpl.STEPS}
    builtins = {s.key: s for s in tmpl.STEPS}
    builtin_order = {s.key: s.order for s in tmpl.STEPS}

    db = SessionLocal()
    try:
        rows = {r.step_key: r for r in db.query(OnboardingStepOverride).all()}
    finally:
        db.close()

    out = []
    seen = set()
    for key in list(builtins.keys()) + [k for k in rows.keys() if k not in builtin_keys]:
        if key in seen:
            continue
        seen.add(key)
        row = rows.get(key)
        base = builtins.get(key)
        title = (row.title if row and row.title is not None else (base.title if base else key)) or key
        description = (row.description if row and row.description is not None
                       else (base.description if base else "")) or ""
        category = (row.category if row and row.category is not None
                    else (base.category if base else "General")) or "General"
        kind = base.kind if base else ((row.kind if row else None) or "manual")
        cta_label = (row.cta_label if row and row.cta_label is not None
                     else (base.cta_label if base else "Mark done")) or "Mark done"
        action_payload = (row.action_payload if row and row.action_payload is not None
                          else (dict(base.action_payload) if base else {})) or {}
        required = bool(row.required) if (row and row.required is not None) else (base.required if base else True)
        is_active = bool(row.is_active) if row else True
        sort_order = (row.sort_order if row and row.sort_order is not None
                      else (builtin_order.get(key, 100)))
        auto = bool(base.auto_signal) if base else False
        out.append({
            "step_key": key,
            "title": title,
            "description": description,
            "category": category,
            "kind": kind,
            "cta_label": cta_label,
            "action_payload": action_payload,
            "required": required,
            "is_active": is_active,
            "is_builtin": key in builtin_keys,
            "auto": auto,
            "sort_order": sort_order,
        })
    out.sort(key=lambda s: (s["sort_order"], s["title"]))
    return out


def _slugify_step_key(title: str) -> str:
    import re
    base = re.sub(r"[^a-z0-9]+", "_", (title or "").lower()).strip("_") or "step"
    return f"custom_{base}"[:60]


def _clean_action_payload(kind: str, data: dict) -> dict:
    """Build a valid action_payload for a custom step from the submitted data.
    deeplink → {"prompt": ...} or {"route": ...}; manual → {}."""
    if kind != "deeplink":
        return {}
    ap = data.get("action_payload")
    if isinstance(ap, dict) and (ap.get("prompt") or ap.get("route")):
        return {k: v for k, v in ap.items() if k in ("prompt", "route") and v}
    prompt = (data.get("prompt") or "").strip()
    route = (data.get("route") or "").strip()
    if prompt:
        return {"prompt": prompt}
    if route:
        return {"route": route}
    return {}


def create_step(data: dict, actor_email: str | None = None) -> dict:
    """HR adds a brand-new custom journey step. step_key is derived from the title (uniquified).
    Custom steps are manual or deeplink and never auto-complete."""
    from app.models import OnboardingStepOverride

    title = (data.get("title") or "").strip()
    if not title:
        raise ValueError("A step title is required.")
    kind = (data.get("kind") or "manual").strip().lower()
    if kind not in ("manual", "deeplink"):
        kind = "manual"
    db = SessionLocal()
    try:
        base_key = _slugify_step_key(title)
        key = base_key
        existing = {s.key for s in tmpl.STEPS} | {
            r.step_key for r in db.query(OnboardingStepOverride).all()
        }
        n = 2
        while key in existing:
            key = f"{base_key}_{n}"
            n += 1
        row = OnboardingStepOverride(
            step_key=key,
            title=title,
            description=(data.get("description") or "").strip() or None,
            category=(data.get("category") or "").strip() or "General",
            kind=kind,
            cta_label=(data.get("cta_label") or "").strip() or ("Open" if kind == "deeplink" else "Mark done"),
            action_payload=_clean_action_payload(kind, data),
            required=bool(data.get("required", True)),
            is_active=bool(data.get("is_active", True)),
            sort_order=int(data.get("sort_order") or 100),
            created_by=actor_email,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"step_key": row.step_key, "id": row.id}
    finally:
        db.close()


def update_step(step_key: str, data: dict) -> dict | None:
    """Update a step. For built-ins this creates/updates an override row (title/description/
    category/cta_label/required/is_active/sort_order, and the deeplink prompt). Returns the
    effective row info, or None if the key is unknown."""
    from app.models import OnboardingStepOverride

    base = next((s for s in tmpl.STEPS if s.key == step_key), None)
    is_builtin = base is not None
    db = SessionLocal()
    try:
        row = db.query(OnboardingStepOverride).filter(
            OnboardingStepOverride.step_key == step_key
        ).first()
        if row is None:
            if not is_builtin:
                return None
            # First edit of a built-in → seed an override row from its current definition.
            row = OnboardingStepOverride(
                step_key=step_key, title=base.title, description=base.description or None,
                category=base.category, kind=base.kind, cta_label=base.cta_label,
                action_payload=dict(base.action_payload), required=base.required,
                is_active=True, sort_order=base.order,
            )
            db.add(row)
        if "title" in data and data["title"] is not None:
            row.title = str(data["title"]).strip() or row.title
        if "description" in data:
            row.description = (data.get("description") or "").strip() or None
        if "category" in data:
            row.category = (data.get("category") or "").strip() or "General"
        if "cta_label" in data and data["cta_label"] is not None:
            row.cta_label = str(data["cta_label"]).strip() or row.cta_label
        if "required" in data:
            row.required = bool(data["required"])
        if "is_active" in data:
            row.is_active = bool(data["is_active"])
        if "sort_order" in data:
            row.sort_order = int(data.get("sort_order") or 100)
        # Custom steps: allow retargeting kind + deeplink prompt/route. Built-in kinds are fixed.
        if not is_builtin:
            if "kind" in data:
                k = (data.get("kind") or "manual").strip().lower()
                row.kind = k if k in ("manual", "deeplink") else "manual"
            if any(x in data for x in ("action_payload", "prompt", "route")):
                row.action_payload = _clean_action_payload(row.kind or "manual", data)
        elif "prompt" in data and (base.kind == "deeplink"):
            # A built-in deeplink's chat prompt is editable.
            row.action_payload = {**(row.action_payload or {}), "prompt": (data.get("prompt") or "").strip()}
        db.commit()
        db.refresh(row)
        return {"step_key": row.step_key, "id": row.id, "is_active": row.is_active}
    finally:
        db.close()


def delete_step(step_key: str) -> bool:
    """Remove a step. Custom steps are hard-deleted; built-ins can't be removed from code, so
    they're soft-removed (is_active=False override)."""
    from app.models import OnboardingStepOverride

    is_builtin = any(s.key == step_key for s in tmpl.STEPS)
    if is_builtin:
        return update_step(step_key, {"is_active": False}) is not None

    db = SessionLocal()
    try:
        row = db.query(OnboardingStepOverride).filter(
            OnboardingStepOverride.step_key == step_key
        ).first()
        if row is None:
            return False
        db.delete(row)
        db.commit()
        return True
    finally:
        db.close()


# ── Bulk reorder (drag-and-drop in the Control Hub) ────────────────────────────────
# Each takes the desired order as a list of keys/ids and rewrites sort_order to 10,20,30…
# so the whole app renders the new sequence. Steps/doc-sections route through update_*
# so a first-time reorder of a built-in seeds its override row.

def reorder_steps(order: list) -> None:
    for i, key in enumerate(order):
        update_step(str(key), {"sort_order": (i + 1) * 10})


def reorder_doc_sections(order: list) -> None:
    for i, key in enumerate(order):
        update_doc_section(str(key), {"sort_order": (i + 1) * 10})


def _reorder_rows(model, order: list) -> None:
    db = SessionLocal()
    try:
        rows = {r.id: r for r in db.query(model).all()}
        for i, rid in enumerate(order):
            try:
                r = rows.get(int(rid))
            except (TypeError, ValueError):
                r = None
            if r is not None:
                r.sort_order = (i + 1) * 10
        db.commit()
    finally:
        db.close()


def reorder_quick_links(order: list) -> None:
    from app.models import OnboardingQuickLink
    _reorder_rows(OnboardingQuickLink, order)


def reorder_induction_videos(order: list) -> None:
    from app.models import InductionVideo
    _reorder_rows(InductionVideo, order)


def reorder_induction_docs(order: list) -> None:
    from app.models import InductionDocument
    _reorder_rows(InductionDocument, order)


# ── HR preview of the new-hire journey (no employee, all steps pending) ────────────

def preview_journey() -> dict:
    """The effective onboarding flow exactly as a brand-new hire would first see it — every
    step pending, no documents submitted — plus the induction videos, reference documents, and
    Day-1 quick links. Powers the HR 'Preview' mode in the tracker (read-only, no employee)."""
    step_views = []
    for step in all_steps():
        v = step.to_dict()
        v.update({"status": "pending", "completed_at": None})
        step_views.append(v)

    doc_views = []
    for doc in all_docs():
        d = doc.to_dict()
        d.update({
            "submitted": False,
            "status": "not_started",
            "has_template_file": template_file_path(doc.doc_key) is not None,
        })
        doc_views.append(d)

    return {
        "status": "active",
        "progress_pct": 0,
        "next_step": step_views[0]["key"] if step_views else None,
        "steps": step_views,
        "documents": doc_views,
        "videos": induction_videos(),
        "induction_documents": induction_documents(),
        "quick_links": quick_links(),
    }


# ── Document template admin (HR uploads blank templates to download/fill/upload) ──

def list_doc_templates_admin() -> list[dict]:
    """Full HR management view of the document catalog: every document — built-in and
    HR-added, including soft-removed ones — with its effective name/description/fields/required,
    whether it's active, whether it's a built-in, and any uploaded template file.

    HR uses this to add sections, remove/deactivate them, edit fields, and toggle mandatory.
    """
    from app.models import OnboardingDocSection

    builtin_keys = {d.doc_key for d in tmpl.ONBOARDING_DOCS}
    builtins = {d.doc_key: d for d in tmpl.ONBOARDING_DOCS}
    builtin_order = {d.doc_key: i for i, d in enumerate(tmpl.ONBOARDING_DOCS)}

    db = SessionLocal()
    try:
        rows = {r.doc_key: r for r in db.query(OnboardingDocSection).all()}
    finally:
        db.close()

    out = []
    seen = set()
    for key in list(builtins.keys()) + [k for k in rows.keys() if k not in builtin_keys]:
        if key in seen:
            continue
        seen.add(key)
        row = rows.get(key)
        base = builtins.get(key)
        name = (row.name if row else base.name) if (row or base) else key
        description = (row.description if row and row.description is not None else (base.description if base else "")) or ""
        fields = list(row.fields) if (row and row.fields is not None) else (list(base.fields) if base else [])
        required = bool(row.required) if row else (base.required if base else True)
        is_active = bool(row.is_active) if row else True
        sort_order = (row.sort_order if row and row.sort_order is not None
                      else (builtin_order.get(key, 100)))
        path = template_file_path(key)
        out.append({
            "doc_key": key,
            "name": name,
            "description": description,
            "fields": fields,
            "required": required,
            "is_active": is_active,
            "is_builtin": key in builtin_keys,
            "section_id": row.id if row else None,
            "sort_order": sort_order,
            "has_template_file": path is not None,
            "template_filename": os.path.basename(path) if path else None,
        })
    out.sort(key=lambda d: (d["sort_order"], d["name"]))
    return out


def _slugify_doc_key(name: str) -> str:
    import re
    base = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_") or "document"
    return f"custom_{base}"[:60]


def create_doc_section(data: dict, actor_email: str | None = None) -> dict:
    """HR adds a brand-new document section. doc_key is derived from the name (uniquified)."""
    from app.models import OnboardingDocSection

    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("A document name is required.")
    db = SessionLocal()
    try:
        base_key = _slugify_doc_key(name)
        key = base_key
        existing = {d.doc_key for d in tmpl.ONBOARDING_DOCS} | {
            r.doc_key for r in db.query(OnboardingDocSection).all()
        }
        n = 2
        while key in existing:
            key = f"{base_key}_{n}"
            n += 1
        row = OnboardingDocSection(
            doc_key=key,
            name=name,
            description=(data.get("description") or "").strip() or None,
            fields=[f.strip() for f in (data.get("fields") or []) if f and f.strip()],
            required=bool(data.get("required", True)),
            is_active=bool(data.get("is_active", True)),
            sort_order=int(data.get("sort_order") or 100),
            created_by=actor_email,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"doc_key": row.doc_key, "section_id": row.id}
    finally:
        db.close()


def update_doc_section(doc_key: str, data: dict) -> dict | None:
    """Update a document. For built-ins this creates/updates an override row (name/description/
    fields/required/is_active/sort_order). Returns the effective row info, or None if unknown."""
    from app.models import OnboardingDocSection

    is_builtin = any(d.doc_key == doc_key for d in tmpl.ONBOARDING_DOCS)
    db = SessionLocal()
    try:
        row = db.query(OnboardingDocSection).filter(
            OnboardingDocSection.doc_key == doc_key
        ).first()
        if row is None:
            if not is_builtin:
                return None
            # First edit of a built-in → seed an override row from its current definition.
            base = next(d for d in tmpl.ONBOARDING_DOCS if d.doc_key == doc_key)
            row = OnboardingDocSection(
                doc_key=doc_key, name=base.name, description=base.description or None,
                fields=list(base.fields), required=base.required, is_active=True, sort_order=100,
            )
            db.add(row)
        if "name" in data and data["name"] is not None:
            row.name = str(data["name"]).strip() or row.name
        if "description" in data:
            row.description = (data.get("description") or "").strip() or None
        if "fields" in data:
            row.fields = [f.strip() for f in (data.get("fields") or []) if f and f.strip()]
        if "required" in data:
            row.required = bool(data["required"])
        if "is_active" in data:
            row.is_active = bool(data["is_active"])
        if "sort_order" in data:
            row.sort_order = int(data.get("sort_order") or 100)
        db.commit()
        db.refresh(row)
        return {"doc_key": row.doc_key, "section_id": row.id, "is_active": row.is_active}
    finally:
        db.close()


def delete_doc_section(doc_key: str) -> bool:
    """Remove a document. Custom sections are hard-deleted (and their template file removed);
    built-ins can't be deleted from code, so they're soft-removed (is_active=False override)."""
    from app.models import OnboardingDocSection

    is_builtin = any(d.doc_key == doc_key for d in tmpl.ONBOARDING_DOCS)
    if is_builtin:
        return update_doc_section(doc_key, {"is_active": False}) is not None

    db = SessionLocal()
    try:
        row = db.query(OnboardingDocSection).filter(
            OnboardingDocSection.doc_key == doc_key
        ).first()
        if row is None:
            return False
        db.delete(row)
        db.commit()
    finally:
        db.close()
    _remove_doc_template_file(doc_key)
    return True


def save_doc_template(doc_key: str, content: bytes, original_name: str) -> dict:
    """Save (or replace) the HR-authored blank template file for a document. Stored as
    uploads/onboarding_templates/<doc_key><ext> so template_file_path() finds it by key.
    Returns {doc_key, template_filename}."""
    if get_doc(doc_key) is None:
        raise ValueError(f"Unknown document: {doc_key}")
    os.makedirs(_TEMPLATES_DIR, exist_ok=True)
    # Remove any existing template for this key (possibly a different extension) first.
    _remove_doc_template_file(doc_key)
    ext = os.path.splitext(original_name or "")[1].lower() or ".pdf"
    fname = f"{doc_key}{ext}"
    with open(os.path.join(_TEMPLATES_DIR, fname), "wb") as f:
        f.write(content)
    return {"doc_key": doc_key, "template_filename": fname}


def _remove_doc_template_file(doc_key: str) -> bool:
    """Delete any template file matching this doc_key (any extension). Returns True if one went."""
    if not os.path.isdir(_TEMPLATES_DIR):
        return False
    removed = False
    for fname in os.listdir(_TEMPLATES_DIR):
        if os.path.splitext(fname)[0] == doc_key:
            try:
                os.remove(os.path.join(_TEMPLATES_DIR, fname))
                removed = True
            except Exception:
                pass
    return removed


def delete_doc_template(doc_key: str) -> bool:
    """Remove the HR-authored template file for a doc (new hires fall back to the text stub)."""
    if get_doc(doc_key) is None:
        return False
    return _remove_doc_template_file(doc_key)


# ── Assigned IT device (admin-set, shown in the new hire's IT-setup step) ─────────

def get_assigned_device(email: str) -> str | None:
    """The IT device an admin assigned to this hire, or None."""
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            return None
        journey = ensure_journey(db, emp)
        return journey.assigned_device
    finally:
        db.close()


def set_assigned_device(email: str, device: str | None) -> dict | None:
    """Admin sets/clears the IT device for a hire. Returns {email, assigned_device} or None."""
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            return None
        journey = ensure_journey(db, emp)
        journey.assigned_device = (device or "").strip() or None
        db.commit()
        db.refresh(journey)
        return {"employee_email": email, "assigned_device": journey.assigned_device}
    finally:
        db.close()


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
        stall_cutoff = _now() - datetime.timedelta(days=get_reminder_settings()["stall_days"])
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
                "docs_required": len(required_doc_keys()),
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
