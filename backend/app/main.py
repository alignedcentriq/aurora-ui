import io
import asyncio
import datetime
import json
import os
import re
import logging
import socket
import time
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, HTMLResponse
from pydantic import BaseModel
from typing import List, Optional

from app.auth import CurrentUser, get_current_user, require_admin
from app.agent import app_agent
from langchain_core.messages import HumanMessage
from app.hr_service import HRService
from app.config import settings, ALIGNED_LLM_HOST
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
from app.services.feedback_service import FeedbackService

# -- Langfuse tracing --
from app.langfuse_tracing import langfuse_trace, langfuse_event

# -- Loki Logger --
try:
    import logging_loki
    from pythonjsonlogger import jsonlogger

    class _SilentLokiHandler(logging_loki.LokiHandler):
        """Suppress connection errors when Loki is not running."""
        def handleError(self, record):
            pass

    loki_handler = _SilentLokiHandler(
        url=os.environ.get("LOKI_URL", "http://localhost:3100/loki/api/v1/push"),
        tags={"application": "aurora-backend"},
        version="1",
    )
    formatter = jsonlogger.JsonFormatter('%(asctime)s %(levelname)s %(name)s %(message)s')
    loki_handler.setFormatter(formatter)

    logger = logging.getLogger("aurora-logger")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        logger.addHandler(loki_handler)
        logger.addHandler(logging.StreamHandler())
except Exception as e:
    logger = logging.getLogger("aurora-logger")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        logger.addHandler(logging.StreamHandler())
    logger.warning(f"Loki logging unavailable: {e}. Using console only.")

from app.sharepoint_routes import router as sharepoint_router
from app.graph_sync import renew_subscriptions

app = FastAPI(title="Centriq AI Backend")

# ── LLM Reachability (VPN check) ─────────────────────────────────────────────

def _llm_host_port() -> tuple[str, int]:
    parsed = urlparse(settings.ROUTER_BASE_URL)
    return (parsed.hostname or ALIGNED_LLM_HOST), (parsed.port or 11434)


def _check_llm_reachable() -> bool:
    host, port = _llm_host_port()
    try:
        with socket.create_connection((host, port), timeout=2.0):
            return True
    except OSError:
        return False
app.include_router(sharepoint_router, prefix="/api")
app.include_router(pmo_router)
app.include_router(it_router)
app.include_router(prompt_router)
app.include_router(announcement_router)
app.include_router(employee_router)
app.include_router(people_router)
app.include_router(hr_portal_router)
app.include_router(admin_portal_router)

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

    if hasattr(app_agent.checkpointer, "setup"):
        try:
            await app_agent.checkpointer.setup()
            print("Redis checkpointer indexes ready.")
        except Exception as e:
            print(f"Redis checkpointer setup: {e}")
            
    async def periodic_renew():
        while True:
            await asyncio.sleep(3600)
            try:
                await asyncio.to_thread(renew_subscriptions)
            except Exception as e:
                print(f"Failed to renew subscriptions: {e}")

    asyncio.create_task(periodic_renew())

@app.get("/")
async def root():
    return {"status": "online", "message": "Centriq AI Backend is running"}


@app.get("/api/health/llm")
async def llm_health():
    """Check whether the LLM service is reachable (VPN required from outside office)."""
    reachable = await asyncio.to_thread(_check_llm_reachable)
    if reachable:
        return {"status": "ok"}
    return JSONResponse(
        status_code=503,
        content={
            "status": "unreachable",
            "code": "VPN_REQUIRED",
            "message": "The AI service is unreachable. If you're outside the office, please connect to the VPN.",
        },
    )

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
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content_bytes)) as pdf:
                extracted = "\n".join(
                    page.extract_text() or "" for page in pdf.pages
                ).strip()
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


def _approval_html(title: str, message: str, color: str = "#16a34a") -> str:
    return f"""
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>{title}</title>
    <style>body{{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;}}
    .card{{background:#fff;border-radius:12px;padding:40px 48px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);}}
    h1{{color:{color};font-size:24px;margin-bottom:12px;}} p{{color:#64748b;font-size:15px;line-height:1.6;}}</style>
    </head><body><div class="card"><h1>{title}</h1><p>{message}</p>
    <p style="margin-top:24px;font-size:13px;color:#94a3b8;">Centriq AI &mdash; Aligned Automation</p>
    </div></body></html>
    """


@app.get("/api/approve/{token}", response_class=HTMLResponse)
async def process_approval(token: str):
    """Manager clicks this link from the leave approval email."""
    db = SessionLocal()
    try:
        tok = db.query(ApprovalToken).filter(ApprovalToken.token == token).first()
        if not tok:
            return HTMLResponse(_approval_html("Invalid Link", "This approval link is invalid or does not exist.", "#dc2626"), status_code=404)
        if tok.used:
            return HTMLResponse(_approval_html("Already Actioned", "This approval link has already been used.", "#f59e0b"))
        if tok.expires_at < datetime.datetime.utcnow():
            return HTMLResponse(_approval_html("Link Expired", "This approval link has expired. Please ask the employee to resubmit.", "#f59e0b"))

        tok.used = True
        decision = "Approved" if tok.action == "approve" else "Rejected"

        if tok.entity_type == "leave":
            leave = db.query(Leave).filter(Leave.id == tok.entity_id).first()
            if leave:
                leave.status = decision
                # Invalidate the sibling token (the other action)
                db.query(ApprovalToken).filter(
                    ApprovalToken.entity_type == "leave",
                    ApprovalToken.entity_id == tok.entity_id,
                    ApprovalToken.token != token,
                    ApprovalToken.used == False,
                ).update({"used": True})
                db.commit()
                # Notify employee
                try:
                    from app.services.email_service import send_leave_decision_notification
                    from app.models import Employee
                    emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
                    if emp:
                        send_leave_decision_notification(
                            employee_email=emp.email,
                            employee_name=emp.name,
                            leave_type=leave.leave_type,
                            start_date=str(leave.start_date),
                            end_date=str(leave.end_date),
                            decision=decision,
                            decided_by=tok.approver_email,
                        )
                except Exception as e:
                    print(f"[Approval] Notification email error: {e}")

                color = "#16a34a" if tok.action == "approve" else "#dc2626"
                return HTMLResponse(_approval_html(
                    f"Leave {decision}",
                    f"The leave request has been <strong>{decision}</strong>. The employee has been notified by email.",
                    color,
                ))

        db.commit()
        return HTMLResponse(_approval_html("Action Completed", "Your action has been recorded."))
    finally:
        db.close()

@app.post("/api/chat")
async def chat(request: ChatRequest, x_user_email: Optional[str] = Header(None)):
    # VPN / LLM reachability pre-flight — catches "outside office, no VPN" in ~2s instead of timing out
    if not await asyncio.to_thread(_check_llm_reachable):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "VPN_REQUIRED",
                "message": "Cannot reach the AI service. If you're outside the office, please connect to the VPN and try again.",
            },
        )

    try:
        start_time = time.time()
        with langfuse_trace("chat", session_id=request.session_id, metadata={"message": request.message}) as trace:
            config = {"configurable": {"thread_id": request.session_id}}
            result = await app_agent.ainvoke(
                {
                    "messages": [HumanMessage(content=request.message)],
                    "user_email": x_user_email or settings.DEFAULT_USER_EMAIL,
                    "session_id": request.session_id,
                },
                config=config,
            )
            
            raw_ai_message = result["messages"][-1].content
            routed_domain = result.get("domain", "unknown")

            final_message = raw_ai_message
            download_url = None
            interactive = None

            # Extract interactive email draft marker before any cleanup
            email_draft_pattern = re.compile(r'\[EMAIL_DRAFT_START\](.*?)\[EMAIL_DRAFT_END\]', re.DOTALL)
            email_draft_match = email_draft_pattern.search(final_message)
            if email_draft_match:
                try:
                    draft_data = json.loads(email_draft_match.group(1))
                    interactive = {"type": "email_draft", "data": draft_data}
                    final_message = email_draft_pattern.sub("", final_message).strip()
                except Exception:
                    pass

            # Extract and convert [DOWNLOAD_PDF:url:title] to markdown link
            download_tag_pattern = re.compile(r"\[DOWNLOAD_PDF:([^:]+):([^\]]+)\]")
            match = download_tag_pattern.search(final_message)
            if match:
                path = match.group(1)
                title = match.group(2)
                base_url = f"http://localhost:{settings.PORT}"
                download_url = f"{base_url}{path}"
                markdown_link = f"\n\n### 📄 **[Download {title}]({download_url})**"
                final_message = download_tag_pattern.sub(markdown_link, final_message)

            # Strip any HTML tags the LLM may have generated (render as plain text)
            html_stripped = re.sub(r'<[^>]+>', '', final_message).strip()
            if html_stripped:
                final_message = html_stripped

            # Remove any internal JSON/metadata blocks but ONLY if they are not the only content
            cleaned_message = re.sub(r'\{.*?\}', '', final_message, flags=re.DOTALL).strip()
            if cleaned_message:
                final_message = cleaned_message

            # Collapse 3+ consecutive blank lines to 2
            final_message = re.sub(r'\n{3,}', '\n\n', final_message).strip()

            # Ultimate fallback if empty
            if not final_message.strip():
                final_message = "I processed your request, but I was unable to generate a text summary. Please try again or rephrase your question."

            trace.update(output=final_message, metadata={"domain": routed_domain})

            # Structured Logging for Loki
            logger.info("chat_response", extra={
                "domain": routed_domain,
                "latency_ms": int((time.time() - start_time) * 1000),
                "session_id": request.session_id,
                "message_length": len(request.message),
            })

        return {
            "response": final_message,
            "domain": routed_domain,
            "id": "msg_1",
            "processing_time": f"{time.time() - start_time:.2f}s",
            "download_url": download_url,
            "interactive": interactive,
        }

    except Exception as e:
        print(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
        to=req.to,
        subject=req.subject,
        html_body=html_body,
        reply_to=req.requester_email or None,
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
