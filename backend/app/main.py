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
from app.mcp_client import load_mcp_tools, shutdown_mcp_client
from app.agents.deeplink_agent import get_deeplink_agent
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
from app.routes.pa_callback_routes import router as pa_callback_router
from app.routes.company_settings_routes import router as company_settings_router
from app.routes.observability_routes import router as observability_router
from app.services.feedback_service import FeedbackService

# -- Langfuse tracing --
from app.langfuse_tracing import TracingContext, langfuse_event

# -- Logger (console only — Loki removed, observability via PostgreSQL) --
logger = logging.getLogger("aurora-logger")
logger.setLevel(logging.INFO)
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())

from app.sharepoint_routes import router as sharepoint_router
from app.graph_sync import renew_subscriptions

app = FastAPI(title="Centriq AI Backend")

# ── LLM Reachability (VPN check) ─────────────────────────────────────────────

def _llm_host_port() -> tuple[str, int]:
    parsed = urlparse(settings.ROUTER_BASE_URL)
    return (parsed.hostname or ALIGNED_LLM_HOST), (parsed.port or 11434)


_llm_reachable_cache: dict = {"result": True, "ts": 0.0}
_LLM_REACHABLE_TTL = 30.0  # seconds — cache VPN check result


def _check_llm_reachable() -> bool:
    now = time.time()
    if now - _llm_reachable_cache["ts"] < _LLM_REACHABLE_TTL:
        return _llm_reachable_cache["result"]
    host, port = _llm_host_port()
    try:
        with socket.create_connection((host, port), timeout=2.0):
            result = True
    except OSError:
        result = False
    _llm_reachable_cache.update({"result": result, "ts": now})
    return result
app.include_router(sharepoint_router, prefix="/api")
app.include_router(pmo_router)
app.include_router(it_router)
app.include_router(prompt_router)
app.include_router(announcement_router)
app.include_router(employee_router)
app.include_router(people_router)
app.include_router(hr_portal_router)
app.include_router(admin_portal_router)
app.include_router(pa_callback_router)
app.include_router(company_settings_router)
app.include_router(observability_router)

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

    try:
        await load_mcp_tools()
        get_deeplink_agent()
        print("MCP deep-link tools loaded.")
    except Exception as e:
        print(f"[MCP] Deep-link tools failed to load: {e}")


@app.on_event("shutdown")
async def shutdown_event():
    await shutdown_mcp_client()


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
                            "leave_approved",
                            f"{tok.employee_email} — {leave.leave_type} {leave.start_date} to {leave.end_date}",
                            {
                                "employee_email": tok.employee_email,
                                "leave_type": leave.leave_type,
                                "start_date": str(leave.start_date),
                                "end_date": str(leave.end_date),
                                "approved_by": tok.approver_email,
                            }
                        )
                    except Exception:
                        pass

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

_policy_img_re = re.compile(r'\[POLICY_IMG:([^\]]+)\]')
_email_draft_re = re.compile(r'\[EMAIL_DRAFT_START\](.*?)\[EMAIL_DRAFT_END\]', re.DOTALL)
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

    # Remove stray JSON blobs (but only if non-empty text remains)
    cleaned = re.sub(r'\{.*?\}', '', final_message, flags=re.DOTALL).strip()
    if cleaned:
        final_message = cleaned

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
    # VPN / LLM reachability pre-flight
    if not await asyncio.to_thread(_check_llm_reachable):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "VPN_REQUIRED",
                "message": "Cannot reach the AI service. If you're outside the office, please connect to the VPN and try again.",
            },
        )

    start_time = time.time()
    user_email = x_user_email or settings.DEFAULT_USER_EMAIL
    user_role = (x_user_role or "employee").lower()
    config = {"configurable": {"thread_id": request.session_id}}
    input_data = {
        "messages": [HumanMessage(content=request.message)],
        "user_email": user_email,
        "user_role": user_role,
        "graph_token": x_graph_token,
        "session_id": request.session_id,
    }

    async def generate():
        from app.models import AiRequestLog, AiLlmCallLog

        accumulated_text = ""
        routed_domain = "general"
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
                    final_messages = output.get("messages") or []

        except Exception as exc:
            error_msg = str(exc)
            print(f"[stream] error: {exc}")
            yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"

        # If nothing streamed (tool-only path, fast-path nodes, etc.), use last message
        if not accumulated_text and final_messages:
            last = final_messages[-1]
            accumulated_text = last.content if hasattr(last, "content") and isinstance(last.content, str) else ""
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

@app.post("/api/suggestions")
async def get_suggestions(request: SuggestionsRequest):
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
        suggestions = json.loads(raw)
        if isinstance(suggestions, list):
            suggestions = [str(s) for s in suggestions[:3] if s]
        else:
            suggestions = []
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
        ChatFeedback, FoodComplaint, Project, FoodVendorFeedback,
    )
    from sqlalchemy import func as sqlfunc
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
