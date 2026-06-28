"""Admin Form Library endpoints — CRUD over admin-defined fillable forms + submission review.

Admin-only (require_admin). Mirrors app_links_routes.py. The service embeds each form on write
so it becomes discoverable in chat the moment it's created — no code change. Submissions are
captured generically and reviewed here.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, require_admin
from app.services.form_library_service import FormLibraryService

router = APIRouter(prefix="/api/admin/form-library", tags=["form-library"])


class FormTemplatePayload(BaseModel):
    name: str
    description: str
    fields: list[dict[str, Any]]
    category: str = ""
    trigger_keywords: str = ""
    notify_email: str = ""
    notify_domain: str = ""
    is_anonymous: bool = False


class FormTemplateUpdatePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    fields: Optional[list[dict[str, Any]]] = None
    category: Optional[str] = None
    trigger_keywords: Optional[str] = None
    enabled: Optional[bool] = None
    notify_email: Optional[str] = None
    notify_domain: Optional[str] = None
    is_anonymous: Optional[bool] = None


class ReviewPayload(BaseModel):
    status: str            # Approved | Rejected | Pending
    remarks: str = ""


class GenerateFormRequest(BaseModel):
    prompt: str


class EditFormRequest(BaseModel):
    form_id: int
    instruction: str


_GENERATE_FIELD_TYPES = {"text", "textarea", "date", "select", "number", "email", "checkbox", "user", "image"}


def _sanitize_generated_fields(raw_fields: list) -> list[dict]:
    """Coerce LLM-drafted fields into the strict shape FormLibraryService expects."""
    fields: list[dict] = []
    used: set[str] = set()
    for f in raw_fields:
        if not isinstance(f, dict):
            continue
        label = str(f.get("label") or f.get("name") or "").strip()
        if not label:
            continue
        base = "".join(c if c.isalnum() else "_" for c in label.lower()).strip("_") or "field"
        name, suffix = base, 2
        while name in used:
            name, suffix = f"{base}_{suffix}", suffix + 1
        used.add(name)
        ftype = str(f.get("type", "text")).strip().lower()
        if ftype not in _GENERATE_FIELD_TYPES:
            ftype = "text"
        options = [str(o).strip() for o in (f.get("options") or []) if str(o).strip()]
        if ftype == "select" and not options:
            ftype = "text"
        field: dict = {"name": name, "label": label, "type": ftype, "required": bool(f.get("required"))}
        if ftype == "select":
            field["options"] = options
        placeholder = str(f.get("placeholder") or "").strip()
        if placeholder:
            field["placeholder"] = placeholder
        fields.append(field)
    return fields


# ── Templates ─────────────────────────────────────────────────────────────────
@router.get("")
async def list_forms(_: CurrentUser = Depends(require_admin)):
    return FormLibraryService.list_all(include_disabled=True)


@router.get("/keyword-suggestions")
async def form_keyword_suggestions(window_days: int = 30, _: CurrentUser = Depends(require_admin)):
    """Mine recent real chat queries for trigger keywords each form is missing.
    Read-only — nothing is changed; the admin accepts suggestions via the normal PUT."""
    window_days = max(1, min(window_days, 180))
    return FormLibraryService.suggest_keywords(window_days=window_days)


@router.post("/generate")
async def generate_form_draft(req: GenerateFormRequest, _: CurrentUser = Depends(require_admin)):
    """LLM-draft a form template (name, description, fields) from a natural-language request.

    Returns a DRAFT only — nothing is persisted. The client shows a preview the admin can
    edit and confirm, which then goes through the normal POST create endpoint.
    """
    from app.services import llm_controls_service as llm_controls
    from app.services.llm_json import invoke_json

    text = (req.prompt or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Describe the form you want to create.")

    model = llm_controls.get_llm("general", default_timeout=60)
    prompt = (
        "You are a form designer for an employee self-service portal. From the request below, "
        "design a fillable form.\n\n"
        f"Request: {text}\n\n"
        "Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:\n"
        '{"name": "Short Form Name", "description": "One sentence on what this form is for.", '
        '"category": "HR|Admin|IT|Finance|General", "fields": [{"label": "Field Label", '
        '"type": "text|textarea|date|select|number|email|checkbox|user|image", "required": true, '
        '"options": ["only for select"], "placeholder": "optional hint"}]}\n\n'
        "Rules:\n"
        "- 3 to 8 fields, ordered logically. Mark genuinely essential fields required.\n"
        "- Use 'select' with sensible options for categorical answers, 'textarea' for descriptions, "
        "'date' for dates, 'user' for picking an employee, 'image' for photo evidence.\n"
        "- Do NOT add fields for the submitter's own name/email — the portal knows the logged-in user."
    )
    draft = invoke_json(model, prompt, attempts=2)
    if draft is None:
        raise HTTPException(status_code=502, detail="Couldn't draft the form — the model didn't return usable JSON. Try again or rephrase.")

    fields = _sanitize_generated_fields(draft.get("fields") or [])
    if not fields:
        raise HTTPException(status_code=502, detail="Couldn't draft any form fields from that description — try rephrasing.")

    return {
        "name": str(draft.get("name") or "Untitled Form").strip()[:120],
        "description": str(draft.get("description") or "").strip()[:500],
        "category": str(draft.get("category") or "General").strip()[:50],
        "fields": fields,
    }


@router.post("/generate-edit")
async def generate_form_edit(req: EditFormRequest, _: CurrentUser = Depends(require_admin)):
    """LLM-revise an EXISTING form's fields from a natural-language instruction.

    Loads the current form, asks the model to apply the requested change to its fields,
    and returns a revised DRAFT (including the form id) — nothing is persisted. The client
    shows the same editable preview, which the admin confirms via the PUT update endpoint.
    """
    import json

    from app.services import llm_controls_service as llm_controls
    from app.services.llm_json import invoke_json

    instruction = (req.instruction or "").strip()
    if not instruction:
        raise HTTPException(status_code=422, detail="Describe the change you want to make.")

    current = FormLibraryService.get(req.form_id)
    if not current:
        raise HTTPException(status_code=404, detail="Form not found.")

    model = llm_controls.get_llm("general", default_timeout=60)
    prompt = (
        "You are editing an existing fillable form for an employee self-service portal. "
        "Apply the requested change and return the COMPLETE revised form (not just the change).\n\n"
        f"Current form (JSON):\n{json.dumps({'name': current['name'], 'description': current['description'], 'category': current.get('category') or 'General', 'fields': current.get('fields') or []})}\n\n"
        f"Change requested: {instruction}\n\n"
        "Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:\n"
        '{"name": "Short Form Name", "description": "One sentence on what this form is for.", '
        '"category": "HR|Admin|IT|Finance|General", "fields": [{"label": "Field Label", '
        '"type": "text|textarea|date|select|number|email|checkbox|user|image", "required": true, '
        '"options": ["only for select"], "placeholder": "optional hint"}]}\n\n'
        "Rules:\n"
        "- Preserve all existing fields and their order unless the change implies removing or reordering them.\n"
        "- Only modify what the instruction asks for; keep everything else identical.\n"
        "- Use 'select' with sensible options for categorical answers, 'textarea' for descriptions, "
        "'date' for dates, 'user' for picking an employee, 'image' for photo evidence.\n"
        "- Do NOT add fields for the submitter's own name/email — the portal knows the logged-in user."
    )
    draft = invoke_json(model, prompt, attempts=2)
    if draft is None:
        raise HTTPException(status_code=502, detail="Couldn't revise the form — the model didn't return usable JSON. Try again or rephrase.")

    fields = _sanitize_generated_fields(draft.get("fields") or [])
    if not fields:
        raise HTTPException(status_code=502, detail="That change would leave the form with no fields — try rephrasing.")

    return {
        "id": current["id"],
        "name": str(draft.get("name") or current.get("name") or "Untitled Form").strip()[:120],
        "description": str(draft.get("description") or current.get("description") or "").strip()[:500],
        "category": str(draft.get("category") or current.get("category") or "General").strip()[:50],
        "fields": fields,
    }


@router.post("")
async def create_form(payload: FormTemplatePayload, user: CurrentUser = Depends(require_admin)):
    res = FormLibraryService.create(
        name=payload.name,
        description=payload.description,
        fields=payload.fields,
        category=payload.category,
        trigger_keywords=payload.trigger_keywords,
        notify_email=payload.notify_email,
        notify_domain=payload.notify_domain,
        is_anonymous=payload.is_anonymous,
        created_by=user.email,
    )
    if res.get("status") != "ok":
        raise HTTPException(status_code=400, detail=res.get("message", "Failed to create form."))
        
    # Trigger Activity Notification for admins
    try:
        from app.database import SessionLocal
        from app.models import Employee
        from app.services.announcement_service import AnnouncementService
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == user.email).first()
            user_name = emp.name if emp else user.email.split("@")[0].replace(".", " ").replace("_", " ").title()
        finally:
            db.close()
        
        AnnouncementService.create(
            title=f"{user_name} added form",
            body=f"The form '{payload.name}' has been added to the Form Library.",
            category="Activity",
            created_by=user.email,
            created_by_domain="admin",
            target_audience="admin",
        )
    except Exception as e:
        pass
        
    return res


@router.put("/{form_id}")
async def update_form(form_id: int, payload: FormTemplateUpdatePayload,
                      _: CurrentUser = Depends(require_admin)):
    res = FormLibraryService.update(
        form_id,
        name=payload.name,
        description=payload.description,
        fields=payload.fields,
        category=payload.category,
        trigger_keywords=payload.trigger_keywords,
        enabled=payload.enabled,
        notify_email=payload.notify_email,
        notify_domain=payload.notify_domain,
        is_anonymous=payload.is_anonymous,
    )
    if res.get("status") != "ok":
        code = 404 if res.get("message") == "Form not found." else 400
        raise HTTPException(status_code=code, detail=res.get("message", "Failed to update form."))
    return res


@router.delete("/{form_id}")
async def delete_form(form_id: int, _: CurrentUser = Depends(require_admin)):
    res = FormLibraryService.delete(form_id)
    if res.get("status") != "ok":
        raise HTTPException(status_code=404, detail=res.get("message", "Failed to delete form."))
    return res


# ── Submissions ───────────────────────────────────────────────────────────────
@router.get("/submissions")
async def list_submissions(form_template_id: Optional[int] = None,
                           status: Optional[str] = None,
                           _: CurrentUser = Depends(require_admin)):
    return FormLibraryService.list_submissions(form_template_id=form_template_id, status=status)


@router.post("/submissions/{submission_id}/review")
async def review_submission(submission_id: int, payload: ReviewPayload,
                            user: CurrentUser = Depends(require_admin)):
    res = FormLibraryService.review_submission(
        submission_id, payload.status, payload.remarks, reviewer=user.email
    )
    if res.get("status") != "ok":
        code = 404 if res.get("message") == "Submission not found." else 400
        raise HTTPException(status_code=code, detail=res.get("message", "Failed to review."))
    return res
