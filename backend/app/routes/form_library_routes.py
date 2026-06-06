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
    notify_email: str = ""
    notify_domain: str = ""


class FormTemplateUpdatePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    fields: Optional[list[dict[str, Any]]] = None
    category: Optional[str] = None
    enabled: Optional[bool] = None
    notify_email: Optional[str] = None
    notify_domain: Optional[str] = None


class ReviewPayload(BaseModel):
    status: str            # Approved | Rejected | Pending
    remarks: str = ""


# ── Templates ─────────────────────────────────────────────────────────────────
@router.get("")
async def list_forms(_: CurrentUser = Depends(require_admin)):
    return FormLibraryService.list_all(include_disabled=True)


@router.post("")
async def create_form(payload: FormTemplatePayload, user: CurrentUser = Depends(require_admin)):
    res = FormLibraryService.create(
        name=payload.name,
        description=payload.description,
        fields=payload.fields,
        category=payload.category,
        notify_email=payload.notify_email,
        notify_domain=payload.notify_domain,
        created_by=user.email,
    )
    if res.get("status") != "ok":
        raise HTTPException(status_code=400, detail=res.get("message", "Failed to create form."))
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
        enabled=payload.enabled,
        notify_email=payload.notify_email,
        notify_domain=payload.notify_domain,
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
