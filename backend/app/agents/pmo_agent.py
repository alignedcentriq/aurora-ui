import re
import uuid
from typing import Annotated, List, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from app.config import settings
from app.services.prompt_service import PromptService


PMO_SYSTEM_PROMPT = """You are the PMO Assistant for Aligned Automation. You have access to a real company project database.

Rules:
1. CRITICAL: NEVER answer from your training data or general knowledge. ALL project information MUST come from your tools.
2. ANY question about company projects, internal projects, AI projects, or technology initiatives — ALWAYS call 'list_projects' first to get the real list.
3. For a single-project report or PDF request, call 'generate_project_report'.
4. For multi-project or all-project report requests, call 'generate_multi_project_report'.
5. If the user asks for a specific number of projects (e.g. "Give 5 projects"), list them from the tool results only.
6. Summarize tool results concisely. Never add examples or suggestions from your own knowledge.
7. CRITICAL: If a tool returns a tag like [DOWNLOAD_PDF:...], you MUST include it EXACTLY as-is in your response. NEVER change it to a markdown link or change the URL.
"""


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
                project = db.query(Project).filter(Project.name.ilike(f"%{name}%")).first()
                if project:
                    projects.append(project)

        if not projects:
            names = [p.name for p in db.query(Project).all()]
            return f"No matching projects found. Available: {', '.join(names)}"

        lines = [f"Organization Project Report — {len(projects)} Projects", ""]
        for project in projects:
            lines += [
                f"{project.name.upper()}:",
                f"Status: {project.status} | Completion: {project.completion_pct}%",
                f"Owner: {project.owner}",
                f"Next Milestone: {project.next_milestone} ({project.next_milestone_date})",
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


pmo_tools = [
    list_projects,
    get_project_status,
    get_project_achievements,
    generate_project_report,
    generate_multi_project_report,
]


pmo_llm = ChatOpenAI(
    base_url=settings.ROUTER_BASE_URL,
    api_key=settings.ROUTER_API_KEY,
    model=settings.ROUTER_MODEL_NAME,
    temperature=settings.AGENT_TEMPERATURE,
    max_retries=3,
    timeout=120,
)

pmo_llm_with_tools = pmo_llm.bind_tools(pmo_tools)


class PMOState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    user_email: str
    feedback_context: str


def pmo_assistant(state: PMOState):
    messages = state["messages"]
    if not any(isinstance(message, SystemMessage) for message in messages):
        base_prompt = PromptService.get_system_prompt("pmo", PMO_SYSTEM_PROMPT)
        guardrail = PromptService.get_guardrail("pmo")
        feedback_ctx = state.get("feedback_context") or ""
        messages = [SystemMessage(content=base_prompt + guardrail + feedback_ctx)] + messages
    try:
        return {"messages": [pmo_llm_with_tools.invoke(messages)]}
    except Exception as exc:
        print(f"PMO Agent LLM error: {exc}")
        return {"messages": [AIMessage(content="PMO Agent is temporarily unavailable. Please try again.")]}


PDF_KEYWORDS = {
    "generate pdf", "generate a pdf", "create pdf", "create a pdf",
    "generate report", "generate a report", "create report", "create a report",
    "export pdf", "export report", "download report", "download pdf",
    "make a report", "make a pdf", "write a report", "produce a report",
}


def _is_pdf_request(message: str) -> bool:
    msg_lower = message.lower()
    return any(keyword in msg_lower for keyword in PDF_KEYWORDS)


def _extract_project_name(message: str) -> str:
    match = re.search(
        r"(?:for|of)\s+(?:project\s+)?([a-z][a-z0-9 _\-]+?)(?:\s+(?:report|pdf|document)|$)",
        message.lower(),
    )
    return match.group(1).strip() if match else ""


def pdf_interceptor(state: PMOState):
    last_user = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
        "",
    )
    if not _is_pdf_request(last_user):
        return {}

    msg_lower = last_user.lower()
    is_multi = (
        "all" in msg_lower
        or "multiple" in msg_lower
        or bool(re.search(r"\b\d+\s+project", msg_lower))
        or msg_lower.count(",") >= 1
    )
    if is_multi:
        tool_name = "generate_multi_project_report"
        tool_args = {"project_names": "all", "report_type": "project_status_report"}
    else:
        tool_name = "generate_project_report"
        tool_args = {
            "project_name": _extract_project_name(last_user) or "all",
            "report_type": "project_status_report",
        }

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


def _after_interceptor(state: PMOState) -> str:
    last = state["messages"][-1]
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return "pmo_assistant"


pmo_workflow = StateGraph(PMOState)
pmo_workflow.add_node("pdf_interceptor", pdf_interceptor)
pmo_workflow.add_node("pmo_assistant", pmo_assistant)
pmo_workflow.add_node("tools", ToolNode(pmo_tools))
pmo_workflow.set_entry_point("pdf_interceptor")
pmo_workflow.add_conditional_edges(
    "pdf_interceptor",
    _after_interceptor,
    {"tools": "tools", "pmo_assistant": "pmo_assistant"},
)
pmo_workflow.add_conditional_edges("pmo_assistant", tools_condition)
pmo_workflow.add_edge("tools", "pmo_assistant")

pmo_agent = pmo_workflow.compile()
