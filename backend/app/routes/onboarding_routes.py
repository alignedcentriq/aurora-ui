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

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, FileResponse

from app.auth import CurrentUser, get_current_user, require_hr
from app.services import actions
from app.services import onboarding_service as svc
from app.services import onboarding_template as tmpl

router = APIRouter(prefix="/api/onboarding", tags=["Onboarding"])


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
    if tmpl.get_step(step_key) is None:
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
    if tmpl.get_doc(doc_key) is None:
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
    if tmpl.get_doc(doc_key) is None:
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


# ── Induction video ─────────────────────────────────────────────────────────────

@router.get("/induction-videos")
def induction_videos(_: CurrentUser = Depends(get_current_user)):
    """List of all induction videos with titles, descriptions, and chapter seek points."""
    return svc.induction_videos()


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
