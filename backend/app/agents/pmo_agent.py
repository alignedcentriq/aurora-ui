import os
from typing import TypedDict, Annotated, List
from langgraph.graph import StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, AIMessage, SystemMessage
from langchain_core.tools import tool
from dotenv import load_dotenv

load_dotenv()

PMO_SYSTEM_PROMPT = """You are the PMO Assistant for Aligned Automation, specialized in Project Management queries.

STRICT RULES — follow these without exception:
1. NEVER invent, guess, or hallucinate project data, timelines, or milestones.
2. ALWAYS call the appropriate tool to fetch real data before answering.
3. When asked to generate a PDF or report for ONE project → call generate_project_report.
4. When asked to generate a PDF or report for MULTIPLE projects or "all projects" → call generate_multi_project_report.
5. If you don't know which projects exist, call get_project_status with "all" or list what you know.

You help with:
- Project status, timelines, and milestone tracking
- Sprint planning, velocity, and backlog management
- Resource allocation and team capacity planning
- PDF report generation for projects

Keep responses concise. After a tool call, summarize the result briefly — do not rewrite the data.
"""


@tool
def get_project_status(project_name: str) -> str:
    """Get the current status, completion percentage, sprint, and next milestone of a project."""
    from app.db import SessionLocal, Project
    db = SessionLocal()
    try:
        project = db.query(Project).filter(
            Project.name.ilike(f"%{project_name}%")
        ).first()
        if not project:
            all_names = [p.name for p in db.query(Project.name).all()]
            return f"No project found matching '{project_name}'. Available projects: {', '.join(all_names)}"
        return (
            f"Project: {project.name} | Status: {project.status} | "
            f"Sprint: {project.sprint_name} | Completion: {project.completion_pct}% | "
            f"Next Milestone: {project.next_milestone} ({project.next_milestone_date}) | "
            f"Owner: {project.owner}"
        )
    finally:
        db.close()


@tool
def get_sprint_info(team: str) -> str:
    """Get the latest sprint details, velocity, and active blockers for a team."""
    from app.db import SessionLocal, Sprint
    db = SessionLocal()
    try:
        sprint = (
            db.query(Sprint)
            .filter(Sprint.team.ilike(f"%{team}%"))
            .order_by(Sprint.id.desc())
            .first()
        )
        if not sprint:
            all_teams = [s.team for s in db.query(Sprint.team).distinct().all()]
            return f"No sprint data found for team '{team}'. Available teams: {', '.join(all_teams)}"
        return (
            f"Team: {sprint.team} | {sprint.name} ({sprint.start_date} – {sprint.end_date}) | "
            f"Velocity: {sprint.velocity}pts | Committed: {sprint.committed}pts | "
            f"Completed: {sprint.completed}pts | Blockers: {sprint.blockers_count} active"
        )
    finally:
        db.close()


@tool
def get_team_capacity(team: str) -> str:
    """Get current team headcount, availability, and capacity percentage."""
    from app.db import SessionLocal, TeamCapacity
    db = SessionLocal()
    try:
        capacity = db.query(TeamCapacity).filter(
            TeamCapacity.team.ilike(f"%{team}%")
        ).first()
        if not capacity:
            all_teams = [t.team for t in db.query(TeamCapacity.team).all()]
            return f"No capacity data found for team '{team}'. Available teams: {', '.join(all_teams)}"
        return (
            f"Team: {capacity.team} | Total: {capacity.total_members} members | "
            f"Available: {capacity.available} | On Leave: {capacity.on_leave} | "
            f"Capacity: {capacity.capacity_pct}%"
        )
    finally:
        db.close()


@tool
def get_milestones(project_name: str) -> str:
    """Get all milestones and their current status for a project."""
    from app.db import SessionLocal, Milestone
    db = SessionLocal()
    try:
        milestones = db.query(Milestone).filter(
            Milestone.project_name.ilike(f"%{project_name}%")
        ).all()
        if not milestones:
            return f"No milestones found for project '{project_name}'."
        status_icons = {"DONE": "✓", "IN_PROGRESS": "→", "UPCOMING": "○"}
        lines = [f"Project: {project_name} milestones:"]
        for m in milestones:
            icon = status_icons.get(m.status, "•")
            lines.append(f"{icon} {m.name} ({m.due_date}) — {m.status}")
        return "\n".join(lines)
    finally:
        db.close()


@tool
def generate_project_report(project_name: str, report_type: str = "project_status_report") -> str:
    """Generate a downloadable PDF report for a project. Use when the user asks to generate,
    create, export, or download a report or document for a project.
    report_type options: project_status_report, sprint_summary, meeting_minutes."""
    from app.db import SessionLocal, Project, Milestone, Sprint
    from app.document_generation.generator import generate_pdf
    from app.document_store import store_pdf
    import uuid

    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
        if not project:
            all_names = [p.name for p in db.query(Project).all()]
            return f"No project found matching '{project_name}'. Available: {', '.join(all_names)}"

        milestones = db.query(Milestone).filter(
            Milestone.project_name.ilike(f"%{project_name}%")
        ).all()
        sprint = db.query(Sprint).filter(
            Sprint.team.ilike("%Centriq%")
        ).order_by(Sprint.id.desc()).first()

        lines = [
            f"Project: {project.name}",
            f"Status: {project.status}",
            f"Completion: {project.completion_pct}%",
            f"Owner: {project.owner}",
            f"Current Sprint: {project.sprint_name}",
            f"Next Milestone: {project.next_milestone} ({project.next_milestone_date})",
        ]
        if sprint:
            lines += [
                "",
                "Sprint Overview:",
                f"- Sprint: {sprint.name} ({sprint.start_date} to {sprint.end_date})",
                f"- Velocity: {sprint.velocity}pts | Committed: {sprint.committed}pts | Completed: {sprint.completed}pts",
                f"- Active Blockers: {sprint.blockers_count}",
            ]
        if milestones:
            lines.append("")
            lines.append("Milestones:")
            icons = {"DONE": "✓", "IN_PROGRESS": "→", "UPCOMING": "○"}
            for m in milestones:
                lines.append(f"{icons.get(m.status, '•')} {m.name} ({m.due_date}) — {m.status}")

        content = "\n".join(lines)
        title = f"{project.name} — {report_type.replace('_', ' ').title()}"

        pdf_bytes = generate_pdf(
            doc_type=report_type,
            title=title,
            content=content,
            generated_by="Centriq PMO Agent",
        )

        file_id = str(uuid.uuid4())[:8]
        store_pdf(file_id, pdf_bytes, f"{project.name.replace(' ', '_')}_report")

        return (
            f"PDF report generated for **{project.name}**.\n\n"
            f"[DOWNLOAD_PDF:/api/documents/download/{file_id}:{title}]"
        )
    except Exception as e:
        return f"Failed to generate report: {str(e)}"
    finally:
        db.close()


@tool
def generate_multi_project_report(project_names: str = "all", report_type: str = "project_status_report") -> str:
    """Generate a single PDF report covering multiple projects.
    Use this when the user asks for a report on multiple projects or all projects in the org.
    project_names: comma-separated project names, or 'all' to include every project.
    report_type options: project_status_report, sprint_summary, meeting_minutes."""
    from app.db import SessionLocal, Project, Milestone
    from app.document_generation.generator import generate_pdf
    from app.document_store import store_pdf
    import uuid

    db = SessionLocal()
    try:
        if project_names.strip().lower() == "all":
            projects = db.query(Project).all()
        else:
            names = [n.strip() for n in project_names.split(",")]
            projects = []
            for name in names:
                p = db.query(Project).filter(Project.name.ilike(f"%{name}%")).first()
                if p:
                    projects.append(p)

        if not projects:
            all_names = [p.name for p in db.query(Project).all()]
            return f"No matching projects found. Available: {', '.join(all_names)}"

        lines = [f"ORGANISATION PROJECT REPORT — {len(projects)} Projects\n"]
        status_icons = {"DONE": "✓", "IN_PROGRESS": "→", "UPCOMING": "○"}

        for project in projects:
            lines += [
                f"\n{project.name.upper()}:",
                f"Status: {project.status} | Completion: {project.completion_pct}%",
                f"Owner: {project.owner} | Sprint: {project.sprint_name}",
                f"Next Milestone: {project.next_milestone} ({project.next_milestone_date})",
            ]
            milestones = db.query(Milestone).filter(
                Milestone.project_name.ilike(f"%{project.name}%")
            ).all()
            if milestones:
                lines.append("Milestones:")
                for m in milestones:
                    lines.append(f"  {status_icons.get(m.status, '•')} {m.name} ({m.due_date}) — {m.status}")

        content = "\n".join(lines)
        title = f"Organisation Report — {len(projects)} Projects"

        pdf_bytes = generate_pdf(
            doc_type=report_type,
            title=title,
            content=content,
            generated_by="Centriq PMO Agent",
        )

        file_id = str(uuid.uuid4())[:8]
        store_pdf(file_id, pdf_bytes, "org_projects_report")

        names_str = ", ".join(p.name for p in projects)
        return (
            f"PDF report generated covering {len(projects)} projects: {names_str}.\n\n"
            f"[DOWNLOAD_PDF:/api/documents/download/{file_id}:{title}]"
        )
    except Exception as e:
        return f"Failed to generate multi-project report: {str(e)}"
    finally:
        db.close()


pmo_tools = [get_project_status, get_sprint_info, get_team_capacity, get_milestones, generate_project_report, generate_multi_project_report]

llm = ChatOpenAI(
    base_url=os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"),
    api_key=os.getenv("LLM_API_KEY", "ollama"),
    model=os.getenv("LLM_MODEL_NAME", "llama3.3:70b"),
)
llm_with_tools = llm.bind_tools(pmo_tools)


class PMOState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]


def pmo_assistant(state: PMOState):
    messages = state["messages"]
    if not any(isinstance(m, SystemMessage) for m in messages):
        messages = [SystemMessage(content=PMO_SYSTEM_PROMPT)] + messages
    try:
        response = llm_with_tools.invoke(messages)
        return {"messages": [response]}
    except Exception as e:
        print(f"PMO Agent LLM error: {e}")
        return {"messages": [AIMessage(content="PMO Agent is temporarily unavailable. Please try again.")]}


import re as _re
import uuid as _uuid

_PDF_KEYWORDS = {
    "generate pdf", "generate a pdf", "create pdf", "create a pdf",
    "generate report", "generate a report", "create report", "create a report",
    "export pdf", "export report", "download report", "download pdf",
    "make a report", "make a pdf", "write a report", "produce a report",
}


def _is_pdf_request(message: str) -> bool:
    msg_lower = message.lower()
    return any(kw in msg_lower for kw in _PDF_KEYWORDS)


def _extract_project_name(message: str) -> str:
    msg_lower = message.lower()
    m = _re.search(
        r'(?:for|of)\s+(?:project\s+)?([a-z][a-z0-9 _\-]+?)(?:\s+(?:report|pdf|document)|$)',
        msg_lower,
    )
    return m.group(1).strip() if m else ""


def pdf_interceptor(state: PMOState):
    """Directly forces the correct PDF tool call — bypasses LLM decision entirely."""
    from langchain_core.messages import HumanMessage as HM
    last_user = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HM)), ""
    )

    if not _is_pdf_request(last_user):
        return {}  # not a PDF request — fall through to pmo_assistant

    msg_lower = last_user.lower()
    num_match = _re.search(r'\b(\d+)\s+project', msg_lower)
    is_multi = (
        "all" in msg_lower
        or "multiple" in msg_lower
        or bool(num_match)
        or msg_lower.count(",") >= 1
    )

    if is_multi:
        tool_name = "generate_multi_project_report"
        tool_args = {"project_names": "all", "report_type": "project_status_report"}
    else:
        project_name = _extract_project_name(last_user) or "all"
        tool_name = "generate_project_report"
        tool_args = {"project_name": project_name, "report_type": "project_status_report"}

    print(f"[PDF Interceptor] forcing {tool_name}({tool_args})")

    forced = AIMessage(
        content="",
        tool_calls=[{
            "name": tool_name,
            "args": tool_args,
            "id": str(_uuid.uuid4()),
            "type": "tool_call",
        }],
    )
    return {"messages": [forced]}


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
