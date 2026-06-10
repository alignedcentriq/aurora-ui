"""
Document Agent — LangGraph subgraph for generating formal HR documents.

The agent extracts doc_type, purpose and any additional context from the
user's message, then calls create_document which hits the same logic as
POST /api/skills/docs/create.
"""

import asyncio
from typing import Annotated, List, Optional, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import InjectedState, ToolNode

from app.config import settings
from app.database import SessionLocal
from app.document_generation.generator import generate_pdf
from app.document_store import store_pdf
from app.models import Employee, EmployeeZohoProfile
from app.services import llm_controls_service as llm_controls
from app.services.document_service import DOC_TEMPLATES, build_messages, generate_stream
from app.services.prompt_service import PromptService


# ── State ──────────────────────────────────────────────────────────────────────

class DocState(TypedDict):
    messages: Annotated[List[BaseMessage], "Conversation messages"]
    user_email: str
    feedback_context: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _resolve_employee(email: str) -> dict:
    with SessionLocal() as db:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            return {"name": email, "employee_id": "", "department": "", "designation": "", "joining_date": ""}
        profile = (
            db.query(EmployeeZohoProfile)
            .filter(EmployeeZohoProfile.employee_id == emp.id)
            .first()
        )
        joining = ""
        if profile and getattr(profile, "date_of_joining", None):
            joining = str(profile.date_of_joining)
        return {
            "name": emp.full_name or email,
            "employee_id": emp.employee_id or "",
            "department": getattr(profile, "department", "") or "",
            "designation": getattr(profile, "designation", "") or emp.role or "",
            "joining_date": joining,
        }


# ── Tools ──────────────────────────────────────────────────────────────────────

@tool
def list_document_types():
    """List all available document types the user can request.
    Call when the user asks what documents are available or is unsure of the type name."""
    return "\n".join(
        f"- {key}: {tpl['label']}" + (" (purpose required)" if tpl.get("requires_purpose") else "")
        for key, tpl in DOC_TEMPLATES.items()
    )


@tool
def create_document(
    doc_type: str,
    purpose: Optional[str],
    additional_info: Optional[str],
    state: Annotated[dict, InjectedState],
):
    """Generate a formal HR document (NOC, experience certificate, employment verification, etc.).
    doc_type must be a valid key from list_document_types.
    purpose is required for NOC and address_proof — ask the user if not provided.
    additional_info is optional extra context (recipient name, specific details)."""
    email = state.get("user_email") or settings.DEFAULT_USER_EMAIL

    if doc_type not in DOC_TEMPLATES:
        return f"Unknown document type '{doc_type}'. Call list_document_types to see valid options."

    tpl = DOC_TEMPLATES[doc_type]
    if tpl.get("requires_purpose") and not purpose:
        return f"'{tpl['label']}' requires a purpose. Please ask the user what it's needed for."

    employee = _resolve_employee(email)

    # Run async generator synchronously (agent node is sync)
    async def _collect():
        chunks = []
        async for chunk in generate_stream(
            doc_type=doc_type,
            employee=employee,
            purpose=purpose or "",
            additional_info=additional_info or "",
            is_official=False,
        ):
            chunks.append(chunk)
        return "".join(chunks)

    content = asyncio.run(_collect())
    if not content.strip():
        return "Document generation failed — the LLM returned no content."

    pdf_bytes = generate_pdf(
        doc_type=doc_type,
        title=tpl["label"],
        content=content,
        subject_name=employee.get("name", ""),
    )

    safe_name = tpl["label"].replace(" ", "_")
    filename = f"{safe_name}_{employee.get('name', 'employee').replace(' ', '_')}.pdf"
    file_id = store_pdf(None, pdf_bytes, filename)

    return (
        f"Your {tpl['label']} is ready.\n"
        f"[DOWNLOAD: {filename}](/api/documents/download/{file_id})"
    )


_tools = [list_document_types, create_document]
_tool_node = ToolNode(_tools)


# ── Agent Node ─────────────────────────────────────────────────────────────────

def doc_assistant(state: DocState):
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    default_prompt = (
        f"You are the Document Assistant for Aligned Automation.\n"
        f"Employee: {user_email}.\n"
        f"ALWAYS respond directly in first person.\n\n"
        f"Tool routing:\n"
        f"  User asks what documents are available  → list_document_types\n"
        f"  User wants a specific document           → create_document\n"
        f"    - Map common names: 'NOC' → no_objection_certificate, "
        f"'experience letter' → experience_certificate, "
        f"'employment letter' → employment_verification\n"
        f"    - If doc_type is ambiguous, call list_document_types first\n"
        f"    - If purpose is required but missing, ask the user before calling create_document\n\n"
        f"When create_document returns a [DOWNLOAD: ...] link, present it clearly to the user.\n"
    )
    base_prompt = PromptService.get_system_prompt("general", default_prompt)
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + feedback_ctx

    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    llm = llm_controls.get_llm("agent", default_timeout=60).bind_tools(_tools)
    return {"messages": [llm.invoke(messages)]}


def _should_continue(state: DocState):
    last = state["messages"][-1]
    if getattr(last, "tool_calls", None):
        return "tools"
    return END


# ── Graph ──────────────────────────────────────────────────────────────────────

_workflow = StateGraph(DocState)
_workflow.add_node("doc_assistant", doc_assistant)
_workflow.add_node("tools", _tool_node)
_workflow.set_entry_point("doc_assistant")
_workflow.add_conditional_edges("doc_assistant", _should_continue, ["tools", END])
_workflow.add_edge("tools", "doc_assistant")

doc_agent = _workflow.compile()
