import warnings
warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")

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

from fastapi import Depends, FastAPI, Header, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional

from app.auth import CurrentUser, get_current_user, require_admin
from app.agent import app_agent
from app.agents.deeplink_agent import get_deeplink_agent
from app.concurrency import chat_gate
from app.services.llm_resilience import ServerBusyError
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
from app.routes.capability_command_routes import router as capability_command_router
from app.routes.library_portal_routes import router as library_portal_router
from app.routes.pa_callback_routes import router as pa_callback_router
from app.routes.company_settings_routes import router as company_settings_router
from app.routes.app_links_routes import router as app_links_router, public_router as app_links_public_router
from app.routes.form_library_routes import router as form_library_router
from app.routes.observability_routes import router as observability_router
from app.routes.analytics_routes import router as analytics_router
from app.routes.llm_controls_routes import router as llm_controls_router
from app.routes.integration_routes import router as integration_router
from app.routes.installation_routes import router as installation_router
from app.routes.software_catalog_routes import router as software_catalog_router
from app.routes.ms365_routes import router as ms365_router
from app.routes.document_routes import router as document_router, public_router as document_public_router
from app.routes.document_library_routes import router as document_library_router
from app.routes.manager_routes import router as manager_router
from app.routes.attendance_routes import router as attendance_router
from app.routes.access_routes import router as access_router
from app.routes.automation_routes import router as automation_router
from app.routes.escalation_routes import router as escalation_router
from app.routes.welcome_routes import router as welcome_router, public_router as welcome_public_router
from app.routes.travel_routes import router as travel_router, admin_router as travel_admin_router
from app.routes.appreciation_routes import router as appreciation_router
from app.routes.skill_hr_routes import router as skill_hr_router
from app.routes.skill_it_routes import router as skill_it_router
from app.routes.skill_doc_routes import router as skill_doc_router
from app.routes.connector_routes import router as connector_admin_router, invoke_router as connector_invoke_router
from app.routes.techelevate_local_routes import router as techelevate_local_router
from app.routes.udemy_routes import router as udemy_router
from app.routes.project_iq_routes import router as project_iq_router
from app.routes.onboarding_routes import router as onboarding_router
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


# ── Model warm-up helpers ──────────────────────────────────────────────────────

def _ollama_root() -> str:
    base = settings.AGENT_BASE_URL.rstrip("/")
    return base[:-3] if base.endswith("/v1") else base


def _ping_model(model: str) -> bool:
    """POST a 0-token request to Ollama to keep ``model`` loaded in VRAM.

    Uses num_predict=0 so the server loads weights but generates nothing —
    the cheapest possible keep-alive.  keep_alive=30m extends the eviction
    window — 10min heartbeat cycle + 30min window = always warm even under load.
    """
    import urllib.request, json as _json
    url = _ollama_root() + "/api/generate"
    payload = _json.dumps({
        "model": model,
        "prompt": "",
        "keep_alive": "30m",
        "options": {"num_predict": 0},
    }).encode()
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as _:  # noqa: S310
            pass
        return True
    except Exception as exc:  # noqa: BLE001
        return False


async def _warmup_task() -> None:
    """Ping every model tier once — run as a fire-and-forget task.

    Covers generation tiers (agent, service, summarizer) AND the embedding model
    and router model. Keeping the embed model warm eliminates cold-reload on the
    first semantic-router/answer-cache/form-match call of the day.
    """
    try:
        cfg = llm_controls.get_config()
        tiers = cfg.get("tiers", {})
        seen: set[str] = set()
        # Generation tiers
        for tier in ("agent", "service", "summarizer"):
            model = (tiers.get(tier) or {}).get("model", "")
            if model and model not in seen:
                seen.add(model)
                await asyncio.to_thread(_ping_model, model)
        # Router model (small, but still benefits from residency)
        router_model = settings.ROUTER_MODEL_NAME
        if router_model and router_model not in seen:
            seen.add(router_model)
            await asyncio.to_thread(_ping_model, router_model)
        # Embedding model — critical for semantic router + answer cache on every request
        embed_model = settings.EMBEDDING_MODEL_NAME
        if embed_model and embed_model not in seen:
            seen.add(embed_model)
            await asyncio.to_thread(_ping_model, embed_model)
    except Exception:  # noqa: BLE001
        pass



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
app.include_router(capability_command_router)
app.include_router(library_portal_router)
app.include_router(pa_callback_router)
app.include_router(company_settings_router)
app.include_router(app_links_router)
app.include_router(app_links_public_router)
app.include_router(form_library_router)
app.include_router(observability_router)
app.include_router(analytics_router)
app.include_router(llm_controls_router)
app.include_router(integration_router)
app.include_router(installation_router)
app.include_router(software_catalog_router)
app.include_router(ms365_router)
app.include_router(document_router)
app.include_router(document_public_router)
app.include_router(document_library_router)
app.include_router(manager_router)
app.include_router(attendance_router)
app.include_router(access_router)
app.include_router(automation_router)
app.include_router(escalation_router)
app.include_router(welcome_router)
app.include_router(welcome_public_router)
app.include_router(travel_router)
app.include_router(travel_admin_router)
app.include_router(appreciation_router)
app.include_router(skill_hr_router)
app.include_router(skill_it_router)
app.include_router(skill_doc_router)
app.include_router(connector_admin_router)
app.include_router(connector_invoke_router)
app.include_router(techelevate_local_router)
app.include_router(udemy_router)
app.include_router(project_iq_router)
app.include_router(onboarding_router)

_uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(_uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")

# Chat-attachment upload limits. Only text-extractable formats are allowed —
# images/binaries are rejected (the chat model is text-only). MAX_UPLOAD_CHARS
# mirrors the slice the composer sends to the model, so anything bigger is
# blocked up front instead of being silently truncated.
_ALLOWED_UPLOAD_EXTS = {".pdf", ".txt", ".csv", ".json", ".md", ".xml", ".log"}
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
_MAX_UPLOAD_CHARS = 6000

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

class PortalContext(BaseModel):
    """What the user is currently looking at in the UI.
    Passed by the frontend on every chat request so the agent can give
    portal-aware answers and optionally return a portal_action to drive
    the visible page (e.g. filter the directory list, highlight a row).
    """
    page: Optional[str] = None          # "directory" | "pmo" | "udemy" | "documents" | "team" | None
    active_filters: Optional[dict] = {} # current filter state already applied on the portal

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []
    session_id: Optional[str] = "default_session_v2"
    is_private: Optional[bool] = False
    portal_context: Optional[PortalContext] = None
    active_mode: Optional[str] = None

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

# Handles for the long-lived background loops spawned in startup_event, so the
# shutdown hook can cancel them cleanly (otherwise the event loop garbage-collects
# them mid-await at shutdown → "Task was destroyed but it is pending!").
_app_background_tasks: list = []


@app.on_event("startup")
async def startup_event():
    # ARB #32 — warn early if running with >1 worker so operators know the
    # module-level TTL caches in agent.py (_feedback_count_cache etc.) are
    # per-process and will cause cache-miss churn.  Harmless at single-worker.
    import os as _os
    _worker_count = int(_os.environ.get("WEB_CONCURRENCY", "1"))
    if _worker_count > 1:
        logging.warning(
            "[ARB#32] Running with WEB_CONCURRENCY=%s — module-level TTL caches "
            "in agent.py are NOT shared across workers. Migrate them to Redis "
            "before scaling horizontally.", _worker_count
        )

    try:
        await asyncio.to_thread(init_db)
    except Exception as e:
        logging.error("init_db failed: %s", e, exc_info=True)

    try:
        from app.connectors.registry import start_background_refresh
        await start_background_refresh()
    except Exception as e:
        logging.warning("Connector registry startup failed (non-fatal): %s", e)

    try:
        from app.database import SessionLocal
        from app.services.document_service import seed_default_templates
        db = SessionLocal()
        try:
            await asyncio.to_thread(seed_default_templates, db)
        finally:
            db.close()
    except Exception as e:
        pass

    try:
        from app.services.udemy_business_service import configured as udemy_configured, _ensure_index
        if udemy_configured():
            _ensure_index()
    except Exception as e:
        logging.warning("Udemy index warm-up failed (non-fatal): %s", e)

    try:
        from app.routes.access_routes import seed_system_roles
        from app.database import SessionLocal as _SL
        _db = _SL()
        try:
            await asyncio.to_thread(seed_system_roles, _db)
        finally:
            _db.close()
    except Exception as e:
        logging.warning("Access role seed failed (non-fatal): %s", e)

    if hasattr(app_agent.checkpointer, "setup"):
        try:
            await app_agent.checkpointer.setup()
        except Exception as e:
            from langgraph.checkpoint.memory import MemorySaver as _MemorySaver
            app_agent.checkpointer = _MemorySaver()
            
    async def periodic_renew():
        while True:
            await asyncio.sleep(3600)
            try:
                await asyncio.to_thread(renew_subscriptions)
            except Exception as e:
                pass

    _app_background_tasks.append(asyncio.create_task(periodic_renew()))

    # Run any due attendance-report automations every minute (schedules persist in DB).
    async def attendance_scheduler():
        from app.services import attendance_schedule_service
        while True:
            await asyncio.sleep(60)
            try:
                fired = await asyncio.to_thread(attendance_schedule_service.run_due)
                if fired:
                    pass
            except Exception as e:
                pass
            # Automation Hub — custom recurring email rules created by managers/HR/IT/PMO.
            try:
                from app.services import automation_service as _automation_svc
                fired_auto = await asyncio.to_thread(_automation_svc.run_due)
                if fired_auto:
                    pass
            except Exception as e:
                pass

    _app_background_tasks.append(asyncio.create_task(attendance_scheduler()))

    # ── Model keep-alive heartbeat ─────────────────────────────────────────
    # Fires a 0-token ping at every heavy model tier every 10 minutes.
    # Combined with the 15-min keep_alive on every real request, this ensures
    # gpt-oss / llama3.1:8b stay loaded in VRAM even under shared-server traffic.
    async def model_warmup_scheduler():
        await asyncio.sleep(30)  # let startup finish first
        while True:
            await _warmup_task()
            await asyncio.sleep(600)  # 10 minutes

    _app_background_tasks.append(asyncio.create_task(model_warmup_scheduler()))


@app.on_event("shutdown")
async def shutdown_event():
    # Cancel the connector registry's poll + pubsub loops cleanly so they don't
    # trigger "Task was destroyed but it is pending!" / async-generator aclose
    # warnings when the event loop tears down.
    try:
        from app.connectors.registry import stop_background_refresh
        await stop_background_refresh()
    except Exception as e:
        logging.warning("Connector registry shutdown failed (non-fatal): %s", e)

    # Cancel the long-lived schedulers (subscription renew, attendance/automation
    # runner, model warm-up). They only ever act mid-loop while the app is alive,
    # so cancelling at shutdown has no feature impact — it just avoids the
    # "Task was destroyed but it is pending!" warning.
    for task in _app_background_tasks:
        if not task.done():
            task.cancel()
    for task in _app_background_tasks:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    _app_background_tasks.clear()

    # ── Chat retention: 30-day purge ───────────────────────────────────────
    # Deletes ConversationSummary rows (the AI's medium-term memory) that
    # have not been updated in >30 days, matching the frontend localStorage
    # eviction policy. Runs every 6 hours; errors are swallowed silently.
    async def chat_retention_scheduler():
        import datetime as _dt
        from app.database import SessionLocal
        from app.models import ConversationSummary
        await asyncio.sleep(120)  # allow startup to settle first
        while True:
            try:
                cutoff = _dt.datetime.utcnow() - _dt.timedelta(days=30)
                db = SessionLocal()
                try:
                    db.query(ConversationSummary).filter(
                        ConversationSummary.updated_at < cutoff
                    ).delete(synchronize_session=False)
                    db.commit()
                finally:
                    db.close()
            except Exception:
                pass
            await asyncio.sleep(6 * 3600)  # every 6 hours

    asyncio.create_task(chat_retention_scheduler())

    # ── Action-safety maintenance (ARB #26) ────────────────────────────────
    # Proactively expire past-TTL pending_action rows and purge terminal rows
    # older than 48 h.  Runs every hour — low-cost table scans, keeps the
    # table lean and makes DB queries accurate (no stale 'pending' phantoms).
    async def pending_action_maintenance_scheduler():
        from app.services.pending_action_service import PendingActionService as _PAS
        await asyncio.sleep(90)  # let startup settle
        while True:
            try:
                await asyncio.to_thread(_PAS.expire_stale)
            except Exception:
                pass
            try:
                await asyncio.to_thread(_PAS.purge_expired, 48)
            except Exception:
                pass
            await asyncio.sleep(3600)  # every hour

    asyncio.create_task(pending_action_maintenance_scheduler())

    # ── Proactive nudge scan ───────────────────────────────────────────────
    # Turns the assistant proactive: deterministic detectors (zero LLM) surface
    # actionable nudges (expiring leaves, stale approvals) into the in-app feed.
    # Best-effort Teams/email push stays OFF until NUDGE_PUSH_ENABLED is set.
    async def proactive_nudge_scheduler():
        from app.services import nudge_service
        await asyncio.sleep(45)  # let startup settle
        while True:
            try:
                await asyncio.to_thread(nudge_service.run_due)
            except Exception:
                pass
            await asyncio.sleep(max(1, settings.NUDGE_SCAN_INTERVAL_MIN) * 60)

    asyncio.create_task(proactive_nudge_scheduler())

    get_deeplink_agent()



@app.get("/")
async def root():
    return {"status": "online", "message": "Centriq AI Backend is running"}


@app.get("/api/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    """Returns the authenticated user's identity. Fails with 403 if not on the allowlist."""
    role = user.role
    db = SessionLocal()
    try:
        from app.models import Employee
        emp = db.query(Employee).filter(Employee.email == user.email).first()
        if emp and emp.role:
            role = emp.role.strip()
    except Exception:
        pass
    finally:
        db.close()
    return {"email": user.email, "role": role}


@app.get("/api/health/llm")
async def llm_health():
    """Probe the shared Ollama server (3s timeout) and report per-tier breaker state.

    status: "ok" (reachable, all breakers closed), "degraded" (reachable but at least
    one tier's circuit breaker is open — fallback models are serving that tier), or
    "down" (Ollama unreachable — VPN required from outside office)."""
    from app.services.llm_resilience import get_breaker_status
    import urllib.request

    base = settings.AGENT_BASE_URL.rsplit("/v1", 1)[0]

    def _probe() -> bool:
        try:
            req = urllib.request.Request(f"{base}/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status == 200
        except Exception:
            return False

    reachable = await asyncio.to_thread(_probe)
    breakers = get_breaker_status()
    if not reachable:
        status = "down"
    elif any(state == "open" for state in breakers.values()):
        status = "degraded"
    else:
        status = "ok"
    return {"status": status, "ollama_reachable": reachable, "circuit_breakers": breakers}

@app.get("/api/chat/load")
async def chat_load():
    """Live concurrency-gate stats + circuit breaker states — handy while load testing."""
    stats = await chat_gate.stats()
    try:
        from app.services.llm_resilience import get_breaker_status
        stats["circuit_breakers"] = get_breaker_status()
    except Exception:
        pass
    return stats


@app.post("/api/warmup")
async def warmup_models():
    """Fire-and-forget: ping heavy model tiers so they stay warm in VRAM.
    Called by the frontend when the chat input is focused so a cold-reload
    starts before the user hits Send."""
    asyncio.create_task(_warmup_task())
    return {"status": "warming"}


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
    """Accept a PDF or text file and return its extracted text content.

    Images and other binary formats are rejected — the chat model is text-only,
    so only the whitelisted text-extractable formats are accepted. Files whose
    extracted text exceeds the model's window are blocked rather than truncated.
    """
    filename = file.filename or "upload"

    # Block images and any non-whitelisted format up front.
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _ALLOWED_UPLOAD_EXTS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Supported formats: PDF, TXT, CSV, JSON, MD, XML, LOG.",
        )

    content_bytes = await file.read()
    if len(content_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File must be under 10 MB.")

    extracted = ""
    if ext == ".pdf":
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

    char_count = len(extracted)
    if char_count > _MAX_UPLOAD_CHARS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"File is too large to analyze: {char_count:,} characters "
                f"(limit {_MAX_UPLOAD_CHARS:,}). Upload a shorter file or paste "
                "the relevant section."
            ),
        )

    return {"text": extracted, "filename": filename, "char_count": char_count}


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


def _undo_confirm_form(token: str, summary: str, system: str) -> str:
    """Branded confirm page for undoing an action. The reversal runs ONLY on the POST this
    page submits — so a GET (or a link prefetcher like SafeLinks / a chat unfurler) can never
    silently undo the action."""
    try:
        from app.services.email_service import _BUDDY_B64
    except Exception:
        _BUDDY_B64 = ""
    buddy = (
        f'<img src="data:image/png;base64,{_BUDDY_B64}" alt="" '
        f'style="width:60px;height:60px;display:block;margin:0 auto 10px;">'
        if _BUDDY_B64 else ""
    )
    where = f" in {html.escape(system)}" if system else ""
    return f"""<!DOCTYPE html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Undo action</title>
    <style>
    *{{box-sizing:border-box;}}
    body{{font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f4fa;padding:20px;}}
    .card{{background:#fff;border-radius:18px;max-width:460px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(13,27,46,.12);overflow:hidden;}}
    .hero{{background:linear-gradient(135deg,#1B6FC8 0%,#0D9488 60%,#16A34A 100%);padding:24px;}}
    .hero .brand{{color:#fff;font-size:20px;font-weight:800;letter-spacing:.2px;}}
    .body{{padding:28px 36px 32px;}}
    h1{{color:#0d1b2e;font-size:21px;margin:0 0 8px;}}
    p.sub{{color:#64748b;font-size:14.5px;margin:0 0 20px;line-height:1.55;}}
    button{{width:100%;background:#dc2626;color:#fff;border:0;border-radius:25px;padding:14px;font:700 15px 'Segoe UI',Arial,sans-serif;cursor:pointer;}}
    button:hover{{background:#b91c1c;}}
    .foot{{margin-top:16px;font-size:12px;color:#94a3b8;}}
    </style></head>
    <body><div class="card">
    <div class="hero">{buddy}<div class="brand">Centriq AI</div></div>
    <div class="body">
    <h1>Undo this action?</h1>
    <p class="sub">This will reverse <strong>{html.escape(summary)}</strong>{where}. You can only undo while it hasn't been picked up yet.</p>
    <form method="post" action="/api/receipts/undo/{token}">
      <button type="submit">Yes, undo it</button>
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
                    pass

            db.commit()
            # Notify employee — use employee's Graph token as sender since the manager
            # clicks the approval link without a connected MS365 session in our app.
            try:
                from app.services.email_service import send_leave_decision_notification
                from app.models import Employee
                emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
                if emp:
                    send_leave_decision_notification(
                        user_email=tok.employee_email,
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
                pass

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
                        user_email=tok.employee_email,
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
            pass

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
            pass

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
_SKIP_STREAMING_NODES = {"followup_resolver", "intent_router", "context_manager", "feedback_lookup", "context_gate", "state_tracker", "form_builder_agent", "analytics_agent"}

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
    "asset_request", "office_supply_request", "create_ticket", "hardware_issue", "my_tickets", "my_assets",
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
_form_builder_re = re.compile(r'\[FORM_BUILDER_START\](.*?)\[FORM_BUILDER_END\]', re.DOTALL)
_quick_choice_re = re.compile(r'\[QUICK_CHOICE_START\](.*?)\[QUICK_CHOICE_END\]', re.DOTALL)
_chart_re = re.compile(r'\[CHART_START\](.*?)\[CHART_END\]', re.DOTALL)
_download_tag_re = re.compile(r"\[DOWNLOAD_PDF:([^:]+):([^\]]+)\]")
# ARB #41 — citation extraction. RAG search tools (search_policies / search_projects /
# search_it_docs / …) all format hits as "**Title** (Category):\n<text>" joined by
# "\n\n---\n\n" (see PolicyService._hybrid_search). We parse that out of the ToolMessages
# so the answer can be surfaced with its grounding sources in a trust UI.
_citation_re = re.compile(
    r"\*\*(.+?)\*\*\s*\((.+?)\):\n([\s\S]*?)(?=\n\n---|\n\n\[POLICY_IMG|\Z)"
)


def _extract_citations(all_messages: list) -> list[dict]:
    """Pull grounding sources out of RAG tool outputs in the message history.

    Returns a deduped list of ``{"title", "category", "excerpt"}`` in first-seen
    order. Empty when the answer wasn't grounded in any retrieved document
    (e.g. a pure-action turn), so the frontend simply renders no trust card.
    """
    citations: list[dict] = []
    seen: set[str] = set()
    for msg in all_messages:
        content = getattr(msg, "content", None)
        if not isinstance(content, str) or "**" not in content:
            continue
        for m in _citation_re.finditer(content):
            title = m.group(1).strip()
            category = m.group(2).strip()
            excerpt = re.sub(r"\[POLICY_IMG:[^\]]*\]", "", m.group(3)).strip()
            key = title.lower()
            if not title or key in seen:
                continue
            seen.add(key)
            citations.append({
                "title": title,
                "category": category,
                "excerpt": excerpt[:180].strip(),
            })
    return citations


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
        except Exception as _e:
            logger.warning("Failed to parse EMAIL_DRAFT marker JSON (widget dropped): %s; raw=%.200r", _e, email_match.group(1))
            final_message = _email_draft_re.sub("", final_message).strip()

    # Extract dynamic form (Form Library) — must run BEFORE the JSON-blob stripping below so the
    # form schema JSON isn't mangled. The marker wraps the JSON, so it's gone before any blob regex.
    form_match = _dynamic_form_re.search(final_message)
    if form_match:
        try:
            form_data = json.loads(form_match.group(1))
            interactive = {"type": "dynamic_form", "data": form_data}
            final_message = _dynamic_form_re.sub("", final_message).strip()
        except Exception as _e:
            logger.warning("Failed to parse DYNAMIC_FORM marker JSON (widget dropped): %s; raw=%.200r", _e, form_match.group(1))
            final_message = _dynamic_form_re.sub("", final_message).strip()

    # Extract form builder draft (admin creates a NEW form template).
    fb_match = _form_builder_re.search(final_message)
    if fb_match:
        try:
            fb_data = json.loads(fb_match.group(1))
            interactive = {"type": "form_builder", "data": fb_data}
            final_message = _form_builder_re.sub("", final_message).strip()
        except Exception as _e:
            logger.warning("Failed to parse FORM_BUILDER marker JSON (widget dropped): %s; raw=%.200r", _e, fb_match.group(1))
            final_message = _form_builder_re.sub("", final_message).strip()

    # Extract quick-choice card (zero-LLM choice widget).
    qc_match = _quick_choice_re.search(final_message)
    if qc_match:
        try:
            qc_data = json.loads(qc_match.group(1))
            interactive = {"type": "quick_choice", "data": qc_data}
            final_message = _quick_choice_re.sub("", final_message).strip()
        except Exception as _e:
            logger.warning("Failed to parse QUICK_CHOICE marker JSON (widget dropped): %s; raw=%.200r", _e, qc_match.group(1))
            final_message = _quick_choice_re.sub("", final_message).strip()

    # Extract analytics chart (ChartSpec) — must run BEFORE the JSON-blob stripping below so the
    # chart JSON isn't mangled. The marker wraps the JSON, so it's removed before any blob regex.
    chart_match = _chart_re.search(final_message)
    if chart_match:
        try:
            chart_data = json.loads(chart_match.group(1))
            interactive = {"type": "chart", "data": chart_data}
            final_message = _chart_re.sub("", final_message).strip()
        except Exception as _e:
            logger.warning("Failed to parse CHART marker JSON (widget dropped): %s; raw=%.200r", _e, chart_match.group(1))
            final_message = _chart_re.sub("", final_message).strip()

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
        # Rescue: surface the last ToolMessage with meaningful text before giving up.
        # This fires when the agent returned empty content (common with weak models after tool use).
        from langchain_core.messages import ToolMessage as _TMsg, AIMessage as _AIMsg
        _rescue = None
        for _m in reversed(all_messages):
            if isinstance(_m, _TMsg) and isinstance(_m.content, str) and _m.content.strip():
                _candidate = _strip_json_blobs(_m.content.strip())
                if _candidate.strip():
                    _rescue = _candidate.strip()
                    break
            # Also accept an AIMessage that preceded the empty one
            if isinstance(_m, _AIMsg) and isinstance(_m.content, str) and _m.content.strip():
                _candidate = _strip_json_blobs(_m.content.strip())
                if _candidate.strip():
                    _rescue = _candidate.strip()
                    break
        final_message = _rescue if _rescue else "I'm sorry, I wasn't able to generate a response. Please try again or rephrase your question."

    citations = _extract_citations(all_messages)

    return {
        "final_message": final_message,
        "download_url": download_url,
        "interactive": interactive,
        "images": policy_images if policy_images else None,
        "citations": citations if citations else None,
        "processing_time": f"{time.time() - start_time:.2f}s",
    }


async def _get_token_and_location(user_email: str, x_graph_token: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Fetch MS graph token + user office location in parallel, with Redis cache for location.

    Called inside generate() so cache/fastpath requests never pay this overhead.
    Location is cached per email for 24h — it changes ~never during a workday.
    """
    from app.services.oauth_service import get_valid_token as _get_valid_token

    async def _fetch_token() -> Optional[str]:
        if x_graph_token:
            return x_graph_token
        try:
            return await _get_valid_token(user_email.lower().strip(), "microsoft")
        except Exception:
            return None

    async def _fetch_location_cached(token: Optional[str]) -> Optional[str]:
        if not token:
            return None
        cache_key = f"user_loc:{user_email.lower()}"
        try:
            from app.redis_config import get_redis_client
            rc = get_redis_client()
            if rc:
                cached = rc.get(cache_key)
                if cached:
                    return cached if cached != "__none__" else None
        except Exception:
            pass
        try:
            from app.services.ms365_service import fetch_my_profile
            _profile = await fetch_my_profile(token)
            loc = (_profile.get("officeLocation") or _profile.get("city") or _profile.get("country")) or None
            try:
                from app.redis_config import get_redis_client
                rc = get_redis_client()
                if rc:
                    rc.setex(cache_key, 86400, loc if loc else "__none__")
            except Exception:
                pass
            return loc
        except Exception:
            return None

    token = await _fetch_token()
    location = await _fetch_location_cached(token)
    return token, location


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

    # Token + location are resolved INSIDE generate() so cache/fastpath requests
    # never block on the live MS Graph call. input_data is assembled lazily there.
    config = {"configurable": {"thread_id": request.session_id}}

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
        # Skipped while an assistant mode is active so mode stays sticky until /exit.
        name_match = (
            None if request.active_mode
            else re.search(r'^\s*who\s+is\s+([a-zA-Z0-9.-]+\s+[a-zA-Z0-9.-]+)[?.!\s]*$', request.message, re.IGNORECASE)
        )
        if name_match:
            person_name = name_match.group(1).strip()
            try:
                from app.services.employee_service import EmployeeService
                profile_res = await asyncio.to_thread(EmployeeService.get_profile, person_name)
                if profile_res and not profile_res.startswith("No employee profile found"):
                    yield f"data: {json.dumps({'type': 'token', 'content': profile_res})}\n\n"
                    # Observability log
                    if not request.is_private:
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
                            pass
                        finally:
                            try:
                                _db.close()
                            except Exception:
                                pass
                    yield f"data: {json.dumps({'type': 'done', 'domain': 'hr', 'download_url': None, 'interactive': None, 'images': None, 'processing_time': f'{time.time() - start_time:.2f}s'})}\n\n"
                    return
            except Exception as _pe:
                pass

        # ── Semantic answer cache (instant path, zero LLM) ──────────────
        # If a near-identical informational question was answered recently, stream the saved
        # answer immediately and skip the concurrency gate + graph entirely. Guarded against
        # action phrasings so side-effecting requests never short-circuit.
        # An active assistant mode (e.g. Analytics Builder) must drive routing — never let a
        # stale cached text answer for the same phrasing preempt the mode's domain.
        if (settings.ANSWER_CACHE_ENABLED and not request.is_private
                and not request.active_mode
                and not _CACHE_SKIP_RE.search(request.message)):
            try:
                from app.services.answer_cache_service import AnswerCacheService
                hit = await asyncio.to_thread(AnswerCacheService.lookup, request.message)
            except Exception as _ce:
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
                    pass
                finally:
                    try:
                        _db.close()
                    except Exception:
                        pass
                yield f"data: {json.dumps({'type': 'done', 'domain': cached_domain})}\n\n"
                return

        accumulated_text = ""
        routed_domain = "general"
        routed_sub_intent: str | None = None
        final_messages = []
        llm_calls: dict[str, dict] = {}   # run_id → {node, model, start}
        completed_calls: list[dict] = []   # finished LLM calls for DB insert
        error_msg: str | None = None
        ttft_ms: int | None = None         # ms from request start to first streamed token

        # Create Langfuse trace at the START so child spans can attach
        tracing = TracingContext(
            session_id=request.session_id,
            user_id=user_email,
            metadata={"message": request.message},
            tags=["chat"],
            is_private=bool(request.is_private),
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

        # Resolve token + location HERE (after all fast-paths) so cache/fastpath
        # callers pay zero MS Graph latency. Both calls run in parallel.
        effective_graph_token, user_location = await _get_token_and_location(user_email, x_graph_token)
        input_data = {
            "messages": [HumanMessage(content=request.message)],
            "user_email": user_email,
            "user_role": user_role,
            "graph_token": effective_graph_token,
            "session_id": request.session_id,
            "user_location": user_location,
            "portal_context": request.portal_context.model_dump() if request.portal_context else None,
            "active_mode": request.active_mode or None,
        }

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
                    # Status event: let UI show "composing" when the response LLM starts
                    if node not in _SKIP_STREAMING_NODES:
                        yield f"data: {json.dumps({'type': 'status', 'stage': 'composing', 'node': node})}\n\n"

                # ── Track LLM call end ───────────────────────────────────
                elif event_type == "on_chat_model_end":
                    run_id = event.get("run_id", "")
                    call = llm_calls.pop(run_id, None)
                    if call:
                        elapsed = time.time() - call["start"]
                        output_msg = event.get("data", {}).get("output")

                        # Extract token usage from LangChain AIMessage.
                        # Primary: usage_metadata (populated when stream_usage=True).
                        # Fallback: response_metadata["token_usage"] from the OpenAI-compat API.
                        usage = {}
                        if output_msg and hasattr(output_msg, "usage_metadata") and output_msg.usage_metadata:
                            um = output_msg.usage_metadata
                            usage = {
                                "input_tokens": getattr(um, "input_tokens", 0) or (um.get("input_tokens", 0) if isinstance(um, dict) else 0),
                                "output_tokens": getattr(um, "output_tokens", 0) or (um.get("output_tokens", 0) if isinstance(um, dict) else 0),
                                "total_tokens": getattr(um, "total_tokens", 0) or (um.get("total_tokens", 0) if isinstance(um, dict) else 0),
                            }
                        elif output_msg and hasattr(output_msg, "response_metadata"):
                            tu = (output_msg.response_metadata or {}).get("token_usage") or {}
                            if tu:
                                usage = {
                                    "input_tokens": tu.get("prompt_tokens", 0),
                                    "output_tokens": tu.get("completion_tokens", 0),
                                    "total_tokens": tu.get("total_tokens", 0),
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


                # ── Real-time status events — shown in the UI thinking indicator ──
                # Replaces the fake timer-based activity steps: users see actual pipeline
                # progress (routing → agent → tool → composing) within ~300ms of send.
                elif event_type == "on_chain_start":
                    _node_name = event.get("name", "")
                    _node_label = {
                        "intent_router": "routing",
                        "context_manager": "loading context",
                        "feedback_lookup": "loading context",
                        "hr_agent": "thinking",
                        "admin_agent": "thinking",
                        "it_agent": "thinking",
                        "pmo_agent": "thinking",
                        "manager_agent": "thinking",
                        "ms365_agent": "thinking",
                        "deeplink_agent": "automating",
                        "form_builder_agent": "designing form",
                        "doc_agent": "generating document",
                        "general_agent": "thinking",
                        "connector_agent": "connecting",
                    }.get(_node_name)
                    if _node_label:
                        yield f"data: {json.dumps({'type': 'status', 'stage': _node_label, 'node': _node_name})}\n\n"

                elif event_type == "on_tool_start":
                    _tool_name = event.get("name", "")
                    # Friendly label: convert snake_case tool name to human-readable
                    _friendly = _tool_name.replace("_", " ").strip()
                    yield f"data: {json.dumps({'type': 'status', 'stage': f'using {_friendly}', 'node': _tool_name})}\n\n"

                # Stream tokens from final-response nodes only
                elif event_type == "on_chat_model_stream":
                    node = event.get("metadata", {}).get("langgraph_node", "")
                    if node not in _SKIP_STREAMING_NODES:
                        chunk = event["data"].get("chunk")
                        if chunk is not None:
                            content = chunk.content if hasattr(chunk, "content") else ""
                            # Only stream plain text — skip tool-call argument dicts
                            if isinstance(content, str) and content:
                                if ttft_ms is None:
                                    ttft_ms = int((time.time() - start_time) * 1000)
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
            # ML01 server-busy: the Ollama queue was full — tell the user to retry,
            # same UX as the concurrency gate's "busy" signal.
            if isinstance(exc, ServerBusyError):
                yield f"data: {json.dumps({'type': 'busy', 'message': 'The AI server is handling too many requests right now. Please try again in a moment.'})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'domain': routed_domain or 'general'})}\n\n"
            # Degraded mode: a connectivity-class failure means even the fallback model
            # was unreachable (the resilience layer already retried). Tell the user what
            # happened in plain language as a normal assistant message instead of
            # surfacing a raw exception banner.
            elif any(k in error_msg.lower() for k in ("connection", "connect", "timed out", "timeout",
                                                       "refused", "unreachable", "name or service")):
                friendly = (
                    "I can't reach the AI model server right now — it may be restarting or "
                    "under heavy load. Your message wasn't lost; please try again in a "
                    "minute. If this keeps happening, contact IT support."
                )
                yield f"data: {json.dumps({'type': 'token', 'content': friendly})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'domain': 'general', 'degraded': True})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"
                # Always emit a done event after an error so the frontend can unlock the
                # composer and stop showing the "composing" spinner.
                yield f"data: {json.dumps({'type': 'done', 'domain': routed_domain or 'general', 'error': True})}\n\n"
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

        # Post-process the accumulated text. These finalization steps run AFTER the answer
        # has already streamed to the user, so a failure here must NEVER turn a delivered
        # answer into an error bubble — guard them and fall back to the raw answer.
        latency_ms = int((time.time() - start_time) * 1000)
        post = {
            "final_message": accumulated_text, "download_url": None,
            "interactive": None, "images": None, "citations": None,
            "processing_time": latency_ms,
        }
        final_message = accumulated_text
        try:
            post = _postprocess(accumulated_text, final_messages, routed_domain, start_time)
            final_message = post["final_message"]
            # If post-processing changed the text (HTML stripped, markers removed), patch the frontend
            if final_message != accumulated_text:
                yield f"data: {json.dumps({'type': 'replace', 'content': final_message})}\n\n"
        except Exception:
            logger.exception("[chat] post-processing failed; serving the raw streamed answer")

        # ── Observability: dual-write to Langfuse + PostgreSQL ───────
        # Langfuse: finalise trace with output (best-effort — never break the response)
        try:
            tracing.finalize(output=final_message, domain=routed_domain, latency_ms=latency_ms)
        except Exception:
            logger.exception("[chat] tracing.finalize failed")

        # PostgreSQL: insert request log + LLM call logs
        if not request.is_private:
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
                    time_to_first_token_ms=ttft_ms,
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
                pass
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
                and not request.is_private
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
            pass

        yield f"data: {json.dumps({'type': 'done', 'domain': routed_domain, 'download_url': post['download_url'], 'interactive': post['interactive'], 'images': post['images'], 'citations': post.get('citations'), 'processing_time': post['processing_time']})}\n\n"

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


# Markers of a "nothing to follow up on" response — no results, an error, or the
# assistant abstaining. Following these up produces troubleshooting/app-meta chips
# ("reset my search", "how do I add an employee") that don't belong in a user-facing
# assistant, so we surface no chips at all instead.
_NO_FOLLOWUP_RESPONSE_MARKERS = (
    "no employees found", "no results", "no matching", "no records", "none found",
    "couldn't find", "could not find", "didn't find", "did not find", "not found",
    "i don't have", "i do not have", "don't have that", "isn't available",
    "is not available", "unable to", "something went wrong", "an error occurred",
)


def _has_no_followup(response: str) -> bool:
    low = (response or "").lower()
    return any(marker in low for marker in _NO_FOLLOWUP_RESPONSE_MARKERS)


@app.post("/api/suggestions")
async def get_suggestions(request: SuggestionsRequest):
    # No-result / error / abstention responses → no chips (nothing useful to ask next).
    if _has_no_followup(request.response):
        return {"suggestions": []}
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
            "user can contact, hire, or recruit someone. "
            "Never suggest meta questions about how to use this app, the search, or the "
            "assistant itself (e.g. 'how do I reset my search', 'what is the correct search "
            "criteria', 'how do I add an employee', 'how does this work'). "
            "Suggest only natural next questions about the subject matter. "
            "Keep suggestions task-relevant and professional. "
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
        return {"suggestions": []}

@app.get("/api/capabilities")
async def get_capabilities(user: CurrentUser = Depends(get_current_user)):
    """Role-aware capability discovery — the answer to "what can you do?".

    Returns the capabilities visible to the caller's role, grouped by category,
    plus any live signals (e.g. pending approvals) worth surfacing up front.
    Powers the assistant empty-state and onboarding of every user on day one.
    """
    from app.services import capability_registry as caps
    visible = caps.capabilities_for_role(user.role)

    groups: dict[str, list] = {}
    order: list[str] = []
    for c in visible:
        if c.category not in groups:
            groups[c.category] = []
            order.append(c.category)
        groups[c.category].append(c.to_dict())

    # Live signals — turn "what can you do" into "here's what needs you now".
    live: list[dict] = []
    try:
        from app.services import nudge_service
        for n in nudge_service.list_for_user(user.email)[:3]:
            live.append({
                "title": n.get("title") or n.get("message"),
                "prompt": n.get("title") or "what needs my attention?",
            })
    except Exception:
        pass

    # A flat, role-ordered starter set for a compact empty-state (first 6).
    starters = [
        {"title": c["title"], "prompt": c["examples"][0]}
        for c in (cap.to_dict() for cap in visible[:6])
    ]

    return {
        "role": user.role,
        "groups": [{"category": cat, "capabilities": groups[cat]} for cat in order],
        "starters": starters,
        "live": live,
    }


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
            {
                "id": l.id,
                "leave_type": l.leave_type,
                "status": l.status,
                "start_date": str(l.start_date) if l.start_date else None,
                "end_date": str(l.end_date) if l.end_date else None,
                "reason": l.reason or "",
                "days": ((l.end_date - l.start_date).days + 1) if l.start_date and l.end_date else 1,
            }
            for l in db.query(Leave).filter(Leave.employee_id == emp.id).order_by(Leave.created_at.desc()).all()
        ]
    finally:
        db.close()


@app.post("/api/leave/{leave_id}/cancel")
async def cancel_leave(leave_id: int, user: CurrentUser = Depends(get_current_user)):
    """Cancel a leave. Restores balance if the leave was Approved."""
    db = SessionLocal()
    try:
        from app.models import Employee
        emp = HRService.get_employee_by_email(db, user.email)
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found.")

        leave = db.query(Leave).filter(Leave.id == leave_id).first()
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found.")

        # Only the owner can cancel their own leave
        if leave.employee_id != emp.id:
            raise HTTPException(status_code=403, detail="Not authorised to cancel this leave.")

        if leave.status in ("Cancelled", "Rejected"):
            raise HTTPException(status_code=400, detail=f"Leave is already {leave.status}.")

        was_approved = leave.status == "Approved"
        leave.status = "Cancelled"

        if was_approved and leave.start_date and leave.end_date:
            try:
                days = (leave.end_date - leave.start_date).days + 1
                HRService.restore_leave_balance(db, leave.employee_id, leave.leave_type, days)
            except Exception as e:
                pass

        db.commit()

        # Notify manager about the cancellation
        try:
            from app.services.email_service import send_leave_cancellation_notification
            send_leave_cancellation_notification(
                user_email=user.email,
                employee_name=emp.name,
                employee_email=emp.email,
                leave_type=leave.leave_type,
                start_date=str(leave.start_date),
                end_date=str(leave.end_date),
                was_approved=was_approved,
                manager_email=HRService._find_manager_email(db, emp),
            )
        except Exception as e:
            pass

        balance_note = " Your leave balance has been restored." if was_approved else ""
        return {"message": f"Leave cancelled.{balance_note}", "was_approved": was_approved}
    finally:
        db.close()


# ── Morning Briefing (ARB #39) ───────────────────────────────────────────────

@app.get("/api/briefing/me")
async def get_my_briefing(user: CurrentUser = Depends(get_current_user)):
    """A personalized daily digest fusing the caller's nudges, leave balance,
    and self-scoped personal metrics. Read-only; every section degrades to empty."""
    from app.services import briefing_service

    def _build():
        db = SessionLocal()
        try:
            return briefing_service.build_briefing(db, user.email, user.role, name="")
        finally:
            db.close()

    return await asyncio.to_thread(_build)


# ── Proactive nudges (system-initiated feed) ─────────────────────────────────

class NudgeSeenRequest(BaseModel):
    ids: Optional[List[int]] = None


@app.get("/api/nudges")
async def get_nudges(user: CurrentUser = Depends(get_current_user)):
    """The current user's proactive-nudge feed + unread count."""
    from app.services import nudge_service
    nudges = await asyncio.to_thread(nudge_service.list_for_user, user.email)
    unread = await asyncio.to_thread(nudge_service.count_unread, user.email)
    return {"nudges": nudges, "unread": unread}


@app.post("/api/nudges/seen")
async def mark_nudges_seen(req: NudgeSeenRequest, user: CurrentUser = Depends(get_current_user)):
    """Mark nudges as seen (all 'new' for the user, or just the given ids)."""
    from app.services import nudge_service
    n = await asyncio.to_thread(nudge_service.mark_seen, user.email, req.ids)
    return {"marked": n}


@app.post("/api/nudges/{nudge_id}/act")
async def act_nudge(nudge_id: int, user: CurrentUser = Depends(get_current_user)):
    """Execute a nudge's one-click action (apply_leave → deeplink, nudge_manager → re-send approval)."""
    from app.services import nudge_service
    return await asyncio.to_thread(nudge_service.act, user.email, nudge_id)


@app.post("/api/nudges/{nudge_id}/dismiss")
async def dismiss_nudge(nudge_id: int, user: CurrentUser = Depends(get_current_user)):
    from app.services import nudge_service
    ok = await asyncio.to_thread(nudge_service.dismiss, user.email, nudge_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Nudge not found.")
    return {"dismissed": True}


# ── Action receipts + undo (trust / compliance ledger) ───────────────────────

@app.get("/api/receipts")
async def get_receipts(user: CurrentUser = Depends(get_current_user)):
    """The current user's executed-action receipts (most recent first)."""
    from app.services import receipt_service
    receipts = await asyncio.to_thread(receipt_service.list_for_user, user.email)
    return {"receipts": receipts}


@app.get("/api/receipts/undo/{token}", response_class=HTMLResponse)
async def undo_receipt_confirm(token: str):
    """Show the undo CONFIRMATION page. A GET never mutates — so a link prefetcher
    (Outlook SafeLinks, a Teams/Slack unfurler, antivirus) can't silently reverse the
    action. The actual reversal happens on the POST the page submits. Mirrors the
    approve/reject flow where reject likewise collects its confirmation before acting."""
    from app.services import receipt_service
    snap = await asyncio.to_thread(receipt_service.peek, token)
    if not snap:
        return HTMLResponse(_approval_html("Invalid Link", "This undo link is invalid or has already expired.", "#dc2626"), status_code=404)
    if snap.get("status") == "undone":
        return HTMLResponse(_approval_html("Already Undone", f"{snap.get('summary','This action')} was already reversed.", "#f59e0b"))
    if snap.get("expired"):
        return HTMLResponse(_approval_html("Link Expired", "The window to undo this action has passed.", "#f59e0b"))
    if not snap.get("undoable"):
        return HTMLResponse(_approval_html("Can't Undo", f"{snap.get('summary','This action')} can't be undone automatically.", "#f59e0b"))
    return HTMLResponse(_undo_confirm_form(token, snap.get("summary", "this action"), snap.get("system") or ""))


@app.post("/api/receipts/undo/{token}", response_class=HTMLResponse)
async def undo_receipt(token: str):
    """Perform the undo (POST only). The undo handler re-checks live downstream state, so a
    stale confirmation safely refuses; a re-submit of an already-undone receipt is a friendly
    success."""
    from app.services import receipt_service
    result = await asyncio.to_thread(receipt_service.undo, token)
    if result.get("success"):
        title = "Already Undone" if result.get("already") else "Action Undone"
        return HTMLResponse(_approval_html(title, result.get("message", "Done."), "#16A34A"))
    err = result.get("error")
    # invalid/expired links read as a soft amber notice; a downstream refusal explains why.
    color = "#dc2626" if err in ("error", "not_owner") else "#f59e0b"
    status = 404 if err == "invalid" else 200
    return HTMLResponse(
        _approval_html("Couldn't Undo", result.get("message", "This action can't be undone."), color),
        status_code=status,
    )


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


_MAX_FORM_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB

@app.post("/api/forms/upload-image")
async def upload_form_image(
    request: Request,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Upload an image file for a form submission. Returns the URL."""
    import uuid
    # Reject before reading the body when the client declares the size up front.
    _cl = request.headers.get("content-length")
    if _cl and int(_cl) > _MAX_FORM_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be under 10 MB.")
    allowed_types = {"image/jpeg", "image/png", "image/gif", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, GIF, or WebP images are allowed.")
    ext = os.path.splitext(file.filename or "image")[1].lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
        ext = ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    forms_dir = os.path.join(_uploads_dir, "forms")
    os.makedirs(forms_dir, exist_ok=True)
    content = await file.read()
    if len(content) > _MAX_FORM_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be under 10 MB.")
    with open(os.path.join(forms_dir, filename), "wb") as fh:
        fh.write(content)
    return {"url": f"/uploads/forms/{filename}"}


@app.get("/api/forms/list")
async def list_enabled_forms():
    """Public: minimal form stubs for the slash-command picker. No auth required."""
    from app.services.form_library_service import FormLibraryService
    forms = FormLibraryService.list_all(include_disabled=False)
    return [
        {
            "id": f["id"],
            "name": f["name"],
            "description": f.get("description", ""),
            "category": f.get("category", ""),
            "trigger_keywords": f.get("trigger_keywords", ""),
            "fields": f.get("fields", []),
        }
        for f in forms
    ]


@app.get("/api/urls/list")
async def list_active_urls():
    """Public: minimal URL library stubs for the slash-command picker. No auth required."""
    from app.services.app_directory_service import AppDirectoryService
    urls = AppDirectoryService.list_all(include_inactive=False)
    return [
        {"id": u["id"], "name": u["name"], "url": u["url"], "purpose": u.get("purpose", "")}
        for u in urls
    ]


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
        pass
    return {"status": "deleted", "thread_id": thread_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
