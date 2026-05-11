from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from app.agent import app_agent
from langchain_core.messages import HumanMessage, AIMessage
from app.hr_service import HRService, JSONDatabase
import asyncio
from app.config import settings
import os
import re
import logging
import json

# ── Disable Langfuse OpenTelemetry BEFORE any Langfuse imports ──
os.environ["LANGFUSE_OTEL"] = "false"
os.environ.setdefault("LANGFUSE_SECRET_KEY", os.environ.get("LANGFUSE_SECRET_KEY", "sk-lf-1234567890"))
os.environ.setdefault("LANGFUSE_PUBLIC_KEY", os.environ.get("LANGFUSE_PUBLIC_KEY", "pk-lf-1234567890"))
os.environ.setdefault("LANGFUSE_HOST", os.environ.get("LANGFUSE_HOST", "http://localhost:3002"))

from langfuse.langchain import CallbackHandler
from langfuse import Langfuse

# ── Loki Logger with JSON Formatter ──
try:
    import logging_loki
    from pythonjsonlogger import jsonlogger

    loki_handler = logging_loki.LokiHandler(
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

# ── Langfuse Client ──
try:
    langfuse_client = Langfuse()
except Exception:
    langfuse_client = None

from app.sharepoint_routes import router as sharepoint_router
from app.graph_sync import renew_subscriptions

app = FastAPI(title="Centriq AI Backend")
app.include_router(sharepoint_router, prefix="/api")

# Enable CORS for frontend
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

class WebhookPolicyRequest(BaseModel):
    title: str
    content: str
    category: Optional[str] = "General"

class CustomLog(BaseModel):
    event: str
    data: dict

@app.on_event("startup")
async def startup_event():
    if hasattr(app_agent.checkpointer, "setup"):
        try:
            await app_agent.checkpointer.setup()
            print("✅ Redis checkpointer indexes ready.")
        except Exception as e:
            print(f"⚠️  Redis checkpointer setup: {e}")
            
    async def periodic_renew():
        while True:
            await asyncio.sleep(3600)  # Renew every hour
            try:
                await asyncio.to_thread(renew_subscriptions)
            except Exception as e:
                print(f"Failed to renew subscriptions: {e}")

    asyncio.create_task(periodic_renew())

@app.get("/")
async def root():
    return {"status": "online", "message": "Centriq AI Backend is running"}

@app.post("/api/feedback")
async def feedback(data: dict):
    print(f"Feedback received: {data}")
    return {"status": "success", "message": "Feedback logged"}

@app.post("/api/track")
async def track_data(log: CustomLog):
    import time
    logger.info("custom_event", extra={"event_name": log.event, "custom_data": log.data})
    
    if langfuse_client:
        try:
            langfuse_client.create_score(
                trace_id=f"custom-{log.event}-{time.time()}",
                name=log.event,
                value=1,
                comment=json.dumps(log.data)
            )
            langfuse_client.flush()
        except Exception:
            pass
    
    return {"status": "success", "message": "Event tracked successfully"}

@app.post("/api/forms")
async def submit_form(data: dict):
    print(f"Form submitted: {data}")
    return {"status": "success", "message": "Form processed"}

@app.post("/api/webhooks/sharepoint-sync")
async def sync_sharepoint_policy(request: WebhookPolicyRequest):
    """Webhook endpoint for Power Automate to push SharePoint document changes."""
    HRService.upsert_policy(request.title, request.content, request.category)
    print(f"Webhook received from Power Automate! Updated policy: {request.title}")
    return {"status": "success", "message": f"Policy '{request.title}' synchronized successfully"}

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        logger.info(f"Chat request: session={request.session_id}, message={request.message[:50]}...")
        
        # Initialize Langfuse Callback (env vars already set globally)
        langfuse_handler = CallbackHandler()
        
        # Config for LangGraph invocation
        config = {
            "configurable": {"thread_id": request.session_id},
            "callbacks": [langfuse_handler],
        }
        
        # Invoke the multi-agent graph
        result = await app_agent.ainvoke(
            {"messages": [HumanMessage(content=request.message)]},
            config=config,
        )
        
        raw_ai_message = result["messages"][-1].content
        routed_domain = result.get("domain", "unknown")
        
        logger.info(f"Routed to: {routed_domain}")
        print(f"[Chat] Domain: {routed_domain} | Raw response length: {len(raw_ai_message)}")
        
        # Safety cleanup for small model artifacts
        final_message = re.sub(r'\{.*?\}', '', raw_ai_message, flags=re.DOTALL).strip()
        final_message = final_message.replace('{', '').replace('}', '').strip()
        final_message = re.sub(r'```.*?```', '', final_message, flags=re.DOTALL).strip()
        
        # Fallback for empty responses
        if not final_message or len(final_message) < 2:
            final_message = (
                "I'm here to help! I can assist you with HR queries (leave, payroll, policies), "
                "and more capabilities are coming soon. What would you like to know?"
            )
        
        return {
            "response": final_message,
            "domain": routed_domain,
            "id": "msg_1",
        }
    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/hr/dashboard")
async def get_hr_dashboard():
    emp = HRService.get_employee_by_email(settings.DEFAULT_USER_EMAIL)
    if not emp:
        return {"error": "No employees found"}
    
    leaves = JSONDatabase.read("leaves.json")
    emp_leaves = [leave for leave in leaves if leave["employee_id"] == emp["id"]]
    
    payroll = JSONDatabase.read("payroll.json")
    emp_payroll = [p for p in payroll if p["employee_id"] == emp["id"]]
    last_payroll = emp_payroll[-1] if emp_payroll else None
    
    used_leaves = sum(1 for leave in emp_leaves if leave["status"] == "Approved")
    leave_balance = 24 - used_leaves
    
    return {
        "employee": {
            "name": emp["name"],
            "id": emp["employee_id"],
            "designation": emp["designation"],
            "department": emp["department"]
        },
        "stats": {
            "leave_balance": leave_balance,
            "used_leaves": used_leaves,
            "attendance_rate": "98%",
            "net_salary": last_payroll["net_salary"] if last_payroll else 0
        },
        "recent_leaves": emp_leaves[-5:],
        "payroll_summary": {
            "last_paid": last_payroll["net_salary"] if last_payroll else 0,
            "month": last_payroll["month"] if last_payroll else 0,
            "year": last_payroll["year"] if last_payroll else 0
        }
    }

@app.get("/api/hr/leaves")
async def get_leaves():
    return JSONDatabase.read("leaves.json")

@app.post("/api/hr/leaves/apply")
async def apply_leave(data: dict):
    res = HRService.apply_leave(
        settings.DEFAULT_USER_EMAIL, 
        data["start"], 
        data["end"], 
        data.get("type", "Casual")
    )
    return {"status": "success", "message": res}

@app.get("/api/hr/payroll")
async def get_payroll():
    return JSONDatabase.read("payroll.json")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
