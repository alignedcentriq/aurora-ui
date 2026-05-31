"""
Document Generation routes.

- GET  /api/documents/catalogue        → available document types
- GET  /api/documents/lookup?name=...  → employee autofill (HR: search any; others: self only)
- POST /api/documents/generate         → SSE stream of the generated letter text (always a draft)
- GET  /api/documents/list             → role-scoped list (HR: pending/all; others: own)
- POST /api/documents/{id}/approve     → HR/Admin approve & release (draft → verified)
- GET  /api/documents/{id}/download    → branded PDF — ONLY allowed once verified
- GET  /verify/{token}                 → PUBLIC verification page (served by backend, no login)

Trust model: every generated document starts as a *draft* and is preview-only. Nobody can
download it until an HR/Admin user explicitly approves & releases it. The released PDF is
clean and carries a QR code that points at the public /verify page, which is the source of
truth for authenticity — so a screenshot/photo of the watermarked draft preview is never a
valid document. HR/Admin can generate for anyone; everyone else only for themselves.
"""

import datetime
import html
import json
import re
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.database import SessionLocal
from app.document_generation.generator import DOC_TYPE_LABELS, generate_pdf
from app.models import AiLlmCallLog, AiRequestLog, GeneratedDocument
from app.services import document_service

router = APIRouter(prefix="/api/documents", tags=["Documents"])
# Public, unauthenticated verification page (reachable by external recipients, no MSAL).
public_router = APIRouter(tags=["Documents"])

HR_ROLES = {"hr", "admin"}


def _is_hr(user: CurrentUser) -> bool:
    return user.role in HR_ROLES


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
    return f"{settings.APP_BASE_URL.rstrip('/')}/verify/{token}"


@router.get("/catalogue")
def catalogue(user: CurrentUser = Depends(get_current_user)):
    return {"documents": document_service.doc_catalogue()}


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


def _doc_summary(doc: GeneratedDocument) -> dict:
    return {
        "id": doc.id,
        "doc_type": doc.doc_type,
        "label": DOC_TYPE_LABELS.get(doc.doc_type, "Document"),
        "title": doc.title,
        "subject_name": doc.subject_name,
        "subject_email": doc.subject_email,
        "generated_by_email": doc.generated_by_email,
        "status": doc.status or "draft",
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
        return {"results": [_doc_summary(d) for d in rows]}
    finally:
        db.close()


@router.get("/{document_id}")
def get_document(document_id: int, user: CurrentUser = Depends(get_current_user)):
    """Full document incl. content. HR/Admin: any; others: only their own (for review/preview)."""
    db = SessionLocal()
    try:
        doc = db.query(GeneratedDocument).filter(GeneratedDocument.id == document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")
        if not _is_hr(user):
            email = user.email.strip().lower()
            if email not in {(doc.subject_email or "").lower(), (doc.generated_by_email or "").lower()}:
                raise HTTPException(status_code=403, detail="Not authorized to view this document.")
        data = _doc_summary(doc)
        data["content"] = doc.content or ""
        return data
    finally:
        db.close()


class GenerateRequest(BaseModel):
    doc_type: str
    employee_email: str = ""
    purpose: str = ""
    additional_info: str = ""
    session_id: str = ""


@router.post("/generate")
async def generate(req: GenerateRequest, user: CurrentUser = Depends(get_current_user)):
    if req.doc_type not in document_service.DOC_TEMPLATES:
        raise HTTPException(status_code=400, detail="Unknown document type.")

    is_hr = _is_hr(user)

    # Resolve the target employee. Non-HR can only generate for themselves.
    if is_hr:
        target_email = (req.employee_email or user.email).strip().lower()
    else:
        target_email = user.email.strip().lower()
        if req.employee_email and req.employee_email.strip().lower() != target_email:
            raise HTTPException(status_code=403, detail="You can only generate documents for yourself.")

    db = SessionLocal()
    try:
        employee = document_service.resolve_employee(db, target_email) or _fallback_employee(target_email)
    finally:
        db.close()

    label = DOC_TYPE_LABELS.get(req.doc_type, "Document")
    title = f"{label} — {employee['name']}".strip(" —")

    async def stream():
        start = time.time()
        accumulated = ""
        error_msg = None
        document_id = None
        try:
            # `is_hr` only flavours the prose (self-service note); storage is always a draft.
            async for chunk in document_service.generate_stream(
                req.doc_type, employee, req.purpose, req.additional_info, is_hr
            ):
                accumulated += chunk
                yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"
        except Exception as e:  # noqa: BLE001
            error_msg = str(e)
            yield f"data: {json.dumps({'type': 'error', 'content': 'Generation failed. Please try again.'})}\n\n"

        db2 = SessionLocal()
        try:
            if accumulated and not error_msg:
                doc = GeneratedDocument(
                    doc_type=req.doc_type,
                    title=title,
                    subject_email=employee["email"],
                    subject_name=employee["name"],
                    generated_by_email=user.email,
                    is_official=False,
                    status="draft",
                    verify_token=uuid.uuid4().hex,
                    purpose=req.purpose or None,
                    additional_info=req.additional_info or None,
                    content=accumulated,
                )
                db2.add(doc)
                db2.flush()
                document_id = doc.id

            latency_ms = int((time.time() - start) * 1000)
            est_completion = max(1, len(accumulated) // 4)
            req_log = AiRequestLog(
                session_id=req.session_id or f"doc-{int(start)}",
                user_email=user.email,
                user_message=f"[document:{req.doc_type}] subject={employee['email']} purpose={req.purpose[:200]}",
                domain="document",
                sub_intent=req.doc_type,
                route_method="document_generation",
                response_text=accumulated[:2000] if accumulated else None,
                response_length=len(accumulated),
                total_latency_ms=latency_ms,
                llm_call_count=1,
                total_completion_tokens=est_completion,
                total_tokens=est_completion,
                model_name=settings.AGENT_MODEL_NAME,
                error=error_msg,
            )
            db2.add(req_log)
            db2.flush()
            db2.add(AiLlmCallLog(
                request_id=req_log.id,
                node="document_generation",
                model=settings.AGENT_MODEL_NAME,
                duration_ms=latency_ms,
                completion_tokens=est_completion,
                total_tokens=est_completion,
                error=error_msg,
            ))
            db2.commit()
        except Exception as log_err:  # noqa: BLE001
            db2.rollback()
            print(f"[documents] persist/log error: {log_err}")
        finally:
            db2.close()

        if not error_msg:
            yield (
                "data: "
                + json.dumps({
                    "type": "done",
                    "document_id": document_id,
                    "status": "draft",
                    "can_approve": is_hr,
                    "title": title,
                })
                + "\n\n"
            )

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.post("/{document_id}/approve")
def approve(document_id: int, user: CurrentUser = Depends(get_current_user)):
    """HR/Admin only: approve & release a draft. This is what makes it downloadable."""
    if not _is_hr(user):
        raise HTTPException(status_code=403, detail="Only HR or Admin can approve and release documents.")
    db = SessionLocal()
    try:
        doc = db.query(GeneratedDocument).filter(GeneratedDocument.id == document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")
        doc.status = "verified"
        doc.is_official = True
        doc.verified_by_email = user.email
        doc.verified_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(doc)
        return _doc_summary(doc)
    finally:
        db.close()


@router.get("/{document_id}/download")
def download(document_id: int, user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        doc = db.query(GeneratedDocument).filter(GeneratedDocument.id == document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")

        # Approval gate: nothing is downloadable until HR/Admin has released it.
        if (doc.status or "draft") != "verified":
            raise HTTPException(
                status_code=403,
                detail="This document is a draft. It must be approved by HR before it can be downloaded.",
            )

        # Once released: HR/Admin can download any; others only their own (subject or actor).
        if not _is_hr(user):
            email = user.email.strip().lower()
            if email not in {(doc.subject_email or "").lower(), (doc.generated_by_email or "").lower()}:
                raise HTTPException(status_code=403, detail="Not authorized to download this document.")

        pdf_bytes = generate_pdf(
            doc_type=doc.doc_type,
            title=doc.title or "Document",
            content=doc.content or "",
            generated_by="Aligned Automation HR",
            thread_id=str(doc.id),
            watermark="",
            qr_url=_verify_url(doc.verify_token) if doc.verify_token else "",
        )
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

def _verify_html(doc: GeneratedDocument | None) -> str:
    if doc is None or (doc.status or "draft") != "verified":
        body = """
          <div class="badge bad">Not a valid document</div>
          <p>This reference does not correspond to a document that has been verified and
          released by Aligned Automation HR. If you were given a printed letter, it may be a
          draft, altered, or fabricated — do not rely on it.</p>
        """
        return _verify_shell("Verification failed", body, ok=False)

    verified_on = doc.verified_at.strftime("%B %d, %Y") if doc.verified_at else "—"
    content = html.escape(doc.content or "").replace("\n", "<br>")
    body = f"""
      <div class="badge ok">✓ Verified &amp; released by HR</div>
      <table class="meta">
        <tr><td>Document</td><td>{html.escape(DOC_TYPE_LABELS.get(doc.doc_type, 'Document'))}</td></tr>
        <tr><td>Issued to</td><td>{html.escape(doc.subject_name or '—')}</td></tr>
        <tr><td>Verified on</td><td>{verified_on}</td></tr>
        <tr><td>Verified by</td><td>{html.escape(doc.verified_by_email or '—')}</td></tr>
      </table>
      <h3>Document content</h3>
      <div class="content">{content}</div>
    """
    return _verify_shell("Document verified", body, ok=True)


def _verify_shell(heading: str, body: str, ok: bool) -> str:
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
        return HTMLResponse(content=_verify_html(doc), status_code=200 if doc else 404)
    finally:
        db.close()
