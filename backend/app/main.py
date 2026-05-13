import io
import asyncio
import os
import re
import logging
import json
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional

from app.agent import app_agent
from langchain_core.messages import HumanMessage, AIMessage
from app.hr_service import HRService
from app.config import settings
from app.database import init_db, SessionLocal
from app.models import Employee, Leave, Payroll, Policy
from app.document_generation.generator import generate_pdf
from app.document_store import get_pdf
from app.pmo_routes import router as pmo_router

# -- Langfuse tracing --
from app.langfuse_tracing import langfuse_trace, langfuse_event

# -- Loki Logger --
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
    return {"status": "success", "message": "Feedback logged"}

@app.post("/api/track")
async def track_data(log: CustomLog):
    logger.info("custom_event", extra={"event_name": log.event, "custom_data": log.data})
    langfuse_event(log.event, log.data)
    return {"status": "success", "message": "Event tracked successfully"}

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

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        start_time = time.time()
        with langfuse_trace("chat", session_id=request.session_id, metadata={"message": request.message}) as trace:
            config = {"configurable": {"thread_id": request.session_id}}
            result = await app_agent.ainvoke(
                {"messages": [HumanMessage(content=request.message)]},
                config=config,
            )
            
            raw_ai_message = result["messages"][-1].content
            routed_domain = result.get("domain", "unknown")
            
            # Extract and convert [DOWNLOAD_PDF:url:title] to markdown link
            download_tag_pattern = re.compile(r"\[DOWNLOAD_PDF:([^:]+):([^\]]+)\]")
            match = download_tag_pattern.search(raw_ai_message)
            
            final_message = raw_ai_message
            download_url = None
            if match:
                path = match.group(1)
                title = match.group(2)
                # Use current request host if possible, or fallback to settings
                base_url = f"http://localhost:{settings.PORT}" 
                download_url = f"{base_url}{path}"
                markdown_link = f"\n\n### 📄 **[Download {title}]({download_url})**"
                # Replace the tag with a nice markdown link
                final_message = download_tag_pattern.sub(markdown_link, raw_ai_message)
            
            # Final cleanup of any other artifacts
            final_message = re.sub(r'\{.*?\}', '', final_message, flags=re.DOTALL).strip()
            
            trace.update(output=final_message, metadata={"domain": routed_domain})
        
        return {
            "response": final_message,
            "domain": routed_domain,
            "id": "msg_1",
            "processing_time": f"{time.time() - start_time:.2f}s",
            "download_url": download_url
        }

    except Exception as e:
        print(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/hr/dashboard")
async def get_hr_dashboard():
    db = SessionLocal()
    try:
        emp = HRService.get_employee_by_email(db, settings.DEFAULT_USER_EMAIL)
        if not emp: return {"error": "No employees found"}
        
        emp_leaves = db.query(Leave).filter(Leave.employee_id == emp.id).all()
        emp_payroll = db.query(Payroll).filter(Payroll.employee_id == emp.id).order_by(Payroll.year.desc(), Payroll.month.desc()).all()
        last_payroll = emp_payroll[0] if emp_payroll else None
        
        used_leaves = sum(1 for leave in emp_leaves if leave.status == "Approved")
        leave_balance = 24 - used_leaves
        
        return {
            "employee": {"name": emp.name, "id": emp.employee_id, "designation": emp.designation},
            "stats": {"leave_balance": leave_balance, "used_leaves": used_leaves, "net_salary": last_payroll.net_salary if last_payroll else 0},
            "recent_leaves": [{"leave_type": l.leave_type, "status": l.status} for l in emp_leaves[-5:]]
        }
    finally:
        db.close()

@app.get("/api/hr/leaves")
async def get_leaves():
    db = SessionLocal()
    try:
        return [{"id": l.id, "leave_type": l.leave_type, "status": l.status} for l in db.query(Leave).all()]
    finally:
        db.close()

@app.get("/api/hr/payroll")
async def get_payroll():
    db = SessionLocal()
    try:
        return [{"month": p.month, "year": p.year, "net_salary": p.net_salary} for p in db.query(Payroll).all()]
    finally:
        db.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
