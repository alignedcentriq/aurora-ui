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
10. For an organisation-wide skill-gap / capability / hiring question — NOT about one named project but about where the org is short on skills given who is available ('what skills are we short on?', 'what can't we staff?', 'where are our skill gaps?', 'should we hire or can we redeploy?', 'what should we train for?') — call 'analyze_skill_supply'. Present the result verbatim.
11. For a learning / upskilling question — someone asking what to learn or which course to take for a skill ('recommend a course on React', 'what Udemy courses are there for AWS', 'I want to upskill in Power BI') — call 'search_udemy_courses' with the topic inferred from their message. Present the returned courses verbatim. If they then want a seat, call 'request_training_license'.
12. Project IQ (delivery-knowledge reuse from past projects). Present the result verbatim. NEVER add from your own knowledge:
    - 'have we done/built something like X before?', 'any prior project with Y?' → 'find_similar_projects'.
    - 'what usually goes wrong in X?', 'common risks/lessons with Y' → 'project_lessons'.
    - 'who has done X before?', 'who has delivered Y?' (proven past experience, NOT availability) → 'find_project_experts'. For who is FREE to staff a new project, still use 'match_resources'.
    - 'do we already have a Z component?', 'any reusable X we can reuse?' → 'find_reusable_assets'.
    - For any other project question not covered by the specific tools above — call 'search_project_corpus'.
    These are internal-only — never draft client-facing proposals or case studies from them.
13. Udemy Business seat administration (for HR/PMO/Admin):
    - 'who hasn't used Udemy / inactive Udemy users / idle seats / who can we remove' → 'udemy_inactive_seats' (infer the idle-day threshold; default 30).
    - 'how many Udemy licenses are left / seat usage / are we out of seats / utilisation' → 'udemy_seat_utilization'.
    - 'Udemy learning insights / most popular courses / completion rate / what are people learning' → 'udemy_course_insights'.
    - 'deactivate / remove / revoke Udemy access for / reclaim the seat of <person>' → 'deactivate_udemy_user' (needs their email).
    - 'reactivate / restore Udemy access for <person>' → 'reactivate_udemy_user'.
    - 'add / provision / give Udemy access to <person>' → 'provision_udemy_user'.
    Present each tool's result verbatim. These tools enforce their own permissions; if one says it's restricted or not connected, relay that — don't work around it.
14. TechElevate LMS — creating new in-house trainings:
    - 'create a training on X', 'build a course for Y', 'add a new training called Z', 'make a DevOps course' → call 'create_te_training'. Infer topic and any description from the message. PMO/Admin only.
15. TechElevate LMS — assigning trainings:
    - 'assign X training to Y', 'enroll me in the DevOps course', 'book cloud fundamentals for John', 'assign Python to my team' → call 'assign_te_training'. Infer training_name and employee from the message. Use 'me' if the user wants it for themselves. PMO/Admin only.
16. TechElevate LMS — completion tracking:
    - 'who completed the security training?', 'show completions for Python', 'who passed the DevOps assessment?', 'training status for X' → call 'list_training_completions'. Infer training_name from the message.
17. TechElevate LMS — MCQ generation:
    - 'generate MCQ questions for X training', 'create quiz questions for the DevOps course', 'draft assessment questions grounded in the Udemy content', 'make questions for the Python training' → call 'generate_training_mcq'. Infer training_name and count (default 5). Questions are AI-drafted from the course's uploaded materials and Udemy/video links. PMO/Admin only.

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
        from app.services.fuzzy_match import best_fuzzy_match
        best = best_fuzzy_match(project_name, names)
        if best:
            return f"No project found matching '{project_name}'. Did you mean **{best}**?"
        return f"No project found matching '{project_name}'. Available projects: {', '.join(names)}"
    return result


@tool
def get_project_achievements(project_name: str) -> str:
    """Get the key achievements and successes for a specific project from SharePoint content."""
    from app.services.policy_service import PolicyService
    result = PolicyService.search_projects(f"{project_name} achievements outcomes results", limit=4)
    if not result or "no results" in result.lower():
        from app.services.fuzzy_match import best_fuzzy_match
        best = best_fuzzy_match(project_name, _get_project_names_from_db())
        if best:
            return f"No project found matching '{project_name}'. Did you mean **{best}**?"
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
            from app.services.fuzzy_match import best_fuzzy_match
            best = best_fuzzy_match(project_name, names)
            if best:
                return f"No project found matching '{project_name}'. Did you mean **{best}**?"
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
    """Recommend trainings to upskill on a skill/topic. Checks the real TechElevate
    catalog FIRST (company-provided, tracked); only if nothing matches does it fall back
    to the Udemy Business catalog. Call when someone asks what to learn or which course
    to take for a skill ('how do I learn ML', 'upskill in DevOps', 'training for
    Python'). topic: the skill inferred from the user's message."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    from app.services import techelevate_local_service as te
    internal = te.recommend_for_skill_live(email, topic, limit=5)
    if internal:
        lines = [f"Here are **TechElevate trainings** for **{topic}** — company-provided and tracked:\n"]
        for t in internal:
            head = f"- **{t['title']}**" + (f" — {t['category']}" if t.get("category") else "")
            lines.append(head)
            if t.get("description"):
                lines.append(f"  {t['description']}")
        lines.append("\nOpen the TechElevate tab to assign one of these to yourself or your team.")
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
    completed. Call for 'my trainings', 'what training do I have', 'my learning
    progress', 'my course status'."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    from app.services import techelevate_local_service as te
    try:
        rows = te.my_assignments_live(email)
    except PermissionError:
        return ("I can't reach your TechElevate assignments right now — open the TechElevate "
                "tab once to connect your Microsoft account, then ask me again.")
    if not rows:
        return ("You don't have any TechElevate training assignments yet. Ask me to recommend "
                "trainings for a skill you'd like to build.")
    order = {"in_progress": 0, "assigned": 1, "completed": 2, "failed": 3}
    lines = ["Here are your **TechElevate trainings**:\n"]
    for a in sorted(rows, key=lambda r: order.get(r["status"], 9)):
        bits = [(a["status"] or "").replace("_", " ")]
        if a.get("due_date"):
            bits.append(f"due {a['due_date']}")
        lines.append(f"- **{a['training_title']}** — {' · '.join(bits)}")
    return "\n".join(lines)


# ── Udemy seat administration (reporting + SCIM provisioning) ────────────────
_UDEMY_REPORT_ROLES = {"hr", "pmo", "admin", "super admin"}
_UDEMY_ADMIN_ROLES = {"pmo", "admin", "super admin"}


def _caller_role(state) -> str:
    return ((state or {}).get("user_role") or "employee").strip().lower()


@tool
def udemy_inactive_seats(days: int = None, state: Annotated[dict, InjectedState] = None) -> str:
    """List Udemy Business learners who haven't logged in for a while, so their seats can be
    reclaimed. Call for 'who hasn't used Udemy', 'inactive Udemy users', 'idle seats',
    'who can we remove from Udemy', 'Udemy users inactive for 90 days'. days: idle-day
    threshold ONLY if the user states one; leave unset to use the PMO-configured org default.
    HR/PMO/Admin only."""
    if _caller_role(state) not in _UDEMY_REPORT_ROLES:
        return "Udemy seat reporting is restricted to HR, PMO and Admin users."
    from app.services import udemy_business_service as udemy
    if not udemy.configured():
        return "Udemy Business isn't connected, so I can't read learner activity."
    try:
        days = max(1, int(days)) if days not in (None, "") else udemy.get_inactive_default_days()
    except (TypeError, ValueError):
        days = udemy.get_inactive_default_days()
    res = udemy.get_inactive_users(days)
    if res.get("error"):
        return "Udemy Business isn't connected, so I can't read learner activity."
    rows = res.get("results") or []
    if not rows:
        return f"No Udemy learners have been idle for {days}+ days — every active seat is in use."
    lines = [f"**{res['count']} of {res['total_learners']} Udemy learners** are idle {days}+ days "
             f"(longest-idle first):\n"]
    for r in rows[:12]:
        grp = f" · {', '.join(r['groups'])}" if r.get("groups") else ""
        last = "never visited" if r.get("never_visited") else f"last active {r.get('last_active')}"
        lines.append(f"- **{r['name']}** ({r['email']}) — {r['idle_days']}d idle, {last}{grp}")
    if len(rows) > 12:
        lines.append(f"\n…and {len(rows) - 12} more.")
    lines.append("\nWant me to deactivate any of them? Tell me the person and I'll free the seat "
                 "(if SCIM provisioning is connected).")
    return "\n".join(lines)


@tool
def udemy_seat_utilization(state: Annotated[dict, InjectedState] = None) -> str:
    """Report Udemy Business license usage — how many seats are purchased, used and available.
    Call for 'how many Udemy licenses are left', 'Udemy seat usage', 'are we out of Udemy
    seats', 'Udemy utilisation'. HR/PMO/Admin only."""
    if _caller_role(state) not in _UDEMY_REPORT_ROLES:
        return "Udemy seat reporting is restricted to HR, PMO and Admin users."
    from app.services import udemy_business_service as udemy
    if not udemy.configured():
        return "Udemy Business isn't connected, so I can't read seat usage."
    s = udemy.get_license_summary()
    if s.get("error"):
        return "Udemy Business isn't connected, so I can't read seat usage."
    parts = []
    if s.get("purchased") is not None:
        parts.append(f"**{s.get('used', '?')} of {s['purchased']} seats used**")
        if s.get("available") is not None:
            parts.append(f"**{s['available']} available**")
        if s.get("utilization_pct") is not None:
            parts.append(f"{s['utilization_pct']}% utilised")
    else:
        parts.append("seat totals not set yet (PMO can set them on the Udemy portal)")
    head = "Udemy Business licenses: " + ", ".join(parts) + "."
    tail = (f" For context, the activity report shows {s.get('active_in_report', 0)} active learners "
            f"and {s.get('deactivated', 0)} deactivated accounts.")
    return head + tail


@tool
def udemy_course_insights(state: Annotated[dict, InjectedState] = None) -> str:
    """High-level Udemy learning insights — total enrollments, completions, completion rate,
    hours consumed, top courses and categories. Call for 'Udemy learning insights', 'most
    popular Udemy courses', 'Udemy completion rate', 'what are people learning on Udemy'.
    HR/PMO/Admin only. (First call of the day can take a moment to aggregate.)"""
    if _caller_role(state) not in _UDEMY_REPORT_ROLES:
        return "Udemy learning insights are restricted to HR, PMO and Admin users."
    from app.services import udemy_business_service as udemy
    if not udemy.configured():
        return "Udemy Business isn't connected, so I can't compute learning insights."
    ins = udemy.get_course_insights()
    if ins.get("error"):
        return "Udemy Business isn't connected, so I can't compute learning insights."
    t = ins.get("totals", {})
    lines = [
        f"**Udemy learning at a glance** — {t.get('learners_engaged', 0)} learners, "
        f"{t.get('enrollments', 0)} enrollments, {t.get('completions', 0)} completions "
        f"({t.get('completion_rate', 0)}% completion rate), {t.get('hours_consumed', 0)} hours consumed.\n",
        "Most-enrolled courses:",
    ]
    for c in (ins.get("top_enrolled") or [])[:5]:
        lines.append(f"- {c['title']} — {c['enrolled']} enrolled, {c['completion_rate']}% completed")
    cats = ins.get("categories") or []
    if cats:
        lines.append("\nTop categories: " + ", ".join(f"{c['category']} ({c['enrolled']})" for c in cats[:5]) + ".")
    return "\n".join(lines)


@tool
def deactivate_udemy_user(email: str, state: Annotated[dict, InjectedState] = None) -> str:
    """Deactivate (deprovision) a Udemy Business user via SCIM to free their seat. Call when
    a PMO/Admin asks to 'deactivate', 'remove', 'revoke Udemy access for', or 'reclaim the
    seat of' a named person. email: the user's email. PMO/Admin only."""
    if _caller_role(state) not in _UDEMY_ADMIN_ROLES:
        return "Deactivating Udemy seats is restricted to PMO and Admin users."
    from app.services import udemy_scim_service as scim
    if not scim.configured():
        return ("Udemy SCIM provisioning isn't connected yet, so I can't deactivate seats directly. "
                "Once it's set up I can do this in one step; for now it can be done in Udemy admin.")
    res = scim.deactivate_user((email or "").strip())
    if res.get("ok"):
        return f"Done — **{email}** has been deactivated in Udemy and their seat is freed. ✓"
    if res.get("error") == "not_found":
        return f"I couldn't find a Udemy user for **{email}**. Double-check the email."
    return f"Couldn't deactivate **{email}**: {res.get('message', 'SCIM error')}."


@tool
def reactivate_udemy_user(email: str, state: Annotated[dict, InjectedState] = None) -> str:
    """Reactivate a previously-deactivated Udemy Business user via SCIM. Call for 'reactivate',
    're-enable', or 'restore Udemy access for' a named person. email: the user's email.
    PMO/Admin only."""
    if _caller_role(state) not in _UDEMY_ADMIN_ROLES:
        return "Reactivating Udemy seats is restricted to PMO and Admin users."
    from app.services import udemy_scim_service as scim
    if not scim.configured():
        return "Udemy SCIM provisioning isn't connected yet, so I can't reactivate users directly."
    res = scim.reactivate_user((email or "").strip())
    if res.get("ok"):
        return f"Done — **{email}** has been reactivated in Udemy. ✓"
    if res.get("error") == "not_found":
        return f"I couldn't find a Udemy user for **{email}**."
    return f"Couldn't reactivate **{email}**: {res.get('message', 'SCIM error')}."


@tool
def provision_udemy_user(email: str, given_name: str = "", family_name: str = "",
                         state: Annotated[dict, InjectedState] = None) -> str:
    """Provision (create) a new Udemy Business user via SCIM and grant access. Call for 'add',
    'provision', 'give Udemy access to', or 'create a Udemy account for' a named person.
    email required; given_name/family_name optional. PMO/Admin only."""
    if _caller_role(state) not in _UDEMY_ADMIN_ROLES:
        return "Provisioning Udemy users is restricted to PMO and Admin users."
    from app.services import udemy_scim_service as scim
    if not scim.configured():
        return "Udemy SCIM provisioning isn't connected yet, so I can't provision users directly."
    email = (email or "").strip()
    if not email:
        return "I need the person's email to provision them."
    res = scim.provision_user(email, given_name=given_name, family_name=family_name)
    if res.get("ok"):
        if res.get("already"):
            return f"**{email}** already has a Udemy account — nothing to do."
        return f"Done — provisioned **{email}** in Udemy Business with access. ✓"
    return f"Couldn't provision **{email}**: {res.get('message', 'SCIM error')}."


@tool
def search_project_corpus(query: str) -> str:
    """Search the full project knowledge base — transcripts, project files, and delivery
    documents from all past projects. Use for ANY project question not covered by the
    specific Project IQ tools: e.g. 'what technologies have we used in healthcare projects?',
    'summarise our delivery in fintech', 'what did we build for client X?', 'what does
    project Y do?', 'how many projects use React?', 'tell me about our cloud work'.
    query: a descriptive search query inferred from the user's message."""
    from app.services.policy_service import PolicyService
    return PolicyService.search_projects(query, limit=6)


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


_TE_WRITE_ROLES = {"pmo", "admin", "super admin"}


@tool
def create_te_training(
    topic: str,
    description: str = "",
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Create a new in-house TechElevate LMS training from a plain-English description.
    The AI drafts the title, description, category, duration, pass %, skill tags, and
    optional multi-level structure; the training is saved immediately. Call for 'create
    a training on Azure DevOps', 'build a course for Python beginners', 'add a new
    training called Cloud Fundamentals', 'make a compliance course'. PMO/Admin only.
    topic: the training topic / working title inferred from the message.
    description: any extra requirements or details stated by the user (leave blank if none)."""
    email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    if _caller_role(state) not in _TE_WRITE_ROLES:
        return "Creating TechElevate trainings is restricted to PMO and Admin users."
    from app.database import SessionLocal
    from app.services import techelevate_local_service as te
    if not te.local_enabled():
        return "The TechElevate LMS isn't enabled right now (TECHELEVATE_LOCAL is off)."
    from app.services.llm_json import invoke_json
    full_desc = f"{topic}: {description}" if description.strip() else topic
    prompt = (
        "You are a corporate training designer for an internal Learning Management System. "
        "From the admin's description below, design a training course.\n\n"
        f"Admin's description: {full_desc}\n\n"
        "Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:\n"
        '{"title": "Short Course Title", "description": "2-3 sentence overview.", '
        '"category": "Technical|Governance & Compliance|Business", '
        '"duration_minutes": 120, "pass_percentage": 60, '
        '"skill_tags": ["Skill1", "Skill2"], '
        '"multi_level": false, '
        '"levels": [{"name": "Beginner", "duration_minutes": 60, "pass_percentage": 55, "description": "..."}, '
        '{"name": "Intermediate", "duration_minutes": 60, "pass_percentage": 65, "description": "..."}, '
        '{"name": "Advanced", "duration_minutes": 60, "pass_percentage": 70, "description": "..."}]}\n\n'
        "Rules:\n"
        "- title: concise, professional. 5-10 words max.\n"
        "- category: pick the single best fit from the three options.\n"
        "- duration_minutes: realistic total study time (30-480).\n"
        "- pass_percentage: 50-80.\n"
        "- skill_tags: 2-5 concrete skills the learner earns on completion.\n"
        "- multi_level: true only if the topic naturally has a progression. Simple courses → false.\n"
        "- levels: include ONLY when multi_level is true. 2-4 levels with ascending difficulty.\n"
    )
    draft = invoke_json("general", prompt, attempts=2, default_timeout=60)
    if not draft:
        return "Couldn't draft the training — the AI model didn't return usable content. Try rephrasing."
    tags = draft.get("skill_tags") or []
    if isinstance(tags, str):
        tags = [s.strip() for s in tags.split(",") if s.strip()]
    data = {
        "title": str(draft.get("title") or topic).strip()[:150],
        "description": str(draft.get("description") or "").strip()[:500],
        "category": str(draft.get("category") or "Technical").strip(),
        "duration_minutes": min(max(int(draft.get("duration_minutes") or 120), 15), 960),
        "pass_percentage": min(max(int(draft.get("pass_percentage") or 60), 10), 100),
        "skill_tags": tags[:8],
        "levels": (
            [
                {
                    "name": str(lv.get("name") or f"Level {i+1}").strip()[:60],
                    "duration_minutes": min(max(int(lv.get("duration_minutes") or 60), 10), 480),
                    "pass_percentage": min(max(int(lv.get("pass_percentage") or 60), 10), 100),
                    "description": str(lv.get("description") or "").strip()[:300],
                }
                for i, lv in enumerate((draft.get("levels") or [])[:5])
            ]
            if draft.get("multi_level") and isinstance(draft.get("levels"), list)
            else []
        ),
    }
    if data["category"] not in ("Technical", "Governance & Compliance", "Business"):
        data["category"] = "Technical"
    db = SessionLocal()
    try:
        result = te.create_training(db, data, created_by=email)
        lines = [
            f"Training **{result['title']}** created. ✓",
            f"Category: {result.get('category')} · Duration: {result.get('duration_minutes')} min · Pass: {result.get('pass_percentage')}%",
        ]
        if result.get("skill_tags"):
            lines.append(f"Skills on completion: {', '.join(result['skill_tags'])}")
        if result.get("levels"):
            lvl_names = ", ".join(lv["name"] for lv in result["levels"])
            lines.append(f"Levels: {lvl_names}")
        lines.append(f"\nTraining ID: {result['id']}. Add materials and MCQ questions from the TechElevate LMS tab, then assign it to learners.")
        return "\n".join(lines)
    except Exception as exc:
        return f"Failed to create training: {exc}"
    finally:
        db.close()


@tool
def assign_te_training(
    training_name: str,
    employee: str = "me",
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Assign an in-house TechElevate training to an employee. Call for 'assign Python
    training to John', 'enroll me in the DevOps course', 'book Cloud Fundamentals for
    sarah@example.com', 'assign security training to the team'. PMO/Admin for others;
    any user can self-enroll with employee='me'.
    training_name: the training name inferred from the message.
    employee: target employee's name or email. Use 'me' if the user wants it for themselves."""
    caller_email = (state or {}).get("user_email", settings.DEFAULT_USER_EMAIL)
    import datetime
    from app.database import SessionLocal
    from app.services import techelevate_local_service as te
    if not te.local_enabled():
        return "The TechElevate LMS isn't enabled right now."
    target_is_self = not employee or employee.strip().lower() in ("me", "myself", "i")
    if not target_is_self and _caller_role(state) not in _TE_WRITE_ROLES:
        return "Assigning trainings to others is restricted to PMO and Admin users."
    db = SessionLocal()
    try:
        trainings = te.list_trainings(db, search=training_name)
        if not trainings:
            return (f"No training found matching '{training_name}'. "
                    "Use 'recommend training' or 'show available trainings' to browse the catalog.")
        t = trainings[0]
        target_email = caller_email if target_is_self else None
        if not target_email:
            from app.models import Employee
            emp_q = db.query(Employee).filter(
                Employee.name.ilike(f"%{employee}%") | Employee.email.ilike(f"%{employee}%")
            ).first()
            if not emp_q:
                return f"Couldn't find employee '{employee}'. Check the name or email and try again."
            target_email = emp_q.email
        emp_obj = te._resolve_employee(db, email=target_email)
        if not emp_obj:
            return f"No employee record found for '{target_email}'. Check the directory sync."
        # Check for existing enrollment before assigning (assign_training is idempotent and
        # returns the existing row rather than None when already enrolled).
        from app.models import TeAssignment
        already = db.query(TeAssignment).filter(
            TeAssignment.training_id == t["id"],
            TeAssignment.employee_id == emp_obj.id,
        ).first()
        if already:
            return f"**{emp_obj.name}** is already enrolled in **{t['title']}** (status: {already.status}) — nothing to do."
        a = te.assign_training(
            db, training_id=t["id"], employee=emp_obj,
            start_date=datetime.date.today(), assigned_by=caller_email,
        )
        if a is None:
            return f"Could not assign the training — training or employee record missing."
        db.commit()
        who = "You are" if target_is_self else f"**{emp_obj.name}** is"
        return (
            f"Done — {who} enrolled in **{t['title']}**. ✓\n"
            f"They can take the assessment from TechElevate LMS → My Learning tab "
            f"to earn the course's verified skills: {', '.join(t.get('skill_tags') or [])}."
        )
    finally:
        db.close()


@tool
def list_training_completions(training_name: str) -> str:
    """Show enrollment and completion status for a TechElevate training — who completed,
    who is in progress, who is pending, and scores. Call for 'who completed the security
    training?', 'show completions for Python course', 'who passed the DevOps assessment?',
    'training status for X', 'enrollment for the ML course'.
    training_name: the training name inferred from the message."""
    from app.database import SessionLocal
    from app.services import techelevate_local_service as te
    if not te.local_enabled():
        return "The TechElevate LMS isn't enabled right now."
    db = SessionLocal()
    try:
        trainings = te.list_trainings(db, search=training_name)
        if not trainings:
            return f"No training found matching '{training_name}'."
        t = trainings[0]
        assignments = te.list_assignments(db, training_id=t["id"], limit=100)
        if not assignments:
            return f"No one is enrolled in **{t['title']}** yet. Use 'assign' to enroll learners."
        completed = [a for a in assignments if a["status"] == "Completed"]
        in_progress = [a for a in assignments if a["status"] == "In Progress"]
        pending = [a for a in assignments if a["status"] == "Assigned"]
        failed = [a for a in assignments if a["status"] == "Failed"]
        lines = [f"**{t['title']}** — {len(assignments)} enrolled:\n"]
        if completed:
            lines.append(f"Completed ({len(completed)}):")
            for a in completed[:12]:
                score = f" · {a['score']}%" if a.get("score") is not None else ""
                lines.append(f"  - {a.get('employee_name') or a.get('employee_email', '?')}{score}")
        if in_progress:
            lines.append(f"\nIn Progress ({len(in_progress)}):")
            for a in in_progress[:8]:
                lines.append(f"  - {a.get('employee_name') or a.get('employee_email', '?')}")
        if pending:
            lines.append(f"\nPending ({len(pending)}):")
            for a in pending[:8]:
                lines.append(f"  - {a.get('employee_name') or a.get('employee_email', '?')}")
        if failed:
            lines.append(f"\nFailed ({len(failed)}):")
            for a in failed[:8]:
                lines.append(f"  - {a.get('employee_name') or a.get('employee_email', '?')}")
        if len(assignments) > 28:
            lines.append(f"\n…and more. See the full list in TechElevate LMS → Admin Panel.")
        return "\n".join(lines)
    finally:
        db.close()


@tool
def generate_training_mcq(
    training_name: str,
    count: int = 5,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """AI-generate MCQ (multiple-choice question) assessment questions for a TechElevate
    training, grounded in its uploaded materials (PDFs, DOCX) and linked content (Udemy
    courses, video links). Questions are generated AND saved to the training immediately.
    Call for 'generate MCQ questions for the Python training', 'create quiz questions for
    DevOps course', 'generate assessment questions based on the Udemy content',
    'generate 10 questions for ML training'. PMO/Admin only.
    training_name: inferred from the message.
    count: number of questions to generate and save (default 5, max 10 via chat)."""
    if _caller_role(state) not in _TE_WRITE_ROLES:
        return "Generating MCQ questions is restricted to PMO and Admin users."
    from app.database import SessionLocal
    from app.services import techelevate_local_service as te
    if not te.local_enabled():
        return "The TechElevate LMS isn't enabled right now."
    count = max(1, min(int(count or 5), 10))
    db = SessionLocal()
    try:
        trainings = te.list_trainings(db, search=training_name)
        if not trainings:
            return (f"No training found matching '{training_name}'. "
                    "Check the name or browse the TechElevate LMS catalog.")
        t = trainings[0]
        result = te.generate_questions(db, t["id"], count=count, difficulty="mixed")
        if result.get("error") == "training_not_found":
            return f"Training '{training_name}' not found."
        if result.get("error"):
            return ("Couldn't generate questions — the AI model didn't return usable content. "
                    "Try again or add more content/materials to the course first.")
        questions = result.get("questions") or []
        if not questions:
            return ("No questions were generated. Add Udemy course links, videos, or "
                    "upload course materials in the LMS portal first, then try again.")

        # Save the generated questions directly to the training.
        saved = te.bulk_add_questions(db, t["id"], questions)

        grounded = result.get("grounded")
        source = "grounded in the course's materials" if grounded else "based on course topic/skills (add materials for richer grounding)"
        lines = [
            f"Done — {len(saved)} MCQ questions generated and saved to **{t['title']}** ({source}):\n"
        ]
        for i, q in enumerate(saved, 1):
            lines.append(f"{i}. {q['question']}")
            for k in sorted(q.get("options") or {}):
                marker = " ✓" if k == q.get("correct_answer") else ""
                lines.append(f"   {k}) {q['options'][k]}{marker}")
            if q.get("explanation"):
                lines.append(f"   _{q['explanation']}_")
            lines.append("")
        lines.append(
            "Questions are now live on the training. "
            "Learners who pass the assessment will earn the course's verified skills. "
            "You can edit or delete individual questions in TechElevate LMS → open the course → Assessment tab."
        )
        return "\n".join(lines)
    finally:
        db.close()


pmo_tools = [
    list_projects,
    search_project_corpus,
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
    create_te_training,
    assign_te_training,
    list_training_completions,
    generate_training_mcq,
    udemy_inactive_seats,
    udemy_seat_utilization,
    udemy_course_insights,
    deactivate_udemy_user,
    reactivate_udemy_user,
    provision_udemy_user,
]

# LLM built on demand from the live IT-tunable params (router tier).
from app.services.llm_resilience import resilient_invoke


# ── State ─────────────────────────────────────────────────────────────────────

class PMOState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    user_email: str
    user_role: Optional[str]    # caller role — gates Udemy seat reporting + SCIM writes
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

# Project IQ mode pins sub_intent="project_iq". Pick the right project-IQ tool by
# keyword and inject the call directly — the weak 8B model, especially with semantic
# routing degraded, otherwise mis-selects (e.g. reads "find similar projects" as
# create_te_training and leaks raw course-spec JSON). All four are passthrough tools,
# so output is display-ready. ponytail: keyword pick, upgrade to embeddings if it drifts.
_PIQ_EXPERT_KW = ("expert", "who has", "who's done", "whos done", "who did", "sme", "skilled in", "experience in", "worked on")
_PIQ_ASSET_KW = ("reusable", "reuse", "accelerator", "template", "component", "connector", "existing module", "asset")
_PIQ_LESSON_KW = ("lesson", "learned", "goes wrong", "went wrong", "pitfall", "retro")
_PIQ_SIMILAR_KW = ("similar", "like ", "prior", "done before", "built before", "comparable", "past project")


def _inject_project_iq_tool_call(text: str) -> dict:
    """Inject the matching Project IQ tool call directly — zero LLM tool selection."""
    blob = (text or "").lower()
    if any(k in blob for k in _PIQ_EXPERT_KW):
        name, arg = "find_project_experts", "skills"
    elif any(k in blob for k in _PIQ_ASSET_KW):
        name, arg = "find_reusable_assets", "need"
    elif any(k in blob for k in _PIQ_LESSON_KW) and not any(k in blob for k in _PIQ_SIMILAR_KW):
        name, arg = "project_lessons", "topic"
    else:
        # Default: similar projects — render_similar_projects already includes each
        # project's lessons, so "similar + lessons learned" is covered here.
        name, arg = "find_similar_projects", "description"
    return {
        "messages": [
            AIMessage(
                content="",
                tool_calls=[{
                    "name": name,
                    "args": {arg: (text or "").strip()},
                    "id": str(uuid.uuid4()),
                    "type": "tool_call",
                }],
            )
        ]
    }


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

    if sub_intent == "project_iq":
        last = next((m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), None)
        return _inject_project_iq_tool_call(getattr(last, "content", "") if last else "")

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
    # TechElevate LMS write/query tools — results are display-ready.
    "create_te_training",
    "assign_te_training",
    "list_training_completions",
    "generate_training_mcq",
    # Udemy seat admin (reporting + SCIM) — all return display-ready confirmations/lists.
    "udemy_inactive_seats",
    "udemy_seat_utilization",
    "udemy_course_insights",
    "deactivate_udemy_user",
    "reactivate_udemy_user",
    "provision_udemy_user",
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
