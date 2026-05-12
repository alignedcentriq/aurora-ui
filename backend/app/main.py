import io
import re
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from app.db import init_db
from app.agent import app_agent
from app.document_generation.generator import generate_pdf
from app.pmo_routes import router as pmo_router
from langchain_core.messages import HumanMessage, AIMessage


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Centriq AI Backend",
    description="Backend API for Centriq AI — Enterprise Workplace Assistant",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pmo_router)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []


class DocumentRequest(BaseModel):
    doc_type: str  # project_status_report | sprint_summary | meeting_minutes
    title: str
    content: str
    thread_id: Optional[str] = ""
    generated_by: Optional[str] = "Centriq AI"


@app.get("/", tags=["Health"])
async def root():
    return {"status": "online", "message": "Centriq AI Backend is running"}


@app.post("/api/feedback", tags=["Chat"])
async def feedback(data: dict):
    print(f"Feedback received: {data}")
    return {"status": "success", "message": "Feedback logged"}


@app.post("/api/forms", tags=["Chat"])
async def submit_form(data: dict):
    print(f"Form submitted: {data}")
    return {"status": "success", "message": "Form processed"}


@app.post("/api/chat", tags=["Chat"])
async def chat(request: ChatRequest):
    try:
        messages = []
        for msg in request.history:
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            else:
                messages.append(AIMessage(content=msg.content))

        messages.append(HumanMessage(content=request.message))

        result = await app_agent.ainvoke({"messages": messages})
        final_message = result["messages"][-1].content

        # Scan ALL result messages for a download tag — the LLM may rewrite
        # its final response and drop the tag, but the ToolMessage always has it.
        download_url = None
        download_title = None
        tag_pattern = re.compile(r'\[DOWNLOAD_PDF:([^:]+):([^\]]+)\]')
        for msg in result["messages"]:
            content = getattr(msg, "content", "")
            if isinstance(content, str):
                m = tag_pattern.search(content)
                if m:
                    download_url = m.group(1)
                    download_title = m.group(2)
                    break

        # Strip the tag from the visible response if the LLM echoed it
        final_message = tag_pattern.sub("", final_message).strip()

        return {
            "response": final_message,
            "id": "msg_" + str(len(messages)),
            "download_url": download_url,
            "download_title": download_title,
        }
    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/documents/download/{file_id}", tags=["Documents"])
async def download_document(file_id: str):
    from app.document_store import get_pdf
    doc = get_pdf(file_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or expired")
    return StreamingResponse(
        io.BytesIO(doc["data"]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{doc["filename"]}.pdf"'},
    )


@app.post("/api/documents/generate", tags=["Documents"])
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
            c if c.isalnum() or c in "-_" else "_"
            for c in request.title.lower().replace(" ", "_")
        )[:50]
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.pdf"'},
        )
    except Exception as e:
        print(f"Document generation error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate document: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
