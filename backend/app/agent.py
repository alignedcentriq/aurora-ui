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
from app.router import classify_intent, classify_intent_async, get_domain_status, get_placeholder_response
from app.agents.pmo_agent import pmo_agent
from app.agents.admin_agent import admin_agent
from app.agents.it_agent import it_agent
from app.agents.manager_agent import manager_agent
from app.agents.deeplink_agent import get_deeplink_agent
from app.agents.ms365_agent import ms365_agent
from app.services.it_service import ITService
from app.services.employee_service import EmployeeService
from app.services.announcement_service import AnnouncementService
from app.services.people_service import PeopleService
from app.services.prompt_service import PromptService
from app.services.feedback_service import FeedbackService


DOWNLOAD_TAG_PATTERN = re.compile(r"\[DOWNLOAD_PDF:[^\]]+\]")


# ── Zoho Leave Fast-Path ───────────────────────────────────────────────────────
# Bypasses all LLM calls for standard leave requests (0 LLM = <2s response).

_FP_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2,
    "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5,
    "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}
_FP_LEAVE_TYPES = [
    (re.compile(r'\b(sick|sl|medical)\b', re.I), "Sick"),
    (re.compile(r'\b(earned|el|annual)\b', re.I), "Earned"),
    (re.compile(r'\b(optional|ol)\b', re.I), "Optional"),
    (re.compile(r'\b(casual|cl)\b', re.I), "Casual"),
]
_FP_INTENT_RE = re.compile(
    r'\b(apply|book|take|want|need|request|submit)\b.*?\bleave\b',
    re.IGNORECASE | re.DOTALL,
)
_FP_MN = (
    r'(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?'
    r'|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
)
_FP_DN = r'\d{1,2}(?:st|nd|rd|th)?'
_FP_DATE = r'(?:\d{4}-\d{2}-\d{2}|' + _FP_DN + r'\s+' + _FP_MN + r'|' + _FP_MN + r'\s+' + _FP_DN + r')'
_FP_RANGE_RE = re.compile(
    r'(?:from\s+)?(' + _FP_DATE + r')\s+to\s+(' + _FP_DATE + r'|\d{1,2}(?:st|nd|rd|th)?)',
    re.IGNORECASE,
)


def _fp_parse_month(s: str) -> int:
    s = s.lower().strip()
    return _FP_MONTHS.get(s) or _FP_MONTHS.get(s[:3]) or 0


def _fp_parse_date(token: str, fallback_month: int = 0, year: int = 2026) -> str:
    token = re.sub(r'(\d+)(?:st|nd|rd|th)', r'\1', token.strip())
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', token)
    if m:
        return token
    m = re.match(r'^(\d{1,2})\s+([a-zA-Z]+)$', token)
    if m:
        mo = _fp_parse_month(m.group(2))
        if mo:
            return f"{year}-{mo:02d}-{int(m.group(1)):02d}"
    m = re.match(r'^([a-zA-Z]+)\s+(\d{1,2})$', token)
    if m:
        mo = _fp_parse_month(m.group(1))
        if mo:
            return f"{year}-{mo:02d}-{int(m.group(2)):02d}"
    m = re.match(r'^(\d{1,2})$', token)
    if m and fallback_month:
        return f"{year}-{fallback_month:02d}-{int(m.group(1)):02d}"
    return ""


def _try_extract_leave_params(message: str) -> Optional[dict]:
    """Return leave params dict if the message is a clear Zoho leave request; None otherwise."""
    if not _FP_INTENT_RE.search(message):
        return None
    m = _FP_RANGE_RE.search(message)
    if not m:
        return None
    start_date = _fp_parse_date(m.group(1).strip(), year=2026)
    if not start_date:
        return None
    fallback_month = int(start_date.split("-")[1])
    end_date = _fp_parse_date(m.group(2).strip(), fallback_month=fallback_month, year=2026)
    if not end_date:
        return None
    leave_type = "Casual"
    for pattern, lt in _FP_LEAVE_TYPES:
        if pattern.search(message):
            leave_type = lt
            break
    return {"start_date": start_date, "end_date": end_date, "leave_type": leave_type, "reason": ""}


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
    conversation_summary: Optional[str]  # rolling summary of older turns (context manager)
    user_role: Optional[str]           # "employee" | "hr" | "admin" | "manager" | "it" | "pmo"
    graph_token: Optional[str]         # user's delegated Microsoft Graph token (from frontend)
    user_location: Optional[str]       # detected from M365 profile (officeLocation / city)


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


# ── Location helper ──────────────────────────────────────────────────────────

def _location_prefix(state: "AgentState") -> str:
    """Return a one-line location block to prepend to feedback_context, or '' if unknown."""
    loc = state.get("user_location")
    return f"[User office location: {loc}]\n" if loc else ""


# ── Role Instructions ─────────────────────────────────────────────────────────

ROLE_INSTRUCTIONS = {
    "employee":   "You are serving a regular employee. Expose only their own records — never other employees' data.",
    "hr":         "You are serving an HR manager. You may access and display aggregate employee data, all leave records, and HR reports.",
    "admin":      "You are serving an Office Admin. You have full cross-domain read/write access for admin operations.",
    "manager":    "You are serving a functional manager. You may access your direct reports' data only.",
    "it":         "You are serving an IT manager. You may view all IT tickets, assets, software requests, and licenses.",
    "pmo":        "You are serving a PMO manager. You may view and edit all project data, allocations, and training licenses.",
}


def _get_role_instruction(state: AgentState) -> str:
    """Return a role-awareness string to append to agent system prompts."""
    role = (state.get("user_role") or "employee").lower()
    return ROLE_INSTRUCTIONS.get(role, ROLE_INSTRUCTIONS["employee"])


def _save_conversation_summary(thread_id: str, summary: str, domain: Optional[str]) -> None:
    """Persist rolling conversation summary to DB for durability across Redis restarts."""
    try:
        from app.database import SessionLocal
        from app.models import ConversationSummary
        import datetime
        db = SessionLocal()
        try:
            existing = db.query(ConversationSummary).filter(ConversationSummary.thread_id == thread_id).first()
            if existing:
                existing.summary = summary
                existing.domain = domain
                existing.updated_at = datetime.datetime.utcnow()
            else:
                db.add(ConversationSummary(thread_id=thread_id, summary=summary, domain=domain))
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[context_manager] Failed to persist summary: {e}")


async def context_manager_node(state: AgentState) -> dict:
    """Rolling window + summarization node.

    When the conversation grows beyond ~6000 tokens, this node:
    1. Summarizes all but the last 6 messages via LLM
    2. Injects the summary into feedback_context (already prepended to every agent's system prompt)
    3. Persists the summary to conversation_summaries table for durability across Redis restarts

    NOTE: Does NOT modify the messages list directly — LangGraph's reducer appends rather than
    replaces, so summary is injected via feedback_context instead.
    """
    messages = state.get("messages", [])
    total_tokens = sum(len(getattr(m, "content", "") or "") // 4 for m in messages)

    if total_tokens <= 6000 or len(messages) <= 8:
        return {}

    to_summarize = messages[:-6]  # everything except the last 3 turns

    summary_prompt = (
        "Summarize this conversation history in 3-5 sentences. "
        "Preserve: key facts, dates, employee names, leave types, ticket IDs, "
        "requests made, and decisions reached. Be concise and factual."
    )
    try:
        summary_response = await summary_llm.ainvoke(
            [
                SystemMessage(content=summary_prompt),
                HumanMessage(content="\n".join(
                    f"{m.type}: {getattr(m, 'content', '')}" for m in to_summarize
                )),
            ]
        )
        summary_text = summary_response.content.strip()
        if not summary_text:
            return {}
    except Exception as e:
        print(f"[context_manager] Summarization failed: {e}")
        return {}

    session_id = state.get("session_id")
    if session_id:
        # Fire-and-forget: don't block the pipeline on a DB write
        import asyncio as _asyncio
        _asyncio.get_event_loop().run_in_executor(
            None, _save_conversation_summary, session_id, summary_text, state.get("domain")
        )

    # Inject summary as a prefix to feedback_context — all agents append this to their system prompt
    existing_feedback = state.get("feedback_context") or ""
    updated_feedback = (
        f"[CONVERSATION SUMMARY — earlier turns compressed]:\n{summary_text}\n\n{existing_feedback}"
    )
    print(f"[context_manager] Summarized {len(to_summarize)} old messages ({total_tokens} tokens → summary)")
    return {
        "conversation_summary": summary_text,
        "feedback_context": updated_feedback,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 2. HR TOOLS
# ═══════════════════════════════════════════════════════════════════════════════

@tool
def get_leave_balance(email: str):
    """Get current leave balance. Call with the logged-in user's email. Never ask for email."""
    return HRService.get_leave_balance(email)

@tool
def apply_leave(
    email: str,
    start_date: str,
    end_date: str,
    leave_type: str = "Casual",
    reason: str = "Applied via AI Assistant",
):
    """Submit a leave request. Infer leave_type from context (default Casual). Dates in YYYY-MM-DD.
    Do NOT ask for reason — defaults to 'Applied via AI Assistant'. Manager gets email to approve/reject."""
    return HRService.apply_leave(email, start_date, end_date, leave_type, reason)

@tool
def search_hr_policies(query: str):
    """Search HR policy documents. Call for any policy question. Answer from the result only.
    State policy name once. Never include metadata (author, version, review dates)."""
    return HRService.search_policies(query, limit=4)


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
    """Submit an HR grievance. STRICT multi-turn flow — do NOT call until all 3 are confirmed:
    1. category: infer from message (Harassment, Discrimination, Safety, Manager Conduct, Compensation, Workplace Culture, Other)
    2. description: ask 'Could you describe what happened?' if not provided
    3. is_anonymous: ask 'Would you like to remain anonymous?' — NEVER skip this step
    Only call after user confirms all three. Never call with empty description."""
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


@tool
def submit_hr_query(
    email: str,
    category: str,
    subject: str,
    description: str,
):
    """Submit an HR query when the employee's question CANNOT be answered by
    existing policies, OR when it requires HR to take an action (generate letter,
    update records, process claim, etc.).

    DO NOT call this tool if the answer is available in company policies.
    ALWAYS search policies first before calling this tool.
    ASK the employee for confirmation before submitting.

    Categories: Attendance Query, General Query, Insurance Query, Leave Query,
    Notice Period Query, PF Query, Proof Letter Query, Compensation & Tax Query,
    Resignation Query."""
    from app.hr_service import HRService
    return HRService.submit_hr_query(email, category, subject, description)


hr_tools = [
    get_leave_balance, apply_leave, search_hr_policies,
    search_employee_directory, get_employee_profile, get_org_chart,
    get_team_roster, find_skills_expert, get_department_headcount,
    search_people_directory,
    create_announcement, get_announcements, deactivate_announcement,
    update_hr_prompt,
    get_team_absence, get_team_absence_for,
    generate_hr_document,
    submit_grievance, submit_grievance_for,
    trigger_onboarding_checklist, trigger_offboarding_checklist,
    submit_hr_query,
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
    max_retries=2,
    timeout=45,
)

# General LLM — lighter qwen2.5:14b for greetings/small talk/announcements
general_llm_base = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.FAST_MODEL_NAME,
    temperature=0.7,
    max_retries=2,
    timeout=20,
)


# Agent LLM with HR tools bound
hr_llm = agent_llm.bind_tools(hr_tools)


summary_llm = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.FAST_MODEL_NAME,
    temperature=0.3,
    max_retries=2,
    timeout=20,
)



# ═══════════════════════════════════════════════════════════════════════════════
# 3b. KEYWORD FAST-PATH ROUTER (0 LLM calls — saves 20-60s per request)
# ═══════════════════════════════════════════════════════════════════════════════
# For queries with clear, unambiguous intent, skip the LLM router entirely.
# Only matches patterns where misclassification risk is negligible.
# Ambiguous queries still fall through to the LLM router.

_KW_GREETING = re.compile(
    r'^\s*(hi|hello|hey|hola|namaste|yo|sup|'
    r'good\s+(morning|afternoon|evening|night)|'
    r'thanks|thank\s+you|bye|goodbye|see\s+you|'
    r'how\s+are\s+you|what\'?s\s+up|what\s+can\s+you\s+do|'
    r'who\s+are\s+you)'
    r'[!.?\s]*$', re.I
)

_KW_HR_POLICY = re.compile(
    r'\b(leave\s+policy|hr\s+policy|attendance\s+policy|wfh\s+policy|'
    r'work\s+from\s+home\s+policy|posh\s+policy|sexual\s+harassment|'
    r'maternity\s+(leave|policy)|paternity\s+(leave|policy)|'
    r'probation\s+(policy|period|confirmation)|comp[- ]?off\s+policy|'
    r'holiday\s+(list|calendar|policy)|appraisal\s+policy|'
    r'referral\s+bonus|onboarding\s+policy|offboarding\s+policy|'
    r'gratuity\s+policy|variable\s+pay\s+policy|'
    r'sabbatical\s+policy|relocation\s+policy)\b', re.I
)

_KW_HR_DOC = re.compile(
    r'\b(experience\s+certificate|generate\s+.{0,15}(certificate|letter|noc)|'
    r'relieving\s+letter|salary\s+certificate|noc\s+for)\b', re.I
)

_KW_HR_GRIEVANCE = re.compile(
    r'\b(grievance|submit\s+grievance|report\s+harassment|'
    r'hr\s+complaint|anonymous\s+complaint)\b', re.I
)

_KW_HR_PEOPLE = re.compile(
    r'\b(employee\s+directory|org\s+chart|department\s+headcount|'
    r'who\s+is\s+\w+\s+\w+|find\s+(employee|person|people)\s+with|'
    r'who\s+has\s+\w+\s+skills?)\b', re.I
)

_KW_ADMIN_REIMB = re.compile(
    r'\b(reimburs\w*|expense\s+(policy|claim|process|limit)|'
    r'claim\s+(policy|process)|certification\s+reimburs|'
    r'travel\s+reimburs|medical\s+reimburs|'
    r'how\s+(to|can\s+i)\s+(claim|reimburse|raise\s+reimburs))\b', re.I
)

_KW_ADMIN_PARKING = re.compile(
    r'\b(parking\s+(sticker|pass|request|info)|'
    r'register\s+(my\s+)?(vehicle|bike|car|two[- ]?wheeler|four[- ]?wheeler)|'
    r'surrender\s+parking)\b', re.I
)

_KW_ADMIN_FACILITY = re.compile(
    r'\b(ac\s+(not|isn\'?t|is\s+not)|air\s+condition\w*\s+(not|broken|issue)|'
    r'lights?\s+(not|broken|flickering)|plumbing\s+(issue|leak|broken)|'
    r'washroom\s+(dirty|issue|problem)|electrical\s+(issue|problem)|'
    r'housekeeping|facility\s+complaint|furniture\s+(broken|damaged)|'
    r'lift\s+(not|broken|stuck)|elevator\s+(not|broken))\b', re.I
)

_KW_ADMIN_FOOD = re.compile(
    r'\b(food\s+(complaint|quality|hygiene)|cafeteria\s+(complaint|issue)|'
    r'foreign\s+object\s+in\s+food|food\s+vendor|rate\s+.{0,20}(vendor|food))\b', re.I
)

_KW_ADMIN_ACCOM = re.compile(
    r'\b(book\s+(guest\s+house|hotel|accommodation)|'
    r'guest\s+house\s+(booking|request)|corporate\s+accommodation)\b', re.I
)

_KW_ADMIN_DESK = re.compile(r'\b(desk\s+key|key\s+for\s+desk)\b', re.I)

_KW_BOOKSHELF = re.compile(
    r'\b(bookshelf|book\s*shelf|borrow\s+a?\s*book|issue\s+a?\s*book|'
    r'return\s+a?\s*book|company\s+library|office\s+library|'
    r'available\s+books?|books?\s+available|book\s+request|request\s+a?\s*book|'
    r'lend\s+me\s+a\s+book|check\s+(?:my\s+)?book\s+request)\b',
    re.I,
)

_KW_IT_HARDWARE = re.compile(
    r'\b(laptop|system|computer|device|machine|workstation)\s+'
    r'(is\s+)?(slow|hanging|crashing|overheating|heating|hot|'
    r'not\s+(working|starting|responding)|frozen|freezing|'
    r'restarting|blue\s+screen|lagging|noisy|fan\s+loud)\b', re.I
)

_KW_IT_TICKETS = re.compile(r'\bmy\s+(it\s+)?(tickets?|requests?|issues?)\b', re.I)
_KW_IT_ASSETS = re.compile(r'\bmy\s+(it\s+)?(assets?|equipment|devices?)\b', re.I)
_KW_IT_CREATE = re.compile(r'\b(create|raise|log|open)\s+(a\s+|an\s+)?(it\s+)?ticket\b', re.I)
# Strong, install-specific verbs — safe to fire on their own.
# The negative lookahead rejects determiner/infinitive phrasing ("install the app
# for me" stays, but a bare "a/an/the/to <noun>" is never a product name).
_KW_IT_INSTALL = re.compile(
    r'\b(?:install|re-?install|setup|set\s+up)\s+'
    r'(?!(?:a|an|the|to|some|my|our|your|another)\b)'
    r'([A-Za-z0-9][A-Za-z0-9.+# ]{1,30}?)'
    r'(?:\s+(?:on|for|please|pls|in|app|software)\b|[.!?]?\s*$)', re.I
)

# Generic desire verbs (need/want/get me) are install requests ONLY when an
# explicit install cue trails the product name ("I want Slack installed").
# Bare "I need Figma" / "I need help" deliberately fall through to the LLM router,
# which disambiguates far better than a keyword grab — this is what prevented
# "I need <anything>" from being mistaken for a software install.
_KW_IT_INSTALL_NEED = re.compile(
    r'\b(?:need|want|get\s+me|require|requesting)\s+'
    r'(?!(?:a|an|the|to|some|my|our|your|another)\b)'
    r'([A-Za-z0-9][A-Za-z0-9.+# ]{1,30}?)'
    r'\s+(?:installed|installation|set\s*up)\b', re.I
)
_KW_IT_VPN = re.compile(
    r'\b(vpn\s+(not|issue|problem|access|connect)|'
    r'password\s+reset|network\s+(issue|problem|not|down|slow))\b', re.I
)
_KW_IT_LICENSE = re.compile(
    r'\b(need|want|request|get)\s+(a\s+)?(claude|copilot|github\s+copilot|'
    r'loveable|jetbrains|intellij|webstorm)\s*(license|access|seat)?\b', re.I
)

_KW_PMO = re.compile(
    r'\b(project\s+(status|report|list|summary)|list\s+(all\s+)?projects|'
    r'active\s+projects|company\s+projects|our\s+projects|'
    r'udemy\s+(license|seat|access)|training\s+license)\b', re.I
)

_KW_MANAGER = re.compile(
    r'\b(my\s+team|who\s+reports\s+to\s+me|direct\s+reports|'
    r'my\s+reportees|team\s+members)\b', re.I
)
_KW_MS365_ROOMS = re.compile(
    r'\b(meeting\s+room|conference\s+room|book\s+(a\s+)?\w+\s+room|book\s+(a\s+)?room|'
    r'reserve\s+(a\s+)?\w+\s+room|reserve\s+(a\s+)?room|'
    r'room\s+(available|free|booked|availability)|which\s+rooms?\s+(are\s+)?(free|available)|'
    r'available\s+rooms?|rooms?\s+to\s+book|cabin\s+(available|free|book))\b', re.I
)

_KW_DEEPLINK_SETUP = re.compile(r'\bsetup\s+(zoho|powerapps|payroll)\b', re.I)
_KW_DEEPLINK_COMPLAINT = re.compile(
    r'\b(raise|file|submit|log)\s+(a\s+)?(complaint|ticket)\s+'
    r'(in|on|via)\s+(the\s+)?(portal|tracker|powerapps)\b', re.I
)

_KW_MS365_EMAIL = re.compile(
    r'\b(my\s+emails?|check\s+(my\s+)?email|inbox|read\s+.{0,10}emails?|'
    r'unread\s+emails?|recent\s+emails?|show\s+.{0,10}emails?|'
    r'any\s+emails?\s+from|new\s+emails?)\b', re.I
)
_KW_MS365_SEND = re.compile(
    r'\b(send\s+(an?\s+)?email|email\s+to\s+\w|compose\s+email|'
    r'write\s+(an?\s+)?email|draft\s+(an?\s+)?email)\b', re.I
)
_KW_MS365_CALENDAR = re.compile(
    r'\b(my\s+calendar|check\s+(my\s+)?calendar|today\'?s?\s+meetings?|'
    r'meetings?\s+(today|tomorrow|this\s+week|next\s+week)|'
    r'calendar\s+(for|this|next)|what\s+meetings?\s+do\s+i\s+have|'
    r'my\s+schedule|am\s+i\s+free|do\s+i\s+have\s+.{0,15}meeting)\b', re.I
)
_KW_MS365_TEAMS = re.compile(
    r'\b(teams?\s+(messages?|chats?)|my\s+teams?\s+messages?|'
    r'read\s+(my\s+)?teams?|check\s+(my\s+)?teams?)\b', re.I
)
_KW_MS365_TEAMS_SEND = re.compile(
    r'\b(send\s+(a\s+)?message\s+to|message\s+.{1,40}\s+on\s+teams|'
    r'teams?\s+message\s+to|dm\s+\w+\s+on\s+teams|'
    r'send\s+.{1,40}\s+on\s+teams)\b', re.I
)

_KW_MS365_YAMMER = re.compile(
    r'\b(yammer|viva\s+engage|community\s+(feed|posts?|messages?)|'
    r'my\s+communities|post\s+to\s+community|'
    r'announcements?\s+on\s+(yammer|viva)|'
    r'viva\s+engage\s+(feed|posts?|messages?))\b', re.I
)

_KW_COMPANY_INFO = re.compile(
    r'\b(about\s+(aligned\s*automation|the\s+company|aaspl|centriq)|'
    r'company\s+(info|details|overview|profile)|'
    r'what\s+is\s+aligned|tell\s+me\s+about\s+(aligned|aaspl|the\s+company))\b', re.I
)


def _try_keyword_route(message: str) -> dict | None:
    """Classify intent via keyword/regex matching — 0 LLM calls, <1ms.

    Returns a routing dict if the intent is unambiguous, None to fall
    through to the LLM router for ambiguous queries.
    """
    text = message.strip()

    # Greetings / small talk
    if _KW_GREETING.match(text):
        return {"domain": "general", "confidence": 1.0,
                "reasoning": "Keyword: greeting/social",
                "sub_intent": "greeting", "entities": {}}

    # HR — policy queries
    if _KW_HR_POLICY.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: HR policy query",
                "sub_intent": "policy_query", "entities": {}}

    # HR — document generation
    if _KW_HR_DOC.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: HR document request",
                "sub_intent": "document_request", "entities": {}}

    # HR — grievance
    if _KW_HR_GRIEVANCE.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: HR grievance",
                "sub_intent": "grievance", "entities": {}}

    # HR — people search
    if _KW_HR_PEOPLE.search(text):
        return {"domain": "hr", "confidence": 0.9,
                "reasoning": "Keyword: people/directory search",
                "sub_intent": "employee_search", "entities": {}}

    # Admin — reimbursement / expense
    if _KW_ADMIN_REIMB.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: reimbursement/expense",
                "sub_intent": "policy_query",
                "entities": {"policy_topic": "reimbursement"}}

    # Admin — parking
    if _KW_ADMIN_PARKING.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: parking sticker",
                "sub_intent": "parking_sticker", "entities": {}}

    # Admin — facility complaint
    if _KW_ADMIN_FACILITY.search(text):
        return {"domain": "admin", "confidence": 0.9,
                "reasoning": "Keyword: facility complaint",
                "sub_intent": "facility_complaint", "entities": {}}

    # Admin — food complaint / rating
    if _KW_ADMIN_FOOD.search(text):
        return {"domain": "admin", "confidence": 0.9,
                "reasoning": "Keyword: food complaint/rating",
                "sub_intent": "food_complaint", "entities": {}}

    # Admin — accommodation
    if _KW_ADMIN_ACCOM.search(text):
        return {"domain": "admin", "confidence": 0.9,
                "reasoning": "Keyword: accommodation booking",
                "sub_intent": "accommodation", "entities": {}}

    # Admin — desk key
    if _KW_ADMIN_DESK.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: desk key request",
                "sub_intent": "desk_key_request", "entities": {}}

    # Admin — Bookshelf Buddy
    if _KW_BOOKSHELF.search(text):
        return {"domain": "admin", "confidence": 0.97,
                "reasoning": "Keyword: bookshelf / book borrow request",
                "sub_intent": "bookshelf", "entities": {}}

    # MS365 — read emails
    if _KW_MS365_EMAIL.search(text):
        return {"domain": "ms365", "confidence": 0.95,
                "reasoning": "Keyword: email/inbox query",
                "sub_intent": "read_email", "entities": {}}

    # MS365 — send email
    if _KW_MS365_SEND.search(text):
        return {"domain": "ms365", "confidence": 0.95,
                "reasoning": "Keyword: send email",
                "sub_intent": "send_email", "entities": {}}

    # MS365 — calendar
    if _KW_MS365_CALENDAR.search(text):
        return {"domain": "ms365", "confidence": 0.95,
                "reasoning": "Keyword: calendar/meetings query",
                "sub_intent": "calendar", "entities": {}}

    # MS365 — send Teams message (must be before read teams)
    if _KW_MS365_TEAMS_SEND.search(text):
        return {"domain": "ms365", "confidence": 0.95,
                "reasoning": "Keyword: send Teams message",
                "sub_intent": "send_teams_message", "entities": {}}

    # MS365 — Teams messages
    if _KW_MS365_TEAMS.search(text):
        return {"domain": "ms365", "confidence": 0.95,
                "reasoning": "Keyword: Teams messages",
                "sub_intent": "teams_messages", "entities": {}}

    # MS365 — Yammer / Viva Engage
    if _KW_MS365_YAMMER.search(text):
        return {"domain": "ms365", "confidence": 0.95,
                "reasoning": "Keyword: Yammer/Viva Engage",
                "sub_intent": "yammer", "entities": {}}

    # IT — hardware issues
    if _KW_IT_HARDWARE.search(text):
        return {"domain": "it_support", "confidence": 0.95,
                "reasoning": "Keyword: hardware/device issue",
                "sub_intent": "hardware_issue", "entities": {}}

    # IT — VPN / network / password
    if _KW_IT_VPN.search(text):
        return {"domain": "it_support", "confidence": 0.95,
                "reasoning": "Keyword: VPN/network/password",
                "sub_intent": "create_ticket", "entities": {}}

    # IT — license request
    if _KW_IT_LICENSE.search(text):
        return {"domain": "it_support", "confidence": 0.95,
                "reasoning": "Keyword: license request",
                "sub_intent": "license_request", "entities": {}}

    # IT — my tickets
    if _KW_IT_TICKETS.search(text):
        return {"domain": "it_support", "confidence": 0.95,
                "reasoning": "Keyword: check IT tickets",
                "sub_intent": "my_tickets", "entities": {}}

    # IT — my assets
    if _KW_IT_ASSETS.search(text):
        return {"domain": "it_support", "confidence": 0.95,
                "reasoning": "Keyword: check IT assets",
                "sub_intent": "my_assets", "entities": {}}

    # IT — create ticket
    if _KW_IT_CREATE.search(text):
        return {"domain": "it_support", "confidence": 0.95,
                "reasoning": "Keyword: create IT ticket",
                "sub_intent": "create_ticket", "entities": {}}

    # MS365 — rooms (must be before IT install to avoid "want to book a room" → software_install)
    if _KW_MS365_ROOMS.search(text):
        return {"domain": "ms365", "confidence": 0.95,
                "reasoning": "Keyword: meeting room / conference room query",
                "sub_intent": "room_availability", "entities": {}}

    # IT — software install (with entity extraction)
    m = _KW_IT_INSTALL.search(text) or _KW_IT_INSTALL_NEED.search(text)
    if m and not re.search(r'\b(leave|parking|zoho|complaint|policy|reimburs|room|meeting|book|visitor|guest|pass)\b', text, re.I):
        sw = m.group(1).strip()
        if sw and 1 < len(sw) < 35:
            return {"domain": "it_support", "confidence": 0.9,
                    "reasoning": "Keyword: software install",
                    "sub_intent": "software_install",
                    "entities": {"software_name": sw}}

    # PMO — projects / training licenses
    if _KW_PMO.search(text):
        return {"domain": "pmo", "confidence": 0.95,
                "reasoning": "Keyword: PMO/project query",
                "sub_intent": "list_projects", "entities": {}}

    # Manager — team structure
    if _KW_MANAGER.search(text):
        return {"domain": "functional_manager", "confidence": 0.95,
                "reasoning": "Keyword: team/manager query",
                "sub_intent": "team_structure", "entities": {}}

    # Deeplink — setup sessions
    if _KW_DEEPLINK_SETUP.search(text):
        return {"domain": "deeplink", "confidence": 1.0,
                "reasoning": "Keyword: setup external session",
                "sub_intent": "setup_session", "entities": {}}

    # Deeplink — complaint via portal
    if _KW_DEEPLINK_COMPLAINT.search(text):
        return {"domain": "deeplink", "confidence": 0.9,
                "reasoning": "Keyword: portal complaint",
                "sub_intent": "powerapps_complaint", "entities": {}}

    # Company info — route to general, not HR
    if _KW_COMPANY_INFO.search(text):
        return {"domain": "general", "confidence": 0.9,
                "reasoning": "Keyword: company info query",
                "sub_intent": "company_info", "entities": {}}

    return None  # Ambiguous — fall through to LLM router


# ═══════════════════════════════════════════════════════════════════════════════
# 4. GRAPH NODES
# ═══════════════════════════════════════════════════════════════════════════════

_STICKY_DOMAINS = {"hr", "admin", "it_support", "pmo", "functional_manager", "ms365"}


def _last_ai_message(messages: list) -> str:
    """Return the content of the most recent AIMessage, or empty string."""
    for msg in reversed(messages):
        if isinstance(msg, AIMessage):
            return msg.content or ""
    return ""


async def intent_router(state: AgentState):
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

    # Fast-path: leave balance — must run BEFORE sticky domain so short queries aren't swallowed
    _LB_RE = re.compile(
        r'\b(leave\s+balance|how\s+many\s+leave|remaining\s+leave|leave\s+status'
        r'|my\s+leave|check\s+.*leave|leaves?\s+(left|remaining|available))\b',
        re.IGNORECASE,
    )
    if _LB_RE.search(last_human):
        print("[Router] Fast-path leave balance → deeplink")
        return {
            "domain": "deeplink",
            "route_confidence": 1.0,
            "route_reasoning": "Fast-path: leave balance query → deeplink/Zoho.",
            "sub_intent": "leave_balance",
            "entities": {},
        }

    # Keyword fast-path is computed up-front so a clear, complete new intent can
    # override stickiness. Terse follow-up answers ("B-07", "tomorrow 3pm") don't
    # match any keyword route, so they still fall through to the sticky logic below.
    keyword_result = _try_keyword_route(last_human)

    # Sticky domain: keep the same domain for follow-up messages that reference prior context.
    # Triggers on: (a) short reply to an agent question, OR (b) short message with context-reference
    # words after a substantive AI answer (e.g. "is there any timeline for applying it").
    existing_domain = state.get("domain")
    # A confident keyword match for a DIFFERENT domain is a genuine new request
    # (e.g. "I need to request a visitor pass" while stuck in it_support) — never
    # let stickiness swallow it.
    keyword_overrides_sticky = bool(
        keyword_result
        and keyword_result["domain"] != existing_domain
        and keyword_result.get("confidence", 0) >= 0.9
    )
    if existing_domain in _STICKY_DOMAINS and not keyword_overrides_sticky:
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

    # Fast-path: bypass LLM entirely for unambiguous leave requests
    leave_params = _try_extract_leave_params(last_human)
    if leave_params:
        print(f"[Router] Fast-path Zoho leave: {leave_params}")
        return {
            "domain": "deeplink",
            "route_confidence": 1.0,
            "route_reasoning": "Zoho leave params extracted without LLM.",
            "sub_intent": "zoho_leave_fastpath",
            "entities": leave_params,
        }

    # Keyword fast-path: classify via regex — 0 LLM calls, <1ms
    # (computed above so it can override stickiness; reuse the result here)
    if keyword_result:
        print(
            f"[Router] Keyword fast-path → {keyword_result['domain']} "
            f"({keyword_result['sub_intent']})"
        )
        return {
            "domain": keyword_result["domain"],
            "route_confidence": keyword_result["confidence"],
            "route_reasoning": keyword_result["reasoning"],
            "sub_intent": keyword_result["sub_intent"],
            "entities": keyword_result.get("entities", {}),
        }

    try:
        result = await classify_intent_async(last_human)
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


_feedback_count_cache: dict = {"count": 0, "ts": 0.0}
_FEEDBACK_COUNT_TTL = 300.0  # re-check every 5 minutes

# Short-lived cache: avoid re-embedding the same query within 2 minutes
_feedback_result_cache: dict[str, tuple[str, float]] = {}
_FEEDBACK_RESULT_TTL = 120.0


async def feedback_lookup(state: AgentState) -> dict:
    """Fetch relevant past feedback for the current query and store as prompt context.

    Runs the blocking Ollama embedding + DB query off the event loop via
    asyncio.to_thread so it never stalls the async pipeline.
    """
    import time as _t
    import asyncio
    now = _t.time()
    if now - _feedback_count_cache["ts"] > _FEEDBACK_COUNT_TTL:
        try:
            from app.database import SessionLocal as _SL
            from app.models import ChatFeedback as _CF
            def _count():
                _db = _SL()
                try:
                    return _db.query(_CF).count()
                finally:
                    _db.close()
            count = await asyncio.to_thread(_count)
            _feedback_count_cache.update({"count": count, "ts": now})
        except Exception:
            _feedback_count_cache.update({"count": 0, "ts": now})

    if _feedback_count_cache["count"] < 3:
        return {}

    domain = state.get("domain", "unknown") or "unknown"
    last_human = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
        "",
    )
    if not last_human:
        return {}

    # Cache key: domain + first 120 chars of query
    cache_key = f"{domain}:{last_human[:120]}"
    cached = _feedback_result_cache.get(cache_key)
    if cached:
        ctx, ts = cached
        if now - ts < _FEEDBACK_RESULT_TTL:
            return {"feedback_context": ctx} if ctx else {}

    try:
        relevant = await asyncio.to_thread(
            FeedbackService.get_relevant_feedback, domain, last_human, 3
        )
        ctx = FeedbackService.build_feedback_prompt(relevant)
    except Exception:
        ctx = ""

    _feedback_result_cache[cache_key] = (ctx, now)
    # Prevent unbounded growth
    if len(_feedback_result_cache) > 500:
        oldest = sorted(_feedback_result_cache, key=lambda k: _feedback_result_cache[k][1])
        for k in oldest[:100]:
            _feedback_result_cache.pop(k, None)

    return {"feedback_context": ctx} if ctx else {}


def hr_agent(state: AgentState):
    """HR Agent — handles leave and policies."""
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    messages = state["messages"]
    if not any(isinstance(m, SystemMessage) for m in messages):
        role_instruction = _get_role_instruction(state)
        _loc = state.get("user_location")
        _loc_line = f" Office: {_loc}." if _loc else ""
        base = PromptService.get_system_prompt(
            "hr",
            f"You are Centriq HR Assistant for Aligned Automation.\n"
            f"Employee email: {user_email}.{_loc_line} Never ask who the user is.\n"
            f"ROLE: {role_instruction}\n\n"
            f"Tool routing — act immediately:\n"
            f"- Leave balance → get_leave_balance(email='{user_email}')\n"
            f"- Apply leave → apply_leave with inferred leave_type (default Casual)\n"
            f"- Policy question → search_hr_policies, answer from result\n"
            f"- Employee search → search_employee_directory\n"
            f"- Org chart / team → get_org_chart or get_team_roster\n"
            f"- Team absence → get_team_absence_for(manager_email='{user_email}')\n"
            f"- Document → generate_hr_document(target_email='{user_email}')\n"
            f"- Grievance → collect category + description + ask if anonymous, THEN submit_grievance_for\n"
            f"- Onboarding → trigger_onboarding_checklist\n"
            f"- Offboarding → trigger_offboarding_checklist\n"
            f"- HR query (proof letter, PF, insurance, attendance issue, resignation, etc.) → "
            f"FIRST search_hr_policies. If no policy answers it or HR action is needed, "
            f"ASK employee to confirm, THEN submit_hr_query(email='{user_email}', category, subject, description)\n\n"
            f"Never answer from training knowledge — use tools only.\n",
        )
        guardrail = PromptService.get_guardrail("hr")
        feedback_ctx = state.get("feedback_context") or ""
        messages = [SystemMessage(content=base + guardrail + feedback_ctx)] + messages

    try:
        response = hr_llm.invoke(messages)
    except APIConnectionError:
        return {"messages": [AIMessage(content="I'm sorry, the HR system is currently unreachable.")]}

    return {"messages": [response]}

async def deeplink_agent_node(state: AgentState):
    """Deep-Link Agent — automates Zoho leave, PowerApps complaints, and Payroll via Playwright."""
    # Fast-path: leave balance — call tool directly, format response, 0 LLM calls
    if state.get("sub_intent") == "leave_balance":
        try:
            from app.agents.deeplink_agent import get_zoho_leave_balance
            result_json = get_zoho_leave_balance.invoke({})
            result_data = json.loads(result_json)
            if result_data.get("success"):
                balances = result_data.get("balances") or []
                if balances:
                    lines = []
                    for b in balances:
                        leave_type = b.get("type", "Unknown")
                        balance = b.get("balance", "?")
                        total = b.get("total")
                        used = b.get("used")
                        if total is not None and used is not None:
                            lines.append(f"{leave_type} — {balance} days remaining (used {used} of {total})")
                        else:
                            lines.append(f"{leave_type} — {balance} days remaining")
                    return {"messages": [AIMessage(content="Here is your current leave balance:\n\n" + "\n".join(lines))]}
                raw = result_data.get("raw_text", "")
                if raw:
                    # Fall through to LLM to parse raw_text
                    pass
                else:
                    return {"messages": [AIMessage(content="Your leave balance data was retrieved but appears empty. Please try again or check Zoho People directly.")]}
            elif result_data.get("action") == "run_setup":
                return {"messages": [AIMessage(content="Your Zoho session isn't set up yet. Please type 'setup zoho session' to log in once via SSO, then ask again.")]}
            elif result_data.get("error"):
                return {"messages": [AIMessage(content=f"I couldn't fetch your leave balance: {result_data['error']}. Please try again.")]}
        except Exception as _lb_err:
            print(f"[deeplink] leave_balance fast-path error: {_lb_err}")

    # Fast-path: leave application params already extracted by regex — call tool directly, 0 LLM calls
    if state.get("sub_intent") == "zoho_leave_fastpath":
        entities = state.get("entities") or {}
        if entities.get("start_date") and entities.get("end_date"):
            try:
                from app.agents.deeplink_agent import submit_zoho_leave
                result_json = submit_zoho_leave.invoke(entities)
                result_data = json.loads(result_json)
                if result_data.get("success"):
                    return {"messages": [AIMessage(content=result_data["message"])]}
                # Session not set up or not configured — fall through to LLM agent
            except Exception as _fp_err:
                print(f"[deeplink] fast-path error: {_fp_err}")

    agent = get_deeplink_agent()
    result = await agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": state.get("feedback_context") or "",
    })
    last_ai = next(
        (m for m in reversed(result["messages"]) if isinstance(m, AIMessage)),
        AIMessage(content="I could not complete the external portal request."),
    )
    return {"messages": [last_ai]}


async def pmo_agent_node(state: AgentState):
    """PMO Agent - handles project and report requests."""
    result = await pmo_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": _location_prefix(state) + (state.get("feedback_context") or ""),
        "sub_intent": state.get("sub_intent") or "",
        "entities": state.get("entities") or {},
        "user_role": state.get("user_role") or "employee",
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process PMO request."))
    return {"messages": [last_ai]}


_ADMIN_POLICY_KEYWORDS = {"policy", "reimbursement", "reimburse", "claim", "expense", "certification", "travel", "medical"}


async def admin_agent_node(state: AgentState):
    """Admin Agent - handles reimbursement, parking, etc."""
    sub_intent = state.get("sub_intent") or ""
    entities = state.get("entities") or {}
    feedback_ctx = _location_prefix(state) + (state.get("feedback_context") or "")

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

    # Stamp sub_intent into feedback_ctx so admin_agent can select the right tool group
    if sub_intent:
        feedback_ctx = f"[SUB_INTENT:{sub_intent}]\n" + feedback_ctx

    result = await admin_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": feedback_ctx,
        "user_role": state.get("user_role") or "employee",
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
        "feedback_context": _location_prefix(state) + (state.get("feedback_context") or "") + entity_hint,
        "user_role": state.get("user_role") or "employee",
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process IT request."))
    return {"messages": [last_ai]}


async def manager_agent_node(state: AgentState):
    """Manager Agent - handles team approvals, assignments, etc."""
    result = await manager_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": _location_prefix(state) + (state.get("feedback_context") or ""),
        "user_role": state.get("user_role") or "employee",
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), AIMessage(content="Failed to process Manager request."))
    return {"messages": [last_ai]}


async def ms365_agent_node(state: AgentState):
    """MS365 Agent — reads emails, sends emails, calendar, Teams, Yammer.

    Execute-first: for unambiguous read intents, pre-fetch data at the Python
    level and inject it into feedback_context so the LLM only formats (1 call).
    """
    sub_intent = state.get("sub_intent") or ""
    graph_token = state.get("graph_token") or ""
    user_email = (state.get("user_email") or settings.DEFAULT_USER_EMAIL).lower().strip()

    # Fetch Yammer token on-demand (separate audience from Graph)
    yammer_token = ""
    try:
        from app.services.oauth_service import get_yammer_token
        yammer_token = await get_yammer_token(user_email) or ""
    except Exception:
        pass

    # Execute-first for unambiguous read-only intents (skip 1 LLM call)
    pre_fetched = ""
    if graph_token and sub_intent == "read_email":
        from app.services import ms365_service
        result = await ms365_service.fetch_my_emails(graph_token)
        if result.get("success"):
            pre_fetched = f"[PRE-FETCHED EMAILS]\n{json.dumps(result)}\n[END]"

    elif graph_token and sub_intent == "calendar":
        from app.services import ms365_service
        from app.agents.ms365_agent import _today_range
        start, end = _today_range()
        result = await ms365_service.fetch_calendar_view(graph_token, start, end)
        if result.get("success"):
            pre_fetched = f"[PRE-FETCHED CALENDAR (today)]\n{json.dumps(result)}\n[END]"

    elif graph_token and sub_intent == "teams_messages":
        from app.services import ms365_service
        result = await ms365_service.fetch_teams_chats(graph_token)
        if result.get("success"):
            pre_fetched = f"[PRE-FETCHED TEAMS]\n{json.dumps(result)}\n[END]"

    elif yammer_token and sub_intent == "yammer":
        from app.services import yammer_service
        result = await yammer_service.fetch_my_feed(yammer_token)
        if result.get("success"):
            pre_fetched = f"[PRE-FETCHED YAMMER FEED]\n{json.dumps(result)}\n[END]"

    feedback_ctx = _location_prefix(state) + (state.get("feedback_context") or "")
    if pre_fetched:
        feedback_ctx = pre_fetched + "\n\n" + feedback_ctx

    # For follow-ups: inject conversation summary so the LLM knows the prior ask
    if sub_intent == "followup":
        prior_msgs = state.get("messages", [])
        prior_context_parts = []
        for m in prior_msgs[-6:]:  # last 3 turns (human+ai pairs)
            role = "User" if isinstance(m, HumanMessage) else "Assistant"
            content = getattr(m, "content", "")
            if isinstance(content, str) and content.strip():
                prior_context_parts.append(f"{role}: {content[:300]}")
        if prior_context_parts:
            feedback_ctx = (
                "[CONVERSATION CONTEXT — this is a follow-up to the prior exchange]\n"
                + "\n".join(prior_context_parts)
                + "\n[END CONTEXT]\n\n"
                + feedback_ctx
            )

    result = await ms365_agent.ainvoke({
        "messages": state["messages"],
        "user_email": user_email,
        "feedback_context": feedback_ctx,
        "graph_token": graph_token,
        "yammer_token": yammer_token,
    })
    last_ai = next(
        (m for m in reversed(result["messages"]) if isinstance(m, AIMessage)),
        AIMessage(content="Failed to process Microsoft 365 request."),
    )
    return {"messages": [last_ai]}


general_tools = [get_announcements, search_hr_policies]
general_tool_node = ToolNode(general_tools)
general_llm = general_llm_base.bind_tools(general_tools)


def _greeting_response(state: AgentState) -> str:
    """Build a time-aware greeting — 0 LLM calls, <1ms."""
    import datetime as _dt
    hour = _dt.datetime.now().hour
    email = state.get("user_email") or ""
    name = email.split("@")[0].replace(".", " ").title() if email and "@" in email else ""
    if hour < 12:
        period = "Good morning"
    elif hour < 17:
        period = "Good afternoon"
    else:
        period = "Good evening"
    greeting = f"{period}{', ' + name if name else ''}!"
    return f"{greeting} I'm Centriq, your workplace assistant. I can help you with HR policies, leave management, reimbursements, IT tickets, parking, project updates, and more. What do you need help with?"


def general_agent(state: AgentState):
    """General Agent — greetings, announcements, and policy Q&A."""
    # Fast-path: greetings don't need LLM — respond instantly
    sub_intent = state.get("sub_intent") or ""
    if sub_intent == "greeting":
        return {"messages": [AIMessage(content=_greeting_response(state))]}

    base = PromptService.get_system_prompt(
        "general",
        "You are Centriq, the AI assistant for Aligned Automation. "
        "You handle company announcements and general policy questions. "
        "Tools: get_announcements (news/updates), search_hr_policies (policy lookups). "
        "Always use tools first, never guess. Only suggest contacting HR/Admin if tools return no results. "
        "Do not offer further assistance unless asked.",
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
    if domain == "deeplink": return "deeplink_agent"
    if domain == "pmo": return "pmo_agent"
    if domain == "admin": return "admin_agent"
    if domain == "it_support": return "it_agent"
    if domain == "functional_manager": return "manager_agent"
    if domain == "ms365": return "ms365_agent"
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
workflow.add_node("context_manager", context_manager_node)
workflow.add_node("feedback_lookup", feedback_lookup)
workflow.add_node("hr_agent", hr_agent)
workflow.add_node("pmo_agent", pmo_agent_node)
workflow.add_node("admin_agent", admin_agent_node)
workflow.add_node("it_agent", it_agent_node)
workflow.add_node("manager_agent", manager_agent_node)
workflow.add_node("deeplink_agent", deeplink_agent_node)
workflow.add_node("ms365_agent", ms365_agent_node)
workflow.add_node("general_agent", general_agent)
workflow.add_node("general_tools", general_tool_node)
workflow.add_node("dummy_test_agent", dummy_test_agent)
workflow.add_node("placeholder_agent", placeholder_agent)
workflow.add_node("hr_tools", hr_tool_node)
workflow.add_node("summarizer", summarizer)

workflow.set_entry_point("intent_router")
# context_manager sits between router and feedback_lookup:
# intent_router → context_manager (compress if >6000 tokens) → feedback_lookup → domain agent
workflow.add_edge("intent_router", "context_manager")
workflow.add_edge("context_manager", "feedback_lookup")
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
workflow.add_edge("deeplink_agent", END)
workflow.add_edge("ms365_agent", END)
workflow.add_edge("dummy_test_agent", END)
workflow.add_edge("placeholder_agent", END)

app_agent = workflow.compile(checkpointer=checkpointer)
