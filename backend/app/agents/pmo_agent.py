import os
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
3. For one-project report or PDF requests, call 'generate_project_report'.
4. For multi-project or all-project report requests, call 'generate_multi_project_report'.
5. If the user asks for a specific number of projects (e.g. "Give 5 projects"), list them from the tool results only.
6. Summarize tool results concisely. Never add examples or suggestions from your own knowledge.
7. CRITICAL: If a tool returns a tag like [DOWNLOAD_PDF:...], you MUST include it EXACTLY as-is in your response. NEVER change it to a markdown link or change the URL.
8. For resource allocation queries, use 'get_resource_allocation' (by project) or 'get_employee_projects' (by person).
9. For session transcripts: use 'upload_session_transcript' to save, 'search_session_transcripts' to search, 'get_recent_sessions' to list recent.
"""





@tool
def get_project_status(project_name: str) -> str:
    """Get current status, completion, sprint, next milestone, and owner for a project."""
    from app.database import SessionLocal
    from app.models import Project

    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
        if not project:
            names = [project.name for project in db.query(Project).all()]
            return f"No project found matching '{project_name}'. Available projects: {', '.join(names)}"
        return (
            f"Project: {project.name} | Status: {project.status} | "
            f"Sprint: {project.sprint_name} | Completion: {project.completion_pct}% | "
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
def get_sprint_info(team: str) -> str:
    """Get latest sprint details, velocity, committed points, completed points, and blockers."""
    from app.database import SessionLocal
    from app.models import Sprint

    db = SessionLocal()
    try:
        sprint = (
            db.query(Sprint)
            .filter(Sprint.team.ilike(f"%{team}%"))
            .order_by(Sprint.id.desc())
            .first()
        )
        if not sprint:
            teams = [row[0] for row in db.query(Sprint.team).distinct().all()]
            return f"No sprint data found for team '{team}'. Available teams: {', '.join(teams)}"
        return (
            f"Team: {sprint.team} | {sprint.name} ({sprint.start_date} to {sprint.end_date}) | "
            f"Velocity: {sprint.velocity}pts | Committed: {sprint.committed}pts | "
            f"Completed: {sprint.completed}pts | Blockers: {sprint.blockers_count} active"
        )
    finally:
        db.close()


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
def get_team_capacity(team: str) -> str:

    """Get current team headcount, availability, leave count, and capacity percentage."""
    from app.database import SessionLocal
    from app.models import TeamCapacity

    db = SessionLocal()
    try:
        capacity = db.query(TeamCapacity).filter(TeamCapacity.team.ilike(f"%{team}%")).first()
        if not capacity:
            teams = [capacity.team for capacity in db.query(TeamCapacity).all()]
            return f"No capacity data found for team '{team}'. Available teams: {', '.join(teams)}"
        return (
            f"Team: {capacity.team} | Total: {capacity.total_members} members | "
            f"Available: {capacity.available} | On Leave: {capacity.on_leave} | "
            f"Capacity: {capacity.capacity_pct}%"
        )
    finally:
        db.close()


@tool
def get_milestones(project_name: str) -> str:
    """Get milestones and their current status for a project."""
    from app.database import SessionLocal
    from app.models import Milestone

    db = SessionLocal()
    try:
        milestones = (
            db.query(Milestone)
            .filter(Milestone.project_name.ilike(f"%{project_name}%"))
            .all()
        )
        if not milestones:
            return f"No milestones found for project '{project_name}'."
        lines = [f"Project: {project_name} milestones:"]
        for milestone in milestones:
            lines.append(f"- {milestone.name} ({milestone.due_date}) - {milestone.status}")
        return "\n".join(lines)
    finally:
        db.close()


@tool
def generate_project_report(project_name: str, report_type: str = "project_status_report") -> str:
    """Generate a downloadable PDF report for one project."""
    from app.database import SessionLocal
    from app.document_generation.generator import generate_pdf
    from app.document_store import store_pdf
    from app.models import Milestone, Project, Sprint

    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
        if not project:
            names = [project.name for project in db.query(Project).all()]
            return f"No project found matching '{project_name}'. Available: {', '.join(names)}"

        milestones = (
            db.query(Milestone)
            .filter(Milestone.project_name.ilike(f"%{project.name}%"))
            .all()
        )
        sprint = (
            db.query(Sprint)
            .filter(Sprint.team.ilike("%Centriq%"))
            .order_by(Sprint.id.desc())
            .first()
        )

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
                f"- Velocity: {sprint.velocity}pts",
                f"- Committed: {sprint.committed}pts",
                f"- Completed: {sprint.completed}pts",
                f"- Active Blockers: {sprint.blockers_count}",
            ]
        if milestones:
            lines += ["", "Milestones:"]
            for milestone in milestones:
                lines.append(f"- {milestone.name} ({milestone.due_date}) - {milestone.status}")

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
    from app.models import Milestone, Project

    db = SessionLocal()
    try:
        if project_names.strip().lower() == "all":
            projects = db.query(Project).all()
        else:
            projects = []
            for name in [name.strip() for name in project_names.split(",") if name.strip()]:
                project = db.query(Project).filter(Project.name.ilike(f"%{name}%")).first()
                if project:
                    projects.append(project)

        if not projects:
            names = [project.name for project in db.query(Project).all()]
            return f"No matching projects found. Available: {', '.join(names)}"

        lines = [f"Organization Project Report - {len(projects)} Projects", ""]
        for project in projects:
            lines += [
                f"{project.name.upper()}:",
                f"Status: {project.status} | Completion: {project.completion_pct}%",
                f"Owner: {project.owner} | Sprint: {project.sprint_name}",
                f"Next Milestone: {project.next_milestone} ({project.next_milestone_date})",
            ]
            milestones = (
                db.query(Milestone)
                .filter(Milestone.project_name.ilike(f"%{project.name}%"))
                .all()
            )
            if milestones:
                lines.append("Milestones:")
                for milestone in milestones:
                    lines.append(f"- {milestone.name} ({milestone.due_date}) - {milestone.status}")
            lines.append("")

        title = f"Organization Report - {len(projects)} Projects"
        pdf_bytes = generate_pdf(
            doc_type=report_type,
            title=title,
            content="\n".join(lines),
            generated_by="Centriq PMO Agent",
        )

        file_id = str(uuid.uuid4())[:8]
        store_pdf(file_id, pdf_bytes, "org_projects_report")
        names = ", ".join(project.name for project in projects)
        return f"PDF report generated covering {len(projects)} projects: {names}.\n\n[DOWNLOAD_PDF:/api/documents/download/{file_id}:{title}]"
    except Exception as exc:
        return f"Failed to generate multi-project report: {exc}"
    finally:
        db.close()


@tool
def get_resource_allocation(project_name: str) -> str:
    """Get all employees currently assigned to a project — their roles and allocation percentage."""
    from app.database import SessionLocal
    from app.models import ProjectAssignment, Employee

    db = SessionLocal()
    try:
        assignments = (
            db.query(ProjectAssignment)
            .filter(
                ProjectAssignment.project_name.ilike(f"%{project_name}%"),
                ProjectAssignment.status == "Active",
            )
            .all()
        )
        if not assignments:
            return f"No active resource allocations found for project '{project_name}'."

        lines = [f"Resource Allocation — {project_name}:"]
        for a in assignments:
            emp = db.query(Employee).filter(Employee.id == a.employee_id).first()
            emp_name = emp.name if emp else f"Employee #{a.employee_id}"
            lines.append(
                f"- {emp_name} | Role: {a.role} | Allocation: {a.allocation_pct}% | From: {a.start_date}"
            )
        return "\n".join(lines)
    finally:
        db.close()


@tool
def get_employee_projects(employee_identifier: str) -> str:
    """Get all projects an employee is assigned to. Pass name or email."""
    from app.database import SessionLocal
    from app.models import ProjectAssignment, Employee

    db = SessionLocal()
    try:
        emp = (
            db.query(Employee)
            .filter(
                (Employee.name.ilike(f"%{employee_identifier}%"))
                | (Employee.email.ilike(f"%{employee_identifier}%"))
            )
            .first()
        )
        if not emp:
            return f"Employee '{employee_identifier}' not found."

        assignments = (
            db.query(ProjectAssignment)
            .filter(ProjectAssignment.employee_id == emp.id)
            .order_by(ProjectAssignment.status)
            .all()
        )
        if not assignments:
            return f"{emp.name} has no project assignments on record."

        lines = [f"Projects for {emp.name} ({emp.designation}):"]
        for a in assignments:
            lines.append(
                f"- {a.project_name} | Role: {a.role} | {a.allocation_pct}% | Status: {a.status}"
            )
        return "\n".join(lines)
    finally:
        db.close()


@tool
def upload_session_transcript(
    project_name: str,
    session_title: str,
    summary: str,
    session_type: str = "Flash Review",
) -> str:
    """
    Save a session transcript/summary for a project.
    session_type options: Flash Review, Sprint Review, Project Review, Standup, PMO Monitored.
    """
    from app.services.transcript_service import TranscriptService
    from app.config import settings

    return TranscriptService.save_transcript(
        project_name=project_name,
        session_title=session_title,
        summary=summary,
        session_type=session_type,
        uploaded_by=settings.DEFAULT_USER_EMAIL,
    )


@tool
def search_session_transcripts(query: str, project_name: str = "") -> str:
    """Search session transcript summaries by keyword. Optionally filter by project name."""
    from app.services.transcript_service import TranscriptService

    results = TranscriptService.search_transcripts(query, project_name or None)
    if not results:
        return f"No transcripts found matching '{query}'."
    lines = [f"Found {len(results)} transcript(s) matching '{query}':"]
    for r in results:
        lines.append(f"\n[{r['type']}] {r['project']} — {r['title']} ({r['date']})")
        lines.append(f"  {r['summary']}")
    return "\n".join(lines)


@tool
def get_recent_sessions(project_name: str = "", limit: int = 5) -> str:
    """Get the most recent session transcripts. Optionally filter by project name."""
    from app.services.transcript_service import TranscriptService

    results = TranscriptService.get_recent_sessions(project_name or None, limit)
    if not results:
        scope = f" for '{project_name}'" if project_name else ""
        return f"No session transcripts found{scope}."
    lines = [f"Recent sessions{' for ' + project_name if project_name else ''}:"]
    for r in results:
        lines.append(f"\n[{r['type']}] {r['project']} — {r['title']} ({r['date']})")
        lines.append(f"  {r['summary']}")
    return "\n".join(lines)


pmo_tools = [
    list_projects,
    get_project_status,
    get_project_achievements,
    get_sprint_info,
    get_team_capacity,
    get_milestones,
    generate_project_report,
    generate_multi_project_report,
    get_resource_allocation,
    get_employee_projects,
    upload_session_transcript,
    search_session_transcripts,
    get_recent_sessions,
]



pmo_llm = ChatOpenAI(
    base_url=settings.ROUTER_BASE_URL,
    api_key=settings.ROUTER_API_KEY,
    model=settings.ROUTER_MODEL_NAME,
    temperature=settings.AGENT_TEMPERATURE,
    max_retries=3,
    timeout=30,
)


pmo_llm_with_tools = pmo_llm.bind_tools(pmo_tools)


class PMOState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]


def pmo_assistant(state: PMOState):
    messages = state["messages"]
    if not any(isinstance(message, SystemMessage) for message in messages):
        base_prompt = PromptService.get_system_prompt("pmo", PMO_SYSTEM_PROMPT)
        guardrail = PromptService.get_guardrail("pmo")
        messages = [SystemMessage(content=base_prompt + guardrail)] + messages
    try:
        return {"messages": [pmo_llm_with_tools.invoke(messages)]}
    except Exception as exc:
        print(f"PMO Agent LLM error: {exc}")
        return {"messages": [AIMessage(content="PMO Agent is temporarily unavailable. Please try again.")]}


PDF_KEYWORDS = {
    "generate pdf",
    "generate a pdf",
    "create pdf",
    "create a pdf",
    "generate report",
    "generate a report",
    "create report",
    "create a report",
    "export pdf",
    "export report",
    "download report",
    "download pdf",
    "make a report",
    "make a pdf",
    "write a report",
    "produce a report",
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
        (message.content for message in reversed(state["messages"]) if isinstance(message, HumanMessage)),
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
