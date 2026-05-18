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
def search_employee_directory(query: str, function: str = "", designation: str = ""):
    """Search the employee directory by name, skill, function, or designation."""
    return EmployeeService.search_directory(
        query=query,
        function=function or None,
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

# General LLM — uses the same tool-capable agent model (GENERAL_MODEL_NAME does not support tools)
general_llm_base = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.AGENT_MODEL_NAME,
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

_STICKY_DOMAINS = {"hr", "admin", "it_support", "pmo", "functional_manager"}


def _last_ai_message(messages: list) -> str:
    """Return the content of the most recent AIMessage, or empty string."""
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            return msg.content or ""
    return ""


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

    # Sticky domain: keep the same domain for follow-up messages that reference prior context.
    # Triggers on: (a) short reply to an agent question, OR (b) short message with context-reference
    # words after a substantive AI answer (e.g. "is there any timeline for applying it").
    existing_domain = state.get("domain")
    if existing_domain in _STICKY_DOMAINS:
        last_ai = _last_ai_message(state.get("messages", []))
        msg_len = len(last_human.strip())
        _CONTEXT_REFS = {"it", "that", "this", "those", "these", "same", "the", "about", "any"}
        _QUESTION_PHRASES = {
            "could you", "can you", "please provide", "please share", "let me know",
            "what is", "which floor", "which area", "what type", "please tell",
            "kindly", "may i know", "please mention", "please specify",
        }
        last_ai_lower = last_ai.lower()
        words = set(last_human.lower().split())
        ai_asked = "?" in last_ai or any(p in last_ai_lower for p in _QUESTION_PHRASES)
        is_agent_question_reply = ai_asked and msg_len < 120
        is_context_followup = bool(words & _CONTEXT_REFS) and msg_len < 200 and len(last_ai) > 30
        # Very short messages (<60 chars) after any substantive AI response are almost always follow-ups
        is_very_short_followup = msg_len < 60 and len(last_ai) > 30
        if is_agent_question_reply or is_context_followup or is_very_short_followup:
            reason = "follow-up to agent question" if is_agent_question_reply else "short/context follow-up"
            print(f"[Router] Sticky domain: {existing_domain} ({reason})")
            return {
                "domain": existing_domain,
                "route_confidence": 0.95,
                "route_reasoning": f"Follow-up in context of {existing_domain} — staying sticky.",
                "sub_intent": "followup",
                "entities": {},
            }

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
            f"2. Apply leave: → call apply_leave(email='{user_email}', start_date, end_date, leave_type). "
            f"Infer leave_type (default Casual). DO NOT ask for reason — it defaults to 'Applied via AI Assistant'. "
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
            f"Never answer from training knowledge — use tools only.\n\n"
            f"CONVERSATION MEMORY RULES:\n"
            f"- Always read the FULL conversation history before responding.\n"
            f"- If the user refers to something mentioned earlier ('that policy', 'same dates', 'as I said'), look it up in prior messages.\n"
            f"- NEVER ask for information the user already provided in this conversation.\n"
            f"- NEVER repeat a question already asked in this conversation.\n\n"
            f"FOLLOW-UP FOCUS RULE:\n"
            f"- When the user asks a specific follow-up about a tool result already in the conversation, answer ONLY that point in 1-3 lines.\n"
            f"- Do NOT re-list the full policy/balance/document. Extract the specific detail asked.\n"
            f"- Be precise: 'timeline to submit' ≠ 'timeline to receive'. If policy only mentions one, say the other is not specified.\n\n"
            f"GRIEVANCE DATA COLLECTION (strict multi-turn — follow this order):\n"
            f"Step 1 — Infer category from message. Valid: Harassment, Discrimination, Safety, Manager Conduct, Compensation, Workplace Culture, Other.\n"
            f"Step 2 — If description missing → ask ONLY: 'Could you describe what happened?'\n"
            f"Step 3 — After description provided → ask ONLY: 'Would you like to remain anonymous?'\n"
            f"Step 4 — ONLY after category + description + anonymity are all confirmed → call submit_grievance_for.\n"
            f"NEVER skip step 3. NEVER call the tool before the user has answered the anonymity question.\n"
            f"NEVER call the tool with empty or placeholder description.\n\n"
            f"OUTPUT FORMATTING:\n"
            f"- NEVER output markdown tables (no | pipe characters).\n"
            f"- NEVER output HTML tags.\n"
            f"- Use plain bullet points (- ) or numbered lists (1. 2. 3.) only.",
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


_ADMIN_POLICY_KEYWORDS = {"policy", "reimbursement", "reimburse", "claim", "expense", "certification", "travel", "medical"}


async def admin_agent_node(state: AgentState):
    """Admin Agent - handles reimbursement, parking, etc."""
    sub_intent = state.get("sub_intent") or ""
    entities = state.get("entities") or {}
    feedback_ctx = state.get("feedback_context") or ""

    # Execute-first for policy queries: search embeddings/chunks at Python level,
    # avoiding an unreliable LLM tool-calling round-trip.
    if "policy" in sub_intent:
        topic = (
            entities.get("policy_topic")
            or entities.get("topic")
            or next((m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "")
        )
        policy_result = HRService.search_policies(str(topic), limit=2)
        if policy_result and "No policies found" not in policy_result:
            feedback_ctx = f"[PRE-SEARCHED POLICY]\n{policy_result}\n[END POLICY]\n\n{feedback_ctx}"
        else:
            feedback_ctx = (
                f"[POLICY SEARCH RESULT]\nNo policy found for: '{topic}'. "
                f"Tell the user no policy was found and suggest contacting the Admin team "
                f"or raising it via Zoho (expense.zoho@alignedautomation.com).\n[END]\n\n{feedback_ctx}"
            )
    elif sub_intent == "followup":
        # For follow-up questions, re-inject raw policy text if prior conversation was policy-related.
        # The parent graph only persists the last AIMessage per turn, so the LLM only sees a
        # summarized response — not the raw policy. Re-searching lets it extract specific details
        # (e.g. "timeline to submit") that may have been omitted from the summary.
        human_msgs = [m for m in state["messages"] if isinstance(m, HumanMessage)]
        prior_text = " ".join(m.content for m in human_msgs[:-1]).lower()
        if any(kw in prior_text for kw in _ADMIN_POLICY_KEYWORDS):
            original_topic = next(
                (m.content for m in state["messages"]
                 if isinstance(m, HumanMessage) and any(kw in m.content.lower() for kw in _ADMIN_POLICY_KEYWORDS)),
                "",
            )
            if original_topic:
                policy_result = HRService.search_policies(str(original_topic), limit=2)
                if policy_result and "No policies found" not in policy_result:
                    feedback_ctx = f"[PRE-SEARCHED POLICY]\n{policy_result}\n[END POLICY]\n\n{feedback_ctx}"

    result = await admin_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": feedback_ctx,
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
        "You handle greetings, small talk, company announcements, and general policy questions. "
        "You have two tools: get_announcements (fetch all active announcements) "
        "and search_hr_policies (search for policy details by topic). "
        "Always call get_announcements when the user asks about news, updates, or announcements. "
        "Always call search_hr_policies when the user asks about a policy — use tools first, never guess. "
        "If the user asks a follow-up about a policy already discussed, answer from the conversation history — extract only the specific detail asked, do NOT re-summarize the full policy. "
        "Be precise: 'timeline to submit' (submission deadline) and 'timeline to receive/release' (processing time) are different — if the policy only mentions one, say so rather than substituting the other. "
        "Only suggest contacting the HR or Admin team if the tools return no results. "
        "Do NOT offer further assistance or solicit next actions unless the user asks. "
        "CONVERSATION MEMORY RULES: Always read the FULL conversation history before responding. "
        "If the user refers to something mentioned earlier ('it', 'that policy', 'the timeline'), look it up in prior messages. "
        "NEVER ask for information the user already provided. NEVER repeat a question already asked. "
        "OUTPUT FORMATTING: NEVER output markdown tables (no | pipe characters). "
        "NEVER output HTML tags. Use plain bullet points (- ) or numbered lists only. "
        "Keep responses concise — answer what was asked, do not re-summarize the full policy if a specific detail was requested.",
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
