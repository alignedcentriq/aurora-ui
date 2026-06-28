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
9. For a staffing / resourcing question — finding people for a new or upcoming project ('I need 2 React devs with 3+ years', 'who is free for a new project?', 'find an AWS engineer who isn't fully allocated') — call 'match_resources'. Infer the skills, minimum experience, needed-by date, and headcount from the user's message; never invent any value they did not state. Present the returned candidates verbatim.
11. For a learning / upskilling question — someone asking what to learn or which course to take for a skill ('recommend a course on React', 'what Udemy courses are there for AWS', 'I want to upskill in Power BI') — call 'search_udemy_courses' with the topic inferred from their message. Present the returned courses verbatim. If they then want a seat, call 'request_training_license'.
10. For an organisation-wide skill-gap / capability / hiring question — NOT about one named project but about where the org is short on skills given who is available ('what skills are we short on?', 'what can't we staff?', 'where are our skill gaps?', 'should we hire or can we redeploy?', 'what should we train for?') — call 'analyze_skill_supply'. Present the result verbatim.
12. Project IQ (delivery-knowledge reuse from past projects). Use ONLY these tools for the matching question, present the result verbatim, and NEVER add experience from your own knowledge:
    - 'have we done/built something like X before?', 'any prior project with Y?' → 'find_similar_projects'.
    - 'what usually goes wrong in X?', 'common risks/lessons with Y' → 'project_lessons'.
    - 'who has done X before?', 'who has delivered Y?' (proven past experience, NOT availability) → 'find_project_experts'. For who is FREE to staff a new project, still use 'match_resources'.
    - 'do we already have a Z component?', 'any reusable X we can reuse?' → 'find_reusable_assets'.
    These are internal-only — never draft client-facing proposals or case studies from them.

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
    """List all available projects from the project database."""
    from app.database import SessionLocal
    from app.models import Project
    db = SessionLocal()
    try:
        rows = db.query(Project).order_by(Project.name).all()
        if not rows:
            # Fall back to SharePoint-derived names if DB is empty
            from app.services.policy_service import PolicyService
            names = PolicyService.list_project_names()
            if not names:
                return "No projects found in the system."
            return "Available projects:\n" + "\n".join(f"- {n}" for n in names)
        lines = []
        for p in rows:
            status = f" [{p.status}]" if p.status else ""
            pct = f" — {int(p.completion_pct)}% complete" if p.completion_pct else ""
            owner = f" (Owner: {p.owner})" if p.owner else ""
            lines.append(f"- {p.name}{status}{pct}{owner}")
        return f"Available projects ({len(rows)}):\n" + "\n".join(lines)
    finally:
        db.close()


@tool
def get_project_status(project_name: str) -> str:
    """Get status, milestones, and details for a specific project."""
    from app.database import SessionLocal
    from app.models import Project
    from app.services.policy_service import PolicyService
    db = SessionLocal()
    try:
        row = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
        if row:
            lines = [f"**{row.name}**"]
            if row.status: lines.append(f"Status: {row.status}")
            if row.completion_pct: lines.append(f"Completion: {int(row.completion_pct)}%")
            if row.owner: lines.append(f"Owner: {row.owner}")
            if row.sprint_name: lines.append(f"Sprint: {row.sprint_name}")
            if row.next_milestone: lines.append(f"Next milestone: {row.next_milestone}" + (f" ({row.next_milestone_date})" if row.next_milestone_date else ""))
            if row.achievements: lines.append(f"Achievements: {row.achievements}")
            return "\n".join(lines)
    finally:
        db.close()
    # Fall back to SharePoint content
    result = PolicyService.search_projects(f"{project_name} status milestones", limit=4)
    if not result or "no results" in result.lower():
        names = _get_project_names_from_db()
        return f"No project found matching '{project_name}'. Available projects: {', '.join(names)}"
    return result


@tool
def get_project_achievements(project_name: str) -> str:
    """Get the key achievements and successes for a specific project from SharePoint content."""
    from app.services.policy_service import PolicyService
    result = PolicyService.search_projects(f"{project_name} achievements outcomes results", limit=4)
    if not result or "no results" in result.lower():
        return f"No project found matching '{project_name}' to retrieve achievements."
    return result


@tool
def generate_project_report(project_name: str, report_type: str = "project_status_report") -> str:
    """Generate a downloadable PDF report for one project using SharePoint content."""
    from app.document_generation.generator import generate_pdf
    from app.document_store import store_pdf
    from app.services.policy_service import PolicyService
    try:
        content = PolicyService.search_projects(f"{project_name}", limit=8)
        if not content or "no results" in content.lower():
            names = _get_project_names_from_db()
            return f"No project found matching '{project_name}'. Available: {', '.join(names)}"
        title = f"{project_name} - {report_type.replace('_', ' ').title()}"
        pdf_bytes = generate_pdf(
            doc_type=report_type,
            title=title,
            content=content,
            generated_by="Centriq PMO Agent",
        )
        file_id = str(uuid.uuid4())[:8]
        store_pdf(file_id, pdf_bytes, f"{project_name.replace(' ', '_')}_report")
        return f"PDF report generated for **{project_name}**.\n\n[DOWNLOAD_PDF:/api/documents/download/{file_id}:{title}]"
    except Exception as exc:
        return f"Failed to generate report: {exc}"


@tool
def generate_multi_project_report(
    project_names: str = "all",
    report_type: str = "project_status_report",
) -> str:
    """Generate a single PDF report covering multiple projects using SharePoint content."""
    from app.document_generation.generator import generate_pdf
    from app.document_store import store_pdf
    from app.services.policy_service import PolicyService
    try:
        all_names = _get_project_names_from_db()
        if project_names.strip().lower() == "all":
            chosen = all_names
        else:
            requested = [n.strip() for n in project_names.split(",") if n.strip()]
            chosen = [
                n for n in all_names
                if any(r.lower() in n.lower() or n.lower() in r.lower() for r in requested)
            ]
        if not chosen:
            return f"No matching projects found. Available: {', '.join(all_names)}"
        lines = [f"Organization Project Report — {len(chosen)} Projects", ""]
        for name in chosen:
            snippet = PolicyService.search_projects(name, limit=3)
            lines += [f"\n{name.upper()}:", snippet or "(no content available)", ""]
        title = f"Organization Report - {len(chosen)} Projects"
        pdf_bytes = generate_pdf(
            doc_type=report_type,
            title=title,
            content="\n".join(lines),
            generated_by="Centriq PMO Agent",
        )
        file_id = str(uuid.uuid4())[:8]
        store_pdf(file_id, pdf_bytes, "org_projects_report")
        names_str = ", ".join(chosen)
        return f"PDF report generated covering {len(chosen)} projects: {names_str}.\n\n[DOWNLOAD_PDF:/api/documents/download/{file_id}:{title}]"
    except Exception as exc:
        return f"Failed to generate multi-project report: {exc}"


@tool
def search_people_directory(query: str):
    """Search employees by name, skill, designation, project history, experience, or manager.
    Use for: 'Who worked on Project X?', 'Find Python developers', 'Who has 5+ years experience?'"""
    from app.services.people_service import PeopleService
    return PeopleService.search_people_text(query)


@tool
def match_resources(
    skills: str,
    min_years: Optional[float] = None,
    available_by: str = "",
    count: int = 5,
    state: Annotated[dict, InjectedState] = None,
):
    """Find employees who could be staffed on a new/upcoming project, ranked by skill
    match, current availability (free capacity / when they roll off their project), and
    experience. Use for staffing/resourcing questions like 'I need 2 React developers
    with 3+ years free by July', 'who is available for a new data-engineering project?',
    'find me an AWS person who isn't fully allocated'.

    skills: the required skill(s), comma-separated, inferred from the request (e.g. "React, Node, AWS").
    min_years: minimum years of experience, ONLY if the user stated one (else leave null).
    available_by: the date the resource is needed by in YYYY-MM-DD, ONLY if the user gave one (else blank).
    count: how many candidates to return (default 5; use the user's number if they asked for N people).
    Never invent skills, experience, or dates the user did not mention."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    from app.services.resource_matching_service import ResourceMatchingService
    return ResourceMatchingService.match(
        skills=skills, min_years=min_years, available_by=available_by,
        count=count, user_email=email,
    )


@tool
def analyze_skill_supply(
    top_n: int = 8,
    state: Annotated[dict, InjectedState] = None,
):
    """Analyze which in-demand skills the org CANNOT currently staff — Alchemy's
    market skill-gap data crossed with live project allocation availability. Each
    skill is tagged BUY / TRAIN / REDEPLOY / STAFFABLE. Use for questions like
    'what skills are we short on?', 'what can't we staff?', 'where are our skill
    gaps given who's available?', 'do we need to hire or can we redeploy?'.
    top_n: how many top gaps to return (default 8)."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    from app.services.skill_gap_overlay_service import SkillSupplyService
    return SkillSupplyService.render(user_email=email, top_n=top_n)


@tool
def search_pmo_docs(query: str):
    """Search PMO process / governance documents for how-to / process / policy questions
    (project onboarding, governance, change-request process, PMO templates). Call for any
    'how do I…', 'what is the process for…', or PMO-policy question. Infer the query from the
    user's message — never ask what to search."""
    from app.services.policy_service import PolicyService
    return PolicyService.search_pmo_docs(query)


@tool
def request_training_license(
    platform: str = "Udemy",
    course_name: str = "",
    justification: str = "",
    state: Annotated[dict, InjectedState] = None,
):
    """Submit a request for a company-provided training-platform license to the PMO team.
    The company provides both Udemy and Coursera licenses to employees, subject to availability.
    platform: 'Udemy' or 'Coursera' (default 'Udemy' if the user didn't say which).
    course_name: the course or topic they want (optional — leave blank if not stated).
    justification: a one-line reason, ONLY if the user gave one — never invent one.
    The PMO team is notified by email and reviews the request."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    from app.services.udemy_service import UdemyService
    return UdemyService.request_license(email, justification, course_name, platform)


@tool
def search_udemy_courses(topic: str):
    """Search the company's Udemy Business catalog for courses on a given skill or topic.
    Call when someone asks what to learn or which course to take for a skill ('recommend a
    course on React', 'what Udemy courses are there for data engineering', 'I want to upskill
    in AWS'). Returns live matching courses. After showing them, you can offer to raise a
    Udemy license request via request_training_license.
    topic: the skill/subject inferred from the user's message (e.g. 'React', 'AWS', 'Power BI')."""
    from app.services import udemy_business_service as udemy
    if not udemy.configured():
        return ("Udemy Business isn't connected yet, so I can't pull the live catalog. "
                "I can still raise a Udemy license request to the PMO team if you tell me the course.")
    try:
        result = udemy.search_courses(topic, page_size=6)
    except Exception:
        return ("I couldn't reach the Udemy Business catalog right now. "
                "I can raise a Udemy license request to the PMO team instead if you'd like.")
    courses = result.get("results", [])
    if not courses and result.get("indexing"):
        return ("The Udemy course catalog is being indexed for the first time — this takes "
                "a few minutes. Try again shortly, or I can raise a Udemy license request "
                "to the PMO team now if you tell me the course you need.")
    return udemy.format_courses_markdown(topic, courses)


@tool
def recommend_training(topic: str, state: Annotated[dict, InjectedState] = None):
    """Recommend trainings to upskill on a skill/topic. Checks the company's in-house
    TechElevate catalog FIRST (free, tracked, with an assessment that updates the
    employee's verified skills on completion); only if nothing internal matches does it
    fall back to the Udemy Business catalog. Call when someone asks what to learn or which
    course to take for a skill ('how do I learn ML', 'upskill in DevOps', 'training for
    Python'). topic: the skill inferred from the user's message."""
    from app.database import SessionLocal
    from app.services import techelevate_local_service as te
    internal = []
    if te.local_enabled():
        db = SessionLocal()
        try:
            internal = te.recommend_for_skill(db, topic, limit=5)
        finally:
            db.close()
    if internal:
        lines = [f"Here are **in-house TechElevate trainings** for **{topic}** — company-provided, "
                 "tracked, and they add to your verified skills on completion:\n"]
        for t in internal:
            dur = t.get("duration_minutes") or 0
            meta = [m for m in [t.get("category"),
                                (f"{dur // 60}h {dur % 60}m" if dur >= 60 else f"{dur}m") if dur else None] if m]
            head = f"- **{t['title']}**" + (f" — {' · '.join(meta)}" if meta else "")
            lines.append(head)
            if t.get("description"):
                lines.append(f"  {t['description']}")
            tags = ", ".join(t.get("skill_tags") or [])
            if tags:
                lines.append(f"  _Skills: {tags}_")
        lines.append("\nWant me to assign one of these to you or your team? Just say which.")
        return "\n".join(lines)
    # Nothing internal → fall back to the live Udemy catalog.
    from app.services import udemy_business_service as udemy
    if udemy.configured():
        try:
            courses = udemy.search_courses(topic, page_size=6).get("results", [])
            if courses:
                return ("No in-house TechElevate training covers that yet — here are "
                        "**Udemy Business** courses instead:\n\n"
                        + udemy.format_courses_markdown(topic, courses))
        except Exception:
            pass
    return (f"I couldn't find an in-house training or Udemy course for **{topic}** right now. "
            "I can raise a Udemy license request to the PMO team if you tell me the course.")


@tool
def get_my_trainings(state: Annotated[dict, InjectedState] = None):
    """Show the caller's own TechElevate training assignments — assigned / in-progress /
    completed, with scores. Call for 'my trainings', 'what training do I have', 'my learning
    progress', 'my course status'."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    from app.database import SessionLocal
    from app.services import techelevate_local_service as te
    if not te.local_enabled():
        return "The training portal isn't available right now."
    db = SessionLocal()
    try:
        rows = te.my_assignments(db, email)
    finally:
        db.close()
    if not rows:
        return ("You don't have any TechElevate training assignments yet. Ask me to recommend "
                "trainings for a skill you'd like to build.")
    order = {"In Progress": 0, "Assigned": 1, "Completed": 2, "Failed": 3}
    lines = ["Here are your **TechElevate trainings**:\n"]
    for a in sorted(rows, key=lambda r: order.get(r["status"], 9)):
        bits = [a["status"]]
        if a.get("score") is not None:
            bits.append(f"score {a['score']}%")
        if a.get("due_date"):
            bits.append(f"due {a['due_date']}")
        lines.append(f"- **{a['training_title']}** — {' · '.join(bits)}")
    return "\n".join(lines)


@tool
def find_similar_projects(description: str) -> str:
    """Project IQ — find past projects similar to a described need ('have we done
    something like this before?', 'have we built an employee self-service portal with
    HRMS integration?', 'any prior offline-first mobile app with SAP?'). Returns ranked
    past projects with their capabilities, integrations, lessons, reusable assets, and the
    people who delivered them. description: the requirement/scenario inferred from the
    user's message."""
    from app.services import project_iq_service as piq
    return piq.render_similar_projects(description, limit=3)


@tool
def project_lessons(topic: str) -> str:
    """Project IQ — recurring delivery lessons across past projects for a topic
    ('what usually goes wrong in HRMS integration projects?', 'common risks with SAP
    integration', 'lessons from offline sync work'). topic: the area inferred from the
    user's message."""
    from app.services import project_iq_service as piq
    return piq.render_lessons(topic)


@tool
def find_project_experts(skills: str) -> str:
    """Project IQ — find people with EVIDENCE-BACKED delivery experience in given skills,
    based on verified project participation ('who has done Azure AD SSO and HRMS
    integration?', 'who has built approval workflows?'). Returns people with the projects
    that prove it. This is about proven past delivery; for who is AVAILABLE to staff a new
    project use match_resources instead. skills: comma-separated skills inferred from the
    message."""
    from app.services import project_iq_service as piq
    return piq.render_experts(skills)


@tool
def find_reusable_assets(need: str) -> str:
    """Project IQ — find existing reusable components / accelerators / templates from past
    projects ('do we already have an approval-workflow component?', 'any HRMS connector we
    can reuse?', 'existing RBAC module'). Returns matching assets with their source project,
    readiness, and owner. need: the component/capability inferred from the message."""
    from app.services import project_iq_service as piq
    return piq.render_reusable_assets(need)


pmo_tools = [
    list_projects,
    find_similar_projects,
    project_lessons,
    find_project_experts,
    find_reusable_assets,
    get_project_status,
    get_project_achievements,
    generate_project_report,
    generate_multi_project_report,
    search_people_directory,
    match_resources,
    analyze_skill_supply,
    search_pmo_docs,
    request_training_license,
    search_udemy_courses,
    recommend_training,
    get_my_trainings,
]

# LLM built on demand from the live IT-tunable params (router tier).
from app.services.llm_resilience import resilient_invoke


# ── State ─────────────────────────────────────────────────────────────────────

class PMOState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    user_email: str
    feedback_context: str
    sub_intent: Optional[str]   # passed from router
    entities: Optional[dict]    # passed from router


# ── DB helpers (no LLM) ───────────────────────────────────────────────────────

def _get_project_names_from_db() -> list[str]:
    """Return sorted project names from the projects table; fall back to SharePoint titles."""
    from app.database import SessionLocal
    from app.models import Project
    db = SessionLocal()
    try:
        rows = db.query(Project.name).order_by(Project.name).all()
        if rows:
            return [r.name for r in rows]
    finally:
        db.close()
    from app.services.policy_service import PolicyService
    return PolicyService.list_project_names()


def _db_list_all_projects() -> dict:
    names = _get_project_names_from_db()
    if not names:
        return {"messages": [AIMessage(content="There are currently no projects in the system.")]}
    lines = [f"{i + 1}. **{n}**" for i, n in enumerate(names)]
    body = f"Here are all **{len(names)} projects** in the organization:\n\n" + "\n".join(lines)
    return {"messages": [AIMessage(content=body)]}


def _db_project_status(project_name: str) -> dict:
    from app.services.policy_service import PolicyService
    content = PolicyService.search_projects(f"{project_name} status milestones", limit=4)
    if not content or "no results" in content.lower():
        all_names = _get_project_names_from_db()
        return {"messages": [AIMessage(content=f"No project found matching '{project_name}'. Available: {', '.join(all_names)}")]}
    return {"messages": [AIMessage(content=f"**{project_name}**\n\n{content}")]}


def _db_project_achievements(project_name: str) -> dict:
    from app.services.policy_service import PolicyService
    content = PolicyService.search_projects(f"{project_name} achievements outcomes results", limit=4)
    if not content or "no results" in content.lower():
        all_names = _get_project_names_from_db()
        return {"messages": [AIMessage(content=f"No project found matching '{project_name}'. Available: {', '.join(all_names)}")]}
    return {"messages": [AIMessage(content=f"**Achievements for {project_name}:**\n\n{content}")]}


def _detect_platform(entities: dict, text: str) -> str:
    """Resolve the training platform from router entities, else from the raw message.
    Defaults to 'Udemy'. Coursera wins if the user explicitly named it."""
    explicit = (entities or {}).get("platform") or ""
    blob = f"{explicit} {text}".lower()
    if "coursera" in blob:
        return "Coursera"
    return "Udemy"


def _inject_training_tool_call(entities: dict, text: str) -> dict:
    """Inject the training-license request tool call directly — zero LLM.
    Only carries what the router actually extracted; justification is NEVER
    fabricated (an empty one renders as '—' in the PMO email)."""
    entities = entities or {}
    args = {
        "platform": _detect_platform(entities, text),
        "course_name": (entities.get("course_name") or entities.get("course") or "").strip(),
        "justification": (entities.get("justification") or "").strip(),
    }
    return {
        "messages": [
            AIMessage(
                content="",
                tool_calls=[{
                    "name": "request_training_license",
                    "args": args,
                    "id": str(uuid.uuid4()),
                    "type": "tool_call",
                }],
            )
        ]
    }


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

    if sub_intent == "udemy_license":
        last = state["messages"][-1]
        text = getattr(last, "content", "") if isinstance(last, HumanMessage) else ""
        return _inject_training_tool_call(entities, text or "")

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
        response = resilient_invoke("service", messages,
                                    build=lambda l: l.bind_tools(pmo_tools),
                                    default_timeout=120)
        return {"messages": [response]}
    except Exception as exc:
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
    "match_resources", "analyze_skill_supply",
    # Project IQ results are already formatted (ranked cards / lessons / experts / assets).
    "find_similar_projects", "project_lessons", "find_project_experts", "find_reusable_assets",
    # Training-license confirmation is display-ready; passing it through avoids the
    # LLM reflexively refusing ("can't help get a discounted Udemy/Coursera license").
    "request_training_license",
    # Live Udemy catalog results are already formatted with course links.
    "search_udemy_courses",
    # In-house training recommendations + personal training list are display-ready.
    "recommend_training",
    "get_my_trainings",
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
