import uuid
from typing import Annotated, List, Optional, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode, tools_condition, InjectedState

from app.config import settings
from app.services.prompt_service import PromptService


PMO_SYSTEM_PROMPT = """You are the PMO Assistant for Aligned Automation. You have access to a real company project database.

CONVERSATION MEMORY RULE:
Read the full conversation history before responding.
- If the user refers to a project mentioned earlier ('give me a PDF for that one', 'tell me more about it'), use the project name from prior messages.
- NEVER ask for information already provided in this conversation.
- If prior messages already contain a list_projects result, use those project names directly — do NOT call list_projects again.

Rules:
1. CRITICAL: NEVER answer from your training data or general knowledge. ALL project information MUST come from your tools.
2. ANY question about company projects, internal projects, AI projects, or technology initiatives — ALWAYS call 'list_projects' first to get the real list.
3. For a single-project report or PDF request, call 'generate_project_report'.
4. For multi-project or all-project report requests, call 'generate_multi_project_report'.
5. If the user asks for a specific number of projects (e.g. "Give 5 projects"), list them from the tool results only.
6. Summarize tool results concisely. Never add examples or suggestions from your own knowledge.
7. CRITICAL: If a tool returns a tag like [DOWNLOAD_PDF:...], you MUST include it EXACTLY as-is in your response. NEVER change it to a markdown link or change the URL.
8. For a PMO process / how-to / policy question ('how do I…', 'what is the process for…', onboarding, governance, change request), call 'search_pmo_docs' first and answer from the result. If it returns nothing, say the process document isn't available yet — do NOT answer from your own knowledge.

FOLLOW-UP FOCUS RULE:
- When the user asks a specific follow-up ('who is the owner?', 'what is the completion %?', 'when is the next milestone?'), answer ONLY that single point from the prior tool result — do NOT re-list all project details.
- 1-2 lines is enough for a specific follow-up answer.

OUTPUT FORMATTING:
- NEVER output markdown tables (no | pipe characters).
- NEVER output HTML tags.
- Use plain bullet points (- ) or numbered lists (1. 2. 3.) only.
"""


# ── Tools (used by LLM for complex/ambiguous queries) ────────────────────────

@tool
def list_projects() -> str:
    """List all available project names in the system."""
    from app.database import SessionLocal
    from app.models import Project
    db = SessionLocal()
    try:
        projects = db.query(Project).all()
        if not projects:
            return "No projects found in the system."
        return "Available projects:\n" + "\n".join([f"- {p.name}" for p in projects])
    finally:
        db.close()


@tool
def get_project_status(project_name: str) -> str:
    """Get current status, completion percentage, next milestone, and owner for a project."""
    from app.database import SessionLocal
    from app.models import Project
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
        if not project:
            names = [p.name for p in db.query(Project).all()]
            return f"No project found matching '{project_name}'. Available projects: {', '.join(names)}"
        return (
            f"Project: {project.name} | Status: {project.status} | "
            f"Completion: {project.completion_pct}% | "
            f"Next Milestone: {project.next_milestone} ({project.next_milestone_date}) | "
            f"Owner: {project.owner}"
        )
    finally:
        db.close()


@tool
def get_project_achievements(project_name: str) -> str:
    """Get the key achievements and successes for a specific project."""
    from app.database import SessionLocal
    from app.models import Project
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
        if not project:
            return f"No project found matching '{project_name}' to retrieve achievements."
        achievements = project.achievements or "No achievements recorded yet."
        return f"Achievements for **{project.name}**:\n{achievements}"
    finally:
        db.close()


@tool
def generate_project_report(project_name: str, report_type: str = "project_status_report") -> str:
    """Generate a downloadable PDF report for one project."""
    from app.database import SessionLocal
    from app.document_generation.generator import generate_pdf
    from app.document_store import store_pdf
    from app.models import Project
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
        if not project:
            names = [p.name for p in db.query(Project).all()]
            return f"No project found matching '{project_name}'. Available: {', '.join(names)}"
        lines = [
            f"Project: {project.name}",
            f"Status: {project.status}",
            f"Completion: {project.completion_pct}%",
            f"Owner: {project.owner}",
            f"Next Milestone: {project.next_milestone} ({project.next_milestone_date})",
        ]
        if project.achievements:
            lines += ["", "Achievements:", project.achievements]
        title = f"{project.name} - {report_type.replace('_', ' ').title()}"
        pdf_bytes = generate_pdf(
            doc_type=report_type,
            title=title,
            content="\n".join(lines),
            generated_by="Centriq PMO Agent",
        )
        file_id = str(uuid.uuid4())[:8]
        store_pdf(file_id, pdf_bytes, f"{project.name.replace(' ', '_')}_report")
        return f"PDF report generated for **{project.name}**.\n\n[DOWNLOAD_PDF:/api/documents/download/{file_id}:{title}]"
    except Exception as exc:
        return f"Failed to generate report: {exc}"
    finally:
        db.close()


@tool
def generate_multi_project_report(
    project_names: str = "all",
    report_type: str = "project_status_report",
) -> str:
    """Generate a single PDF report covering multiple projects."""
    from app.database import SessionLocal
    from app.document_generation.generator import generate_pdf
    from app.document_store import store_pdf
    from app.models import Project
    db = SessionLocal()
    try:
        if project_names.strip().lower() == "all":
            projects = db.query(Project).all()
        else:
            projects = []
            for name in [n.strip() for n in project_names.split(",") if n.strip()]:
                p = db.query(Project).filter(Project.name.ilike(f"%{name}%")).first()
                if p:
                    projects.append(p)
        if not projects:
            names = [p.name for p in db.query(Project).all()]
            return f"No matching projects found. Available: {', '.join(names)}"
        lines = [f"Organization Project Report — {len(projects)} Projects", ""]
        for p in projects:
            lines += [
                f"{p.name.upper()}:",
                f"Status: {p.status} | Completion: {p.completion_pct}%",
                f"Owner: {p.owner}",
                f"Next Milestone: {p.next_milestone} ({p.next_milestone_date})",
                "",
            ]
        title = f"Organization Report - {len(projects)} Projects"
        pdf_bytes = generate_pdf(
            doc_type=report_type,
            title=title,
            content="\n".join(lines),
            generated_by="Centriq PMO Agent",
        )
        file_id = str(uuid.uuid4())[:8]
        store_pdf(file_id, pdf_bytes, "org_projects_report")
        names = ", ".join(p.name for p in projects)
        return f"PDF report generated covering {len(projects)} projects: {names}.\n\n[DOWNLOAD_PDF:/api/documents/download/{file_id}:{title}]"
    except Exception as exc:
        return f"Failed to generate multi-project report: {exc}"
    finally:
        db.close()


@tool
def search_people_directory(query: str):
    """Search employees by name, skill, designation, project history, experience, or manager.
    Use for: 'Who worked on Project X?', 'Find Python developers', 'Who has 5+ years experience?'"""
    from app.services.people_service import PeopleService
    return PeopleService.search_people_text(query)


@tool
def search_pmo_docs(query: str):
    """Search PMO process / governance documents for how-to / process / policy questions
    (project onboarding, governance, change-request process, PMO templates). Call for any
    'how do I…', 'what is the process for…', or PMO-policy question. Infer the query from the
    user's message — never ask what to search."""
    from app.services.policy_service import PolicyService
    return PolicyService.search_pmo_docs(query)


@tool
def request_udemy_license(
    justification: str = "",
    course_name: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Request a Udemy license from the PMO team. Use when the user asks for a Udemy license / online course access.
    course_name: the course or topic they want (ask if not stated).
    justification: a one-line reason / how it helps their work (ask if not stated).
    Licenses are provided subject to availability — make this clear. The PMO team is notified by email."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    from app.services.udemy_service import UdemyService
    return UdemyService.request_license(email, justification, course_name)


pmo_tools = [
    list_projects,
    get_project_status,
    get_project_achievements,
    generate_project_report,
    generate_multi_project_report,
    search_people_directory,
    search_pmo_docs,
    request_udemy_license,
]

# LLM built on demand from the live IT-tunable params (router tier).
from app.services import llm_controls_service as llm_controls


# ── State ─────────────────────────────────────────────────────────────────────

class PMOState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    user_email: str
    feedback_context: str
    sub_intent: Optional[str]   # passed from router
    entities: Optional[dict]    # passed from router


# ── DB helpers (no LLM) ───────────────────────────────────────────────────────

def _db_list_all_projects() -> dict:
    from app.database import SessionLocal
    from app.models import Project
    db = SessionLocal()
    try:
        projects = db.query(Project).all()
        if not projects:
            return {"messages": [AIMessage(content="There are currently no projects in the system.")]}
        lines = [
            f"{i + 1}. **{p.name}** — {p.status} ({p.completion_pct}% complete)"
            for i, p in enumerate(projects)
        ]
        body = f"Here are all **{len(projects)} projects** in the organization:\n\n" + "\n".join(lines)
        return {"messages": [AIMessage(content=body)]}
    finally:
        db.close()


def _db_project_status(project_name: str) -> dict:
    from app.database import SessionLocal
    from app.models import Project
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
        if not project:
            all_names = [p.name for p in db.query(Project).all()]
            return {"messages": [AIMessage(content=f"No project found matching '{project_name}'. Available: {', '.join(all_names)}")]}
        body = (
            f"**{project.name}**\n"
            f"- Status: {project.status}\n"
            f"- Completion: {project.completion_pct}%\n"
            f"- Owner: {project.owner}\n"
            f"- Next Milestone: {project.next_milestone} ({project.next_milestone_date})"
        )
        return {"messages": [AIMessage(content=body)]}
    finally:
        db.close()


def _db_project_achievements(project_name: str) -> dict:
    from app.database import SessionLocal
    from app.models import Project
    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
        if not project:
            all_names = [p.name for p in db.query(Project).all()]
            return {"messages": [AIMessage(content=f"No project found matching '{project_name}'. Available: {', '.join(all_names)}")]}
        achievements = project.achievements or "No achievements recorded yet."
        return {"messages": [AIMessage(content=f"**Achievements for {project.name}:**\n{achievements}")]}
    finally:
        db.close()


def _inject_pdf_tool_call(project_name: str, scope: str) -> dict:
    """Inject a PDF tool call directly — no LLM needed to make this decision."""
    is_multi = scope == "multi" or not project_name or project_name.lower() == "all"
    if is_multi:
        tool_name = "generate_multi_project_report"
        tool_args = {"project_names": project_name or "all", "report_type": "project_status_report"}
    else:
        tool_name = "generate_project_report"
        tool_args = {"project_name": project_name, "report_type": "project_status_report"}
    return {
        "messages": [
            AIMessage(
                content="",
                tool_calls=[{
                    "name": tool_name,
                    "args": tool_args,
                    "id": str(uuid.uuid4()),
                    "type": "tool_call",
                }],
            )
        ]
    }


# ── Smart dispatcher ──────────────────────────────────────────────────────────
# Uses sub_intent + entities from the router to resolve directly from DB.
# Falls through to the LLM only for genuinely ambiguous/complex queries.

_REPORT_INTENTS = {"generate_report", "download_report", "pdf_report", "export_report", "create_report"}


def smart_dispatcher(state: PMOState) -> dict:
    sub_intent = (state.get("sub_intent") or "").lower().strip()
    entities = state.get("entities") or {}
    project_name = (
        entities.get("project_name")
        or entities.get("project")
        or ""
    )

    if sub_intent == "list_projects":
        return _db_list_all_projects()

    if sub_intent == "project_status":
        if project_name:
            return _db_project_status(project_name)
        # No specific project mentioned — list all
        return _db_list_all_projects()

    if sub_intent == "project_achievements":
        if project_name:
            return _db_project_achievements(project_name)
        return _db_list_all_projects()

    if sub_intent in _REPORT_INTENTS:
        scope = "multi" if not project_name or project_name.lower() == "all" else "single"
        return _inject_pdf_tool_call(project_name, scope)

    # Unknown/complex — let LLM handle via pmo_assistant
    return {}


def _route_after_dispatcher(state: PMOState) -> str:
    last = state["messages"][-1]
    if isinstance(last, HumanMessage):
        # Dispatcher returned {} — LLM must handle this
        return "pmo_assistant"
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return "done"


# ── LLM node (fallback for complex queries) ───────────────────────────────────

def pmo_assistant(state: PMOState):
    messages = state["messages"]
    if not any(isinstance(m, SystemMessage) for m in messages):
        base_prompt = PromptService.get_system_prompt("pmo", PMO_SYSTEM_PROMPT)
        guardrail = PromptService.get_guardrail("pmo")
        feedback_ctx = state.get("feedback_context") or ""
        messages = [SystemMessage(content=base_prompt + guardrail + feedback_ctx)] + messages
    try:
        llm = llm_controls.get_llm("service", default_timeout=120).bind_tools(pmo_tools)
        return {"messages": [llm.invoke(messages)]}
    except Exception as exc:
        print(f"PMO Agent LLM error: {exc}")
        return {"messages": [AIMessage(content="PMO Agent is temporarily unavailable. Please try again.")]}


# ── Workflow ───────────────────────────────────────────────────────────────────

# Tools whose output is display-ready and never feeds a follow-up tool call.
# Report tools especially benefit: they carry a [DOWNLOAD_PDF:...] tag the LLM is
# only *instructed* to preserve — passing them through verbatim removes the risk
# of the model mangling or dropping the tag. list_projects is excluded because the
# PMO prompt deliberately chains it (call list_projects → answer from the names).
_PASSTHROUGH_TOOLS = {
    "generate_project_report", "generate_multi_project_report",
    "get_project_status", "get_project_achievements", "search_people_directory",
}


def pmo_passthrough(state: PMOState):
    """Emit a display-ready tool result verbatim — zero LLM."""
    last = state["messages"][-1]
    return {"messages": [AIMessage(content=(getattr(last, "content", "") or "").strip())]}


def _route_after_tools(state: PMOState) -> str:
    last = state["messages"][-1]
    if isinstance(last, ToolMessage) and getattr(last, "name", "") in _PASSTHROUGH_TOOLS:
        return "passthrough"
    return "pmo_assistant"


pmo_workflow = StateGraph(PMOState)
pmo_workflow.add_node("smart_dispatcher", smart_dispatcher)
pmo_workflow.add_node("pmo_assistant", pmo_assistant)
pmo_workflow.add_node("tools", ToolNode(pmo_tools))
pmo_workflow.add_node("passthrough", pmo_passthrough)

pmo_workflow.set_entry_point("smart_dispatcher")
pmo_workflow.add_conditional_edges(
    "smart_dispatcher",
    _route_after_dispatcher,
    {"done": END, "tools": "tools", "pmo_assistant": "pmo_assistant"},
)
pmo_workflow.add_conditional_edges("pmo_assistant", tools_condition)
pmo_workflow.add_conditional_edges("tools", _route_after_tools, ["passthrough", "pmo_assistant"])
pmo_workflow.add_edge("passthrough", END)

pmo_agent = pmo_workflow.compile()
