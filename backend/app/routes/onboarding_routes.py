"""Employee onboarding journey API.

Two audiences share one prefix:
  • the new hire — /me/* (their own guided journey, documents, induction video)
  • HR / Admin   — /overview/* (track every joiner's progress)

Reads identity from the standard x-user-email / x-user-role headers (app.auth). Writes go
through the action registry so they get a receipt + undo. Document uploads follow the existing
upload-route convention (UploadFile), are saved under uploads/onboarding_docs/, and emailed to HR.
"""

from __future__ import annotations

import io
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user, require_hr
from app.services import actions
from app.services import onboarding_service as svc
from app.services import onboarding_template as tmpl

router = APIRouter(prefix="/api/onboard", tags=["Onboarding"])

# Uploaded induction videos can be large — allow up to 500 MB.
_MAX_VIDEO_BYTES = 500 * 1024 * 1024


# ── New-hire journey ─────────────────────────────────────────────────────────────

@router.get("/me")
def my_journey(user: CurrentUser = Depends(get_current_user)):
    """The current user's journey + steps + documents + progress. Auto-creates and recomputes."""
    view = svc.get_for_employee(user.email)
    if view is None:
        raise HTTPException(status_code=404, detail="No employee record found for your account.")
    return view


@router.post("/me/steps/{step_key}/complete")
def complete_step(step_key: str, user: CurrentUser = Depends(get_current_user)):
    """Mark one of MY steps done (via the action registry → receipt + undo)."""
    if svc.get_step(step_key) is None:
        raise HTTPException(status_code=404, detail=f"Unknown onboarding step: {step_key}")
    result = actions.run(
        "onboarding_complete_step",
        actor_email=user.email,
        actor_role=user.role,
        step_key=step_key,
        employee_email=user.email,
    )
    if not result.success:
        raise HTTPException(status_code=400, detail=result.human_message or result.error)
    return {"message": result.human_message, "confirmation_id": result.confirmation_id,
            "receipt": result.receipt}


# ── Documents ─────────────────────────────────────────────────────────────────────

@router.get("/me/documents")
def my_documents(user: CurrentUser = Depends(get_current_user)):
    """The joining documents + this user's submission status for each."""
    view = svc.get_for_employee(user.email)
    if view is None:
        raise HTTPException(status_code=404, detail="No employee record found for your account.")
    return {"documents": view["documents"]}


@router.get("/documents/{doc_key}/template")
def download_template(doc_key: str, _: CurrentUser = Depends(get_current_user)):
    """Download the blank template for a document. Serves the HR-authored file if one was
    dropped into uploads/onboarding_templates/; otherwise generates a fillable text template."""
    if svc.get_doc(doc_key) is None:
        raise HTTPException(status_code=404, detail=f"Unknown document: {doc_key}")

    real = svc.template_file_path(doc_key)
    if real:
        return FileResponse(real, filename=f"{doc_key}{__import__('os').path.splitext(real)[1]}")

    filename, text = svc.generate_text_template(doc_key)
    return StreamingResponse(
        io.BytesIO(text.encode("utf-8")),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/me/documents/{doc_key}/upload")
async def upload_document(
    doc_key: str,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Upload a filled document → saved, emailed to HR, submission recorded, docs step recomputed."""
    if svc.get_doc(doc_key) is None:
        raise HTTPException(status_code=404, detail=f"Unknown document: {doc_key}")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    db, emp, journey = svc.get_journey_for(user.email)
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee record found for your account.")
    try:
        result = svc.submit_document(
            db, journey, doc_key, content,
            original_name=file.filename or f"{doc_key}",
            content_type=file.content_type or "application/octet-stream",
            actor_email=user.email,
        )
    finally:
        db.close()

    msg = "Document uploaded and sent to HR." if result["emailed"] else \
          "Document uploaded. (HR will be emailed once mail is connected.)"
    return {"message": msg, **result}


@router.get("/me/documents/{doc_key}/submission")
def download_my_submission(doc_key: str, user: CurrentUser = Depends(get_current_user)):
    """Download the new hire's own most recent submission for a document — the exact filled
    file that was saved and emailed to HR (PDF, or the mail-merged .docx/.xlsx if HR authored
    a template), not the blank template."""
    if svc.get_doc(doc_key) is None:
        raise HTTPException(status_code=404, detail=f"Unknown document: {doc_key}")

    db, emp, journey = svc.get_journey_for(user.email)
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee record found for your account.")
    try:
        sub = svc.latest_submission(db, journey, doc_key)
        file_path = sub.file_path if sub else None
        filename = sub.original_name if sub else None
    finally:
        db.close()

    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="No submission found for that document.")
    return FileResponse(file_path, filename=filename or os.path.basename(file_path))


class FillDocumentBody(BaseModel):
    field_values: dict
    signature: Optional[str] = None   # PNG data URL from the in-app signature pad


@router.post("/me/documents/{doc_key}/fill")
def fill_document(
    doc_key: str,
    body: FillDocumentBody,
    user: CurrentUser = Depends(get_current_user),
):
    """Fill a document in-app from the values the user typed into the declared fields → mail-
    merges them (and the signature) into HR's .docx/.xlsx template if one exists, else renders
    a generic PDF; submits to HR and records the submission (no download needed)."""
    if svc.get_doc(doc_key) is None:
        raise HTTPException(status_code=404, detail=f"Unknown document: {doc_key}")

    db, emp, journey = svc.get_journey_for(user.email)
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee record found for your account.")
    try:
        result = svc.fill_document(db, journey, doc_key, body.field_values or {},
                                   actor_email=user.email, signature=body.signature)
    finally:
        db.close()

    msg = "Document completed and sent to HR." if result["emailed"] else \
          "Document completed. (HR will be emailed once mail is connected.)"
    return {"message": msg, **result}


# ── Induction video ─────────────────────────────────────────────────────────────

@router.get("/induction-videos")
def induction_videos(_: CurrentUser = Depends(get_current_user)):
    """List of all induction videos with titles, descriptions, and chapter seek points."""
    return svc.induction_videos()


@router.get("/induction-documents")
def induction_documents(_: CurrentUser = Depends(get_current_user)):
    """Reference documents (handbooks, slides) attached to the induction step for new hires."""
    return svc.induction_documents()


# ── Manager intro-call (new hire's read-only view) ───────────────────────────────

@router.get("/me/manager-call")
def my_manager_call(user: CurrentUser = Depends(get_current_user)):
    """This user's manager intro-call status: pending (not scheduled yet) or scheduled
    with the date/time + Teams join link. Returns {status: "none"} if no invite exists."""
    from app.services import manager_call_service as mc
    return mc.get_for_new_hire(user.email)


@router.get("/me/manager-team")
def my_manager_team(user: CurrentUser = Depends(get_current_user)):
    """This user's manager + the manager's other direct reports — a scoped hierarchy
    card for the "Meet your manager & team" step (not the full company org chart)."""
    from app.services import manager_call_service as mc
    return mc.get_my_manager_team(user.email)


# ── HR tracker ────────────────────────────────────────────────────────────────────

@router.get("/overview")
def overview(_: CurrentUser = Depends(require_hr)):
    """HR/Admin: every new-hire journey with progress, next step, docs count, stalled flag."""
    return svc.overview()


@router.get("/overview/{employee_email}")
def overview_one(employee_email: str, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: drill into one employee's full journey."""
    view = svc.get_for_employee(employee_email)
    if view is None:
        raise HTTPException(status_code=404, detail="Employee not found.")
    return view


@router.post("/admin/doc-submissions/{submission_id}/resend")
def resend_doc_submission(submission_id: int, _: CurrentUser = Depends(require_hr)):
    """HR: manually retry emailing a joining document to HR that previously failed
    (or is otherwise stuck) — see onboarding_service.resend_doc_submission."""
    result = svc.resend_doc_submission(submission_id)
    if not result.get("ok") and result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ── Admin: induction video management (Control Hub) ───────────────────────────────

class InductionVideoBody(BaseModel):
    title: str
    url: str
    description: Optional[str] = None
    chapters: Optional[list] = None
    uploaded_filename: Optional[str] = None
    sort_order: Optional[int] = 0
    is_active: Optional[bool] = True


@router.get("/admin/videos")
def admin_list_videos(_: CurrentUser = Depends(require_hr)):
    """HR/Admin: all induction videos (active + inactive) for the management table."""
    return svc.list_induction_videos_admin()


@router.post("/admin/videos")
def admin_create_video(body: InductionVideoBody, user: CurrentUser = Depends(require_hr)):
    """HR/Admin: add an induction video (external URL or a previously-uploaded file URL)."""
    if not body.title.strip() or not body.url.strip():
        raise HTTPException(status_code=400, detail="Title and a video URL are required.")
    return svc.create_induction_video(body.model_dump(), actor_email=user.email)


@router.put("/admin/videos/{video_id}")
def admin_update_video(video_id: int, body: InductionVideoBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: update an induction video."""
    updated = svc.update_induction_video(video_id, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Induction video not found.")
    return updated


@router.delete("/admin/videos/{video_id}")
def admin_delete_video(video_id: int, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: delete an induction video (removes the uploaded file too, if any)."""
    if not svc.delete_induction_video(video_id):
        raise HTTPException(status_code=404, detail="Induction video not found.")
    return {"ok": True}


@router.post("/admin/videos/upload")
async def admin_upload_video(file: UploadFile = File(...), _: CurrentUser = Depends(require_hr)):
    """HR/Admin: upload a video file → saved under /uploads/induction/, returns its URL.
    The URL is then submitted via POST /admin/videos to create the catalog entry."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > _MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="Video exceeds the 500 MB upload limit.")
    return svc.save_induction_upload(content, file.filename or "induction.mp4")


# ── Admin: induction documents (Control Hub) ──────────────────────────────────────

class InductionDocBody(BaseModel):
    title: str
    url: str
    description: Optional[str] = None
    uploaded_filename: Optional[str] = None
    sort_order: Optional[int] = 0
    is_active: Optional[bool] = True


@router.get("/admin/induction-docs")
def admin_list_induction_docs(_: CurrentUser = Depends(require_hr)):
    """HR/Admin: all induction reference documents (active + inactive)."""
    return svc.list_induction_docs_admin()


@router.post("/admin/induction-docs")
def admin_create_induction_doc(body: InductionDocBody, user: CurrentUser = Depends(require_hr)):
    """HR/Admin: add an induction document (external URL or an uploaded file URL)."""
    if not body.title.strip() or not body.url.strip():
        raise HTTPException(status_code=400, detail="Title and a document URL are required.")
    return svc.create_induction_doc(body.model_dump(), actor_email=user.email)


@router.put("/admin/induction-docs/{doc_id}")
def admin_update_induction_doc(doc_id: int, body: InductionDocBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: update an induction document."""
    updated = svc.update_induction_doc(doc_id, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Induction document not found.")
    return updated


@router.delete("/admin/induction-docs/{doc_id}")
def admin_delete_induction_doc(doc_id: int, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: delete an induction document (removes the uploaded file too, if any)."""
    if not svc.delete_induction_doc(doc_id):
        raise HTTPException(status_code=404, detail="Induction document not found.")
    return {"ok": True}


@router.post("/admin/induction-docs/upload")
async def admin_upload_induction_doc(file: UploadFile = File(...), _: CurrentUser = Depends(require_hr)):
    """HR/Admin: upload an induction document file → saved under /uploads/induction_docs/."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Document exceeds the 50 MB limit.")
    return svc.save_induction_doc_upload(content, file.filename or "induction_doc.pdf")


# ── Admin: assigned IT device (Control Hub) ───────────────────────────────────────

class AssignedDeviceBody(BaseModel):
    employee_email: str
    assigned_device: Optional[str] = None


@router.put("/admin/device")
def admin_set_device(body: AssignedDeviceBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: set (or clear) the IT device assigned to a new hire."""
    result = svc.set_assigned_device(body.employee_email, body.assigned_device)
    if result is None:
        raise HTTPException(status_code=404, detail="Employee not found.")
    return result


# ── Admin: onboarding document templates (HR uploads blank templates) ─────────────

@router.get("/admin/doc-templates")
def admin_list_doc_templates(_: CurrentUser = Depends(require_hr)):
    """HR/Admin: full document catalog (built-in + custom, incl. hidden) with control metadata."""
    return svc.list_doc_templates_admin()


class DocSectionBody(BaseModel):
    name: str
    description: Optional[str] = None
    fields: Optional[list] = None
    required: Optional[bool] = True
    is_active: Optional[bool] = True
    sort_order: Optional[int] = 100


@router.post("/admin/doc-sections")
def admin_create_doc_section(body: DocSectionBody, user: CurrentUser = Depends(require_hr)):
    """HR/Admin: add a new document section (with its own fields + mandatory flag)."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="A document name is required.")
    return svc.create_doc_section(body.model_dump(), actor_email=user.email)


@router.put("/admin/doc-sections/{doc_key}")
def admin_update_doc_section(doc_key: str, body: DocSectionBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: edit any document (built-in or custom) — name, fields, required, active."""
    updated = svc.update_doc_section(doc_key, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return updated


@router.delete("/admin/doc-sections/{doc_key}")
def admin_delete_doc_section(doc_key: str, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: remove a document. Custom docs are deleted; built-ins are hidden (deactivated)."""
    if not svc.delete_doc_section(doc_key):
        raise HTTPException(status_code=404, detail="Document not found.")
    return {"ok": True}


@router.post("/admin/doc-templates/{doc_key}/upload")
async def admin_upload_doc_template(
    doc_key: str,
    file: UploadFile = File(...),
    _: CurrentUser = Depends(require_hr),
):
    """HR/Admin: upload (or replace) the blank template file new hires download for a document."""
    if svc.get_doc(doc_key) is None:
        raise HTTPException(status_code=404, detail=f"Unknown document: {doc_key}")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Template exceeds the 25 MB limit.")
    return svc.save_doc_template(doc_key, content, file.filename or f"{doc_key}.pdf")


@router.delete("/admin/doc-templates/{doc_key}")
def admin_delete_doc_template(doc_key: str, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: remove a doc's template file (new hires fall back to the generated text stub)."""
    if not svc.delete_doc_template(doc_key):
        raise HTTPException(status_code=404, detail="No template found for that document.")
    return {"ok": True}


# ── Day-1 quick links ─────────────────────────────────────────────────────────────

@router.get("/quick-links")
def new_hire_quick_links(_: CurrentUser = Depends(get_current_user)):
    """Active Day-1 quick links (useful apps/portals) shown to new hires in their journey."""
    return svc.quick_links()


class QuickLinkBody(BaseModel):
    title: str
    url: str
    description: Optional[str] = None
    category: Optional[str] = None
    sort_order: Optional[int] = 0
    is_active: Optional[bool] = True


@router.get("/admin/quick-links")
def admin_list_quick_links(_: CurrentUser = Depends(require_hr)):
    """HR/Admin: all quick links (active + inactive)."""
    return svc.list_quick_links_admin()


@router.post("/admin/quick-links")
def admin_create_quick_link(body: QuickLinkBody, user: CurrentUser = Depends(require_hr)):
    """HR/Admin: add a Day-1 quick link."""
    if not body.title.strip() or not body.url.strip():
        raise HTTPException(status_code=400, detail="Title and a URL are required.")
    return svc.create_quick_link(body.model_dump(), actor_email=user.email)


@router.put("/admin/quick-links/{link_id}")
def admin_update_quick_link(link_id: int, body: QuickLinkBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: update a quick link."""
    updated = svc.update_quick_link(link_id, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Quick link not found.")
    return updated


@router.delete("/admin/quick-links/{link_id}")
def admin_delete_quick_link(link_id: int, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: delete a quick link."""
    if not svc.delete_quick_link(link_id):
        raise HTTPException(status_code=404, detail="Quick link not found.")
    return {"ok": True}


# ── Stalled-joiner reminder settings ───────────────────────────────────────────────

class ReminderSettingsBody(BaseModel):
    enabled: Optional[bool] = None
    stall_days: Optional[int] = None
    remind_hire: Optional[bool] = None
    remind_manager: Optional[bool] = None
    remind_hr: Optional[bool] = None
    hr_email: Optional[str] = None


@router.get("/admin/reminder-settings")
def admin_get_reminder_settings(_: CurrentUser = Depends(require_hr)):
    """HR/Admin: current stalled-joiner reminder cadence config."""
    return svc.get_reminder_settings()


@router.put("/admin/reminder-settings")
def admin_set_reminder_settings(body: ReminderSettingsBody, user: CurrentUser = Depends(require_hr)):
    """HR/Admin: update the stalled-joiner reminder cadence (who gets pinged, after how long)."""
    return svc.set_reminder_settings(body.model_dump(exclude_unset=True), actor_email=user.email)


# ── Journey step admin (add/edit/hide/reorder onboarding steps) ─────────────────────

class StepBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    kind: Optional[str] = None                 # manual | deeplink (custom steps only)
    cta_label: Optional[str] = None
    prompt: Optional[str] = None               # deeplink chat prompt
    route: Optional[str] = None                # deeplink navigation route
    action_payload: Optional[dict] = None
    required: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


@router.get("/admin/steps")
def admin_list_steps(_: CurrentUser = Depends(require_hr)):
    """HR/Admin: the full journey — every step (built-in + custom, incl. hidden) with control metadata."""
    return svc.list_steps_admin()


@router.post("/admin/steps")
def admin_create_step(body: StepBody, user: CurrentUser = Depends(require_hr)):
    """HR/Admin: add a new custom journey step (manual card or a deeplink that opens chat/a route)."""
    if not (body.title or "").strip():
        raise HTTPException(status_code=400, detail="A step title is required.")
    return svc.create_step(body.model_dump(exclude_unset=True), actor_email=user.email)


@router.put("/admin/steps/{step_key}")
def admin_update_step(step_key: str, body: StepBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: edit any step (built-in or custom) — title, description, order, CTA, required, active."""
    updated = svc.update_step(step_key, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Step not found.")
    return updated


@router.delete("/admin/steps/{step_key}")
def admin_delete_step(step_key: str, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: remove a step. Custom steps are deleted; built-ins are hidden (deactivated)."""
    if not svc.delete_step(step_key):
        raise HTTPException(status_code=404, detail="Step not found.")
    return {"ok": True}


# ── Bulk reorder (drag-and-drop) ────────────────────────────────────────────────────

class ReorderBody(BaseModel):
    order: list = []


@router.post("/admin/steps/reorder")
def admin_reorder_steps(body: ReorderBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: persist a new step order (list of step_keys, top to bottom)."""
    svc.reorder_steps(body.order or [])
    return {"ok": True}


@router.post("/admin/doc-sections/reorder")
def admin_reorder_doc_sections(body: ReorderBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: persist a new document order (list of doc_keys, top to bottom)."""
    svc.reorder_doc_sections(body.order or [])
    return {"ok": True}


@router.post("/admin/quick-links/reorder")
def admin_reorder_quick_links(body: ReorderBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: persist a new quick-link order (list of ids, top to bottom)."""
    svc.reorder_quick_links(body.order or [])
    return {"ok": True}


@router.post("/admin/videos/reorder")
def admin_reorder_videos(body: ReorderBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: persist a new induction-video order (list of ids, top to bottom)."""
    svc.reorder_induction_videos(body.order or [])
    return {"ok": True}


@router.post("/admin/induction-docs/reorder")
def admin_reorder_induction_docs(body: ReorderBody, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: persist a new reference-document order (list of ids, top to bottom)."""
    svc.reorder_induction_docs(body.order or [])
    return {"ok": True}


# ── HR preview of the new-hire journey ──────────────────────────────────────────────

@router.get("/admin/preview")
def admin_preview_journey(_: CurrentUser = Depends(require_hr)):
    """HR/Admin: the effective onboarding flow exactly as a new hire first sees it — every step
    pending, no docs submitted — plus induction videos, reference docs, and Day-1 quick links."""
    return svc.preview_journey()
