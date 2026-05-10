from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from app.agent import app_agent
from langchain_core.messages import HumanMessage, AIMessage
from app.hr_service import HRService, JSONDatabase
import asyncio
from app.config import settings

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

@app.on_event("startup")
async def startup_event():
    if hasattr(app_agent.checkpointer, "setup"):
        try:
            await app_agent.checkpointer.setup()
            print("Successfully set up Redis checkpointer indexes.")
        except Exception as e:
            print(f"Error setting up Redis checkpointer: {e}")
            
    async def periodic_renew():
        while True:
            await asyncio.sleep(3600)  # Renew every hour
            try:
                # Run synchronous renewal in a thread to avoid blocking the event loop
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
        messages = []
        for msg in request.history:
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            else:
                messages.append(AIMessage(content=msg.content))
        
        messages.append(HumanMessage(content=request.message))
        
        # Use session_id as thread_id for Redis persistence
        config = {"configurable": {"thread_id": request.session_id}}
        
        # If history is provided, we might want to respect it, but with persistence,
        # we usually just invoke with the latest message.
        # For compatibility with current frontend, we use the last message.
        result = await app_agent.ainvoke({"messages": [HumanMessage(content=request.message)]}, config=config)
        raw_ai_message = result["messages"][-1].content
        print(f"DEBUG RAW AI MESSAGE: '{raw_ai_message.encode('ascii', 'backslashreplace').decode()}'")
        
        # Safety cleanup: Strip all curly braces and technical markers
        import re
        # Remove anything in braces first (multi-line)
        final_message = re.sub(r'\{.*?\}', '', raw_ai_message, flags=re.DOTALL).strip()
        # Remove any stray braces that might be left from nested or malformed JSON
        final_message = final_message.replace('{', '').replace('}', '').strip()
        # Remove markdown code blocks
        final_message = re.sub(r'```.*?```', '', final_message, flags=re.DOTALL).strip()
        
        # Final fallback if cleaning left us with nothing
        if not final_message or len(final_message) < 2:
            # If the raw message was actually just a tool call with no content, 
            # we should check if the graph completed correctly.
            final_message = "I'm ready to help. Could you please provide more details, such as the dates and type of leave?"
        
        print(f"DEBUG FINAL MESSAGE SENT TO FRONTEND: '{final_message.encode('ascii', 'backslashreplace').decode()}'")
        
        return {
            "response": final_message,
            "id": "msg_" + str(len(messages))
        }
    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/hr/dashboard")
async def get_hr_dashboard():
    # Mock: Assume current user is from settings
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
    # In a real app, filters would be applied
    return JSONDatabase.read("leaves.json")

@app.post("/api/hr/leaves/apply")
async def apply_leave(data: dict):
    # Mock current user
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

