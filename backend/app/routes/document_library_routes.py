"""
Document Library — company-wide file repository (PPTs, PDFs, DOCX, etc.).

- GET  /api/document-library             → list all documents (any authenticated user)
- GET  /api/document-library/policies    → list SharePoint policy documents
- POST /api/document-library/upload      → upload a file (HR, Admin, Super Admin only)
- GET  /api/document-library/{id}/download → download raw file bytes
- GET  /api/document-library/policies/{id}/download → stream policy file from SharePoint
- DELETE /api/document-library/{id}      → delete (HR, Admin, Super Admin only)
"""

import mimetypes

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.auth import CurrentUser, get_current_user
from app.database import SessionLocal
from app.models import LibraryDocument, Policy

router = APIRouter(prefix="/api/document-library", tags=["Document Library"])

_UPLOAD_ROLES = {"hr", "admin", "super admin"}
_MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


def _get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _require_upload_role(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role not in _UPLOAD_ROLES:
        raise HTTPException(status_code=403, detail="Only HR, Admin, or Super Admin can upload documents.")
    return user


@router.get("")
def list_documents(
    category: str | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    with SessionLocal() as db:
        q = db.query(LibraryDocument)
        if category:
            q = q.filter(LibraryDocument.category == category)
        docs = q.order_by(LibraryDocument.created_at.desc()).all()
        return {
            "documents": [
                {
                    "id": d.id,
                    "title": d.title,
                    "description": d.description,
                    "category": d.category,
                    "filename": d.filename,
                    "file_type": d.file_type,
                    "file_size": d.file_size,
                    "uploaded_by": d.uploaded_by,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                }
                for d in docs
            ]
        }


def _filename_from_source_key(source_key: str) -> str:
    """sp:HR/SubDir/Leave Policy.pdf → 'Leave Policy.pdf'"""
    path = source_key[3:] if source_key.startswith("sp:") else source_key
    return path.split("/")[-1] if "/" in path else path


def _ext_from_source_key(source_key: str) -> str:
    filename = _filename_from_source_key(source_key)
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else "file"


@router.get("/policies")
def list_sharepoint_policies(
    category: str | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    """Return all policy documents synced from SharePoint, formatted as LibraryDoc."""
    with SessionLocal() as db:
        q = db.query(Policy).filter(
            Policy.source_key.like("sp:%"),
            ~Policy.source_key.like("sp:PROJECT/%"),
        )
        if category:
            q = q.filter(Policy.category == category)
        policies = q.order_by(Policy.updated_at.desc()).all()
        return {
            "documents": [
                {
                    "id": p.id,
                    "title": p.title,
                    "description": None,
                    "category": p.category,
                    "filename": _filename_from_source_key(p.source_key),
                    "file_type": _ext_from_source_key(p.source_key),
                    "file_size": 0,
                    "uploaded_by": "SharePoint",
                    "created_at": p.updated_at.isoformat() if p.updated_at else None,
                    "source": "sharepoint",
                }
                for p in policies
            ]
        }


@router.get("/policies/{policy_id}/download")
def download_sharepoint_policy(
    policy_id: int,
    user: CurrentUser = Depends(get_current_user),
):
    """Re-fetch a policy file from SharePoint and stream it to the client."""
    from app.config import settings
    from app.graph_sync import sp_client

    with SessionLocal() as db:
        policy = (
            db.query(Policy)
            .filter(Policy.id == policy_id, Policy.source_key.like("sp:%"))
            .first()
        )
        if not policy:
            raise HTTPException(status_code=404, detail="Policy not found.")
        source_key = policy.source_key
        filename = _filename_from_source_key(source_key)

    # source_key "sp:HR/Leave Policy.pdf" → full path "IQ/HR/Leave Policy.pdf"
    rel_path = source_key[3:]  # strip "sp:"
    base = getattr(settings, "SHAREPOINT_BASE_FOLDER", "") or ""
    full_path = f"{base}/{rel_path}" if base else rel_path

    try:
        site_id = sp_client.get_site_id(settings.SHAREPOINT_SITE_URL)
        drive_id = sp_client.get_drive_id(site_id)
        resp = sp_client.download_file_by_path(drive_id, full_path)
        content = resp.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SharePoint download failed: {e}")

    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(
        content=content,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/categories")
def list_categories(user: CurrentUser = Depends(get_current_user)):
    with SessionLocal() as db:
        rows = (
            db.query(LibraryDocument.category)
            .filter(LibraryDocument.category.isnot(None))
            .distinct()
            .all()
        )
        return {"categories": sorted(r[0] for r in rows if r[0])}


@router.post("/upload")
async def upload_document(
    title: str = Form(...),
    description: str = Form(""),
    category: str = Form(""),
    file: UploadFile = File(...),
    user: CurrentUser = Depends(_require_upload_role),
):
    content = await file.read()
    if len(content) > _MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit.")

    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    file_type = ext or (mimetypes.guess_type(file.filename or "")[0] or "").split("/")[-1] or "file"

    doc = LibraryDocument(
        title=title.strip(),
        description=description.strip() or None,
        category=category.strip() or None,
        filename=file.filename or "document",
        file_type=file_type,
        file_size=len(content),
        file_content=content,
        uploaded_by=user.email,
    )
    with SessionLocal() as db:
        db.add(doc)
        db.commit()
        db.refresh(doc)
        return {
            "id": doc.id,
            "title": doc.title,
            "filename": doc.filename,
            "file_type": doc.file_type,
            "file_size": doc.file_size,
        }


@router.get("/{doc_id}/download")
def download_document(
    doc_id: int,
    user: CurrentUser = Depends(get_current_user),
):
    with SessionLocal() as db:
        doc = db.query(LibraryDocument).filter(LibraryDocument.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")
        mime = mimetypes.guess_type(doc.filename)[0] or "application/octet-stream"
        return Response(
            content=bytes(doc.file_content),
            media_type=mime,
            headers={"Content-Disposition": f'attachment; filename="{doc.filename}"'},
        )


@router.delete("/{doc_id}")
def delete_document(
    doc_id: int,
    user: CurrentUser = Depends(_require_upload_role),
):
    with SessionLocal() as db:
        doc = db.query(LibraryDocument).filter(LibraryDocument.id == doc_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")
        db.delete(doc)
        db.commit()
        return {"ok": True}
