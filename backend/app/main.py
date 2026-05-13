import io

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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
import time
from app.database import init_db
from app.document_generation.generator import generate_pdf
from app.document_store import get_pdf
from app.pmo_routes import router as pmo_router

# -- Langfuse tracing (custom lightweight wrapper) --
from app.langfuse_tracing import langfuse_trace, langfuse_event

# -- Loki Logger with JSON Formatter --
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

from app.sharepoint_routes import router as sharepoint_router
from app.graph_sync import renew_subscriptions

app = FastAPI(title="Centriq AI Backend")
app.include_router(sharepoint_router, prefix="/api")
app.include_router(pmo_router)

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

class DocumentRequest(BaseModel):
    doc_type: str
    title: str
    content: str
    thread_id: Optional[str] = ""
    generated_by: Optional[str] = "Centriq AI"

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

@app.post("/api/feedback")
async def feedback(data: dict):
    print(f"Feedback received: {data}")
    return {"status": "success", "message": "Feedback logged"}

@app.post("/api/track")
async def track_data(log: CustomLog):
    logger.info("custom_event", extra={"event_name": log.event, "custom_data": log.data})
    langfuse_event(log.event, log.data)
    return {"status": "success", "message": "Event tracked successfully"}

@app.post("/api/forms")
async def submit_form(data: dict):
    print(f"Form submitted: {data}")
    return {"status": "success", "message": "Form processed"}

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

@app.post("/api/documents/generate")
async def generate_document(request: DocumentRequest):
    try:
        pdf_bytes = generate_pdf(
            doc_type=request.doc_type,
            title=request.title,
            content=request.content,
            generated_by=request.generated_by or "Centriq AI",
            thread_id=request.thread_id or "",
        )
        safe_name = "".join(
            char if char.isalnum() or char in "-_" else "_"
            for char in request.title.lower().replace(" ", "_")
        )[:50]
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
        )
    except Exception as e:
        print(f"Document generation error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate document: {e}")

@app.post("/api/webhooks/sharepoint-sync")
async def sync_sharepoint_policy(request: WebhookPolicyRequest):
    """Webhook endpoint for Power Automate to push SharePoint document changes."""
    HRService.upsert_policy(request.title, request.content, request.category)
    print(f"Webhook received from Power Automate! Updated policy: {request.title}")
    return {"status": "success", "message": f"Policy '{request.title}' synchronized successfully"}

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        start_time = time.time()
        logger.info(f"Chat request: session={request.session_id}, message={request.message[:50]}...")
        
        # Wrap the entire chat in a Langfuse trace
        with langfuse_trace("chat", session_id=request.session_id, metadata={"message": request.message}) as trace:
            
            # Config for LangGraph invocation (no langfuse callback needed)
            config = {
                "configurable": {"thread_id": request.session_id},
            }
            
            # Invoke the multi-agent graph
            result = await app_agent.ainvoke(
                {"messages": [HumanMessage(content=request.message)]},
                config=config,
            )
            
            raw_ai_message = result["messages"][-1].content
            routed_domain = result.get("domain", "unknown")
            download_url = None
            download_title = None
            download_tag_pattern = re.compile(r"\[DOWNLOAD_PDF:([^:]+):([^\]]+)\]")

            for message in result["messages"]:
                content = getattr(message, "content", "")
                if isinstance(content, str):
                    match = download_tag_pattern.search(content)
                    if match:
                        download_url = match.group(1)
                        download_title = match.group(2)
                        break
            
            logger.info(f"Routed to: {routed_domain}")
            elapsed_time = time.time() - start_time
            print(f"[Chat] Domain: {routed_domain} | Time: {elapsed_time:.2f}s | Raw response length: {len(raw_ai_message)}")
            
            # Safety cleanup for small model artifacts
            final_message = download_tag_pattern.sub("", raw_ai_message).strip()
            final_message = re.sub(r'\{.*?\}', '', final_message, flags=re.DOTALL).strip()
            final_message = final_message.replace('{', '').replace('}', '').strip()
            final_message = re.sub(r'```.*?```', '', final_message, flags=re.DOTALL).strip()
            
            # Fallback for empty responses
            if not final_message or len(final_message) < 2:
                final_message = (
                    "I'm here to help! I can assist you with HR queries (leave, payroll, policies), "
                    "and more capabilities are coming soon. What would you like to know?"
                )
            
            # Update the Langfuse trace with the result
            trace.update(
                output=final_message,
                metadata={
                    "domain": routed_domain,
                    "raw_length": len(raw_ai_message),
                    "final_length": len(final_message),
                }
            )
        
        return {
            "response": final_message,
            "domain": routed_domain,
            "id": "msg_1",
            "processing_time": f"{time.time() - start_time:.2f}s",
            "download_url": download_url,
            "download_title": download_title,
        }
    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/chat/{session_id}")
async def delete_chat(session_id: str):
    try:
        logger.info(f"Deleting session: {session_id}")
        
        # 1. Clear from the LangGraph checkpointer if possible
        # Checkpointer keys in langgraph-checkpoint-redis usually follow a pattern
        # but the safest way is to delete from the underlying client if exposed.
        if hasattr(app_agent.checkpointer, "redis_client"):
            # RedisSaver uses thread_id directly or with a prefix
            # Let's try to delete the thread_id key
            await app_agent.checkpointer.redis_client.delete(session_id)
            # Also common prefixes in langgraph-checkpoint-redis
            await app_agent.checkpointer.redis_client.delete(f"checkpoint:{session_id}")
            
        return {"status": "success", "message": f"Session {session_id} deleted"}
    except Exception as e:
        print(f"Error deleting session: {e}")
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
