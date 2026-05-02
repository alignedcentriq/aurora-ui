from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from app.agent import app_agent
from langchain_core.messages import HumanMessage, AIMessage

app = FastAPI(title="Centriq AI Backend")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this
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

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        # Prepare inputs for LangGraph
        messages = []
        for msg in request.history:
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            else:
                messages.append(AIMessage(content=msg.content))
        
        messages.append(HumanMessage(content=request.message))
        
        # Invoke LangGraph
        result = await app_agent.ainvoke({"messages": messages})
        
        # Get the last message (AI response)
        final_message = result["messages"][-1].content
        
        return {
            "response": final_message,
            "id": "msg_" + str(len(messages)) # Simple ID for now
        }
    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
