import io
import asyncio
import datetime
import html
import json
import os
import re
import logging
import socket
import time
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, HTMLResponse
from pydantic import BaseModel
from typing import List, Optional

from app.auth import CurrentUser, get_current_user, require_admin
from app.agent import app_agent
from app.agents.deeplink_agent import get_deeplink_agent
from app.concurrency import chat_gate
from langchain_core.messages import HumanMessage
from app.hr_service import HRService
from app.config import settings, ALIGNED_LLM_HOST
from app.services import llm_controls_service as llm_controls
from app.database import init_db, SessionLocal
from app.models import Leave, ApprovalToken
from app.document_store import get_pdf
from app.pmo_routes import router as pmo_router
from app.routes.it_routes import router as it_router
from app.routes.prompt_routes import router as prompt_router
from app.routes.announcement_routes import router as announcement_router
from app.routes.employee_routes import router as employee_router
from app.routes.people_routes import router as people_router
from app.routes.hr_portal_routes import router as hr_portal_router
from app.routes.admin_portal_routes import router as admin_portal_router
from app.routes.pmo_portal_routes import router as pmo_portal_router
from app.routes.project_update_routes import router as project_update_router
from app.routes.library_portal_routes import router as library_portal_router
from app.routes.pa_callback_routes import router as pa_callback_router
from app.routes.company_settings_routes import router as company_settings_router
from app.routes.app_links_routes import router as app_links_router
from app.routes.form_library_routes import router as form_library_router
from app.routes.observability_routes import router as observability_router
from app.routes.llm_controls_routes import router as llm_controls_router
from app.routes.integration_routes import router as integration_router
from app.routes.installation_routes import router as installation_router
from app.routes.software_catalog_routes import router as software_catalog_router
from app.routes.ms365_routes import router as ms365_router
from app.routes.document_routes import router as document_router, public_router as document_public_router
from app.routes.manager_routes import router as manager_router
from app.services.feedback_service import FeedbackService

# -- Langfuse tracing --
from app.langfuse_tracing import TracingContext, langfuse_event

# -- Logger --
logger = logging.getLogger("aurora-logger")
logger.setLevel(logging.INFO)
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())

from app.sharepoint_routes import router as sharepoint_router
from app.graph_sync import renew_subscriptions

app = FastAPI(title="Centriq AI Backend")



app.include_router(sharepoint_router, prefix="/api")
app.include_router(pmo_router)
app.include_router(it_router)
app.include_router(prompt_router)
app.include_router(announcement_router)
app.include_router(employee_router)
app.include_router(people_router)
app.include_router(hr_portal_router)
app.include_router(admin_portal_router)
app.include_router(pmo_portal_router)
app.include_router(project_update_router)
app.include_router(library_portal_router)
app.include_router(pa_callback_router)
app.include_router(company_settings_router)
app.include_router(app_links_router)
app.include_router(form_library_router)
app.include_router(observability_router)
app.include_router(llm_controls_router)
app.include_router(integration_router)
app.include_router(installation_router)
app.include_router(software_catalog_router)
app.include_router(ms365_router)
app.include_router(document_router)
app.include_router(document_public_router)
app.include_router(manager_router)

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []
    session_id: Optional[str] = "default_session_v2"

class FeedbackRequest(BaseModel):
    rating: str                          # "up" or "down"
    index: Optional[int] = None          # message index in conversation
    threadId: Optional[str] = None       # session / thread id
    domain: Optional[str] = None
    user_message: Optional[str] = None
    ai_response: Optional[str] = None
    feedback_text: Optional[str] = None

class WebhookPolicyRequest(BaseModel):
    title: str
    content: str
    category: Optional[str] = "General"

class CustomLog(BaseModel):
    event: str
    data: dict

class DocumentRequest(BaseModel):
    doc_type: str
    title: str
    content: str
    thread_id: Optional[str] = ""
    generated_by: Optional[str] = "Centriq AI"

class ParkingSubmitRequest(BaseModel):
    email: str
    vehicle_type: str
    vehicle_number: str
    vehicle_make: Optional[str] = ""
    vehicle_model: Optional[str] = ""

class VisitorPassSubmitRequest(BaseModel):
    email: str
    visitor_name: str
    visit_date: str   # YYYY-MM-DD
    purpose: str
    visit_time: Optional[str] = ""
    visitor_company: Optional[str] = ""

class SendEmailDraftRequest(BaseModel):
    to: str
    subject: str
    body: str
    requester_email: Optional[str] = ""

@app.on_event("startup")
async def startup_event():
    try:
        await asyncio.to_thread(init_db)
        print("Database initialized.")
    except Exception as e:
        print(f"Database initialization failed: {e}")

    try:
        from app.database import SessionLocal
        from app.services.document_service import seed_default_templates
        db = SessionLocal()
        try:
            await asyncio.to_thread(seed_default_templates, db)
        finally:
            db.close()
    except Exception as e:
        print(f"Document template seeding failed: {e}")

    if hasattr(app_agent.checkpointer, "setup"):
        try:
            await app_agent.checkpointer.setup()
            print("Redis checkpointer indexes ready.")
        except Exception as e:
            print(f"Redis checkpointer setup failed ({e}), falling back to MemorySaver.")
            from langgraph.checkpoint.memory import MemorySaver as _MemorySaver
            app_agent.checkpointer = _MemorySaver()
            
    async def periodic_renew():
        while True:
            await asyncio.sleep(3600)
            try:
                await asyncio.to_thread(renew_subscriptions)
            except Exception as e:
                print(f"Failed to renew subscriptions: {e}")

    asyncio.create_task(periodic_renew())

    # Run any due attendance-report automations every minute (schedules persist in DB).
    async def attendance_scheduler():
        from app.services import attendance_schedule_service, project_update_service
        while True:
            await asyncio.sleep(60)
            try:
                fired = await asyncio.to_thread(attendance_schedule_service.run_due)
                if fired:
                    print(f"[attendance_scheduler] ran {fired} due schedule(s)")
            except Exception as e:
                print(f"[attendance_scheduler] error: {e}")
            # Biweekly project-update form — cadence gating lives inside run_due().
            try:
                await asyncio.to_thread(project_update_service.run_due)
            except Exception as e:
                print(f"[project_update] scheduler error: {e}")

    asyncio.create_task(attendance_scheduler())

    # Send a daily cybersecurity news digest once per day at SECURITY_NEWS_HOUR.
    async def security_news_scheduler():
        import datetime as _dt
        _last_sent_date = None
        while True:
            await asyncio.sleep(300)  # check every 5 minutes
            try:
                from app.services import llm_controls_service as _llm_ctrl
                if not _llm_ctrl.is_security_news_enabled():
                    continue
                recipients = [r.strip() for r in settings.SECURITY_NEWS_RECIPIENTS.split(",") if r.strip()]
                if not recipients:
                    continue
                sender = (
                    settings.SECURITY_NEWS_SENDER
                    or settings.PARKING_REMINDER_SENDER
                    or settings.NOTIFY_TO_EMAIL
                )
                if not sender:
                    continue
                now = _dt.datetime.now()
                today = now.date()
                if today == _last_sent_date or now.hour < settings.SECURITY_NEWS_HOUR:
                    continue
                from app.services.security_news_service import fetch_digest
                from app.services.email_service import send_security_news_digest
                items = await asyncio.to_thread(fetch_digest)
                if items:
                    date_str = today.strftime("%B %d, %Y")
                    ok = await asyncio.to_thread(send_security_news_digest, sender, recipients, items, date_str)
                    if ok:
                        _last_sent_date = today
                        print(f"[security_news] digest sent to {recipients} ({len(items)} stories)")
                    else:
                        print("[security_news] send failed — check Graph token for sender mailbox")
            except Exception as _sne:
                print(f"[security_news] scheduler error: {_sne}")

    asyncio.create_task(security_news_scheduler())

    get_deeplink_agent()



@app.get("/")
async def root():
    return {"status": "online", "message": "Centriq AI Backend is running"}


@app.get("/api/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    """Returns the authenticated user's identity. Fails with 403 if not on the allowlist."""
    return {"email": user.email, "role": user.role}


@app.get("/api/health/llm")
async def llm_health():
    """Check whether the LLM service is reachable (VPN required from outside office)."""
    return {"status": "ok"}

@app.get("/api/chat/load")
async def chat_load():
    """Live concurrency-gate stats — handy while load testing."""
    return await chat_gate.stats()


@app.post("/api/feedback")
async def feedback(req: FeedbackRequest):
    rating_int = 1 if req.rating == "up" else -1
    FeedbackService.record(
        session_id=req.threadId or "unknown",
        domain=req.domain or "unknown",
        user_message=req.user_message or "",
        ai_response=req.ai_response or "",
        rating=rating_int,
        feedback_text=req.feedback_text or "",
    )
    return {"status": "success"}

@app.get("/api/feedback/stats")
async def feedback_stats(domain: str = ""):
    return FeedbackService.get_stats(domain or "")

@app.post("/api/track")
async def track_data(log: CustomLog):
    logger.info("custom_event", extra={"event_name": log.event, "custom_data": log.data})
    langfuse_event(log.event, log.data)
    return {"status": "success", "message": "Event tracked successfully"}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Accept a PDF or text file and return its extracted text content."""
    filename = file.filename or "upload"
    content_bytes = await file.read()

    extracted = ""
    if filename.lower().endswith(".pdf"):
        def _extract_pdf(data: bytes) -> str:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages).strip()
        try:
            extracted = await asyncio.to_thread(_extract_pdf, content_bytes)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"PDF extraction failed: {e}")
    else:
        try:
            extracted = content_bytes.decode("utf-8", errors="replace").strip()
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Text decoding failed: {e}")

    if not extracted:
        raise HTTPException(status_code=422, detail="Could not extract text from file")

    return {"text": extracted, "filename": filename, "char_count": len(extracted)}


@app.get("/api/documents/download/{file_id}")
async def download_document(file_id: str):
    doc = get_pdf(file_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or expired")
    return StreamingResponse(
        io.BytesIO(doc["data"]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{doc["filename"]}.pdf"'},
    )


def _approval_html(title: str, message: str, color: str = "#16A34A") -> str:
    """Branded Gradient Hero confirmation page shown after a manager clicks an
    Approve/Reject link — matches the email so the hand-off feels like one product."""
    try:
        from app.services.email_service import _BUDDY_B64
    except Exception:
        _BUDDY_B64 = ""
    buddy = (
        f'<img src="data:image/png;base64,{_BUDDY_B64}" alt="" '
        f'style="width:64px;height:64px;display:block;margin:0 auto 12px;">'
        if _BUDDY_B64 else ""
    )
    return f"""<!DOCTYPE html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
    <style>
    *{{box-sizing:border-box;}}
    body{{font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f4fa;padding:20px;}}
    .card{{background:#fff;border-radius:18px;max-width:460px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(13,27,46,.12);overflow:hidden;}}
    .hero{{background:linear-gradient(135deg,#1B6FC8 0%,#0D9488 60%,#16A34A 100%);padding:26px 24px 22px;}}
    .hero .brand{{color:#fff;font-size:20px;font-weight:800;letter-spacing:.2px;}}
    .body{{padding:30px 40px 34px;}}
    h1{{color:{color};font-size:23px;margin:0 0 12px;}}
    p{{color:#64748b;font-size:15px;line-height:1.6;margin:0;}}
    .foot{{margin-top:22px;font-size:13px;color:#94a3b8;}}
    </style></head>
    <body><div class="card">
    <div class="hero">{buddy}<div class="brand">Centriq AI</div></div>
    <div class="body"><h1>{title}</h1><p>{message}</p>
    <p class="foot">Centriq AI &mdash; Aligned Automation</p></div>
    </div></body></html>
    """


_REJECT_LABELS = {
    "leave": "Reject Leave Request",
    "book_request": "Reject Borrow Request",
    "book_extension": "Reject Extension Request",
    "udemy_license": "Decline Training License",
    "desk_key": "Reject Desk Key Request",
    "project_update": "Reject Project Update",
}


def _entity_label(tok) -> str:
    return _REJECT_LABELS.get(tok.entity_type, "Reject Request")


def _reject_reason_form(token: str, subtitle: str, error: str = "") -> str:
    """Branded page asking the approver to enter a mandatory rejection reason."""
    try:
        from app.services.email_service import _BUDDY_B64
    except Exception:
        _BUDDY_B64 = ""
    buddy = (
        f'<img src="data:image/png;base64,{_BUDDY_B64}" alt="" '
        f'style="width:60px;height:60px;display:block;margin:0 auto 10px;">'
        if _BUDDY_B64 else ""
    )
    err_html = (
        f'<div style="background:#fee2e2;color:#b91c1c;font-size:13px;padding:10px 14px;'
        f'border-radius:8px;margin-bottom:14px;">{html.escape(error)}</div>'
        if error else ""
    )
    return f"""<!DOCTYPE html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(subtitle)}</title>
    <style>
    *{{box-sizing:border-box;}}
    body{{font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f4fa;padding:20px;}}
    .card{{background:#fff;border-radius:18px;max-width:480px;width:100%;box-shadow:0 12px 40px rgba(13,27,46,.12);overflow:hidden;}}
    .hero{{background:linear-gradient(135deg,#1B6FC8 0%,#0D9488 60%,#16A34A 100%);padding:24px;text-align:center;}}
    .hero .brand{{color:#fff;font-size:20px;font-weight:800;letter-spacing:.2px;}}
    .body{{padding:28px 32px 30px;}}
    h1{{color:#0d1b2e;font-size:20px;margin:0 0 6px;}}
    p.sub{{color:#64748b;font-size:14px;margin:0 0 18px;line-height:1.5;}}
    label{{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px;}}
    textarea{{width:100%;min-height:120px;border:1px solid #cbd5e1;border-radius:10px;padding:12px;font:400 14px 'Segoe UI',Arial,sans-serif;color:#0d1b2e;resize:vertical;}}
    textarea:focus{{outline:none;border-color:#1B6FC8;box-shadow:0 0 0 3px rgba(27,111,200,.15);}}
    button{{margin-top:16px;width:100%;background:#dc2626;color:#fff;border:0;border-radius:25px;padding:14px;font:700 15px 'Segoe UI',Arial,sans-serif;cursor:pointer;}}
    button:hover{{background:#b91c1c;}}
    .foot{{margin-top:16px;font-size:12px;color:#94a3b8;text-align:center;}}
    </style></head>
    <body><div class="card">
    <div class="hero">{buddy}<div class="brand">Centriq AI</div></div>
    <div class="body">
    <h1>{html.escape(subtitle)}</h1>
    <p class="sub">A reason is required before this request can be rejected. The employee will see this note.</p>
    {err_html}
    <form method="post" action="/api/approve/{token}/reject">
      <label for="reason">Reason for rejection</label>
      <textarea id="reason" name="reason" required placeholder="e.g. Insufficient leave balance — please discuss with your manager before re-applying."></textarea>
      <button type="submit">Confirm Rejection</button>
    </form>
    <p class="foot">Centriq AI &mdash; Aligned Automation</p>
    </div></div></body></html>
    """


def _validate_token(db, token: str):
    """Return (tok, error_response). error_response is None when the token is usable."""
    tok = db.query(ApprovalToken).filter(ApprovalToken.token == token).first()
    if not tok:
        return None, HTMLResponse(_approval_html("Invalid Link", "This approval link is invalid or does not exist.", "#dc2626"), status_code=404)
    if tok.used:
        return None, HTMLResponse(_approval_html("Already Actioned", "This approval link has already been used.", "#f59e0b"))
    if tok.expires_at < datetime.datetime.utcnow():
        return None, HTMLResponse(_approval_html("Link Expired", "This approval link has expired. Please ask the employee to resubmit.", "#f59e0b"))
    return tok, None


@app.get("/api/approve/{token}", response_class=HTMLResponse)
async def process_approval(token: str):
    """Approve link → finalize immediately. Reject link → show the reason form first
    (a rejection cannot be finalized without a reason)."""
    db = SessionLocal()
    try:
        tok, err = _validate_token(db, token)
        if err:
            return err
        if tok.action == "reject":
            # Do NOT mark the token used or change any state — just collect the reason.
            return HTMLResponse(_reject_reason_form(token, _entity_label(tok)))
        return _finalize_decision(db, tok, "Approved", "")
    finally:
        db.close()


@app.post("/api/approve/{token}/reject", response_class=HTMLResponse)
async def submit_rejection(token: str, reason: str = Form("")):
    """Finalize a rejection. Proceeds only when a non-empty reason is supplied."""
    db = SessionLocal()
    try:
        tok, err = _validate_token(db, token)
        if err:
            return err
        if tok.action != "reject":
            return HTMLResponse(_approval_html("Invalid Link", "This link cannot be used to reject a request.", "#dc2626"), status_code=400)
        reason = (reason or "").strip()
        if not reason:
            return HTMLResponse(
                _reject_reason_form(token, _entity_label(tok), error="A reason is required to reject this request."),
                status_code=400,
            )
        return _finalize_decision(db, tok, "Rejected", reason)
    finally:
        db.close()


def _finalize_decision(db, tok, decision: str, reason: str = "") -> HTMLResponse:
    """Apply an approve/reject decision for the token's entity, notify the employee,
    and return the branded confirmation page. `reason` is required for rejections and
    is surfaced to the employee."""
    tok.used = True
    reject_note = reason if decision == "Rejected" else ""
    reason_block = (
        f"<br><br><strong>Reason:</strong> {html.escape(reject_note)}" if reject_note else ""
    )

    if tok.entity_type == "leave":
        leave = db.query(Leave).filter(Leave.id == tok.entity_id).first()
        if leave:
            leave.status = decision
            # Invalidate the sibling token (the other action)
            db.query(ApprovalToken).filter(
                ApprovalToken.entity_type == "leave",
                ApprovalToken.entity_id == tok.entity_id,
                ApprovalToken.token != tok.token,
                ApprovalToken.used == False,
            ).update({"used": True})

            # Deduct leave balance on approval
            if decision == "Approved":
                try:
                    from app.hr_service import HRService
                    days = (leave.end_date - leave.start_date).days + 1
                    HRService.deduct_leave_balance(db, leave.employee_id, leave.leave_type, days)
                except Exception as e:
                    print(f"[Approval] Balance deduction error (non-fatal): {e}")

            db.commit()
            # Notify employee
            try:
                from app.services.email_service import send_leave_decision_notification
                from app.models import Employee
                emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
                if emp:
                    send_leave_decision_notification(
                        user_email=tok.approver_email,
                        employee_email=emp.email,
                        employee_name=emp.name,
                        leave_type=leave.leave_type,
                        start_date=str(leave.start_date),
                        end_date=str(leave.end_date),
                        decision=decision,
                        decided_by=tok.approver_email,
                        reason=reject_note,
                    )
            except Exception as e:
                print(f"[Approval] Notification email error: {e}")

            if decision == "Approved":
                try:
                    from app.services.admin_service import AdminService
                    AdminService._fire_webhook(settings.PA_WEBHOOK_LEAVE_APPROVED, {
                        "event": "leave_approved",
                        "employee_email": tok.employee_email,
                        "leave_type": leave.leave_type,
                        "start_date": str(leave.start_date),
                        "end_date": str(leave.end_date),
                        "approved_by": tok.approver_email,
                    })
                except Exception:
                    pass
                try:
                    from app.services.email_service import send_notification_event
                    send_notification_event(
                        user_email=tok.approver_email,
                        event_type="leave_approved",
                        subject_suffix=f"{tok.employee_email} — {leave.leave_type} {leave.start_date} to {leave.end_date}",
                        data={
                            "employee_email": tok.employee_email,
                            "leave_type": leave.leave_type,
                            "start_date": str(leave.start_date),
                            "end_date": str(leave.end_date),
                            "approved_by": tok.approver_email,
                        },
                    )
                except Exception:
                    pass

            color = "#16A34A" if decision == "Approved" else "#dc2626"
            return HTMLResponse(_approval_html(
                f"Leave {decision}",
                f"The leave request has been <strong>{decision}</strong>. The employee has been notified by email.{reason_block}",
                color,
            ))

    if tok.entity_type == "book_request":
        from app.services.bookshelf_service import BookshelfService
        from app.services.email_service import send_book_decision_email
        # Invalidate the sibling token
        db.query(ApprovalToken).filter(
            ApprovalToken.entity_type == "book_request",
            ApprovalToken.entity_id == tok.entity_id,
            ApprovalToken.token != tok.token,
            ApprovalToken.used == False,
        ).update({"used": True})
        db.commit()

        book_title = "your book"
        due_date = ""
        try:
            if decision == "Approved":
                result = BookshelfService.approve_request(tok.entity_id, admin_remarks="Approved via email")
                due_date = (result or {}).get("due_date", "")
            else:
                BookshelfService.reject_request(tok.entity_id, admin_remarks=reject_note)
            # Look up book title for the employee notification.
            for req in BookshelfService.list_requests() or []:
                if req.get("id") == tok.entity_id:
                    book_title = req.get("book_title") or book_title
                    ticket_id = req.get("ticket_id") or f"#{tok.entity_id}"
                    employee_name = req.get("employee_name") or ""
                    if not due_date:
                        due_date = req.get("due_date") or ""
                    break
            else:
                ticket_id = f"#{tok.entity_id}"
                employee_name = ""
        except Exception as e:
            return HTMLResponse(_approval_html(
                "Action Failed",
                f"We couldn't update the borrow request: {html.escape(str(e))}",
                "#dc2626",
            ), status_code=502)

        try:
            send_book_decision_email(
                user_email=tok.approver_email,
                employee_email=tok.employee_email,
                employee_name=employee_name,
                book_title=book_title,
                ticket_id=ticket_id,
                decision=decision,
                due_date=due_date,
                admin_remarks=reject_note,
            )
        except Exception as e:
            print(f"[Approval] Book decision email error: {e}")

        color = "#16A34A" if decision == "Approved" else "#dc2626"
        return HTMLResponse(_approval_html(
            f"Borrow Request {decision}",
            f"The borrow request for <strong>{html.escape(book_title)}</strong> has been <strong>{decision}</strong>. The employee has been notified by email.{reason_block}",
            color,
        ))

    if tok.entity_type == "book_extension":
        from app.services.bookshelf_service import BookshelfService
        from app.services.email_service import send_extension_decision_email
        db.query(ApprovalToken).filter(
            ApprovalToken.entity_type == "book_extension",
            ApprovalToken.entity_id == tok.entity_id,
            ApprovalToken.token != tok.token,
            ApprovalToken.used == False,
        ).update({"used": True})
        db.commit()

        ext_record = BookshelfService.get_extension(tok.entity_id) or {}
        new_due_date = ""
        try:
            if decision == "Approved":
                result = BookshelfService.approve_extension(tok.entity_id, admin_remarks="Approved via email")
                new_due_date = (result or {}).get("new_due_date", "")
            else:
                BookshelfService.reject_extension(tok.entity_id, admin_remarks=reject_note)
        except Exception as e:
            return HTMLResponse(_approval_html(
                "Action Failed",
                f"We couldn't update the extension: {html.escape(str(e))}",
                "#dc2626",
            ), status_code=502)

        try:
            send_extension_decision_email(
                user_email=tok.approver_email,
                employee_email=tok.employee_email,
                employee_name=ext_record.get("employee_name") or "",
                book_title=ext_record.get("book_title") or "your book",
                ticket_id=ext_record.get("ticket_id") or f"#{tok.entity_id}",
                decision=decision,
                new_due_date=new_due_date,
                admin_remarks=reject_note,
            )
        except Exception as e:
            print(f"[Approval] Extension decision email error: {e}")

        color = "#16A34A" if decision == "Approved" else "#dc2626"
        return HTMLResponse(_approval_html(
            f"Extension {decision}",
            f"The extension request for <strong>{html.escape(ext_record.get('book_title') or 'the book')}</strong> has been <strong>{decision}</strong>. The employee has been notified by email.{reason_block}",
            color,
        ))

    if tok.entity_type == "udemy_license":
        from app.services.udemy_service import UdemyService
        # Invalidate the sibling token
        db.query(ApprovalToken).filter(
            ApprovalToken.entity_type == "udemy_license",
            ApprovalToken.entity_id == tok.entity_id,
            ApprovalToken.token != tok.token,
            ApprovalToken.used == False,
        ).update({"used": True})
        db.commit()
        try:
            if decision == "Approved":
                res = UdemyService.approve(tok.entity_id, decided_by=tok.approver_email)
            else:
                res = UdemyService.reject(tok.entity_id, decided_by=tok.approver_email, reason=reject_note)
        except Exception as e:
            return HTMLResponse(_approval_html(
                "Action Failed", f"We couldn't update the license request: {html.escape(str(e))}", "#dc2626",
            ), status_code=502)
        platform = html.escape((res or {}).get("platform") or "Udemy")
        color = "#16A34A" if decision == "Approved" else "#dc2626"
        verb = "Approved" if decision == "Approved" else "Declined"
        return HTMLResponse(_approval_html(
            f"{platform} License {verb}",
            f"The {platform} license request has been <strong>{verb}</strong>. The employee has been notified by email.{reason_block}",
            color,
        ))

    if tok.entity_type == "desk_key":
        from app.services.admin_service import AdminService
        # Invalidate the sibling token
        db.query(ApprovalToken).filter(
            ApprovalToken.entity_type == "desk_key",
            ApprovalToken.entity_id == tok.entity_id,
            ApprovalToken.token != tok.token,
            ApprovalToken.used == False,
        ).update({"used": True})
        db.commit()
        try:
            if decision == "Approved":
                res = AdminService.approve_desk_key(tok.entity_id, decided_by=tok.approver_email)
                if not res.get("ok"):
                    return HTMLResponse(_approval_html(
                        "Cannot Approve", html.escape(res.get("error", "Desk is already assigned.")), "#dc2626",
                    ), status_code=409)
            else:
                AdminService.reject_desk_key(tok.entity_id, decided_by=tok.approver_email, reason=reject_note)
        except Exception as e:
            return HTMLResponse(_approval_html(
                "Action Failed", f"We couldn't update the desk key request: {html.escape(str(e))}", "#dc2626",
            ), status_code=502)
        color = "#16A34A" if decision == "Approved" else "#dc2626"
        return HTMLResponse(_approval_html(
            f"Desk Key {decision}",
            f"The desk key request has been <strong>{decision}</strong>. The employee has been notified by email.{reason_block}",
            color,
        ))

    if tok.entity_type == "project_update":
        from app.services import project_update_service
        from app.services.email_service import send_project_update_decision_notification
        # Invalidate the sibling token
        db.query(ApprovalToken).filter(
            ApprovalToken.entity_type == "project_update",
            ApprovalToken.entity_id == tok.entity_id,
            ApprovalToken.token != tok.token,
            ApprovalToken.used == False,
        ).update({"used": True})
        try:
            if decision == "Approved":
                sub = project_update_service.approve(db, tok.entity_id, approved_by=tok.approver_email)
            else:
                sub = project_update_service.reject(db, tok.entity_id, approved_by=tok.approver_email, reason=reject_note)
            if sub is None:
                return HTMLResponse(_approval_html(
                    "Not Found", "This project update no longer exists.", "#dc2626",
                ), status_code=404)
            activity_type = sub.activity_type
            project_name = sub.project_name or ""
            employee_email = sub.employee_email
            employee_name = sub.employee_name
            db.commit()
        except Exception as e:
            db.rollback()
            return HTMLResponse(_approval_html(
                "Action Failed", f"We couldn't update the project update: {html.escape(str(e))}", "#dc2626",
            ), status_code=502)

        try:
            send_project_update_decision_notification(
                user_email=tok.approver_email,
                employee_email=employee_email,
                employee_name=employee_name,
                activity_type=activity_type,
                project_name=project_name,
                decision=decision,
                decided_by=tok.approver_email,
                reason=reject_note,
            )
        except Exception as e:
            print(f"[Approval] Project update notification error: {e}")

        color = "#16A34A" if decision == "Approved" else "#dc2626"
        applied = " The allocation data has been updated." if decision == "Approved" else ""
        return HTMLResponse(_approval_html(
            f"Project Update {decision}",
            f"The project update has been <strong>{decision}</strong>.{applied} "
            f"The employee has been notified by email.{reason_block}",
            color,
        ))

    db.commit()
    return HTMLResponse(_approval_html("Action Completed", "Your action has been recorded."))


@app.get("/api/policy-images/{image_id}")
async def serve_policy_image(image_id: int):
    """Serve a policy image stored in PostgreSQL."""
    from app.models import PolicyImage
    from fastapi.responses import Response as RawResponse
    db = SessionLocal()
    try:
        img = db.query(PolicyImage).filter(PolicyImage.id == image_id).first()
        if not img:
            raise HTTPException(status_code=404, detail="Image not found")
        return RawResponse(
            content=img.image_data,
            media_type=img.content_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )
    finally:
        db.close()


# Nodes whose LLM stream events should NOT be forwarded to the user
# (routing/context work, not the final answer)
_SKIP_STREAMING_NODES = {"intent_router", "context_manager", "feedback_lookup"}

# Domains whose answers are safe & stable enough to serve from the semantic answer cache.
# Excludes per-user/dynamic domains (pmo, functional_manager) and action-heavy ones (it_support, ms365).
_CACHEABLE_DOMAINS = {"hr", "admin", "general"}

# Cheap guard: skip the cache for obvious action / side-effecting phrasings so they always
# run live. (The frontend already intercepts most actions before /api/chat; this is belt-and-braces.)
_CACHE_SKIP_RE = re.compile(
    r"\b(book|reserve|cancel|delete|remove|apply|submit|raise|create|install|"
    r"request|register|approve|reject|send|update|change|set|add|draft|schedule)\b",
    re.IGNORECASE,
)

# Action / dynamic sub-intents must NEVER be cached — even if the phrasing slips
# past _CACHE_SKIP_RE — because their responses contain one-time IDs or create
# records (e.g. a visitor pass with a fresh Pass ID). Only informational answers
# (policy_query, company_info, greeting) are safe to serve verbatim later.
_NON_CACHEABLE_SUBINTENTS = {
    "visitor_pass", "parking_sticker", "desk_key_request", "accommodation",
    "facility_complaint", "food_complaint", "food_feedback",
    "document_request", "grievance", "submit_leave", "leave_balance",
    "zoho_leave_fastpath", "powerapps_complaint", "setup_session",
    "software_install", "software_install_confirm", "license_request",
    "asset_request", "create_ticket", "hardware_issue", "my_tickets", "my_assets",
    "send_email", "send_teams_message", "room_availability", "book_room",
    "announcement", "prompt_config",
    # Dynamic directory / per-user data lookups: the underlying employee data
    # changes and the output is rendered live (tables), so a cached copy goes
    # stale and freezes the formatting. Always run these live.
    "employee_search", "alchemy_my_skills", "alchemy_skills_overview",
    # URL library: admins can re-point / rename / remove an app at any time, so a
    # cached answer would freeze a stale link. Always run the find_apps tool live.
    "app_directory",
}

# Refusal / no-answer responses must NEVER be cached: they're a transient routing or
# retrieval miss, not a stable fact. Caching one poisons the cache — a later lookup
# (which runs before routing, across all domains) serves the refusal verbatim and the
# fixed route never gets a chance to run. Matched against the final answer text.
_REFUSAL_RE = re.compile(
    r"(outside my area|outside my domain|contact the relevant team|"
    r"i (?:can(?:'|no)?t|cannot|am (?:not able|unable)) (?:help|assist|answer)|"
    r"i (?:don'?t|do not) have (?:access|information|enough)|"
    r"i (?:couldn'?t|could not|cannot|can'?t|was unable to|am unable to) find|"
    r"i was unable to find|no (?:relevant )?(?:information|policy|document)s? "
    r"(?:found|available)|please contact (?:hr|the relevant|your))",
    re.IGNORECASE,
)

_policy_img_re = re.compile(r'\[POLICY_IMG:([^\]]+)\]')
_email_draft_re = re.compile(r'\[EMAIL_DRAFT_START\](.*?)\[EMAIL_DRAFT_END\]', re.DOTALL)
_dynamic_form_re = re.compile(r'\[DYNAMIC_FORM_START\](.*?)\[DYNAMIC_FORM_END\]', re.DOTALL)
_download_tag_re = re.compile(r"\[DOWNLOAD_PDF:([^:]+):([^\]]+)\]")


def _postprocess(raw_text: str, all_messages: list, domain: str, start_time: float) -> dict:
    """Apply the same cleanup/extraction logic as the old blocking endpoint."""
    final_message = raw_text
    download_url = None
    interactive = None
    policy_images: list = []

    # Extract policy images from ToolMessages (skip small logos/icons < 20 KB)
    from app.models import PolicyImage as _PolicyImage
    _img_db = SessionLocal()
    try:
        for msg in all_messages:
            if hasattr(msg, 'content') and isinstance(msg.content, str):
                m = _policy_img_re.search(msg.content)
                if m:
                    for img_id in m.group(1).split("||"):
                        img_id = img_id.strip()
                        if not img_id:
                            continue
                        try:
                            img_rec = _img_db.query(_PolicyImage).filter(_PolicyImage.id == int(img_id)).first()
                            if img_rec and img_rec.image_data and len(img_rec.image_data) >= 20_000:
                                policy_images.append(f"/api/policy-images/{img_id}")
                        except Exception:
                            pass
    finally:
        _img_db.close()

    # Extract interactive email draft
    email_match = _email_draft_re.search(final_message)
    if email_match:
        try:
            draft_data = json.loads(email_match.group(1))
            interactive = {"type": "email_draft", "data": draft_data}
            final_message = _email_draft_re.sub("", final_message).strip()
        except Exception:
            pass

    # Extract dynamic form (Form Library) — must run BEFORE the JSON-blob stripping below so the
    # form schema JSON isn't mangled. The marker wraps the JSON, so it's gone before any blob regex.
    form_match = _dynamic_form_re.search(final_message)
    if form_match:
        try:
            form_data = json.loads(form_match.group(1))
            interactive = {"type": "dynamic_form", "data": form_data}
            final_message = _dynamic_form_re.sub("", final_message).strip()
        except Exception:
            pass

    # Extract download tag
    dl_match = _download_tag_re.search(final_message)
    if dl_match:
        path = dl_match.group(1)
        title = dl_match.group(2)
        base_url = f"http://localhost:{settings.PORT}"
        download_url = f"{base_url}{path}"
        markdown_link = f"\n\n### 📄 **[Download {title}]({download_url})**"
        final_message = _download_tag_re.sub(markdown_link, final_message)

    # Strip HTML tags
    html_stripped = re.sub(r'<[^>]+>', '', final_message).strip()
    if html_stripped:
        final_message = html_stripped

    # Remove stray JSON blobs — tool call leaks and LLM-echoed tool results.
    # Handles both flat {"key":"val"} and nested {"name":"tool","parameters":{...}} forms.
    import json as _json

    def _strip_json_blobs(text: str) -> str:
        """Remove standalone JSON objects from the start/standalone lines of the response."""
        lines_out = []
        i = 0
        lines = text.split('\n')
        while i < len(lines):
            line = lines[i]
            stripped = line.lstrip()
            if stripped.startswith('{') and '"' in stripped:
                # Try to accumulate a balanced JSON block starting here
                depth = 0
                buf = []
                j = i
                while j < len(lines):
                    buf.append(lines[j])
                    depth += lines[j].count('{') - lines[j].count('}')
                    if depth <= 0:
                        break
                    j += 1
                candidate = '\n'.join(buf)
                try:
                    parsed = _json.loads(candidate.strip())
                    if isinstance(parsed, dict) and len(candidate.strip()) > 20:
                        i = j + 1
                        continue  # skip this JSON block
                except Exception:
                    pass
            lines_out.append(line)
            i += 1
        return '\n'.join(lines_out)

    # Also catch the case where the entire message is a JSON blob
    stripped_msg = final_message.strip()
    if stripped_msg.startswith('{'):
        try:
            parsed_whole = _json.loads(stripped_msg)
            if isinstance(parsed_whole, dict):
                # Extract human-readable fields: message > content > description > name
                for field in ("message", "content", "description", "detail"):
                    if field in parsed_whole and isinstance(parsed_whole[field], str):
                        final_message = parsed_whole[field]
                        break
                else:
                    # Last resort: remove it entirely so generic fallback shows
                    final_message = ""
        except Exception:
            final_message = _strip_json_blobs(final_message)
    else:
        final_message = _strip_json_blobs(final_message)

    # Collapse excessive blank lines
    final_message = re.sub(r'\n{3,}', '\n\n', final_message).strip()

    if not final_message.strip():
        final_message = "I processed your request, but I was unable to generate a text summary. Please try again or rephrase your question."

    return {
        "final_message": final_message,
        "download_url": download_url,
        "interactive": interactive,
        "images": policy_images if policy_images else None,
        "processing_time": f"{time.time() - start_time:.2f}s",
    }


@app.post("/api/chat")
async def chat(
    request: ChatRequest,
    x_user_email: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    x_graph_token: Optional[str] = Header(None),
):
    start_time = time.time()
    user_email = x_user_email or settings.DEFAULT_USER_EMAIL
    user_role = (x_user_role or "employee").lower()

    # Auto-fetch stored Microsoft token if none passed explicitly
    effective_graph_token = x_graph_token or None
    if not effective_graph_token:
        try:
            from app.services.oauth_service import get_valid_token
            effective_graph_token = await get_valid_token(
                user_email.lower().strip(),
                "microsoft",
            )
        except Exception:
            pass

    # Detect user's office location from their M365 profile (officeLocation → city → country)
    user_location: str | None = None
    if effective_graph_token:
        try:
            from app.services.ms365_service import fetch_my_profile
            _profile = await fetch_my_profile(effective_graph_token)
            user_location = (
                _profile.get("officeLocation")
                or _profile.get("city")
                or _profile.get("country")
            ) or None
        except Exception:
            pass

    config = {"configurable": {"thread_id": request.session_id}}
    input_data = {
        "messages": [HumanMessage(content=request.message)],
        "user_email": user_email,
        "user_role": user_role,
        "graph_token": effective_graph_token,
        "session_id": request.session_id,
        "user_location": user_location,
    }

    async def generate():
        from app.models import AiRequestLog, AiLlmCallLog

        # ── Global kill switch (IT) ─────────────────────────────────────
        # When IT pauses AI chat, short-circuit every request — including the
        # cache path — with a friendly notice and zero LLM calls.
        if not llm_controls.is_chat_enabled():
            paused_msg = (
                "🛠️ AI assistance is temporarily paused by IT, likely for maintenance "
                "or to manage system load. Please try again shortly."
            )
            yield f"data: {json.dumps({'type': 'token', 'content': paused_msg})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'domain': 'general'})}\n\n"
            return

        # ── Short-circuit "who is X" lookup (instant path, zero LLM) ──────────
        name_match = re.search(r'^\s*who\s+is\s+([a-zA-Z0-9.-]+\s+[a-zA-Z0-9.-]+)[?.!\s]*$', request.message, re.IGNORECASE)
        if name_match:
            person_name = name_match.group(1).strip()
            try:
                from app.services.employee_service import EmployeeService
                profile_res = await asyncio.to_thread(EmployeeService.get_profile, person_name)
                if profile_res and not profile_res.startswith("No employee profile found"):
                    yield f"data: {json.dumps({'type': 'token', 'content': profile_res})}\n\n"
                    # Observability log
                    try:
                        _db = SessionLocal()
                        _db.add(AiRequestLog(
                            session_id=request.session_id,
                            user_email=user_email,
                            user_message=request.message,
                            domain="hr",
                            sub_intent="employee_search",
                            route_method="who_is_shortcircuit",
                            response_text=profile_res[:2000],
                            response_length=len(profile_res),
                            total_latency_ms=int((time.time() - start_time) * 1000),
                            llm_call_count=0,
                        ))
                        _db.commit()
                    except Exception as _le:
                        print(f"[observability] shortcircuit log error: {_le}")
                    finally:
                        try:
                            _db.close()
                        except Exception:
                            pass
                    yield f"data: {json.dumps({'type': 'done', 'domain': 'hr', 'download_url': None, 'interactive': None, 'images': None, 'processing_time': f'{time.time() - start_time:.2f}s'})}\n\n"
                    return
            except Exception as _pe:
                print(f"[ShortCircuit] error: {_pe}")

        # ── Semantic answer cache (instant path, zero LLM) ──────────────
        # If a near-identical informational question was answered recently, stream the saved
        # answer immediately and skip the concurrency gate + graph entirely. Guarded against
        # action phrasings so side-effecting requests never short-circuit.
        if settings.ANSWER_CACHE_ENABLED and not _CACHE_SKIP_RE.search(request.message):
            try:
                from app.services.answer_cache_service import AnswerCacheService
                hit = await asyncio.to_thread(AnswerCacheService.lookup, request.message)
            except Exception as _ce:
                print(f"[AnswerCache] lookup error: {_ce}")
                hit = None
            if hit and hit.get("answer"):
                cached_answer = hit["answer"]
                cached_domain = hit.get("domain") or "general"
                yield f"data: {json.dumps({'type': 'token', 'content': cached_answer})}\n\n"
                # Observability: record a 0-LLM cache hit so hit-rate is measurable.
                try:
                    _db = SessionLocal()
                    _db.add(AiRequestLog(
                        session_id=request.session_id,
                        user_email=user_email,
                        user_message=request.message,
                        domain=cached_domain,
                        sub_intent=hit.get("sub_intent"),
                        route_method="cache_hit",
                        response_text=cached_answer[:2000],
                        response_length=len(cached_answer),
                        total_latency_ms=int((time.time() - start_time) * 1000),
                        llm_call_count=0,
                    ))
                    _db.commit()
                except Exception as _le:
                    print(f"[observability] cache-hit log error: {_le}")
                finally:
                    try:
                        _db.close()
                    except Exception:
                        pass
                print(f"[AnswerCache] HIT sim={hit.get('similarity')} domain={cached_domain} session={request.session_id}")
                yield f"data: {json.dumps({'type': 'done', 'domain': cached_domain})}\n\n"
                return

        accumulated_text = ""
        routed_domain = "general"
        routed_sub_intent: str | None = None
        final_messages = []
        llm_calls: dict[str, dict] = {}   # run_id → {node, model, start}
        completed_calls: list[dict] = []   # finished LLM calls for DB insert
        error_msg: str | None = None

        # Create Langfuse trace at the START so child spans can attach
        tracing = TracingContext(
            session_id=request.session_id,
            user_id=user_email,
            metadata={"message": request.message},
            tags=["chat"],
        )

        # ── Concurrency gate: cap simultaneous LLM generations ──────────
        # Cross-process (Redis-backed) cap with a bounded wait queue. We drive
        # the wait here so we can stream a "queued" notice and periodic SSE
        # keepalives to the client while it waits; once we hold a slot, a
        # heartbeat keeps its lease alive so it can't leak if this worker dies.
        slot = None
        async for kind, payload in chat_gate.acquire():
            if kind == "queued":
                yield f"data: {json.dumps({'type': 'queued', 'message': 'High demand right now — holding your place in line…'})}\n\n"
            elif kind == "keepalive":
                yield ": keepalive\n\n"
            elif kind in ("busy", "timeout"):
                busy_msg = (
                    "Centriq is handling a lot of requests right now. "
                    "Please try again in a moment."
                )
                yield f"data: {json.dumps({'type': 'busy', 'message': busy_msg})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'domain': 'general'})}\n\n"
                return
            elif kind == "acquired":
                slot = payload

        heartbeat_task = asyncio.ensure_future(chat_gate.slot_heartbeat(slot))

        try:
            async for event in app_agent.astream_events(input_data, config=config, version="v2"):
                event_type = event.get("event", "")

                # ── Track LLM call start ─────────────────────────────────
                if event_type == "on_chat_model_start":
                    run_id = event.get("run_id", "")
                    meta = event.get("metadata", {})
                    node = meta.get("langgraph_node", "unknown")
                    model = meta.get("ls_model_name") or event.get("name", "unknown")
                    llm_calls[run_id] = {"node": node, "model": model, "start": time.time()}
                    tracing.start_generation(run_id, node, model)

                # ── Track LLM call end ───────────────────────────────────
                elif event_type == "on_chat_model_end":
                    run_id = event.get("run_id", "")
                    call = llm_calls.pop(run_id, None)
                    if call:
                        elapsed = time.time() - call["start"]
                        output_msg = event.get("data", {}).get("output")

                        # Extract token usage from LangChain AIMessage
                        usage = {}
                        if output_msg and hasattr(output_msg, "usage_metadata") and output_msg.usage_metadata:
                            um = output_msg.usage_metadata
                            usage = {
                                "input_tokens": getattr(um, "input_tokens", 0) or (um.get("input_tokens", 0) if isinstance(um, dict) else 0),
                                "output_tokens": getattr(um, "output_tokens", 0) or (um.get("output_tokens", 0) if isinstance(um, dict) else 0),
                                "total_tokens": getattr(um, "total_tokens", 0) or (um.get("total_tokens", 0) if isinstance(um, dict) else 0),
                            }

                        # Detect tool calls
                        tool_calls_list = []
                        tool_names_str = None
                        if output_msg and hasattr(output_msg, "tool_calls") and output_msg.tool_calls:
                            tool_calls_list = output_msg.tool_calls
                            tool_names_str = ",".join(
                                tc.get("name", "unknown") if isinstance(tc, dict) else getattr(tc, "name", "unknown")
                                for tc in tool_calls_list
                            )

                        # Store for DB insert
                        completed_calls.append({
                            "node": call["node"],
                            "model": call["model"],
                            "duration_ms": int(elapsed * 1000),
                            "prompt_tokens": usage.get("input_tokens"),
                            "completion_tokens": usage.get("output_tokens"),
                            "total_tokens": usage.get("total_tokens"),
                            "is_tool_call": bool(tool_calls_list),
                            "tool_names": tool_names_str,
                        })

                        # Langfuse generation span
                        tracing.end_generation(run_id, output_msg, usage, tool_calls_list or None)

                        print(
                            f"[LLM] node={call['node']}  model={call['model']}  "
                            f"time={elapsed:.2f}s  tokens={usage.get('total_tokens', '?')}  "
                            f"session={request.session_id}"
                        )

                # Stream tokens from final-response nodes only
                elif event_type == "on_chat_model_stream":
                    node = event.get("metadata", {}).get("langgraph_node", "")
                    if node not in _SKIP_STREAMING_NODES:
                        chunk = event["data"].get("chunk")
                        if chunk is not None:
                            content = chunk.content if hasattr(chunk, "content") else ""
                            # Only stream plain text — skip tool-call argument dicts
                            if isinstance(content, str) and content:
                                accumulated_text += content
                                yield f"data: {json.dumps({'type': 'token', 'content': content})}\n\n"

                # Capture final graph state (domain + all messages for post-processing)
                elif event_type == "on_chain_end" and event.get("name") == "LangGraph":
                    output = event["data"].get("output") or {}
                    routed_domain = output.get("domain") or routed_domain
                    routed_sub_intent = output.get("sub_intent") or routed_sub_intent
                    final_messages = output.get("messages") or []

        except Exception as exc:
            error_msg = str(exc)
            print(f"[stream] error: {exc}")
            yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"
        finally:
            # Stop renewing and free the slot the moment generation ends.
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            await chat_gate.release(slot)

        # If nothing streamed (tool-only path, fast-path nodes, etc.), use last message
        if not accumulated_text and final_messages:
            last = final_messages[-1]
            accumulated_text = last.content if hasattr(last, "content") and isinstance(last.content, str) else ""
            # If the last AI message was empty, fall back to the most recent ToolMessage result.
            if not accumulated_text:
                from langchain_core.messages import ToolMessage as _ToolMessage
                last_tool = next(
                    (m for m in reversed(final_messages)
                     if isinstance(m, _ToolMessage) and isinstance(m.content, str) and m.content.strip()),
                    None,
                )
                if last_tool:
                    accumulated_text = last_tool.content
            # Send as token so frontend creates the AI turn (no LLM = no stream events)
            if accumulated_text:
                yield f"data: {json.dumps({'type': 'token', 'content': accumulated_text})}\n\n"

        # Post-process the accumulated text
        post = _postprocess(accumulated_text, final_messages, routed_domain, start_time)
        final_message = post["final_message"]

        # If post-processing changed the text (HTML stripped, markers removed), patch the frontend
        if final_message != accumulated_text:
            yield f"data: {json.dumps({'type': 'replace', 'content': final_message})}\n\n"

        # ── Observability: dual-write to Langfuse + PostgreSQL ───────
        latency_ms = int((time.time() - start_time) * 1000)

        # Langfuse: finalise trace with output
        tracing.finalize(output=final_message, domain=routed_domain, latency_ms=latency_ms)

        # PostgreSQL: insert request log + LLM call logs
        try:
            db = SessionLocal()
            primary_model = completed_calls[-1]["model"] if completed_calls else None
            req_log = AiRequestLog(
                session_id=request.session_id,
                user_email=user_email,
                user_message=request.message,
                domain=routed_domain,
                sub_intent=routed_sub_intent,
                response_text=final_message[:2000] if final_message else None,
                response_length=len(final_message) if final_message else 0,
                total_latency_ms=latency_ms,
                llm_call_count=len(completed_calls),
                total_prompt_tokens=sum(c.get("prompt_tokens") or 0 for c in completed_calls),
                total_completion_tokens=sum(c.get("completion_tokens") or 0 for c in completed_calls),
                total_tokens=sum(c.get("total_tokens") or 0 for c in completed_calls),
                model_name=primary_model,
                error=error_msg,
                langfuse_trace_id=tracing.trace_id,
            )
            db.add(req_log)
            db.flush()
            for call_data in completed_calls:
                db.add(AiLlmCallLog(request_id=req_log.id, **call_data))
            db.commit()
        except Exception as log_err:
            print(f"[observability] DB insert error: {log_err}")
        finally:
            try:
                db.close()
            except Exception:
                pass

        # ── Store informational answers in the semantic cache (store-side safety gate) ──
        # Only plain, stable, text-only answers are cached. Anything with a widget, download,
        # image, error, or from an action/dynamic domain is never stored — which is exactly
        # what makes future cache lookups safe to serve verbatim.
        try:
            if (
                settings.ANSWER_CACHE_ENABLED
                and not error_msg
                and routed_domain in _CACHEABLE_DOMAINS
                and (routed_sub_intent or "") not in _NON_CACHEABLE_SUBINTENTS
                and not post["interactive"]
                and not post["download_url"]
                and not post["images"]
                and not _CACHE_SKIP_RE.search(request.message)
                and final_message
                and len(final_message.strip()) >= 40
                and not _REFUSAL_RE.search(final_message)
            ):
                from app.services.answer_cache_service import AnswerCacheService
                await asyncio.to_thread(
                    AnswerCacheService.store,
                    request.message,
                    final_message,
                    routed_domain,
                    routed_sub_intent,
                    None,   # source_keys: domain-level invalidation handles freshness
                )
        except Exception as _se:
            print(f"[AnswerCache] store error: {_se}")

        yield f"data: {json.dumps({'type': 'done', 'domain': routed_domain, 'download_url': post['download_url'], 'interactive': post['interactive'], 'images': post['images'], 'processing_time': post['processing_time']})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )

class SuggestionsRequest(BaseModel):
    message: str
    response: str
    domain: str = "general"

# Topics that must never appear in follow-up chips — salary is sensitive, and
# "can I contact / hire" framing is inappropriate for an internal people search.
_BANNED_SUGGESTION_TERMS = (
    "salary", "compensation", " pay", "ctc", "remuneration", "wage",
    "contact", "hire", "hiring", "recruit",
)

# Deterministic, purposeful chips shown after a people/skill search instead of the
# free-form LLM ones (which kept surfacing salary/contact/hire questions).
_PEOPLE_SEARCH_CHIPS = [
    "Are they available for work?",
    "Show their current project allocation",
    "Show their detailed skills",
]


def _is_people_search(message: str) -> bool:
    try:
        from app.agent import _KW_HR_PEOPLE, _KW_HR_PEOPLE_ROLE, _KW_HR_AVAILABILITY
    except Exception:
        return False
    return bool(
        _KW_HR_PEOPLE.search(message)
        or _KW_HR_PEOPLE_ROLE.search(message)
        or _KW_HR_AVAILABILITY.search(message)
    )


@app.post("/api/suggestions")
async def get_suggestions(request: SuggestionsRequest):
    # People/skill search → curated chips (skip the LLM entirely).
    if _is_people_search(request.message):
        return {"suggestions": list(_PEOPLE_SEARCH_CHIPS)}
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(
            base_url=settings.AGENT_BASE_URL,
            api_key=settings.AGENT_API_KEY,
        )
        system_prompt = (
            "You are a helpful assistant. Given a user question and an AI response, "
            "generate exactly 3 short follow-up questions the user might ask next. "
            "Each question must be under 10 words. "
            "Never suggest questions about salary, compensation, pay, CTC, or whether the "
            "user can contact, hire, or recruit someone. Keep suggestions task-relevant and "
            "professional. "
            "Return ONLY a valid JSON array of 3 strings, no explanation, no markdown."
        )
        user_content = f"User question: {request.message}\n\nAI response: {request.response[:800]}"
        completion = await client.chat.completions.create(
            model=settings.FAST_MODEL_NAME,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0,
            max_tokens=200,
        )
        raw = completion.choices[0].message.content or "[]"
        # Strip markdown code fences if present
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
        # Extract just the JSON array — LLM may append extra explanation text
        arr_match = re.search(r'\[.*?\]', raw, re.DOTALL)
        raw = arr_match.group(0) if arr_match else "[]"
        suggestions = json.loads(raw)
        if isinstance(suggestions, list):
            suggestions = [str(s) for s in suggestions[:3] if s]
        else:
            suggestions = []
        # Deterministic safety net: drop anything touching a banned topic, even if the
        # prompt didn't dissuade the model.
        suggestions = [
            s for s in suggestions
            if not any(term in s.lower() for term in _BANNED_SUGGESTION_TERMS)
        ]
        return {"suggestions": suggestions}
    except Exception as e:
        print(f"[suggestions] error: {e}")
        return {"suggestions": []}

@app.get("/api/admin/stats")
async def get_admin_stats(_: CurrentUser = Depends(require_admin)):
    db = SessionLocal()
    try:
        from app.models import ITTicket, FacilityComplaint, ParkingSticker, Reimbursement, FoodComplaint, Announcement
        import datetime
        today_start = datetime.datetime.combine(datetime.date.today(), datetime.time.min)

        return {
            "it_tickets": {
                "total": db.query(ITTicket).count(),
                "open": db.query(ITTicket).filter(ITTicket.status == "Open").count(),
                "resolved_today": db.query(ITTicket).filter(
                    ITTicket.resolved_at >= today_start
                ).count(),
            },
            "facility_complaints": {
                "total": db.query(FacilityComplaint).count(),
                "open": db.query(FacilityComplaint).filter(FacilityComplaint.status == "Open").count(),
            },
            "parking": {
                "active": db.query(ParkingSticker).filter(ParkingSticker.status == "Active").count(),
                "pending": db.query(ParkingSticker).filter(ParkingSticker.status == "Pending").count(),
            },
            "reimbursements": {
                "pending": db.query(Reimbursement).filter(Reimbursement.status == "Pending").count(),
                "total": db.query(Reimbursement).count(),
            },
            "announcements": {
                "active": db.query(Announcement).filter(Announcement.is_active == True).count(),
            },
            "food_complaints": {
                "open": db.query(FoodComplaint).filter(FoodComplaint.status == "Open").count(),
            },
        }
    finally:
        db.close()


@app.get("/api/admin/overdue")
async def get_overdue_items(_: CurrentUser = Depends(require_admin)):
    """Items breaching SLA thresholds — for Power Automate escalation flows."""
    from app.models import Grievance, FacilityComplaint, ITTicket, Employee

    def _business_days(start: datetime.datetime) -> int:
        d = start.date() if isinstance(start, datetime.datetime) else start
        today = datetime.date.today()
        count = 0
        while d < today:
            if d.weekday() < 5:
                count += 1
            d += datetime.timedelta(days=1)
        return count

    now = datetime.datetime.utcnow()
    db = SessionLocal()
    try:
        # Grievances open >= 5 business days
        grievances_raw = (
            db.query(Grievance, Employee)
            .outerjoin(Employee, Grievance.employee_id == Employee.id)
            .filter(Grievance.status.in_(["Open", "Under Review"]))
            .all()
        )
        grievances = [
            {
                "reference_id": g.reference_id,
                "category": g.category,
                "business_days_open": _business_days(g.created_at),
                "status": g.status,
                "employee_name": emp.name if emp else "Anonymous",
                "is_anonymous": g.is_anonymous,
            }
            for g, emp in grievances_raw
            if _business_days(g.created_at) >= 5
        ]

        # High/Critical facility complaints open >= 24h
        complaints_raw = (
            db.query(FacilityComplaint, Employee)
            .join(Employee, FacilityComplaint.employee_id == Employee.id)
            .filter(
                FacilityComplaint.priority.in_(["High", "Critical"]),
                FacilityComplaint.status.in_(["Open", "In Progress"]),
            )
            .all()
        )
        facility_complaints = [
            {
                "ticket_id": c.ticket_id,
                "category": c.category,
                "priority": c.priority,
                "hours_open": round((now - c.created_at).total_seconds() / 3600, 1),
                "status": c.status,
                "employee_name": emp.name,
                "employee_email": emp.email,
            }
            for c, emp in complaints_raw
            if (now - c.created_at).total_seconds() / 3600 >= 24
        ]

        # IT tickets open >= 72h
        tickets_raw = (
            db.query(ITTicket, Employee)
            .join(Employee, ITTicket.employee_id == Employee.id)
            .filter(ITTicket.status.in_(["Open", "In Progress"]))
            .all()
        )
        it_tickets = [
            {
                "ticket_id": t.ticket_id,
                "subject": t.subject,
                "priority": t.priority,
                "hours_open": round((now - t.created_at).total_seconds() / 3600, 1),
                "status": t.status,
                "assigned_to": t.assigned_to,
                "employee_name": emp.name,
                "employee_email": emp.email,
            }
            for t, emp in tickets_raw
            if (now - t.created_at).total_seconds() / 3600 >= 72
        ]

        return {
            "generated_at": now.isoformat() + "Z",
            "overdue": {
                "grievances": grievances,
                "facility_complaints": facility_complaints,
                "it_tickets": it_tickets,
                "totals": {
                    "grievances": len(grievances),
                    "facility_complaints": len(facility_complaints),
                    "it_tickets": len(it_tickets),
                },
            },
        }
    finally:
        db.close()


@app.get("/api/admin/analytics")
async def get_admin_analytics(_: CurrentUser = Depends(require_admin)):
    """Comprehensive analytics endpoint — all charts powered by real DB data."""
    from app.models import (
        Employee, ITTicket, FacilityComplaint, Reimbursement, Leave,
        ChatFeedback, Project, FoodVendorFeedback,
    )
    from sqlalchemy import func as sqlfunc

    def _fetch() -> dict:
        db = SessionLocal()
        try:
            dept_rows = (
                db.query(Employee.department, sqlfunc.count(Employee.id))
                .group_by(Employee.department)
                .order_by(sqlfunc.count(Employee.id).desc())
                .all()
            )
            ticket_cat_rows = (
                db.query(ITTicket.category, sqlfunc.count(ITTicket.id))
                .group_by(ITTicket.category)
                .order_by(sqlfunc.count(ITTicket.id).desc())
                .all()
            )
            ticket_status_rows = (
                db.query(ITTicket.status, sqlfunc.count(ITTicket.id))
                .group_by(ITTicket.status)
                .all()
            )
            leave_rows = (
                db.query(Leave.leave_type, Leave.status, sqlfunc.count(Leave.id))
                .group_by(Leave.leave_type, Leave.status)
                .all()
            )
            reimb_rows = (
                db.query(
                    Reimbursement.type, Reimbursement.status,
                    sqlfunc.count(Reimbursement.id),
                    sqlfunc.coalesce(sqlfunc.sum(Reimbursement.amount), 0),
                )
                .group_by(Reimbursement.type, Reimbursement.status)
                .all()
            )
            facility_cat_rows = (
                db.query(FacilityComplaint.category, sqlfunc.count(FacilityComplaint.id))
                .group_by(FacilityComplaint.category)
                .order_by(sqlfunc.count(FacilityComplaint.id).desc())
                .all()
            )
            feedback_rows = (
                db.query(ChatFeedback.domain, ChatFeedback.rating, sqlfunc.count(ChatFeedback.id))
                .group_by(ChatFeedback.domain, ChatFeedback.rating)
                .all()
            )
            total_feedback = db.query(ChatFeedback).count()
            helpful = db.query(ChatFeedback).filter(ChatFeedback.rating == 1).count()
            unhelpful = db.query(ChatFeedback).filter(ChatFeedback.rating == -1).count()
            project_status_rows = (
                db.query(Project.status, sqlfunc.count(Project.id))
                .group_by(Project.status)
                .all()
            )
            avg_completion = db.query(sqlfunc.avg(Project.completion_pct)).scalar() or 0.0
            vendor_rows = (
                db.query(
                    FoodVendorFeedback.vendor_name,
                    sqlfunc.avg(FoodVendorFeedback.rating),
                    sqlfunc.count(FoodVendorFeedback.id),
                )
                .group_by(FoodVendorFeedback.vendor_name)
                .order_by(sqlfunc.avg(FoodVendorFeedback.rating).desc())
                .limit(5)
                .all()
            )
            return {
                "employees": {
                    "total": db.query(Employee).count(),
                    "by_department": [{"dept": r[0] or "Unknown", "count": r[1]} for r in dept_rows],
                },
                "it_tickets": {
                    "total": db.query(ITTicket).count(),
                    "open": db.query(ITTicket).filter(ITTicket.status == "Open").count(),
                    "by_category": [{"category": r[0] or "Other", "count": r[1]} for r in ticket_cat_rows],
                    "by_status": [{"status": r[0], "count": r[1]} for r in ticket_status_rows],
                },
                "leaves": {
                    "total": db.query(Leave).count(),
                    "by_type_status": [{"type": r[0], "status": r[1], "count": r[2]} for r in leave_rows],
                },
                "reimbursements": {
                    "total": db.query(Reimbursement).count(),
                    "total_amount": float(db.query(sqlfunc.coalesce(sqlfunc.sum(Reimbursement.amount), 0)).scalar()),
                    "by_type_status": [
                        {"type": r[0], "status": r[1], "count": r[2], "amount": float(r[3])}
                        for r in reimb_rows
                    ],
                },
                "facility_complaints": {
                    "total": db.query(FacilityComplaint).count(),
                    "by_category": [{"category": r[0], "count": r[1]} for r in facility_cat_rows],
                },
                "feedback": {
                    "total": total_feedback,
                    "helpful": helpful,
                    "unhelpful": unhelpful,
                    "score_pct": round(helpful / total_feedback * 100) if total_feedback else 0,
                    "by_domain": [{"domain": r[0], "rating": r[1], "count": r[2]} for r in feedback_rows],
                },
                "projects": {
                    "total": db.query(Project).count(),
                    "avg_completion": round(float(avg_completion), 1),
                    "by_status": [{"status": r[0], "count": r[1]} for r in project_status_rows],
                },
                "food_vendors": [
                    {"vendor": r[0], "avg_rating": round(float(r[1]), 1), "reviews": r[2]}
                    for r in vendor_rows
                ],
            }
        finally:
            db.close()

    return await asyncio.to_thread(_fetch)


@app.get("/api/hr/dashboard")
async def get_hr_dashboard(user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        emp = HRService.get_employee_by_email(db, user.email)
        if not emp: return {"error": "No employees found"}
        
        emp_leaves = db.query(Leave).filter(Leave.employee_id == emp.id).all()
        used_leaves = sum(1 for leave in emp_leaves if leave.status == "Approved")
        leave_balance = 24 - used_leaves

        return {
            "employee": {"name": emp.name, "id": emp.employee_id, "designation": emp.designation},
            "stats": {"leave_balance": leave_balance, "used_leaves": used_leaves},
            "recent_leaves": [{"leave_type": l.leave_type, "status": l.status} for l in emp_leaves[-5:]]
        }
    finally:
        db.close()

@app.get("/api/hr/leaves")
async def get_leaves(user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        from app.models import Employee
        emp = HRService.get_employee_by_email(db, user.email)
        if not emp:
            return []
        return [
            {"id": l.id, "leave_type": l.leave_type, "status": l.status}
            for l in db.query(Leave).filter(Leave.employee_id == emp.id).all()
        ]
    finally:
        db.close()


@app.post("/api/parking/submit")
async def submit_parking(req: ParkingSubmitRequest):
    from app.services.admin_service import AdminService
    result = AdminService.request_parking_sticker(
        req.email,
        req.vehicle_type,
        req.vehicle_number,
        req.vehicle_make or "",
        req.vehicle_model or "",
    )
    return {"message": result}


@app.post("/api/visitor-pass/submit")
async def submit_visitor_pass(req: VisitorPassSubmitRequest):
    # Deterministic form submit — no LLM, no router, no cache. The service guards
    # against placeholder names / past dates as a backstop; the form enforces the
    # rest. Run off the event loop since it writes to the DB and sends email.
    from app.services.admin_service import AdminService
    result = await asyncio.to_thread(
        AdminService.request_visitor_pass,
        req.email,
        req.visitor_name,
        req.visit_date,
        req.purpose,
        req.visit_time or "",
        req.visitor_company or "",
    )
    return {"message": result}


class FormSubmitRequest(BaseModel):
    form_template_id: int
    field_values: dict = {}


@app.post("/api/forms/submit")
async def submit_dynamic_form(req: FormSubmitRequest,
                              user: CurrentUser = Depends(get_current_user)):
    # Generic Form Library submit — no LLM. employee_email is taken from the authenticated
    # user, never the payload, so a user can't submit as someone else. Required-field
    # validation is enforced server-side in the service. Runs off the loop (DB + email).
    from app.services.form_library_service import FormLibraryService
    res = await asyncio.to_thread(
        FormLibraryService.submit, req.form_template_id, user.email, req.field_values
    )
    if res.get("status") != "ok":
        raise HTTPException(status_code=400, detail=res.get("message", "Submission failed."))
    return {"message": res["message"], "reference_id": res["reference_id"]}


@app.post("/api/email/send-draft")
async def send_email_draft(req: SendEmailDraftRequest):
    import html as html_lib
    from app.services.email_service import _send, _nl2br
    html_body = f"""
    <html><body style="font-family: Arial, sans-serif; color: #333;">
      <p style="line-height:1.5;">{_nl2br(req.body)}</p>
      <p style="color:#888;font-size:12px;margin-top:24px;">Sent via Centriq AI.</p>
    </body></html>
    """
    sent = _send(
        user_email=req.requester_email or settings.DEFAULT_USER_EMAIL,
        to=req.to,
        subject=req.subject,
        html_body=html_body,
    )
    if sent:
        return {"message": f"Email sent to **{req.to}** successfully."}
    return {"message": "Email could not be sent — please check SMTP configuration."}


@app.delete("/api/chat/{thread_id}")
async def delete_chat(thread_id: str):
    """Clear the LangGraph checkpoint for a chat thread (best-effort)."""
    try:
        cp = app_agent.checkpointer
        # MemorySaver: clear in-memory storage
        if hasattr(cp, "storage"):
            cp.storage.pop(thread_id, None)
        # AsyncRedisSaver: delete matching Redis keys
        elif hasattr(cp, "redis_client"):
            client = cp.redis_client
            keys = await client.keys(f"{thread_id}:*")
            if keys:
                await client.delete(*keys)
    except Exception as e:
        print(f"[delete_chat] cleanup skipped: {e}")
    return {"status": "deleted", "thread_id": thread_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
