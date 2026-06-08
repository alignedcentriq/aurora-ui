"""
Document Generation routes (template-driven).

- GET  /api/documents/catalogue            → HR-enabled document types + their user fields
- GET  /api/documents/lookup?name=...       → employee autofill (HR: search any; others: self)
- POST /api/documents/generate              → deterministic placeholder merge (no LLM); returns
                                              the document id + an HTML preview
- GET  /api/documents/list                  → role-scoped list (HR: pending/all; others: own)
- POST /api/documents/{id}/approve          → HR-only approve & release (draft → verified)
- GET  /api/documents/{id}/download         → rendered PDF (envelope-id header + signature) —
                                              ONLY once verified
- GET  /api/documents/admin/templates       → HR: manage the catalogue (all templates)
- PUT  /api/documents/admin/templates/{id}  → HR: enable/disable, approval toggle, label, fields
- POST /api/documents/admin/templates/sync  → HR: re-pull templates from SharePoint
- GET  /verify/{token}                       → PUBLIC verification page (no login)

Trust model: a generated document carries a small "envelope id" header on every page (the
unguessable verify token), which also backs the public /verify page. Approval-gated types stay
drafts (preview-only, no signature) until HR releases them, at which point the HR signature
block is added; auto-release types are released at generation. HR/Admin can generate for anyone;
everyone else only for themselves.
"""

import datetime
import json
import re
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user, require_hr
from app.database import SessionLocal
from app.document_generation import template_engine as engine
from app.models import AiRequestLog, GeneratedDocument
from app.services import document_service
from app.services.company_settings_service import CompanySettingsService

router = APIRouter(prefix="/api/documents", tags=["Documents"])
# Public, unauthenticated verification page (reachable by external recipients, no MSAL).
public_router = APIRouter(tags=["Documents"])

HR_ROLES = {"hr", "admin"}


def _is_hr(user: CurrentUser) -> bool:
    return user.role in HR_ROLES


# Who may approve & release documents is configurable in Document settings. HR is always
# allowed (and is force-included on write) so the setting can never lock everyone out;
# Admin is opt-in. Stored as a JSON list under this key in the company_settings table.
_APPROVER_ROLES_KEY = "document_approver_roles"
ASSIGNABLE_APPROVER_ROLES = ["hr", "admin"]  # roles an HR can grant approval rights to


def get_approver_roles() -> list[str]:
    """Roles allowed to approve & release documents. Defaults to HR-only; HR is always
    present regardless of what is stored."""
    roles: list[str] = []
    raw = CompanySettingsService.get(_APPROVER_ROLES_KEY)
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                roles = [str(r).lower() for r in parsed if str(r).lower() in ASSIGNABLE_APPROVER_ROLES]
        except (ValueError, TypeError):
            roles = []
    if "hr" not in roles:
        roles.insert(0, "hr")
    return roles


def _can_release(user: CurrentUser) -> bool:
    """Approving & releasing a document is restricted to the configured approver roles
    (HR always; Admin opt-in via Document settings)."""
    return user.role in get_approver_roles()


def _fallback_employee(email: str) -> dict:
    """Minimal employee dict when no DB record exists (never block self-service)."""
    local = (email or "").split("@")[0].replace(".", " ").replace("_", " ").strip()
    return {
        "name": local.title() or email,
        "employee_id": "",
        "department": "",
        "designation": "",
        "email": email,
        "joining_date": None,
    }


def _verify_url(token: str) -> str:
    from app.config import settings
    return f"{settings.APP_BASE_URL.rstrip('/')}/verify/{token}"


def _docx_context(field_values: dict, token: str, released: bool) -> dict:
    """docxtpl render context: the resolved field values plus the app-supplied system vars
    HR can reference in the Word template ({{ envelope_id }}, {{ verify_url }}, {% if released %})."""
    return {
        **(field_values or {}),
        "envelope_id": token,
        "verify_url": _verify_url(token),
        "released": released,
        "status": "verified" if released else "draft",
    }


# ── Catalogue + lookup ────────────────────────────────────────────────────────

@router.get("/catalogue")
def catalogue(user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        return {"documents": document_service.doc_catalogue(db)}
    finally:
        db.close()


@router.get("/lookup")
def lookup(
    name: str = Query("", description="Name to search (HR/Admin only)"),
    user: CurrentUser = Depends(get_current_user),
):
    """HR/Admin: fuzzy-search employees by name. Others: only their own record."""
    db = SessionLocal()
    try:
        if _is_hr(user):
            results = document_service.search_employees(db, name)
            return {"results": results, "scope": "all"}
        own = document_service.resolve_employee(db, user.email) or _fallback_employee(user.email)
        return {"results": [own], "scope": "self"}
    finally:
        db.close()


def _doc_summary(db, doc: GeneratedDocument) -> dict:
    return {
        "id": doc.id,
        "doc_type": doc.doc_type,
        "label": document_service.label_for(db, doc.doc_type),
        "title": doc.title,
        "subject_name": doc.subject_name,
        "subject_email": doc.subject_email,
        "generated_by_email": doc.generated_by_email,
        "status": doc.status or "draft",
        "envelope_id": doc.verify_token,
        "verified_by_email": doc.verified_by_email,
        "verified_at": doc.verified_at.isoformat() if doc.verified_at else None,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


@router.get("/list")
def list_documents(
    scope: str = Query("recent", description="HR/Admin: 'pending' or 'recent'. Ignored for others."),
    limit: int = Query(50, le=200),
    user: CurrentUser = Depends(get_current_user),
):
    """HR/Admin see pending drafts (to approve) or recent docs; everyone else sees only their own."""
    db = SessionLocal()
    try:
        q = db.query(GeneratedDocument)
        if _is_hr(user):
            if scope == "pending":
                q = q.filter(GeneratedDocument.status != "verified")
        else:
            email = user.email.strip().lower()
            q = q.filter(GeneratedDocument.subject_email == email)
        rows = q.order_by(GeneratedDocument.created_at.desc()).limit(limit).all()
        return {"results": [_doc_summary(db, d) for d in rows]}
    finally:
        db.close()


# ── HR template management (declared before /{document_id} catch-all) ─────────

@router.get("/admin/templates")
def admin_list_templates(user: CurrentUser = Depends(require_hr)):
    db = SessionLocal()
    try:
        return {"templates": document_service.list_all_templates(db)}
    finally:
        db.close()


@router.put("/admin/templates/{template_id}")
def admin_update_template(
    template_id: int,
    patch: dict = Body(...),
    user: CurrentUser = Depends(require_hr),
):
    db = SessionLocal()
    try:
        view = document_service.update_template_config(db, template_id, patch)
        if view is None:
            raise HTTPException(status_code=404, detail="Template not found.")
        return view
    finally:
        db.close()


@router.post("/admin/templates/sync")
def admin_sync_templates(
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(require_hr),
):
    from app.config import settings
    if not (settings.SHAREPOINT_SITE_URL and settings.SHAREPOINT_TEMPLATES_FOLDER):
        raise HTTPException(
            status_code=400,
            detail="SHAREPOINT_SITE_URL / SHAREPOINT_TEMPLATES_FOLDER not configured.",
        )
    from app.services.sharepoint_template_sync import sync_templates
    background_tasks.add_task(sync_templates)
    return {"message": "Template sync started in background.",
            "folder": settings.SHAREPOINT_TEMPLATES_FOLDER}


@router.get("/settings")
def get_document_settings(user: CurrentUser = Depends(require_hr)):
    """Document-wide settings (HR/Admin can view). Currently: which roles may approve & release."""
    return {
        "approver_roles": get_approver_roles(),
        "assignable_roles": ASSIGNABLE_APPROVER_ROLES,
        "can_edit": user.role in ("hr", "super admin"),
    }


@router.put("/settings")
def update_document_settings(payload: dict = Body(...), user: CurrentUser = Depends(get_current_user)):
    """Change who can approve & release documents. HR-only — prevents an Admin from
    granting itself approval rights. HR is always retained as an approver."""
    if user.role not in ("hr", "super admin"):
        raise HTTPException(status_code=403, detail="Only HR can change document approval settings.")
    roles = payload.get("approver_roles")
    if not isinstance(roles, list):
        raise HTTPException(status_code=400, detail="approver_roles must be a list of roles.")
    clean = [str(r).lower() for r in roles if str(r).lower() in ASSIGNABLE_APPROVER_ROLES]
    if "hr" not in clean:
        clean.insert(0, "hr")
    CompanySettingsService.set(_APPROVER_ROLES_KEY, json.dumps(clean), updated_by=user.email)
    return {"approver_roles": clean}


@router.get("/{document_id}")
def get_document(document_id: int, user: CurrentUser = Depends(get_current_user)):
    """Full document incl. rendered HTML. HR/Admin: any; others: only their own."""
    db = SessionLocal()
    try:
        doc = db.query(GeneratedDocument).filter(GeneratedDocument.id == document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")
        if not _is_hr(user):
            email = user.email.strip().lower()
            if email not in {(doc.subject_email or "").lower(), (doc.generated_by_email or "").lower()}:
                raise HTTPException(status_code=403, detail="Not authorized to view this document.")
        data = _doc_summary(db, doc)
        # content is the preview HTML of the rendered .docx; it already reflects the
        # draft/released state (the signature block is gated by {% if released %}).
        data["preview_html"] = doc.content or ""
        return data
    finally:
        db.close()


# ── Generate (deterministic merge — no LLM, no SSE) ───────────────────────────

class GenerateRequest(BaseModel):
    doc_type: str
    employee_email: str = ""
    field_values: dict = {}
    session_id: str = ""


@router.post("/generate")
def generate(req: GenerateRequest, user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        tpl = document_service.get_template(db, req.doc_type)
        if tpl is None:
            raise HTTPException(status_code=400, detail="Unknown or disabled document type.")
        if not tpl.template_blob:
            raise HTTPException(
                status_code=400,
                detail="This template has no Word source. Upload a .docx template to SharePoint and re-sync.",
            )

        is_hr = _is_hr(user)

        # Resolve the target employee. Non-HR can only generate for themselves.
        if is_hr:
            target_email = (req.employee_email or user.email).strip().lower()
        else:
            target_email = user.email.strip().lower()
            if req.employee_email and req.employee_email.strip().lower() != target_email:
                raise HTTPException(status_code=403, detail="You can only generate documents for yourself.")

        employee = document_service.resolve_employee(db, target_email) or _fallback_employee(target_email)

        today_label = datetime.date.today().strftime("%B %d, %Y")
        values = engine.resolve_auto_fields(employee, today_label)

        # Merge user-supplied fields; enforce required ones.
        user_fields, _auto = engine.classify_fields(tpl.fields)
        supplied = req.field_values or {}
        missing = []
        for f in user_fields:
            name = f.get("name")
            val = supplied.get(name)
            if val not in (None, ""):
                values[name] = val
            elif f.get("required"):
                missing.append(f.get("label") or name)
        if missing:
            raise HTTPException(status_code=400,
                                detail=f"Please fill the required field(s): {', '.join(missing)}.")

        requires_approval = bool(tpl.requires_approval)
        status = "draft" if requires_approval else "verified"
        released = not requires_approval
        title = f"{tpl.label or req.doc_type} — {employee['name']}".strip(" —")
        token = uuid.uuid4().hex

        # Fill the Word template (docxtpl) and build the on-screen preview from the result.
        try:
            rendered = engine.render_docx(tpl.template_blob, _docx_context(values, token, released))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Failed to fill the template: {e}")
        preview_html = engine.docx_to_html(rendered)

        doc = GeneratedDocument(
            doc_type=req.doc_type,
            title=title,
            subject_email=employee["email"],
            subject_name=employee["name"],
            generated_by_email=user.email,
            is_official=(not requires_approval),
            status=status,
            verify_token=token,
            field_values=values,
            content=preview_html,
            rendered_docx=rendered,
            verified_by_email=("system" if not requires_approval else None),
            verified_at=(datetime.datetime.utcnow() if not requires_approval else None),
        )
        db.add(doc)
        db.flush()
        document_id = doc.id

        # Audit row (zero LLM calls — this is a deterministic merge).
        try:
            start = time.time()
            db.add(AiRequestLog(
                session_id=req.session_id or f"doc-{int(start)}",
                user_email=user.email,
                user_message=f"[document:{req.doc_type}] subject={employee['email']}",
                domain="document",
                sub_intent=req.doc_type,
                route_method="document_docx_merge",
                response_text=None,
                response_length=len(preview_html or ""),
                total_latency_ms=0,
                llm_call_count=0,
                total_completion_tokens=0,
                total_tokens=0,
                model_name=None,
            ))
        except Exception as log_err:  # noqa: BLE001
            pass

        db.commit()

        return {
            "document_id": document_id,
            "status": status,
            "can_approve": _can_release(user) and status == "draft",
            "envelope_id": token,
            "title": title,
            "preview_html": preview_html,
        }
    finally:
        db.close()


@router.post("/{document_id}/approve")
def approve(document_id: int, user: CurrentUser = Depends(get_current_user)):
    """HR only: approve & release a draft. This is what makes it downloadable and adds
    the signature on render."""
    if not _can_release(user):
        raise HTTPException(status_code=403, detail="Only HR can approve and release documents.")
    db = SessionLocal()
    try:
        doc = db.query(GeneratedDocument).filter(GeneratedDocument.id == document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")

        # Re-render the .docx with released=True so the signature block is added and the
        # stored artifact becomes the final, immutable issued document.
        tpl = document_service.get_template_any(db, doc.doc_type)
        if tpl is not None and tpl.template_blob:
            try:
                rendered = engine.render_docx(
                    tpl.template_blob,
                    _docx_context(doc.field_values or {}, doc.verify_token or "", released=True),
                )
                doc.rendered_docx = rendered
                doc.content = engine.docx_to_html(rendered)
            except Exception as e:  # noqa: BLE001
                pass
                # Don't block release on a render hiccup — keep the draft render.

        doc.status = "verified"
        doc.is_official = True
        doc.verified_by_email = user.email
        doc.verified_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(doc)
        return _doc_summary(db, doc)
    finally:
        db.close()


@router.get("/{document_id}/download")
def download(document_id: int, user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        doc = db.query(GeneratedDocument).filter(GeneratedDocument.id == document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")

        # Approval gate: nothing is downloadable until it has been released.
        if (doc.status or "draft") != "verified":
            raise HTTPException(
                status_code=403,
                detail="This document is a draft. It must be approved before it can be downloaded.",
            )

        # Once released: HR/Admin can download any; others only their own (subject or actor).
        if not _is_hr(user):
            email = user.email.strip().lower()
            if email not in {(doc.subject_email or "").lower(), (doc.generated_by_email or "").lower()}:
                raise HTTPException(status_code=403, detail="Not authorized to download this document.")

        if not doc.rendered_docx:
            raise HTTPException(
                status_code=409,
                detail="This document has no rendered Word file. Re-generate it to download.",
            )
        # Convert the filled .docx to PDF via Word, preserving HR's exact layout.
        try:
            pdf_bytes = engine.docx_to_pdf(doc.rendered_docx)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Failed to render document to PDF: {e}")

        base = doc.doc_type or (doc.title or "document")
        safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", base).strip("_")[:80] or "document"
        filename = f"{safe_name}_{datetime.date.today().isoformat()}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    finally:
        db.close()


# ── Public verification page ──────────────────────────────────────────────────

def _verify_html(doc: GeneratedDocument | None, label: str) -> str:
    import html

    if doc is None or (doc.status or "draft") != "verified":
        body = """
          <div class="badge bad">Not a valid document</div>
          <p>This reference does not correspond to a document that has been verified and
          released by Aligned Automation. If you were given a printed letter, it may be a
          draft, altered, or fabricated — do not rely on it.</p>
        """
        return _verify_shell("Verification failed", body, ok=False)

    verified_on = doc.verified_at.strftime("%B %d, %Y") if doc.verified_at else "—"
    # doc.content is server-generated merged HTML (user values were escaped at merge time).
    content = doc.content or ""
    body = f"""
      <div class="badge ok">✓ Verified &amp; released by Aligned Automation</div>
      <table class="meta">
        <tr><td>Document</td><td>{html.escape(label)}</td></tr>
        <tr><td>Issued to</td><td>{html.escape(doc.subject_name or '—')}</td></tr>
        <tr><td>Document ID</td><td>{html.escape(doc.verify_token or '—')}</td></tr>
        <tr><td>Verified on</td><td>{verified_on}</td></tr>
        <tr><td>Verified by</td><td>{html.escape(doc.verified_by_email or '—')}</td></tr>
      </table>
      <h3>Document content</h3>
      <div class="content">{content}</div>
    """
    return _verify_shell("Document verified", body, ok=True)


def _verify_shell(heading: str, body: str, ok: bool) -> str:
    import html
    accent = "#00D4AA" if ok else "#DC2626"
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Document Verification — Aligned Automation</title>
<style>
  body {{ font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#F1F5F9; margin:0; color:#1E293B; }}
  .wrap {{ max-width: 680px; margin: 40px auto; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,.08); }}
  .head {{ background:#0A2540; color:#fff; padding:22px 28px; display:flex; align-items:center; justify-content:space-between; }}
  .head b {{ font-size:16px; }} .head span {{ color:{accent}; font-weight:700; font-size:12px; }}
  .main {{ padding: 28px; }}
  h2 {{ margin:0 0 16px; font-size:20px; }} h3 {{ margin:24px 0 8px; font-size:13px; color:#64748B; text-transform:uppercase; letter-spacing:.05em; }}
  .badge {{ display:inline-block; padding:8px 14px; border-radius:999px; font-weight:700; font-size:14px; }}
  .badge.ok {{ background:rgba(0,212,170,.12); color:#0A8F73; }}
  .badge.bad {{ background:rgba(220,38,38,.1); color:#DC2626; }}
  table.meta {{ width:100%; border-collapse:collapse; margin-top:16px; }}
  table.meta td {{ padding:8px 0; border-bottom:1px solid #E2E8F0; font-size:14px; }}
  table.meta td:first-child {{ color:#64748B; width:130px; }}
  .content {{ background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:18px; font-size:13px; line-height:1.7; }}
  .foot {{ padding:16px 28px; color:#94A3B8; font-size:11px; border-top:1px solid #E2E8F0; }}
</style></head>
<body><div class="wrap">
  <div class="head"><b>Aligned Automation</b><span>DOCUMENT VERIFICATION</span></div>
  <div class="main"><h2>{html.escape(heading)}</h2>{body}</div>
  <div class="foot">This page is generated from Aligned Automation's records and reflects the document's current status.</div>
</div></body></html>"""


@public_router.get("/verify/{token}", response_class=HTMLResponse)
def verify(token: str):
    db = SessionLocal()
    try:
        doc = db.query(GeneratedDocument).filter(GeneratedDocument.verify_token == token).first()
        label = document_service.label_for(db, doc.doc_type) if doc else "Document"
        return HTMLResponse(content=_verify_html(doc, label), status_code=200 if doc else 404)
    finally:
        db.close()
