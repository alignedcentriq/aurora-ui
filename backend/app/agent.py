"""
Centriq AI — Multi-Agent LangGraph Brain

Architecture:
  User Message → Intent Router (gpt-oss:latest / 20.9B) → Domain Agent (gpt-oss:latest / 20.9B)
                                         ↓
                              HR Agent (active, with tools)
                              Admin Agent (placeholder)
                              IT Support Agent (placeholder)
                              PMO Agent (active, with tools)
                              Functional Manager Agent (placeholder)
                              General Agent (direct LLM response)
"""

import os
import json
import re
from typing import TypedDict, Annotated, List, Optional

from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver

from langchain_openai import ChatOpenAI
from openai import APIConnectionError
from langchain_core.messages import (
    BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage,
)
from langchain_core.tools import tool

from app.hr_service import HRService
from app.config import settings
from app.router import classify_intent, get_domain_status, get_placeholder_response
from app.agents.pmo_agent import pmo_agent
from app.agents.admin_agent import admin_agent
from app.agents.it_agent import it_agent
from app.agents.manager_agent import manager_agent
from app.services.it_service import ITService
from app.sharepoint_transfer_service import sharepoint_transfer_service
from app.services.employee_service import EmployeeService
from app.services.announcement_service import AnnouncementService
from app.services.people_service import PeopleService
from app.services.prompt_service import PromptService
from app.services.feedback_service import FeedbackService


DOWNLOAD_TAG_PATTERN = re.compile(r"\[DOWNLOAD_PDF:[^\]]+\]")


# ═══════════════════════════════════════════════════════════════════════════════
# 1. STATE DEFINITION
# ═══════════════════════════════════════════════════════════════════════════════

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], lambda x, y: x + y]
    domain: Optional[str]
    route_confidence: Optional[float]
    route_reasoning: Optional[str]
    sub_intent: Optional[str]          # granular intent label (e.g. "software_install")
    entities: Optional[dict]           # pre-extracted entities from the user message
    feedback_context: Optional[str]    # injected feedback prompt block
    user_email: Optional[str]          # logged-in user email
    session_id: Optional[str]          # chat thread id, used for pending confirmations


PENDING_IT_EMAIL_DRAFTS: dict[str, dict] = {}


def _draft_key(state: AgentState) -> str:
    return state.get("session_id") or state.get("user_email") or settings.DEFAULT_USER_EMAIL


def _is_confirmation(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in {"yes", "y", "ok", "okay", "confirm", "send", "send it", "yes send it"} or (
        "yes" in normalized and "send" in normalized
    )


def _is_cancellation(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in {"no", "cancel", "stop", "discard", "do not send", "don't send"}


# ═══════════════════════════════════════════════════════════════════════════════
# 2. HR TOOLS
# ═══════════════════════════════════════════════════════════════════════════════

@tool
def get_leave_balance(email: str):
    """Get the current leave balance for an employee."""
    return HRService.get_leave_balance(email)

@tool
def apply_leave(
    email: str,
    start_date: str,
    end_date: str,
    leave_type: str = "Casual",
    reason: str = "Applied via AI Assistant",
):
    """Submit a leave request. Use YYYY-MM-DD format for dates."""
    return HRService.apply_leave(email, start_date, end_date, leave_type, reason)

@tool
def search_hr_policies(query: str):
    """Search HR policy documents for a specific topic."""
    return HRService.search_policies(query)

@tool
def transfer_sharepoint_to_minio(site_name: str, folder_path: str, minio_prefix: str = ""):
    """
    Pull documents from a SharePoint folder and transfer them to MinIO.
    site_name: e.g. 'tenant.sharepoint.com:/sites/SiteName'
    folder_path: e.g. 'Shared Documents/General'
    minio_prefix: Optional prefix for the objects in MinIO
    """
    return sharepoint_transfer_service.transfer_folder_to_minio(site_name, folder_path, minio_prefix)

@tool
def list_minio_documents(prefix: str = ""):
    """
    List all documents currently stored in MinIO.
    prefix: Optional prefix to filter the search.
    """
    from app.minio_client import minio_client
    return minio_client.list_objects(prefix)


# ── HR Employee Directory Tools ──────────────────────────────────────────────

@tool
def search_employee_directory(query: str, function: str = "", location: str = "", designation: str = ""):
    """Search the employee directory by name, skill, function, designation, or location."""
    return EmployeeService.search_directory(
        query=query,
        function=function or None,
        location=location or None,
        designation=designation or None,
    )

@tool
def get_employee_profile(name_or_email: str):
    """Get the full non-sensitive profile for an employee by name or email."""
    return EmployeeService.get_profile(name_or_email)

@tool
def get_org_chart(name_or_email: str):
    """Get the reporting chain (manager above and direct reports below) for an employee."""
    return EmployeeService.get_org_chart(name_or_email)

@tool
def get_team_roster(manager_name: str):
    """List all direct reports for a given manager."""
    return EmployeeService.get_team_roster(manager_name)

@tool
def find_skills_expert(skill: str):
    """Find employees who have a specific skill or expertise."""
    return EmployeeService.find_skills_expert(skill)

@tool
def search_people_directory(query: str):
    """Search employees by name, skill, designation, project, experience, or reporting manager.
    Returns detailed profiles including project history and experience.
    Use this for questions like: 'Who has Python skills?', 'Find senior developers',
    'Who reports to John?', 'List employees with 5+ years experience'."""
    return PeopleService.search_people_text(query)

@tool
def get_department_headcount(function: str = ""):
    """Get headcount of active employees by function/department. Leave function blank for all departments."""
    return EmployeeService.get_department_headcount(function or None)

# ── HR Announcement Tools ─────────────────────────────────────────────────────

@tool
def create_announcement(title: str, body: str, category: str = "General", target_audience: str = "all", expires_days: int = 0):
    """
    Publish a company-wide announcement (HR role only).
    Categories: Policy Update, Holiday, Events, Hiring, Training, General, IT Alert.
    expires_days: 0 = never expires.
    """
    return AnnouncementService.create(
        title=title,
        body=body,
        category=category,
        created_by=settings.DEFAULT_USER_EMAIL,
        created_by_domain="hr",
        target_audience=target_audience,
        expires_days=expires_days if expires_days > 0 else None,
    )

@tool
def get_announcements(domain_filter: str = ""):
    """Get latest active announcements. Optionally filter by domain: hr, admin, it_support, functional_manager."""
    return AnnouncementService.get_active(domain_filter=domain_filter or None)

@tool
def deactivate_announcement(announcement_id: int):
    """Deactivate/remove an announcement by its ID (HR role only)."""
    return AnnouncementService.deactivate(announcement_id, requested_by=settings.DEFAULT_USER_EMAIL)

# ── HR Prompt Config Tool ─────────────────────────────────────────────────────

@tool
def update_hr_prompt(new_prompt: str):
    """Update the HR agent system prompt (HR manager role only)."""
    return PromptService.update_prompt(
        domain="hr",
        prompt_key="system_prompt",
        value=new_prompt,
        updated_by=settings.DEFAULT_USER_EMAIL,
        user_role="hr_manager",
    )


# ── New HR Tools ──────────────────────────────────────────────────────────────

@tool
def get_team_absence(from_date: str = "", to_date: str = ""):
    """Check who in your team is on leave during a date range.
    Dates in YYYY-MM-DD format; leave blank for the current week.
    Use for: 'who is on leave this week', 'team absence next week', 'is anyone off on Monday'."""
    from app.hr_service import HRService
    # user_email is injected by the agent via system prompt; the tool receives it from the LLM call
    # We need a way to get the current user — use settings default here and override in agent call
    return HRService.get_team_absence(settings.DEFAULT_USER_EMAIL, from_date, to_date)


@tool
def get_team_absence_for(manager_email: str, from_date: str = "", to_date: str = ""):
    """Check team absence for a specific manager email. Dates YYYY-MM-DD; blank = current week."""
    from app.hr_service import HRService
    return HRService.get_team_absence(manager_email, from_date, to_date)


@tool
def generate_hr_document(doc_type: str, target_email: str = ""):
    """Generate a downloadable HR document PDF.
    doc_type: 'experience_certificate' or 'expense_summary'.
    target_email: employee email (defaults to current user if blank)."""
    import uuid
    from app.database import SessionLocal
    from app.models import Employee, Leave, Reimbursement
    from app.document_generation.generator import generate_pdf
    from app.document_store import store_pdf

    email = target_email or settings.DEFAULT_USER_EMAIL
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            return f"Employee not found for email: {email}"

        if doc_type == "experience_certificate":
            joining = emp.joining_date.strftime("%d %B %Y") if emp.joining_date else "N/A"
            content = (
                f"To Whom It May Concern\n\n"
                f"This is to certify that {emp.name} has been employed with Aligned Automation "
                f"as {emp.designation or 'an employee'} in the {emp.department or 'N/A'} department "
                f"since {joining}.\n\n"
                f"During their tenure, they have demonstrated professional conduct and commitment. "
                f"We wish them the very best in their future endeavours.\n\n"
                f"Employee ID: {emp.employee_id}\n"
                f"Location: {emp.location or 'N/A'}\n"
                f"Employment Type: {emp.employment_type or 'Full-time'}"
            )
            title = f"Experience Certificate — {emp.name}"

        elif doc_type == "expense_summary":
            reimbursements = db.query(Reimbursement).filter(Reimbursement.employee_id == emp.id).all()
            lines = [f"Expense Summary for {emp.name} ({emp.employee_id})\n"]
            total = 0.0
            for r in reimbursements:
                lines.append(f"- {r.type}: INR {r.amount:,.2f} | Status: {r.status} | Ref #{r.id}")
                if r.status == "Approved":
                    total += r.amount
            lines.append(f"\nTotal Approved: INR {total:,.2f}")
            content = "\n".join(lines)
            title = f"Expense Claim Summary — {emp.name}"

        else:
            return f"Unknown doc_type '{doc_type}'. Supported: experience_certificate, expense_summary."

        pdf_bytes = generate_pdf(doc_type=doc_type, title=title, content=content, generated_by="Centriq HR")
        file_id = str(uuid.uuid4())[:8]
        store_pdf(file_id, pdf_bytes, title.replace(" ", "_"))
        return f"Document ready: **{title}**\n\n[DOWNLOAD_PDF:/api/documents/download/{file_id}:{title}]"
    except Exception as exc:
        return f"Failed to generate document: {exc}"
    finally:
        db.close()


@tool
def submit_grievance(category: str, description: str, is_anonymous: bool = False):
    """Submit an HR grievance or concern.
    category options: Harassment, Discrimination, Safety, Manager Conduct, Compensation, Workplace Culture, Other.
    Set is_anonymous=True to submit without revealing your identity.
    Use for: 'raise a complaint', 'submit grievance', 'report harassment', 'anonymous HR concern'."""
    from app.hr_service import HRService
    return HRService.submit_grievance(settings.DEFAULT_USER_EMAIL, category, description, is_anonymous)


@tool
def submit_grievance_for(employee_email: str, category: str, description: str, is_anonymous: bool = False):
    """Submit a grievance for a given employee email."""
    from app.hr_service import HRService
    return HRService.submit_grievance(employee_email, category, description, is_anonymous)


@tool
def trigger_onboarding_checklist(employee_email: str):
    """Trigger onboarding checklist for a new joiner — emails IT, Admin, and HR with setup tasks.
    HR/Admin role only. Use when a new employee joins."""
    from app.hr_service import HRService
    return HRService.trigger_onboarding(employee_email)


@tool
def trigger_offboarding_checklist(employee_email: str, last_working_day: str = ""):
    """Trigger offboarding checklist for a departing employee — emails manager, IT, Admin, and HR.
    HR/Admin role only. last_working_day in YYYY-MM-DD format."""
    from app.hr_service import HRService
    return HRService.trigger_offboarding(employee_email, last_working_day)


hr_tools = [
    get_leave_balance, apply_leave, search_hr_policies,
    transfer_sharepoint_to_minio, list_minio_documents,
    search_employee_directory, get_employee_profile, get_org_chart,
    get_team_roster, find_skills_expert, get_department_headcount,
    search_people_directory,
    create_announcement, get_announcements, deactivate_announcement,
    update_hr_prompt,
    get_team_absence, get_team_absence_for,
    generate_hr_document,
    submit_grievance, submit_grievance_for,
    trigger_onboarding_checklist, trigger_offboarding_checklist,
]
hr_tool_node = ToolNode(hr_tools)


# ═══════════════════════════════════════════════════════════════════════════════
# 3. LLM INSTANCES
# ═══════════════════════════════════════════════════════════════════════════════
# Agent LLM — used for reasoning and tool calling (HR, PMO, Admin, IT, Manager)
agent_llm = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.AGENT_MODEL_NAME,
    temperature=settings.AGENT_TEMPERATURE,
    max_retries=3,
    timeout=120,
)

# General LLM — used for non-technical chat (Greetings, Announcements)
general_llm_base = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.GENERAL_MODEL_NAME,
    temperature=0.7,
    max_retries=3,
    timeout=30,
)


# Agent LLM with HR tools bound
hr_llm = agent_llm.bind_tools(hr_tools)


summary_llm = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.AGENT_MODEL_NAME,
    temperature=0.3,
    max_retries=3,
    timeout=120,
)



# ═══════════════════════════════════════════════════════════════════════════════
# 4. GRAPH NODES
# ═══════════════════════════════════════════════════════════════════════════════

def intent_router(state: AgentState):
    """Entry node — classifies intent, extracts sub-intent + entities, routes to domain."""
    last_human = None
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            last_human = msg.content
            break

    if not last_human:
        return {"domain": "general", "route_confidence": 0.0, "route_reasoning": "No user message found",
                "sub_intent": "unknown", "entities": {}}

    draft_key = _draft_key(state)
    if draft_key in PENDING_IT_EMAIL_DRAFTS:
        if _is_confirmation(last_human):
            return {
                "domain": "it_support",
                "route_confidence": 1.0,
                "route_reasoning": "User confirmed a pending IT email draft.",
                "sub_intent": "software_install_confirm",
                "entities": {},
            }
        if _is_cancellation(last_human):
            return {
                "domain": "it_support",
                "route_confidence": 1.0,
                "route_reasoning": "User cancelled a pending IT email draft.",
                "sub_intent": "software_install_cancel",
                "entities": {},
            }

    if "five project name" in last_human.lower():
        return {"domain": "dummy_test", "route_confidence": 1.0, "route_reasoning": "Testing trigger detected.",
                "sub_intent": "test", "entities": {}}

    try:
        result = classify_intent(last_human)
        print(
            f"[Router] Domain: {result['domain']} | Confidence: {result['confidence']:.2f} "
            f"| Sub-intent: {result.get('sub_intent', '?')} | Entities: {result.get('entities', {})}"
        )
    except APIConnectionError:
        return {"domain": "general", "route_confidence": 0.5, "route_reasoning": "LLM connection failed.",
                "sub_intent": "unknown", "entities": {}}

    return {
        "domain": result["domain"],
        "route_confidence": result["confidence"],
        "route_reasoning": result["reasoning"],
        "sub_intent": result.get("sub_intent", "unknown"),
        "entities": result.get("entities", {}),
    }


def feedback_lookup(state: AgentState) -> dict:
    """Fetch relevant past feedback for the current query and store as prompt context."""
    domain = state.get("domain", "unknown") or "unknown"
    last_human = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
        "",
    )
    try:
        relevant = FeedbackService.get_relevant_feedback(domain, last_human, limit=3)
        ctx = FeedbackService.build_feedback_prompt(relevant)
    except Exception:
        ctx = ""
    return {"feedback_context": ctx}


def hr_agent(state: AgentState):
    """HR Agent — handles leave and policies."""
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    messages = state["messages"]
    if not any(isinstance(m, SystemMessage) for m in messages):
        base = PromptService.get_system_prompt(
            "hr",
            f"You are Centriq HR Assistant for Aligned Automation.\n"
            f"The logged-in employee's email is: {user_email}. NEVER ask who the user is.\n\n"
            f"DIRECT ACTION RULES — Act immediately when intent is clear:\n"
            f"1. Leave balance: → call get_leave_balance(email='{user_email}').\n"
            f"2. Apply leave: → call apply_leave(email='{user_email}', ...). Infer leave_type (default Casual). "
            f"Manager gets an email to approve/reject via clickable link.\n"
            f"3. Policy question: → call search_hr_policies. Always cite the policy name and last-updated date in your answer.\n"
            f"4. Employee search: → call search_employee_directory.\n"
            f"5. Org chart / team: → call get_org_chart or get_team_roster.\n"
            f"6. Team absence / 'who is on leave': → call get_team_absence_for(manager_email='{user_email}', ...).\n"
            f"7. Generate document ('experience certificate', 'expense summary'): → call generate_hr_document(target_email='{user_email}', doc_type=...).\n"
            f"8. Raise grievance / complaint: → call submit_grievance_for(employee_email='{user_email}', ...). "
            f"Ask for category and description if missing; ask if they want to be anonymous.\n"
            f"9. Onboarding checklist for new joiner: → call trigger_onboarding_checklist(employee_email=...).\n"
            f"10. Offboarding checklist for departing employee: → call trigger_offboarding_checklist(employee_email=..., last_working_day=...).\n\n"
            f"RESPONSE STYLE: Act first. Only ask when a REQUIRED parameter is truly missing. "
            f"Never answer from training knowledge — use tools only.",
        )
        guardrail = PromptService.get_guardrail("hr")
        feedback_ctx = state.get("feedback_context") or ""
        messages = [SystemMessage(content=base + guardrail + feedback_ctx)] + messages

    try:
        response = hr_llm.invoke(messages)
    except APIConnectionError:
        return {"messages": [AIMessage(content="I'm sorry, the HR system is currently unreachable.")]}

    return {"messages": [response]}

async def pmo_agent_node(state: AgentState):
    """PMO Agent - handles project and report requests."""
    result = await pmo_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": state.get("feedback_context") or "",
        "sub_intent": state.get("sub_intent") or "",
        "entities": state.get("entities") or {},
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process PMO request."))
    return {"messages": [last_ai]}


async def admin_agent_node(state: AgentState):
    """Admin Agent - handles reimbursement, parking, etc."""
    result = await admin_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": state.get("feedback_context") or "",
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process Admin request."))
    return {"messages": [last_ai]}


async def it_agent_node(state: AgentState):
    """IT Agent - handles software install, tickets, etc."""
    entities = state.get("entities") or {}
    sub_intent = state.get("sub_intent") or ""
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    draft_key = _draft_key(state)

    if sub_intent == "software_install_confirm":
        draft = PENDING_IT_EMAIL_DRAFTS.get(draft_key)
        if not draft:
            return {"messages": [AIMessage(content="I do not have a pending IT email draft to send. Please start the software install request again.")]}
        response = ITService.send_software_install_request(user_email, draft["software_name"])
        PENDING_IT_EMAIL_DRAFTS.pop(draft_key, None)
        return {"messages": [AIMessage(content=response)]}

    if sub_intent == "software_install_cancel":
        PENDING_IT_EMAIL_DRAFTS.pop(draft_key, None)
        return {"messages": [AIMessage(content="No problem. I discarded the pending IT email draft and did not send anything.")]}

    if sub_intent == "software_install":
        software_name = (
            entities.get("software_name")
            or entities.get("software")
            or entities.get("application")
            or entities.get("app")
        )
        if software_name:
            PENDING_IT_EMAIL_DRAFTS[draft_key] = {"software_name": str(software_name)}
            return {"messages": [AIMessage(content=ITService.request_software_install(user_email, str(software_name)))]}

    entity_hint = ""
    if entities:
        entity_hint = f"\n[Router extracted: sub_intent={sub_intent}, entities={entities}]"
    result = await it_agent.ainvoke({
        "messages": state["messages"],
        "user_email": user_email,
        "feedback_context": (state.get("feedback_context") or "") + entity_hint,
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process IT request."))
    return {"messages": [last_ai]}


async def manager_agent_node(state: AgentState):
    """Manager Agent - handles team approvals, assignments, etc."""
    result = await manager_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": state.get("feedback_context") or "",
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process Manager request."))
    return {"messages": [last_ai]}


general_tools = [get_announcements, search_hr_policies]
general_tool_node = ToolNode(general_tools)
general_llm = general_llm_base.bind_tools(general_tools)


def general_agent(state: AgentState):
    """General Agent — greetings, announcements, and policy Q&A."""
    base = PromptService.get_system_prompt(
        "general",
        "You are Centriq, the AI assistant for Aligned Automation. "
        "You handle greetings, small talk, company announcements, and general HR policy questions. "
        "You have two tools: get_announcements (call with no arguments to fetch all active company announcements) "
        "and search_hr_policies (search for policy details by topic). "
        "Always call get_announcements when the user asks about news, updates, or announcements. "
        "Always call search_hr_policies when the user asks about a policy. "
        "For all other domain questions (leave, parking, IT tickets, projects), direct the user to the right team. "
        "IMPORTANT: Do NOT answer company-specific questions from your own knowledge — use tools only.",
    )
    guardrail = PromptService.get_guardrail("general")
    feedback_ctx = state.get("feedback_context") or ""
    messages = [SystemMessage(content=base + guardrail + feedback_ctx)] + state["messages"]
    try:
        response = general_llm.invoke(messages)
    except APIConnectionError:
        return {"messages": [AIMessage(content="I'm sorry, I'm having trouble connecting right now.")]}
    return {"messages": [response]}


def should_continue_general(state: AgentState):
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "general_tools"
    return END


def dummy_test_agent(state: AgentState):
    """Dummy Agent — returns fixed data for testing."""
    dummy_projects = ["1. Centriq AI", "2. Aurora UI", "3. HR Integration", "4. Admin Dashboard", "5. IT Support Agent"]
    response = "Here are five project names for testing:\n\n" + "\n".join(dummy_projects)
    return {"messages": [AIMessage(content=response)]}


def placeholder_agent(state: AgentState):
    """Placeholder for domains that are not yet implemented."""
    domain = state.get("domain", "unknown")
    return {"messages": [AIMessage(content=get_placeholder_response(domain))]}


def summarizer(state: AgentState):
    """Converts tool results to natural language, preserving download tags."""
    tool_message = state["messages"][-1]
    tool_output = tool_message.content if hasattr(tool_message, "content") else str(tool_message)
    
    # Use HumanMessage as some models (like llama3.2) return empty for SystemMessage-only prompts
    prompt = [
        HumanMessage(content=f"""You are an HR Assistant. Summarize this tool result for the employee.
        
TOOL RESULT:
{tool_output}

INSTRUCTIONS:
1. Provide a concise, friendly summary of the result.
2. IMPORTANT: If and ONLY IF the tool result contains a tag like [DOWNLOAD_PDF:url:title], include it exactly at the end.
3. If no such tag is present in the TOOL RESULT above, DO NOT make one up or add any links.
4. Do not include any JSON, curly braces, or technical metadata in your response.
""")
    ]
    try:
        response = summary_llm.invoke(prompt)
        content = response.content.strip()
        
        # Fallback if content is empty or model hallucinated the example tag
        if not content or "[DOWNLOAD_PDF:url:title]" in content:
            content = f"I've retrieved the information for you: {tool_output}"
            
        return {"messages": [AIMessage(content=content)]}
    except Exception as e:
        return {"messages": [AIMessage(content=f"The operation was successful, but I had trouble summarizing the result: {tool_output}")]}



# ═══════════════════════════════════════════════════════════════════════════════
# 5. ROUTING LOGIC
# ═══════════════════════════════════════════════════════════════════════════════

def route_to_agent(state: AgentState):
    domain = state.get("domain", "general")
    status = get_domain_status(domain)
    if domain == "pmo": return "pmo_agent"
    if domain == "admin": return "admin_agent"
    if domain == "it_support": return "it_agent"
    if domain == "functional_manager": return "manager_agent"
    if domain == "dummy_test": return "dummy_test_agent"
    if status == "placeholder": return "placeholder_agent"
    if domain == "hr": return "hr_agent"
    return "general_agent"

def should_continue_hr(state: AgentState):
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "hr_tools"
    return END


# ═══════════════════════════════════════════════════════════════════════════════
# 6. CHECKPOINTER
# ═══════════════════════════════════════════════════════════════════════════════

checkpointer = MemorySaver()
try:
    import redis.asyncio as aioredis
    from langgraph.checkpoint.redis.aio import AsyncRedisSaver
    if not settings.USE_MEMORY_SAVER:
        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=False)
        checkpointer = AsyncRedisSaver(redis_client=redis_client)
except Exception as e:
    print(f"Redis initialization failed: {e}. Using MemorySaver.")


# ═══════════════════════════════════════════════════════════════════════════════
# 7. BUILD THE LANGGRAPH
# ═══════════════════════════════════════════════════════════════════════════════

workflow = StateGraph(AgentState)

workflow.add_node("intent_router", intent_router)
workflow.add_node("feedback_lookup", feedback_lookup)
workflow.add_node("hr_agent", hr_agent)
workflow.add_node("pmo_agent", pmo_agent_node)
workflow.add_node("admin_agent", admin_agent_node)
workflow.add_node("it_agent", it_agent_node)
workflow.add_node("manager_agent", manager_agent_node)
workflow.add_node("general_agent", general_agent)
workflow.add_node("general_tools", general_tool_node)
workflow.add_node("dummy_test_agent", dummy_test_agent)
workflow.add_node("placeholder_agent", placeholder_agent)
workflow.add_node("hr_tools", hr_tool_node)
workflow.add_node("summarizer", summarizer)

workflow.set_entry_point("intent_router")
workflow.add_edge("intent_router", "feedback_lookup")
workflow.add_conditional_edges("feedback_lookup", route_to_agent)
workflow.add_conditional_edges("hr_agent", should_continue_hr)
workflow.add_conditional_edges("general_agent", should_continue_general)
workflow.add_edge("hr_tools", "summarizer")
workflow.add_edge("general_tools", "general_agent")
workflow.add_edge("summarizer", END)
workflow.add_edge("pmo_agent", END)
workflow.add_edge("admin_agent", END)
workflow.add_edge("it_agent", END)
workflow.add_edge("manager_agent", END)
workflow.add_edge("dummy_test_agent", END)
workflow.add_edge("placeholder_agent", END)

app_agent = workflow.compile(checkpointer=checkpointer)
