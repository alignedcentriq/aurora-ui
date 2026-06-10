"""
Centriq AI — Multi-Agent LangGraph Brain

Architecture:
  User Message -> Intent Router (gpt-oss:latest / 20.9B) -> Domain Agent (gpt-oss:latest / 20.9B)
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
import random as _random
import logging
from typing import TypedDict, Annotated, List, Optional

from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode, InjectedState
from langgraph.checkpoint.memory import MemorySaver

from langchain_openai import ChatOpenAI
from openai import APIConnectionError
from langchain_core.messages import (
    BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage,
)
from langchain_core.tools import tool

from app.hr_service import HRService
from app.config import settings
from app.services import llm_controls_service as llm_controls
from app.router import classify_intent, classify_intent_async, get_domain_status, get_placeholder_response
from app.services.semantic_router_service import SemanticRouterService
from app.agents.pmo_agent import pmo_agent
from app.agents.admin_agent import admin_agent
from app.agents.it_agent import it_agent
from app.agents.manager_agent import manager_agent
from app.agents.deeplink_agent import get_deeplink_agent
from app.agents.ms365_agent import ms365_agent
from app.agents.doc_agent import doc_agent
from app.services.it_service import ITService
from app.services.employee_service import EmployeeService
from app.services.announcement_service import AnnouncementService
from app.services.people_service import PeopleService
from app.services.prompt_service import PromptService
from app.services.feedback_service import FeedbackService

log = logging.getLogger("aurora-logger")


DOWNLOAD_TAG_PATTERN = re.compile(r"\[DOWNLOAD_PDF:[^\]]+\]")

# Leading meta-preamble the summarizer model sometimes parrots from its prompt. Matches a
# single opening sentence like "Here's a summary of the tool results for the employee:".
_SUMMARY_PREAMBLE_RE = re.compile(
    r"^\s*(?:here'?s|here is|below is|the following is)\b[^\n.:]*"
    r"\b(?:summary|overview|result|results|response|information)\b[^\n.:]*[.:]\s*",
    re.IGNORECASE,
)


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
        pass


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
        summary_response = await llm_controls.get_llm("summarizer", default_timeout=20).ainvoke(
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
def get_my_leaves(email: str):
    """List the logged-in user's leave requests (id, type, dates, status, days).
    Call before cancel_leave so the user can pick which leave to cancel."""
    from app.database import SessionLocal
    from app.models import Leave, Employee
    db = SessionLocal()
    try:
        emp = HRService.get_employee_by_email(db, email)
        if not emp:
            return "Employee record not found."
        leaves = (
            db.query(Leave)
            .filter(Leave.employee_id == emp.id)
            .order_by(Leave.created_at.desc())
            .limit(10)
            .all()
        )
        if not leaves:
            return "No leave records found."
        lines = []
        for l in leaves:
            days = ((l.end_date - l.start_date).days + 1) if l.start_date and l.end_date else "?"
            lines.append(f"ID {l.id}: {l.leave_type} | {l.start_date} to {l.end_date} | {days} day(s) | Status: {l.status}")
        return "\n".join(lines)
    finally:
        db.close()

@tool
def cancel_leave(email: str, leave_id: int):
    """Cancel a leave by ID. If the leave was Approved, the balance is automatically restored.
    Call get_my_leaves first if you don't know the leave_id."""
    import httpx
    from app.config import settings
    try:
        base = getattr(settings, "APP_BASE_URL", "http://localhost:8000")
        resp = httpx.post(
            f"{base}/api/leave/{leave_id}/cancel",
            headers={"x-user-email": email, "x-user-role": "employee"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("message", "Leave cancelled successfully.")
        else:
            detail = resp.json().get("detail", "Cancellation failed.")
            return f"Could not cancel leave: {detail}"
    except Exception as e:
        return f"Error cancelling leave: {e}"

@tool
def search_hr_policies(query: str):
    """Search HR policy documents. Call for any policy question. Answer from the result only.
    State policy name once. Never include metadata (author, version, review dates)."""
    return HRService.search_policies(query, limit=6, char_budget=6000)


@tool
def search_company_projects(query: str):
    """Search the company's project knowledge base — project summaries, demo
    transcripts, and project details synced from SharePoint. Call for any question
    about what projects the company has worked on, a specific project's summary or
    status, or what was demoed. Answer only from the result."""
    from app.services.policy_service import PolicyService
    return PolicyService.search_projects(query, limit=6)


@tool
def find_apps(query: str):
    """Find an internal app, tool, portal, or website the company offers for a task.
    Call whenever the user asks where to do something, what tool/app/portal/website to use,
    or mentions needing a system for a task (e.g. 'where do I book travel', 'is there an app
    for expenses', 'tool to submit timesheets', 'which portal for IT requests'). Returns the
    matching apps with their links — present them with the link; do not invent apps or URLs."""
    from app.services.app_directory_service import AppDirectoryService
    return AppDirectoryService.search(query)


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


# ── Zoho People — per-user delegated tools ────────────────────────────────────

def _zoho_token_or_error(email: str) -> str | None:
    """Return valid Zoho token or None. Uses _run_coro to bridge async → sync."""
    # In demo mode the services return mock data and ignore the token, so don't require
    # a real Zoho connection — hand back a dummy token so tools don't show "connect Zoho".
    if settings.ZOHO_DEMO_MODE:
        return "demo-mode-token"
    try:
        from app.services.email_service import _run_coro
        from app.services.oauth_service import get_valid_token
        return _run_coro(get_valid_token(email, "zoho"))
    except Exception:
        return None

_ZOHO_CONNECT_MSG = "Please connect your Zoho account first. Go to **Settings > Connected Accounts** and click **Connect Zoho**."

@tool
def get_my_timesheet(week: str = "", state: Annotated[dict, InjectedState] = None) -> str:
    """Get my timesheet hours for a given week.
    week: start date of the week in YYYY-MM-DD format (Monday). Leave blank for current week."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    token = _zoho_token_or_error(email)
    if not token:
        return _ZOHO_CONNECT_MSG
    try:
        from app.services.zoho_people_service import get_timesheet
        data = get_timesheet(token, week)
        if not data.get("success"):
            return "Could not retrieve timesheet data. Please try again."
        logs = data.get("logs", [])
        total = data.get("total_hours", 0)
        if not logs:
            return f"No timesheet entries found for the week of {data.get('week_start', week)}."
        lines = [f"**Timesheet — week of {data['week_start']} to {data['week_end']}**\n"]
        for log in logs:
            lines.append(f"- {log['date']}: {log['hours']}h — {log['job'] or 'General'}")
        lines.append(f"\n**Total: {total} hours**")
        return "\n".join(lines)
    except ValueError:
        return _ZOHO_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching timesheet: {exc}"


def _format_attendance(data: dict, who: str = "") -> str:
    title = f"Attendance — {who} — {data['month']}" if who else f"Attendance — {data['month']}"
    lines = [
        f"**{title}**\n",
        f"- Present: {data['present']} days",
        f"- Absent: {data['absent']} days",
        f"- Work From Home: {data['wfh']} days",
        f"- Late arrivals: {data['late']} days",
    ]
    if data.get("half_day"):
        lines.append(f"- Half-days: {data['half_day']} days")
    return "\n".join(lines)


@tool
def get_my_attendance(month: str = "", year: str = "", state: Annotated[dict, InjectedState] = None) -> str:
    """Get my monthly attendance summary: days present, absent, WFH, and late arrivals.
    month: numeric month 1-12. year: 4-digit year. Leave blank for current month."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    # Attendance is backed by the internal `attendance` table (demo data). In demo mode read
    # from the DB; otherwise fall back to the live Zoho People API.
    if settings.ZOHO_DEMO_MODE:
        try:
            from app.services.attendance_service import summary
            data = summary(email, month, year)
            if not data.get("success"):
                return "No attendance records found for your account."
            return _format_attendance(data)
        except Exception as exc:
            return f"Error fetching attendance: {exc}"
    token = _zoho_token_or_error(email)
    if not token:
        return _ZOHO_CONNECT_MSG
    try:
        from app.services.zoho_people_service import get_attendance_summary
        data = get_attendance_summary(token, month, year)
        if not data.get("success"):
            return "Could not retrieve attendance data. Please try again."
        return _format_attendance(data)
    except ValueError:
        return _ZOHO_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching attendance: {exc}"


@tool
def get_employee_attendance(employee: str, month: str = "", year: str = "",
                            state: Annotated[dict, InjectedState] = None) -> str:
    """Get the monthly attendance summary for one of your direct reportees, by name or email.
    Managers can only view attendance for employees who report directly to them (and themselves).
    employee: the reportee's full name or email address.
    month: numeric month 1-12. year: 4-digit year. Leave blank for current month."""
    if not settings.ZOHO_DEMO_MODE:
        return ("Per-employee attendance requires Zoho admin API access, which isn't enabled "
                "yet. Only your own attendance is available right now.")
    requester_email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    try:
        from app.services.attendance_service import summary_for_manager
        data = summary_for_manager(requester_email, employee, month, year)
        if not data.get("success"):
            err = data.get("error")
            if err == "not_authorized":
                return data.get("message", "You can only view attendance for your direct reportees.")
            if err == "requester_not_found":
                return "Could not find your employee profile, so reportee access can't be verified."
            return f"No employee found matching '{employee}'. Try their full name or work email."
        return _format_attendance(data, who=data.get("employee", employee))
    except Exception as exc:
        return f"Error fetching attendance: {exc}"


@tool
def get_my_appraisal_status(state: Annotated[dict, InjectedState] = None) -> str:
    """Get my current appraisal cycle status, due dates, and any pending tasks."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    token = _zoho_token_or_error(email)
    if not token:
        return _ZOHO_CONNECT_MSG
    try:
        from app.services.zoho_people_service import get_appraisal_status
        data = get_appraisal_status(token)
        if not data.get("success"):
            return "Could not retrieve appraisal data. Please try again."
        cycles = data.get("cycles", [])
        if not cycles:
            return "No active appraisal cycles found at this time."
        lines = ["**Appraisal Status**\n"]
        for c in cycles:
            lines.append(f"- **{c['name']}** — {c['status']}")
            if c.get("start_date") and c.get("end_date"):
                lines.append(f"  Period: {c['start_date']} to {c['end_date']}")
            if c.get("due_date"):
                lines.append(f"  Due: {c['due_date']}")
        return "\n".join(lines)
    except ValueError:
        return _ZOHO_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching appraisal status: {exc}"


@tool
def get_my_training_records(state: Annotated[dict, InjectedState] = None) -> str:
    """Get my completed and upcoming training programs from Zoho People."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    token = _zoho_token_or_error(email)
    if not token:
        return _ZOHO_CONNECT_MSG
    try:
        from app.services.zoho_people_service import get_training_records
        data = get_training_records(token)
        if not data.get("success"):
            return "Could not retrieve training records. Please try again."
        lines = []
        completed = data.get("completed", [])
        upcoming = data.get("upcoming", [])
        if completed:
            lines.append("**Completed Trainings**")
            for t in completed:
                lines.append(f"- {t['name']} ({t['end_date']})")
        if upcoming:
            lines.append("\n**Upcoming Trainings**")
            for t in upcoming:
                lines.append(f"- {t['name']} — starts {t['start_date']}")
        if not lines:
            return "No training records found."
        return "\n".join(lines)
    except ValueError:
        return _ZOHO_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching training records: {exc}"


@tool
def get_my_expense_reports(status: str = "", state: Annotated[dict, InjectedState] = None) -> str:
    """Get my expense reports from Zoho Expense, with their approval/reimbursement status.
    status: optional filter — submitted, approved, reimbursed. Leave blank for all."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    token = _zoho_token_or_error(email)
    if not token:
        return _ZOHO_CONNECT_MSG
    try:
        from app.services.zoho_expense_service import get_my_expense_reports as _fetch
        data = _fetch(token, status)
        if not data.get("success"):
            return "Could not retrieve expense reports. Please try again."
        reports = data.get("reports", [])
        if not reports:
            return "No expense reports found."
        lines = ["**Expense Reports**\n"]
        for r in reports:
            amt = f"{r['total']} {r['currency']}".strip()
            lines.append(f"- **{r['name']}** — {r['status']} — {amt}")
            if r.get("submitted_date"):
                lines.append(f"  Submitted: {r['submitted_date']}")
        return "\n".join(lines)
    except ValueError:
        return _ZOHO_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching expense reports: {exc}"


@tool
def get_my_reimbursement_status(state: Annotated[dict, InjectedState] = None) -> str:
    """Get my pending and reimbursed expense totals from Zoho Expense."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    token = _zoho_token_or_error(email)
    if not token:
        return _ZOHO_CONNECT_MSG
    try:
        from app.services.zoho_expense_service import get_reimbursement_status
        data = get_reimbursement_status(token)
        if not data.get("success"):
            return "Could not retrieve reimbursement status. Please try again."
        pending = data.get("pending", [])
        lines = [
            "**Reimbursement Status**\n",
            f"- Pending reimbursement: **{data['pending_total']}**",
            f"- Already reimbursed: **{data['reimbursed_total']}**",
        ]
        if pending:
            lines.append("\n**Awaiting reimbursement:**")
            for r in pending:
                lines.append(f"- {r['name']} — {r['status']} — {r['reimbursable']}")
        return "\n".join(lines)
    except ValueError:
        return _ZOHO_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching reimbursement status: {exc}"


@tool
def get_open_positions(state: Annotated[dict, InjectedState] = None) -> str:
    """Get currently open job openings from Zoho Recruit."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    token = _zoho_token_or_error(email)
    if not token:
        return _ZOHO_CONNECT_MSG
    try:
        from app.services.zoho_recruit_service import get_open_positions as _fetch
        data = _fetch(token)
        if not data.get("success"):
            return "Could not retrieve open positions. Please try again."
        positions = data.get("positions", [])
        if not positions:
            return "No open positions found at this time."
        lines = ["**Open Positions**\n"]
        for p in positions:
            loc = f" — {p['city']}" if p.get("city") else ""
            lines.append(f"- **{p['title']}**{loc} ({p['status']})")
            if p.get("date_opened"):
                lines.append(f"  Opened: {p['date_opened']}")
        return "\n".join(lines)
    except ValueError:
        return _ZOHO_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching open positions: {exc}"


@tool
def get_candidate_status(email_address: str, state: Annotated[dict, InjectedState] = None) -> str:
    """Look up a candidate's recruitment pipeline status in Zoho Recruit by their email.
    email_address: the candidate's email to search for."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    token = _zoho_token_or_error(email)
    if not token:
        return _ZOHO_CONNECT_MSG
    try:
        from app.services.zoho_recruit_service import get_candidate_status as _fetch
        data = _fetch(token, email_address)
        if not data.get("success"):
            return "Could not retrieve candidate status. Please try again."
        candidates = data.get("candidates", [])
        if not candidates:
            return f"No candidate found for {email_address}."
        lines = ["**Candidate Status**\n"]
        for c in candidates:
            lines.append(f"- **{c['name']}** ({c['email']}) — {c['status']}")
        return "\n".join(lines)
    except ValueError:
        return _ZOHO_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching candidate status: {exc}"


_ALCHEMY_CONNECT_MSG = (
    "Please connect your Microsoft account first. "
    "Go to **Settings > Connected Accounts** and click **Connect Microsoft**."
)


def _alchemy_token_or_none(email: str) -> str | None:
    try:
        from app.services.email_service import _run_coro
        from app.services.oauth_service import get_alchemy_token
        return _run_coro(get_alchemy_token(email))
    except Exception:
        return None


@tool
def get_my_alchemy_skills(state: Annotated[dict, InjectedState] = None) -> str:
    """Get my skills from the Alchemy skills portal."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    if not settings.ALCHEMY_SKILL_SEARCH_ENABLED:
        from app.database import SessionLocal
        db = SessionLocal()
        try:
            skills = EmployeeService._real_skills(db, email)
            if not skills:
                return "No skills found in your profile yet. You can add skills by typing \"update my skills\" in the chat."
            lines = ["**Your Skills (Internal Profile)**"]
            for s in skills.split(","):
                lines.append(f"- {s.strip()}")
            return "\n".join(lines)
        finally:
            db.close()

    token = _alchemy_token_or_none(email)
    if not token:
        return _ALCHEMY_CONNECT_MSG
    try:
        from app.services.alchemy_service import get_my_skills, resolve_employee_id
        emp_id = resolve_employee_id(token, email)
        if not emp_id:
            return "Could not find your employee ID. Please contact IT support."
        data = get_my_skills(token, emp_id)
        skills = data if isinstance(data, list) else data.get("data", data.get("skills", []))
        if not skills:
            return "No skills found in your Alchemy profile."
        lines = ["**Your Skills (Alchemy)**"]
        for s in skills:
            name = s.get("skillName") or s.get("name") or s.get("skill", "Unknown")
            level = s.get("proficiencyLevel") or s.get("level") or ""
            lines.append(f"- {name}" + (f" — {level}" if level else ""))
        return "\n".join(lines)
    except PermissionError:
        return _ALCHEMY_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching skills: {exc}"


@tool
def get_alchemy_skills_overview(state: Annotated[dict, InjectedState] = None) -> str:
    """Get org-wide skills summary and top skills by interest from Alchemy."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    if not settings.ALCHEMY_SKILL_SEARCH_ENABLED:
        from app.database import SessionLocal
        from app.models import EmployeeSkill
        from sqlalchemy import func
        db = SessionLocal()
        try:
            top_skills = (
                db.query(EmployeeSkill.skill, func.count(EmployeeSkill.id))
                .group_by(EmployeeSkill.skill)
                .order_by(func.count(EmployeeSkill.id).desc())
                .limit(10)
                .all()
            )
            total_declared = db.query(EmployeeSkill.id).count()
            unique_skills = db.query(EmployeeSkill.skill).distinct().count()

            lines = ["**Org Skills Overview (Internal DB)**"]
            lines.append(f"- Total Skill Declarations: {total_declared}")
            lines.append(f"- Unique Declared Skills: {unique_skills}")

            if top_skills:
                lines.append("\n**Top Declared Skills**")
                for name, count in top_skills:
                    lines.append(f"- {name} ({count} employees)")
            return "\n".join(lines)
        finally:
            db.close()

    token = _alchemy_token_or_none(email)
    if not token:
        return _ALCHEMY_CONNECT_MSG
    try:
        from app.services.alchemy_service import get_skills_stats_summary, get_top_skills_by_interest
        summary = get_skills_stats_summary(token)
        top = get_top_skills_by_interest(token)
        lines = ["**Org Skills Overview (Alchemy)**"]
        # Summary stats
        if isinstance(summary, dict):
            for k, v in summary.items():
                lines.append(f"- {k}: {v}")
        # Top skills by interest
        top_list = top if isinstance(top, list) else top.get("data", top.get("skills", []))
        if top_list:
            lines.append("\n**Top Skills by Interest**")
            for s in top_list[:10]:
                name = s.get("skillName") or s.get("name") or s.get("skill", "")
                count = s.get("count") or s.get("userCount") or ""
                lines.append(f"- {name}" + (f" ({count} employees)" if count else ""))
        return "\n".join(lines)
    except PermissionError:
        return _ALCHEMY_CONNECT_MSG
    except Exception as exc:
        return f"Error fetching skills overview: {exc}"


@tool
def search_alchemy_skill_experts(skill: str, state: Annotated[dict, InjectedState] = None) -> str:
    """Find employees who have a specific technology or skill (e.g. Python, React, AWS, SAP).

    PREFER THIS over the internal directory for any skill/technology people search —
    "find python developers", "who knows React", "people skilled in AWS". It queries the
    authoritative Alchemy Skills Portal (the org's system of record for skills).
    For name / manager / department lookups, use the internal directory tools instead.
    """
    # Feature flag: when off, use the internal DB directory (dummy/demo data) instead.
    if not settings.ALCHEMY_SKILL_SEARCH_ENABLED:
        return EmployeeService.find_skills_expert(skill)

    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    token = _alchemy_token_or_none(email)
    if not token:
        return _ALCHEMY_CONNECT_MSG
    try:
        from app.services.alchemy_service import resolve_skill_id, get_skill_details
        skill_id, canonical = resolve_skill_id(token, skill)
        if not skill_id:
            return (f"'{skill}' isn't a recognised skill in the Alchemy Skills Portal. "
                    f"Try a more specific technology name (e.g. Python, React, SAP).")
        data = get_skill_details(token, skill_id)
        total = data.get("total_employees")
        experts = data.get("experts") or []
        certified = data.get("certified") or []
        everyone = data.get("employees") or []

        # Order: experts first, then certified, then the rest — de-duped by id/name.
        seen, ordered = set(), []
        for bucket in (experts, certified, everyone):
            for e in bucket:
                key = e.get("employee_id") or e.get("name")
                if key and key not in seen:
                    seen.add(key)
                    ordered.append(e)

        if not ordered:
            return f"No employees found with the **{canonical}** skill in Alchemy."

        cap = 25
        header = (f"**{canonical}** — {total if total is not None else len(ordered)} employee(s) "
                  f"in Alchemy ({len(experts)} expert, {len(certified)} certified):")
        lines = [header, ""]
        for e in ordered[:cap]:
            name = e.get("name") or e.get("employee_id") or "Unknown"
            comp = e.get("competency")
            exp = e.get("experience")
            extra = " | ".join(x for x in [
                comp,
                (f"{exp} yrs" if exp not in (None, "", "0", "0.00") else None),
            ] if x)
            lines.append(f"- {name}" + (f" — {extra}" if extra else ""))
        if len(ordered) > cap:
            lines.append(f"\n…and {len(ordered) - cap} more. Ask to narrow by competency or experience.")
        return "\n".join(lines)
    except PermissionError:
        return _ALCHEMY_CONNECT_MSG
    except Exception as exc:
        # Graceful degradation — fall back to the internal directory.
        log.warning("[alchemy] skill search for %r failed, falling back to DB: %s", skill, exc)
        return EmployeeService.find_skills_expert(skill)


@tool
def get_employee_availability(name_or_email: str) -> str:
    """Check whether an employee is available for work (free to be staffed on a project).

    Availability is based on project allocation: an employee is AVAILABLE only when they
    have NO active allocation (fully unallocated). Anyone currently on an Active project
    counts as unavailable/busy. Use this for 'are they available for work?' follow-ups.
    """
    from app.database import SessionLocal
    from app.models import EmployeeAllocation
    from sqlalchemy import or_, func

    term = (name_or_email or "").strip()
    if not term:
        return "Please specify an employee name to check availability."
    db = SessionLocal()
    try:
        allocs = db.query(EmployeeAllocation).filter(
            or_(
                EmployeeAllocation.employee_name.ilike(f"%{term}%"),
                func.lower(EmployeeAllocation.employee_id) == term.lower(),
            )
        ).order_by(EmployeeAllocation.allocation_date.desc()).all()

        if not allocs:
            return (f"**{term}** — ✅ Available for work (no project allocation on record).")

        def _is_active(a) -> bool:
            return (a.status or "").strip().lower() == "active" or \
                   (a.completion_status or "").strip().lower() == "active"

        active = [a for a in allocs if _is_active(a)]
        display_name = allocs[0].employee_name or term
        if not active:
            return f"**{display_name}** — ✅ Available for work (no active allocation)."

        lines = [f"**{display_name}** — ❌ Not available (currently allocated):"]
        for a in active[:5]:
            end = a.expected_end_date.isoformat() if a.expected_end_date else "no end date"
            eff = f"{a.efforts_percent}% efforts" if a.efforts_percent is not None else ""
            detail = " | ".join(x for x in [a.project_name or "Project", eff, f"ends {end}"] if x)
            lines.append(f"- {detail}")
        return "\n".join(lines)
    finally:
        db.close()


hr_tools = [
    get_leave_balance, apply_leave, get_my_leaves, cancel_leave, search_hr_policies,
    search_employee_directory, get_employee_profile, get_org_chart,
    get_team_roster, find_skills_expert, get_department_headcount,
    search_people_directory, find_apps,
    create_announcement, get_announcements, deactivate_announcement,
    update_hr_prompt,
    get_team_absence, get_team_absence_for,
    generate_hr_document,
    submit_grievance, submit_grievance_for,
    trigger_onboarding_checklist, trigger_offboarding_checklist,
    submit_hr_query,
    get_my_timesheet, get_my_attendance, get_employee_attendance,
    get_my_appraisal_status, get_my_training_records,
    get_my_expense_reports, get_my_reimbursement_status,
    get_open_positions, get_candidate_status,
    get_my_alchemy_skills, get_alchemy_skills_overview,
    search_alchemy_skill_experts, get_employee_availability,
]
hr_tool_node = ToolNode(hr_tools)


# ═══════════════════════════════════════════════════════════════════════════════
# 3. LLM INSTANCES
# ═══════════════════════════════════════════════════════════════════════════════
# LLM instances are built on demand by the runtime factory
# (app.services.llm_controls_service.get_llm) so IT can tune model / temperature /
# max_tokens / timeout live without a restart. Tier → call-site mapping:
#   agent      → HR reasoning (hr_tools)           default_timeout=45
#   general    → greetings / announcements / policy default_timeout=20
#   summarizer → context + tool-result summaries    default_timeout=20
# The factory caches each client by its effective param signature, so these are
# rebuilt only when IT actually changes a value — no per-request construction cost.



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

_KW_LEAVE_CANCEL = re.compile(
    r'\b(cancel|withdraw|revoke|recall|rescind|retract)\b.{0,30}\b(leave|time.?off)\b'
    r'|\b(leave|time.?off)\b.{0,30}\b(cancel|withdraw|revoke|recall)\b', re.I
)

_KW_HR_POLICY = re.compile(
    r'\b(leave\s+policy|hr\s+policy|attendance\s+policy|wfh\s+policy|'
    r'work\s+from\s+home\s+policy|posh\s+policy|sexual\s+harassment|'
    r'maternity\s+(leave|policy)|paternity\s+(leave|policy)|'
    r'probation\s+(policy|period|confirmation)|comp[- ]?off\s+policy|'
    r'holiday\s+(list|calendar|policy)|appraisal\s+policy|'
    r'referral\s+bonus|onboarding\s+policy|offboarding\s+policy|'
    r'gratuity\s+policy|variable\s+pay\s+policy|'
    r'sabbatical\s+policy|relocation\s+policy|'
    r'insurance|mediclaim|group\s+health|medical\s+insurance|'
    r'esic?\b|health\s+(insurance|policy|cover(age)?)|'
    r'insurance\s+claim|claim\s+(form|process))\b', re.I
)

_KW_HR_REFERRAL = re.compile(
    r'\b(employee\s+referral|refer\s+(someone|a\s+(person|candidate|friend|colleague|contact|peer)|people)|'
    r'how\s+(do\s+i|can\s+i|to)\s+refer|referral\s+(program|portal|link|process|bonus)|'
    r'refer\s+(for\s+a\s+job|to\s+the\s+company|someone\s+for|a\s+job)|'
    r'(want|would\s+like|looking)\s+to\s+refer|submit\s+(a[n]?\s+)?referral|'
    r'internal\s+referral|referral\s+submission|'
    r'refer\s+(my\s+)?(friend|colleague|contact|peer|buddy))\b', re.I
)

_KW_HR_DOC = re.compile(
    r'\b(experience\s+certificate|generate\s+.{0,15}(certificate|letter|noc)|'
    r'relieving\s+letter|salary\s+certificate|noc\s+for)\b', re.I
)

# Medical / treatment / surgery coverage is governed by the health-insurance policy
# (HR General), NOT admin reimbursement (travel/certification/equipment). A query that
# combines a medical term with a reimburse/cover/claim term routes to HR's policy search.
_KW_MEDICAL_TERM = re.compile(
    r'\b(surger\w*|operation|hospitali[sz]ation|hospital\s+(bill|expense)|'
    r'cosmetic|plastic\s+surgery|dental|maternity\s+(expense|bill|cost)|'
    r'treatment|medical\s+(bill|expense|procedure|treatment|emergency)|'
    r'\bmedical\b|illness|chemotherapy|dialysis|in[- ]?patient|out[- ]?patient|'
    r'\bopd\b|\bipd\b)\b', re.I
)
_KW_REIMB_OR_COVER = re.compile(
    r'\b(reimburs\w*|cover(ed|age|s)?|claim\w*|paid\s+by|insur\w*)\b', re.I
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

# People search by skill or role — "find Python developers", "list our QA
# engineers", "who knows React", "find a senior architect". The role noun is the
# disambiguator: an install request ("install Python", "setup Node") carries no
# role noun, so it never matches here, while these phrasings would otherwise fall
# through to the LLM router, which over-anchors on the tech word and misroutes to
# software_install.
_KW_HR_PEOPLE_ROLE = re.compile(
    r'\b(?:find|show|list|search|get|any|anyone|looking\s+for|'
    r'who\s+(?:are|is|knows?))\b'
    r'[\w\s.+#,/&-]*?\b'
    r'(?:developers?|engineers?|programmers?|coders?|designers?|testers?|'
    r'qa|analysts?|architects?|specialists?|experts?|consultants?|'
    r'scientists?|devops|sres?)\b'
    # ...or an explicit "who knows X" / "someone who knows X" skill lookup.
    r'|\b(?:who|someone|somebody|anyone)\s+knows?\s+\w+', re.I
)

# Availability / staffing follow-up — "are they available for work", "who is free
# for a project", "check their availability". Intent: project-allocation lookup.
_KW_HR_AVAILABILITY = re.compile(
    r'\b(available\s+for\s+(work|a?\s*project|allocation|staffing)|'
    r'are\s+(they|he|she)\s+available|who\s+is\s+(free|available)|'
    r'(their|his|her)\s+availability|free\s+for\s+a?\s*project|'
    r'currently\s+(allocated|available|free)|bench\s+(strength|status))\b', re.I
)

# Words to strip when extracting the SKILL term from a people-search query. Whatever
# remains after removing verbs, role nouns, and filler is treated as the skill to look
# up in Alchemy (e.g. "find senior python developers" -> "python"). Role-only queries
# ("find QA engineers") reduce to empty -> no Alchemy lookup, fall through to the agent.
_SKILL_SEARCH_STOPWORDS = frozenset({
    "find", "show", "list", "search", "get", "who", "whom", "knows", "know", "are",
    "is", "am", "looking", "look", "for", "any", "anyone", "someone", "somebody", "me",
    "all", "our", "us", "the", "a", "an", "with", "of", "in", "on", "and", "or", "to",
    "do", "does", "have", "has", "having", "that", "which", "needs", "need", "want",
    "wanted", "require", "required", "people", "person", "persons", "employee",
    "employees", "colleague", "colleagues", "staff", "member", "members", "team",
    "teams", "resource", "resources", "folks", "skilled", "skill", "skills", "skillset",
    "expertise", "expert", "experts", "experienced", "experience", "proficient",
    "proficiency", "good", "strong", "specialist", "specialists", "developer",
    "developers", "engineer", "engineers", "programmer", "programmers", "coder",
    "coders", "designer", "designers", "tester", "testers", "qa", "analyst", "analysts",
    "architect", "architects", "consultant", "consultants", "scientist", "scientists",
    "devops", "sre", "sres", "senior", "junior", "lead", "leads", "sr", "jr", "associate",
})


def _extract_skill_term(query: str) -> str:
    """Pull the skill phrase out of a people-search query (best-effort, lowercase)."""
    tokens = re.findall(r"[a-zA-Z0-9.+#]+", (query or "").lower())
    return " ".join(t for t in tokens if t not in _SKILL_SEARCH_STOPWORDS).strip()


# Explicit "by skill" phrasings that don't carry a role noun (so _KW_HR_PEOPLE_ROLE
# misses them): "people skilled in AWS", "who has python expertise", "good at React".
_KW_SKILL_PHRASING = re.compile(
    r'\b(skilled|proficient|proficiency|expertise|experienced|hands[- ]on|'
    r'good\s+at|strong\s+in|worked\s+(with|on)|knows?)\b', re.I
)


_KW_ADMIN_REIMB = re.compile(
    r'\b(reimburs\w*|expense\s+(policy|claim|process|limit)|'
    r'claim\s+(policy|process)|certification\s+reimburs|'
    r'travel\s+reimburs|medical\s+reimburs|'
    r'how\s+(to|can\s+i)\s+(claim|reimburse|raise\s+reimburs))\b', re.I
)

_KW_TRAVEL_REQUEST = re.compile(
    r'\b(business\s+travel|travel\s+request|apply\s+for\s+travel|submit\s+travel|'
    r'travel\s+approval|request\s+(a\s+)?trip|book\s+(a\s+)?business\s+trip|'
    r'official\s+travel|work\s+trip|travelling\s+for\s+(work|business|office)|'
    r'need\s+to\s+travel|plan\s+(a\s+)?business\s+trip|international\s+travel|'
    r'visa\s+(for\s+travel|request|process)|travel\s+visa)\b', re.I
)

_KW_TRAVEL_EXPENSE = re.compile(
    r'\b(travel\s+expense|trip\s+expense|post[- ]trip|after\s+(the\s+)?trip|'
    r'submit\s+travel\s+expense|file\s+(travel\s+)?expense|'
    r'raise\s+expense\s+(for\s+)?trip|trip\s+claim|travel\s+claim|'
    r'expense\s+(for\s+my\s+)?trip)\b', re.I
)

_KW_TRAVEL_STATUS = re.compile(
    r'\b(my\s+travel\s+(request|status|requests?)|'
    r'travel\s+approval\s+status|check\s+travel|'
    r'status\s+of\s+(my\s+)?travel)\b', re.I
)

_KW_ADMIN_PARKING = re.compile(
    r'\b(parking\s+(sticker|pass|request|info)|'
    r'register\s+(my\s+)?(vehicle|bike|car|two[- ]?wheeler|four[- ]?wheeler)|'
    r'surrender\s+parking)\b', re.I
)

# Parking *charges* — a pure info question ("how much is parking?"), distinct from
# requesting a sticker. Checked before _KW_ADMIN_PARKING. Matches "charge/cost/fee/
# rate/price/how much/rent" within ~30 chars of "parking", in either order.
_KW_ADMIN_PARKING_CHARGES = re.compile(
    r'\bparking\b.{0,30}\b(charges?|costs?|fees?|rates?|prices?|pricing|how\s+much|amount|rent)\b'
    r'|\b(charges?|costs?|fees?|rates?|prices?|pricing|how\s+much)\b.{0,30}\bparking\b', re.I
)

_KW_ADMIN_FACILITY = re.compile(
    r'\b(ac\s+(not|isn\'?t|is\s+not)|'
    r'ac\b.{0,40}\b(not\s+working|broken|issue|problem)|'
    r'air\s+condition\w*(\s+.{0,30})?\s*(not|broken|issue)|'
    r'lights?\s+(not|broken|flickering)|plumbing\s+(issue|leak|broken)|'
    r'washroom\s+(dirty|issue|problem)|electrical\s+(issue|problem)|'
    r'housekeeping|facility\s+(complaint|issue|problem|ticket)|'
    r'file\s+(a\s+)?(facility|maintenance|ac|hvac)\s+(complaint|ticket|issue)|'
    r'furniture\s+(broken|damaged)|'
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

_KW_ADMIN_CABIN = re.compile(
    r'\b(where\s+(is|are|can\s+i\s+find)\s+(the\s+)?(hr|admin|it|pmo|human\s+resources?|it\s+support)|'
    r'(hr|admin|it\s+support|pmo)\s+(cabin|room|floor|desk|location|office|sit|located|department)|'
    r'cabin\s+(number|of|for|directory)|'
    r'which\s+(cabin|room|floor)\s+(is|does)\s+(hr|admin|it|pmo)|'
    r'where\s+to\s+(find|meet|go\s+to|reach)\s+(hr|admin|it|pmo))\b',
    re.I,
)

_KW_ADMIN_VISITOR = re.compile(
    r'\b(visitor|guest)\s+(pass|entry|registration|register)|'
    r'register\s+(a\s+|my\s+)?(visitor|guest)|'
    r'(request|need|book|get)\s+(a\s+|an\s+)?(visitor|guest)\s+pass\b', re.I
)

# Information-style queries need a stricter form-match threshold so a loosely-related
# form (e.g. Visitor Pass) doesn't win over a genuinely matching one (e.g. a future
# Employee Referral Form). Action-style queries ("I need a X", "request a X") keep the
# default lower threshold.
_INFO_QUERY_RE = re.compile(
    r'\bhow\s+(do\s+i|can\s+i|to)\b|\bwhat\s+(is|are)\b|\btell\s+me\b|\bexplain\b',
    re.I,
)

_KW_BOOKSHELF_RETURN = re.compile(
    r'\b(return\s+(my\s+|the\s+|a\s+)?book|'
    r'i\s+(have\s+)?finished\s+(reading|the\s+book)|'
    r'give\s+back\s+(my\s+|the\s+|a\s+)?book|'
    r'hand\s+(back|in)\s+(my\s+|the\s+|a\s+)?book)\b',
    re.I,
)

_KW_BOOKSHELF_EXTEND = re.compile(
    r'\b(extend\s+(my\s+|the\s+)?(book|due\s+date|borrow|loan)|'
    r'renew\s+(my\s+|the\s+|a\s+)?book|'
    r'(need|want)\s+more\s+time\s+(on|for|with)\s+(my\s+|the\s+)?book|'
    r'keep\s+(the\s+|my\s+)?book\s+(for\s+)?(more|longer|another))\b',
    re.I,
)

_KW_BOOKSHELF_STATUS = re.compile(
    r'\b(my\s+(book\s+)?(borrows?|requests?)|'
    r'check\s+(my\s+)?book\s+request|book\s+request\s+status|'
    r'borrowed\s+books?|books?\s+i\s+(have\s+)?borrowed|'
    r'what\s+books?\s+do\s+i\s+have|my\s+(borrowed\s+)?library)\b',
    re.I,
)

# General discovery / browse — covers all the natural variations in the spec:
# "I want a book", "need a book", "looking for something to read",
# "I need learning material", "show books", "browse books", "recommend a book".
_KW_BOOKSHELF = re.compile(
    r'\b('
    r'bookshelf|book\s*shelf|'
    r'borrow\s+(a\s+|an\s+|the\s+)?book|'
    r'issue\s+(a\s+|an\s+|the\s+)?book|'
    r'company\s+library|office\s+library|library\s+(catalog|catalogue|books?)|'
    r'available\s+books?|books?\s+available|'
    r'book\s+request|request\s+(a\s+|an\s+|the\s+)?book|'
    r'lend\s+me\s+(a\s+|an\s+|the\s+)?book|'
    r'check\s+(?:my\s+)?book\s+request|'
    # Natural discovery variations
    r'(i\s+)?(want|need|like|require)\s+(a\s+|an\s+|some\s+)?book|'
    r'looking\s+for\s+(a\s+|an\s+|some\s+)?(book|reading\s+material|something\s+to\s+read)|'
    r'(reading|learning|study)\s+material|'
    r'(show|browse|see|view|find|recommend|suggest)\s+(me\s+)?(some\s+|the\s+|any\s+)?(book|books|library)|'
    r'books?\s+on\s+[a-z]'
    r')\b',
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
    r'\b(vpn|'
    r'(connect|setup|set\s+up|configure|use|access|install)\s+\w*\s*vpn|'
    r'vpn\s+(not|issue|problem|access|connect|setup|config\w*)|'
    r'password\s+reset|network\s+(issue|problem|not|down|slow))\b', re.I
)
_KW_IT_LICENSE = re.compile(
    r'\b(need|want|request|get)\s+(a\s+)?(claude|copilot|github\s+copilot|'
    r'loveable|jetbrains|intellij|webstorm)\s*(license|access|seat)?\b', re.I
)

# IT hardware peripheral requests ("I need headphones", "want a mouse").
# Excludes damage/issue reports and how-to questions.
_KW_IT_ASSET_REQUEST = re.compile(
    r'\b(?:need|want|require|request|get\s+me|give\s+me|provide|order|procure|arrange)\b'
    r'.{0,30}'
    r'\b(?:headphones?|headset|mouse|mice|monitor|external\s+monitor|'
    r'keyboard|webcam|web\s+cam|ethernet(?:\s+cable)?|lan\s+cable|network\s+cable|'
    r'usb\s+hub|docking\s+station|dock|external\s+(?:drive|disk|ssd|hdd)|'
    r'hdmi(?:\s+cable)?|displayport\s+cable|vga\s+cable)\b',
    re.I,
)

# Admin office supply requests ("I need pens", "want markers", "need a notebook").
_KW_ADMIN_SUPPLY_REQUEST = re.compile(
    r'\b(?:need|want|require|request|get\s+me|give\s+me|provide|order|procure|arrange)\b'
    r'.{0,30}'
    r'\b(?:pens?|markers?|whiteboard\s+markers?|notebooks?|notepads?|'
    r'stationery|sticky\s+notes?|folders?|binders?|highlighters?|staplers?|scissors)\b',
    re.I,
)

# Training-license request — any supported platform (Udemy, Coursera, …).
_KW_PMO_TRAINING = re.compile(
    r'\budemy\b|\bcoursera\b|\b(training|course|online[\s-]?learning)\s+license\b', re.I
)

_KW_PMO = re.compile(
    r'\b(project\s+(status|report|list|summary)|list\s+(all\s+)?projects|'
    r'active\s+projects|company\s+projects|our\s+projects|'
    r'(udemy|coursera)\s+(license|seat|access)|training\s+license)\b', re.I
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

# Explicit community search: capture group 1 = the topic to search for
_KW_MS365_COMMUNITY_SEARCH = re.compile(
    r'(?:'
    r'search\s+(?:the\s+|our\s+|in\s+)?(?:communit(?:y|ies)|viva\s+engage|yammer)\s+(?:for|about|on)\s+'
    r'|what(?:\'?s|\s+has\s+been|\s+did\s+anyone|\s+has\s+anyone)?\s+(?:posted?|shared|said|discussed|mentioned)\s+(?:about|on|regarding)\s+'
    r'|has\s+anyone\s+(?:posted|asked|mentioned|discussed|shared|said)\s+(?:about|on)\s+'
    r')(.+)', re.I
)

_KW_COMPANY_INFO = re.compile(
    r'\b(about\s+(aligned\s*automation|the\s+company|aaspl|centriq)|'
    r'company\s+(info|details|overview|profile|value|values)|'
    r'what\s+is\s+aligned|tell\s+me\s+about\s+(aligned|aaspl|the\s+company)|'
    r'(4|four)\s*c[\'’]?s?|core\s+values?|company\s+values?)\b', re.I
)

# Company-project knowledge base (summaries / demo transcripts / details from the
# SharePoint Projects tree). Deliberately DISTINCT from _KW_PMO (which owns project
# status/tracking) — this targets demos, transcripts, and "what did we deliver/build":
# overlapping phrasings like "project summary"/"company projects" stay with PMO.
_KW_COMPANY_PROJECTS = re.compile(
    r'\b((demo|demonstration|walkthrough)\s+(of|for)\b|'
    r'what\s+was\s+dem(o|onstrat)|'
    r'(demo|project)\s+transcript|transcript\s+(of|for)\s+\w+\s+project|'
    r'project\s+(details|recap|deck|writeup|write-up)|'
    r'(details|recap)\s+(of|for|on)\s+the\s+\w+\s+project|'
    r'summar(y|ise|ize)\s+(of\s+)?the\s+\w+\s+project|'
    r'what\s+(did|have)\s+we\s+(build|built|deliver|delivered)\s+for\b|'
    r'(client|customer)\s+projects?\b)', re.I
)

# Zoho People — delegated per-user data
_KW_ZOHO_TIMESHEET = re.compile(
    r'\b(my\s+timesheet|timesheet|hours?\s+logged|work\s+hours?|log\s+hours?|'
    r'did\s+i\s+log|time\s+entries?)\b', re.I
)
_KW_ZOHO_ATTENDANCE = re.compile(
    r'\b(my\s+attendance|attendance\s+(summary|report|this\s+month)|'
    r'days?\s+present|days?\s+absent|wfh\s+days?|late\s+mark|punch\s+in|punch\s+out)\b', re.I
)
_KW_ZOHO_APPRAISAL = re.compile(
    r'\b(my\s+appraisal|appraisal\s+status|performance\s+review|'
    r'kpi\s+status|goal\s+setting|rating\s+status|appraisal\s+cycle)\b', re.I
)
_KW_ZOHO_TRAINING = re.compile(
    r'\b(my\s+training(s|s\s+records?)?|training\s+history|courses?\s+completed|'
    r'learning\s+history|upcoming\s+training|training\s+programs?)\b', re.I
)
_KW_ALCHEMY_MY_SKILLS = re.compile(
    r'\b(my\s+skills?\s+(in\s+alchemy|portal|directory)|alchemy\s+skills?|'
    r'skills?\s+in\s+alchemy|what\s+skills?\s+do\s+i\s+have|my\s+skill\s+set)\b', re.I
)
# Matches update/add/edit/change intent for skills — these are handled by the
# frontend SkillsEditorWidget, not the Alchemy backend route.
_KW_SKILLS_EDIT_INTENT = re.compile(
    r'\b(update|edit|add|change|manage|set|modify|remove|delete)\b.{0,40}\b(skill|skills|certification|cert)\b|'
    r'\b(skill|skills|certification|cert)\b.{0,40}\b(update|edit|add|upload|manage|change)\b|'
    r'\b(how\s+(can|do|to)\s+(i\s+)?(update|edit|add|change|manage))', re.I
)
_KW_ALCHEMY_ORG = re.compile(
    r'\b(org\s+(skills?|capabilities)|top\s+skills?\s+in\s+(company|org|team)|'
    r'skills?\s+(overview|summary|stats)|popular\s+skills?|trending\s+skills?|'
    r'skills?\s+by\s+interest|alchemy\s+(overview|summary|stats))\b', re.I
)

# Off-topic personal wishes — requests that are not actionable company processes.
# Catches phrases like "I want a salary hike", "make me a manager", "promote me",
# "I deserve a raise", "I want to be the CEO", etc.
_KW_OFF_TOPIC = re.compile(
    r'\b('
    # Salary / compensation desires
    r'(i\s+want|i\s+need|i\s+wish|give\s+me|i\s+deserve)\s+(a\s+)?'
    r'(salary\s+(hike|raise|increase|increment|revision)|(pay\s+)?(raise|hike|increment)|'
    r'(higher|better|more)\s+(pay|salary|compensation|package|ctc)|(more\s+)?bonus(es)?|'
    r'stock\s+options?|equity)|'
    r'increase\s+my\s+(salary|pay|compensation|ctc|package)|'
    r'double\s+my\s+(salary|pay)|'
    # Role / promotion desires
    r'(i\s+want|i\s+need|i\s+wish|give\s+me|i\s+deserve)\s+(a\s+)?promotion\b|'
    r'promote\s+me\b|'
    r'(make\s+me|i\s+want\s+to\s+be|i\s+should\s+be|i\s+must\s+be)\s+((a|the)\s+)?'
    r'(manager|director|vp|ceo|cto|coo|lead|head|team\s+lead|senior\s+\w+)\b|'
    r'i\s+(should|must|deserve\s+to)\s+be\s+((a|the)\s+)?(manager|director|lead|vp|ceo)\b|'
    # Quitting / resigning
    r'i\s+want\s+(to\s+)?(quit|resign|leave\s+the\s+company|leave\s+this\s+job)\b|'
    # Fire someone
    r'fire\s+my\s+(manager|boss|team\s+lead)\b'
    r')',
    re.I,
)


# Salary credit / payment date — always answered with a fixed policy reply.
_KW_SALARY_CREDIT = re.compile(
    r'\b('
    r'salary\s+(credit|credited|payment|paid|transfer|deposit|disburs\w*|processing)\s*(date|day|when|time)?\b|'
    r'when\s+(is|will|does|do)\s+.{0,20}salary\b|'
    r'(credit|payment|transfer|disburs\w*)\s+date\s+(of|for)?\s*(the\s+)?salary\b|'
    r'salary\s+(credit\s+date|pay\s+date|payment\s+date)\b|'
    r'(payroll|salary)\s+(processing|transfer|credit)\s+(date|day|schedule)\b|'
    r'when\s+do\s+we\s+get\s+(paid|salary)\b|'
    r'salary\s+(cycle|date)\b'
    r')',
    re.I,
)

_SALARY_CREDIT_RESPONSE = (
    "Salaries are credited on the **last working day of every month**. "
    "If the last day of the month falls on a weekend or public holiday, "
    "the credit is processed on the preceding working day."
)


def _try_keyword_route(message: str) -> dict | None:
    """Classify intent via keyword/regex matching — 0 LLM calls, <1ms.

    Returns a routing dict if the intent is unambiguous, None to fall
    through to the LLM router for ambiguous queries.
    """
    text = message.strip()

    # Off-topic personal wishes — not actionable company processes
    if _KW_OFF_TOPIC.search(text):
        return {"domain": "general", "confidence": 1.0,
                "reasoning": "Keyword: off-topic personal wish",
                "sub_intent": "off_topic", "entities": {}}

    # Greetings / small talk
    if _KW_GREETING.match(text):
        return {"domain": "general", "confidence": 1.0,
                "reasoning": "Keyword: greeting/social",
                "sub_intent": "greeting", "entities": {}}

    # Fixed answer: salary credit date
    if _KW_SALARY_CREDIT.search(text):
        return {"domain": "general", "confidence": 1.0,
                "reasoning": "Keyword: salary credit date — fixed answer",
                "sub_intent": "salary_credit_date", "entities": {}}

    # HR — leave cancellation (checked before policy so "cancel my leave" doesn't hit "leave policy")
    if _KW_LEAVE_CANCEL.search(text):
        return {"domain": "hr", "confidence": 1.0,
                "reasoning": "Keyword: leave cancellation",
                "sub_intent": "leave_cancel", "entities": {}}

    # HR — policy queries
    if _KW_HR_POLICY.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: HR policy query",
                "sub_intent": "policy_query", "entities": {}}

    # HR — employee referral → quick-choice card (zero-LLM, instant)
    if _KW_HR_REFERRAL.search(text):
        return {"domain": "referral_choice", "confidence": 1.0,
                "reasoning": "Keyword: employee referral",
                "sub_intent": "referral_choice", "entities": {}}

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

    # HR — availability / staffing (project-allocation lookup). Checked before the
    # generic people search so "are they available for work" reaches the HR agent
    # (which calls get_employee_availability) rather than a fresh directory search.
    if _KW_HR_AVAILABILITY.search(text):
        return {"domain": "hr", "confidence": 0.9,
                "reasoning": "Keyword: employee availability / allocation",
                "sub_intent": "employee_search", "entities": {}}

    # HR — people search
    if _KW_HR_PEOPLE.search(text) or _KW_HR_PEOPLE_ROLE.search(text):
        return {"domain": "hr", "confidence": 0.9,
                "reasoning": "Keyword: people/directory search",
                "sub_intent": "employee_search", "entities": {}}

    # HR — Zoho People delegated: timesheet
    if _KW_ZOHO_TIMESHEET.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: timesheet query",
                "sub_intent": "timesheet", "entities": {}}

    # HR — Zoho People delegated: attendance
    if _KW_ZOHO_ATTENDANCE.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: attendance summary",
                "sub_intent": "attendance", "entities": {}}

    # HR — Zoho People delegated: appraisal
    if _KW_ZOHO_APPRAISAL.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: appraisal status",
                "sub_intent": "appraisal", "entities": {}}

    # HR — Zoho People delegated: training
    if _KW_ZOHO_TRAINING.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: training records",
                "sub_intent": "training", "entities": {}}

    # HR — Alchemy skills portal: my skills
    # Skip if it's an update/add/edit intent — those are handled by the frontend SkillsEditorWidget.
    if _KW_ALCHEMY_MY_SKILLS.search(text) and not _KW_SKILLS_EDIT_INTENT.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: alchemy my skills",
                "sub_intent": "alchemy_my_skills", "entities": {}}

    # HR — Alchemy skills portal: org overview
    if _KW_ALCHEMY_ORG.search(text):
        return {"domain": "hr", "confidence": 0.92,
                "reasoning": "Keyword: alchemy org skills overview",
                "sub_intent": "alchemy_skills_overview", "entities": {}}

    # HR — medical/treatment/surgery coverage (insurance policy), checked BEFORE the
    # admin reimbursement keyword so "will my surgery be reimbursed" goes to HR, not admin.
    if _KW_MEDICAL_TERM.search(text) and _KW_REIMB_OR_COVER.search(text):
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: medical/treatment coverage (insurance policy)",
                "sub_intent": "policy_query",
                "entities": {"policy_topic": "medical insurance coverage"}}

    # Admin — business travel request / status
    if _KW_TRAVEL_STATUS.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: travel status",
                "sub_intent": "travel_status", "entities": {}}

    if _KW_TRAVEL_EXPENSE.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: travel expense claim",
                "sub_intent": "travel_expense", "entities": {}}

    if _KW_TRAVEL_REQUEST.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: business travel request",
                "sub_intent": "travel_request", "entities": {}}

    # Admin — reimbursement / expense
    if _KW_ADMIN_REIMB.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: reimbursement/expense",
                "sub_intent": "policy_query",
                "entities": {"policy_topic": "reimbursement"}}

    # Admin — parking charges (info query) — checked before the sticker keyword so
    # "what are the parking charges for 2-wheeler/4-wheeler" doesn't fall through to
    # the semantic router (which used to mis-match it to a PF query).
    if _KW_ADMIN_PARKING_CHARGES.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: parking charges",
                "sub_intent": "parking_charges", "entities": {}}

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

    if _KW_ADMIN_CABIN.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: cabin/room location for a department",
                "sub_intent": "cabin_info", "entities": {}}

    # Admin — visitor / guest pass (must precede IT install to avoid
    # "I need to request a visitor pass" → software_install misroute)
    if _KW_ADMIN_VISITOR.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: visitor/guest pass",
                "sub_intent": "visitor_pass", "entities": {}}

    # Admin — Bookshelf Buddy (specific sub-intents first, then generic discovery)
    if _KW_BOOKSHELF_EXTEND.search(text):
        return {"domain": "admin", "confidence": 0.97,
                "reasoning": "Keyword: extend / renew book borrow",
                "sub_intent": "bookshelf.extend", "entities": {}}
    if _KW_BOOKSHELF_RETURN.search(text):
        return {"domain": "admin", "confidence": 0.97,
                "reasoning": "Keyword: return a borrowed book",
                "sub_intent": "bookshelf.return", "entities": {}}
    if _KW_BOOKSHELF_STATUS.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: my borrows / book request status",
                "sub_intent": "bookshelf.status", "entities": {}}
    if _KW_BOOKSHELF.search(text):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: bookshelf / book discovery / borrow",
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

    # MS365 — explicit community search (check before generic Yammer feed route)
    _cs = _KW_MS365_COMMUNITY_SEARCH.search(text)
    if _cs:
        topic = _cs.group(1).strip().rstrip("?.! ")
        if topic:
            return {"domain": "ms365", "confidence": 0.95,
                    "reasoning": "Keyword: search Viva Engage communities",
                    "sub_intent": "community_search", "entities": {"query": topic}}

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

    # IT — hardware peripheral request ("I want headphones", "need a mouse")
    if _KW_IT_ASSET_REQUEST.search(text) and not re.search(
        r'\b(broken|not\s+working|issue|problem|repair|fix|replace|damaged|faulty|how\s+do|how\s+to|connect)\b',
        text, re.I
    ):
        return {"domain": "it_support", "confidence": 0.95,
                "reasoning": "Keyword: IT asset/peripheral request",
                "sub_intent": "asset_request", "entities": {}}

    # Admin — office supply request ("I need pens", "want markers", "need a notebook")
    if _KW_ADMIN_SUPPLY_REQUEST.search(text) and not re.search(
        r'\b(broken|not\s+working|issue|problem|how\s+do|how\s+to)\b',
        text, re.I
    ):
        return {"domain": "admin", "confidence": 0.95,
                "reasoning": "Keyword: office supply request",
                "sub_intent": "office_supply_request", "entities": {}}

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

    # PMO — Udemy / Coursera / training license request (must precede the generic PMO project route)
    if _KW_PMO_TRAINING.search(text):
        platform = "Coursera" if re.search(r'\bcoursera\b', text, re.I) else "Udemy"
        return {"domain": "pmo", "confidence": 0.95,
                "reasoning": f"Keyword: {platform} / training license request",
                "sub_intent": "udemy_license", "entities": {"platform": platform}}

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

    # Company projects (summaries / demo transcripts / details) — general agent
    if _KW_COMPANY_PROJECTS.search(text):
        return {"domain": "general", "confidence": 0.9,
                "reasoning": "Keyword: company project query",
                "sub_intent": "company_projects", "entities": {}}

    return None  # Ambiguous — fall through to LLM router


def _extract_entities(message: str, domain: str, sub_intent: str) -> dict:
    """Extract entities for the few sub_intents that carry them, reusing the existing keyword
    regexes. The semantic router supplies domain + sub_intent; only install / leave / community
    search / desk-key need structured entities, and each already has a deterministic extractor.
    Every other intent returns {} — the domain agent re-parses from the raw message, exactly as
    the keyword router's many `entities: {}` branches always did. Fail-soft: never raises."""
    text = (message or "").strip()
    try:
        if sub_intent == "software_install":
            m = _KW_IT_INSTALL.search(text) or _KW_IT_INSTALL_NEED.search(text)
            if m:
                sw = m.group(1).strip()
                if sw and 1 < len(sw) < 35:
                    return {"software_name": sw}
            return {}
        if sub_intent in ("submit_leave", "zoho_leave_fastpath"):
            return _try_extract_leave_params(text) or {}
        if sub_intent == "community_search":
            cs = _KW_MS365_COMMUNITY_SEARCH.search(text)
            if cs:
                topic = cs.group(1).strip().rstrip("?.! ")
                if topic:
                    return {"query": topic}
            return {}
        if sub_intent == "desk_key_request":
            d = re.search(r'\b([A-Za-z]{1,3}[- ]?\d{1,3})\b', text)
            if d:
                return {"desk_number": d.group(1)}
            return {}
    except Exception:  # noqa: BLE001 — entity extraction is best-effort
        return {}
    return {}


# ═══════════════════════════════════════════════════════════════════════════════
# 4. GRAPH NODES
# ═══════════════════════════════════════════════════════════════════════════════

_STICKY_DOMAINS = {"hr", "admin", "it_support", "pmo", "functional_manager", "ms365"}

# ── Continuation detection (sticky-domain gate) ────────────────────────────────
# A message keeps the conversation's sticky domain ONLY when it depends on prior context
# (a genuine follow-up). The signal is *content*, never *length*: "wifi not working" is short
# but is a brand-new request, while "any update on that?" is a follow-up. Length-based
# stickiness was the rogue rule that pinned an IT question to a stale HR thread.
_CONTEXT_REFS = {"it", "that", "this", "those", "these", "same", "above", "any", "about",
                 "one", "ones"}
# Terse acknowledgements / option-picks that only make sense as a reply to the prior turn.
_CONTINUATION_WORDS = {"yes", "y", "no", "n", "ok", "okay", "correct", "sure", "right",
                       "yep", "yeah", "nope", "thanks", "thank"}
_QUESTION_PHRASES = {
    "could you", "can you", "please provide", "please share", "let me know",
    "what is", "which floor", "which area", "what type", "please tell",
    "kindly", "may i know", "please mention", "please specify",
}


def _ai_asked_question(last_ai: str) -> bool:
    """True when the last assistant turn posed a question the user is likely answering."""
    low = (last_ai or "").lower()
    return "?" in (last_ai or "") or any(p in low for p in _QUESTION_PHRASES)


def _is_continuation(last_human: str, last_ai: str) -> bool:
    """True when the message depends on prior context (a real follow-up) rather than being a
    self-standing new request. Deliberately length-agnostic — see _CONTEXT_REFS note.

    A confident new-domain semantic/keyword signal is handled *before* this is consulted (the
    overrides + topic-switch release), so a follow-up that happens to carry a reference token
    but clearly switches domains is still released, not trapped here."""
    text = (last_human or "").strip().lower()
    if not text:
        return True  # nothing substantive → don't break stickiness
    if _ai_asked_question(last_ai):
        return True
    if "what about" in text or "how about" in text:
        return True
    if re.match(r"^\s*(option|choice)\s*\d+\b", text) or re.fullmatch(r"\d{1,2}", text):
        return True
    words = set(re.findall(r"[a-z0-9']+", text))
    return bool(words & _CONTEXT_REFS or words & _CONTINUATION_WORDS)


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
        return {
            "domain": "deeplink",
            "route_confidence": 1.0,
            "route_reasoning": "Fast-path: leave balance query -> deeplink/Zoho.",
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
    # Data-driven stickiness override: a confident NEW-domain signal from the semantic router
    # (exact dictionary, or high-tier embedding k-NN) is a genuine topic switch and must override
    # stickiness too — not just the keyword layer. Otherwise a short, novel-phrasing new-topic
    # question after an agent reply (e.g. "what's the POSH policy?" mid IT chat) gets swallowed.
    # exact is O(1)/free; classify is one embedding, spent only when the exact dictionary misses
    # (so exact hits stay embedding-free). Both are reused at their return points below.
    exact = SemanticRouterService.exact_match(last_human)
    decision = SemanticRouterService.classify(last_human) if exact is None else None
    semantic_overrides_sticky = bool(
        (exact is not None and exact.domain != existing_domain)
        or (decision is not None and decision.tier == "high" and decision.domain != existing_domain)
    )
    # Topic-switch release (closes the ambiguous-tier "dead zone"): the fresh message has a real
    # semantic signal (>= ambiguity floor → tier high/ambiguous) whose top-k candidate domains do
    # NOT include the sticky domain at all. That is a new subject, not a follow-up — release even
    # when the top-1 only reaches the ambiguous tier. Generalises beyond exact/high without regex.
    topic_switch = bool(
        decision is not None
        and decision.tier in ("high", "ambiguous")
        and existing_domain not in (decision.candidate_domains or [])
    )
    if existing_domain in _STICKY_DOMAINS and not keyword_overrides_sticky and not semantic_overrides_sticky:
        last_ai = _last_ai_message(state.get("messages", []))
        # Priority 1 — a fresh signal pointing to a different domain is a topic switch: never sticky.
        # Priority 2 — a genuine follow-up (references prior context / terse ack / AI just asked):
        #   stay in the sticky domain. Length is NOT a factor.
        # Otherwise — a self-standing new request with no usable away-signal (tier low/unavailable):
        #   fall through to normal classification. This is the key fix: when the classifier could
        #   not even look (tier == "unavailable", e.g. ml01 saturated) a substantive message is no
        #   longer pinned to the stale domain — the router stops getting *more* confident as it
        #   knows *less*. Only true continuations stay sticky through an outage.
        if not topic_switch and _is_continuation(last_human, last_ai):
            return {
                "domain": existing_domain,
                "route_confidence": 0.95,
                "route_reasoning": f"Follow-up in context of {existing_domain} — staying sticky.",
                "sub_intent": "followup",
                "entities": {},
            }
        if topic_switch:
            pass

    # Fast-path: bypass LLM entirely for unambiguous leave requests
    leave_params = _try_extract_leave_params(last_human)
    if leave_params:
        return {
            "domain": "deeplink",
            "route_confidence": 1.0,
            "route_reasoning": "Zoho leave params extracted without LLM.",
            "sub_intent": "zoho_leave_fastpath",
            "entities": leave_params,
        }

    # Fast Intent Dictionary (layer 4.5): O(1) exact normalised match against the curated/learned
    # phrasing map (computed above for the stickiness override; reused here). Microseconds, zero
    # ml01 load, 100% precise — handles the high-frequency head and every seeded exact phrasing.
    if exact is not None:
        entities = _extract_entities(last_human, exact.domain, exact.sub_intent)
        return {
            "domain": exact.domain,
            "route_confidence": 1.0,
            "route_reasoning": exact.reasoning,
            "sub_intent": exact.sub_intent,
            "entities": entities,
        }

    # Zero-LLM keyword fast-exit (layer 4.5): keyword routes with confidence=1.0 are deterministic
    # and must NOT be overridden by the semantic router (which can re-route them to an LLM agent
    # and cause timeouts). Fire before the semantic high-tier check below.
    if keyword_result and keyword_result.get("confidence", 0) >= 1.0:
        return {
            "domain": keyword_result["domain"],
            "route_confidence": 1.0,
            "route_reasoning": keyword_result["reasoning"],
            "sub_intent": keyword_result["sub_intent"],
            "entities": keyword_result.get("entities", {}),
        }

    # Semantic intent router (layer 5): embed the message and match it against the closed set of
    # labeled seed utterances (pgvector cosine k-NN). A strong, top-k-agreeing match routes
    # directly with 0 LLM calls and — because the output space is the stored labels — cannot
    # hallucinate a domain the way the generative LLM router can. Generalises to novel paraphrases
    # the exact dictionary misses. Permanent replacement for the brittle keyword-regex bulk.
    # (Computed above when exact missed, for the stickiness override; reused here, never twice.)
    if decision is None:
        decision = SemanticRouterService.classify(last_human)
    if decision.tier == "high":
        entities = _extract_entities(last_human, decision.domain, decision.sub_intent)
        return {
            "domain": decision.domain,
            "route_confidence": decision.similarity,
            "route_reasoning": decision.reasoning,
            "sub_intent": decision.sub_intent,
            "entities": entities,
        }

    # Form Library (layer 5.5): match the message against admin-defined fillable forms
    # (pgvector cosine k-NN over enabled FormTemplate embeddings). A confident match short-
    # circuits to render the form inline — fully data-driven, so a brand-new form created by an
    # admin becomes chat-triggerable with no code change. Runs AFTER the curated exact/semantic-
    # high tiers (so a precise domain intent always wins) and reuses the LRU-cached embedding of
    # this same message (no extra ml01 call). Fail-soft: returns None if the embed model is down.
    # Stickiness is already handled by the early-return above, so a follow-up never lands here.
    try:
        from app.services.form_library_service import FormLibraryService
        _form_threshold = 0.80 if _INFO_QUERY_RE.search(last_human) else None
        form_match = FormLibraryService.match(last_human, threshold=_form_threshold)
    except Exception as e:  # noqa: BLE001
        form_match = None
    if form_match:
        return {
            "domain": "dynamic_form",
            "route_confidence": form_match["similarity"],
            "route_reasoning": f"Message matched the '{form_match['name']}' form.",
            "sub_intent": f"form:{form_match['id']}",
            "entities": {"form_template_id": form_match["id"]},
        }

    # Keyword fast-path: regex safety net beneath the semantic high tier. 0 LLM calls.
    # (Computed up-front so it could override stickiness; reused here. Phased out once the
    # semantic router's accuracy is confirmed against the eval set on live traffic.)
    if keyword_result:
        return {
            "domain": keyword_result["domain"],
            "route_confidence": keyword_result["confidence"],
            "route_reasoning": keyword_result["reasoning"],
            "sub_intent": keyword_result["sub_intent"],
            "entities": keyword_result.get("entities", {}),
        }

    # Ambiguous semantic match → hand the LLM router the semantic shortlist as a soft hint,
    # constraining the 8-way choice to 2-3 and sharply cutting hallucination. Low/unavailable
    # → plain LLM router (the original behaviour).
    candidate_domains = decision.candidate_domains if decision.tier == "ambiguous" else None
    try:
        result = await classify_intent_async(last_human, candidate_domains=candidate_domains)
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

# Short-lived cache for the proactive URL-library nudge (keyed on the raw query).
_app_nudge_cache: dict[str, tuple[str, float]] = {}
_APP_NUDGE_TTL = 120.0


def _app_directory_nudge(query: str) -> str:
    """Return a '[RELEVANT APPS]' block for a confident URL-library match, or ''.

    Surfaces an admin-registered app to ANY agent (not just the general one), so a relevant
    link can be mentioned mid-conversation. Uses a stricter threshold than the find_apps tool
    so unrelated chats aren't peppered with suggestions. Fail-soft and embedding-cache-reusing.
    """
    from app.config import settings as _s
    from app.services.app_directory_service import AppDirectoryService
    matches = AppDirectoryService.search_raw(
        query, k=2, threshold=_s.APP_DIRECTORY_NUDGE_THRESHOLD
    )
    if not matches:
        return ""
    lines = [
        "\n\n[RELEVANT APPS] The company offers these tools for this — if helpful, mention "
        "them by name with their link (markdown). Do not invent other apps or URLs:"
    ]
    for m in matches:
        lines.append(f"- {m['name']} ({m['url']}): {m['purpose']}")
    return "\n".join(lines)


async def feedback_lookup(state: AgentState) -> dict:
    """Fetch relevant past feedback for the current query and store as prompt context.

    Also runs the proactive URL-library nudge so a relevant registered app link can surface in
    any domain. Both the blocking Ollama embedding + DB queries run off the event loop via
    asyncio.to_thread so they never stall the async pipeline.
    """
    import time as _t
    import asyncio
    now = _t.time()

    last_human = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
        "",
    )
    if not last_human:
        return {}

    # ── Proactive URL-library nudge (independent of feedback availability) ──
    nudge_cached = _app_nudge_cache.get(last_human[:160])
    if nudge_cached and now - nudge_cached[1] < _APP_NUDGE_TTL:
        app_nudge = nudge_cached[0]
    else:
        try:
            app_nudge = await asyncio.to_thread(_app_directory_nudge, last_human)
        except Exception:
            app_nudge = ""
        _app_nudge_cache[last_human[:160]] = (app_nudge, now)
        if len(_app_nudge_cache) > 500:
            for k in sorted(_app_nudge_cache, key=lambda k: _app_nudge_cache[k][1])[:100]:
                _app_nudge_cache.pop(k, None)

    # ── Past-feedback context (gated on having enough feedback rows) ──
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

    domain = state.get("domain", "unknown") or "unknown"
    fb_ctx = ""
    if _feedback_count_cache["count"] >= 3:
        cache_key = f"{domain}:{last_human[:120]}"
        cached = _feedback_result_cache.get(cache_key)
        if cached and now - cached[1] < _FEEDBACK_RESULT_TTL:
            fb_ctx = cached[0]
        else:
            try:
                relevant = await asyncio.to_thread(
                    FeedbackService.get_relevant_feedback, domain, last_human, 3
                )
                fb_ctx = FeedbackService.build_feedback_prompt(relevant)
            except Exception:
                fb_ctx = ""
            _feedback_result_cache[cache_key] = (fb_ctx, now)
            if len(_feedback_result_cache) > 500:
                oldest = sorted(_feedback_result_cache, key=lambda k: _feedback_result_cache[k][1])
                for k in oldest[:100]:
                    _feedback_result_cache.pop(k, None)

    combined = (fb_ctx or "") + (app_nudge or "")
    return {"feedback_context": combined} if combined else {}


def hr_agent(state: AgentState):
    """HR Agent — handles leave and policies."""
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    sub_intent = state.get("sub_intent") or ""
    messages = state["messages"]

    # Pre-fetch policy for policy_query sub_intent — avoids a slow LLM tool-calling
    # round-trip (saves one full inference pass on ml01 and eliminates timeout risk).
    _hr_policy_context = ""
    if sub_intent == "policy_query":
        _user_q = next((m.content for m in reversed(messages) if isinstance(m, HumanMessage)), "")
        if _user_q:
            try:
                _policy_result = HRService.search_policies(str(_user_q), limit=3)
                if _policy_result and "No policies found" not in _policy_result:
                    _hr_policy_context = f"\n[PRE-SEARCHED HR POLICY]\n{_policy_result}\n[END POLICY]\n"
            except Exception:
                pass

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
            f"- Cancel/withdraw leave → call get_my_leaves(email='{user_email}') to list leaves, "
            f"then call cancel_leave(email='{user_email}', leave_id=<id>)\n"
            f"- Policy question → search_hr_policies, answer from result\n"
            f"- Who is X / single person's profile → get_employee_profile(name_or_email)\n"
            f"- Find people by SKILL/technology (python, react, aws...) → search_alchemy_skill_experts(skill)\n"
            f"- Employee search by function/department/multiple people → search_employee_directory\n"
            f"- Are they available for work? / is X free for a project → get_employee_availability(name_or_email) "
            f"for each person in question\n"
            f"- Org chart / team → get_org_chart or get_team_roster\n"
            f"- Team absence → get_team_absence_for(manager_email='{user_email}')\n"
            f"- Document → generate_hr_document(target_email='{user_email}')\n"
            f"- Grievance → collect category + description + ask if anonymous, THEN submit_grievance_for\n"
            f"- Onboarding → trigger_onboarding_checklist\n"
            f"- Offboarding → trigger_offboarding_checklist\n"
            f"- HR query (proof letter, PF, insurance, attendance issue, resignation, etc.) → "
            f"FIRST search_hr_policies. If no policy answers it or HR action is needed, "
            f"ASK employee to confirm, THEN submit_hr_query(email='{user_email}', category, subject, description)\n"
            f"- Employee referral / 'where do I refer' / 'referral portal' → "
            f"call search_hr_policies('employee referral') AND find_apps('zoho recruit referral'); "
            f"answer the policy then present the portal link\n"
            f"- Where to do X / which app/portal/tool for X → find_apps(query)\n\n"
            f"Never answer from training knowledge — use tools only.\n"
            + (f"If [PRE-SEARCHED HR POLICY] is present in context:\n"
               f"- DO NOT paste or quote the raw policy text verbatim.\n"
               f"- Read the excerpts and answer the employee's SPECIFIC question in your own words.\n"
               f"- Use clear formatting: bold key terms, bullet points for lists, short paragraphs.\n"
               f"- Lead with a direct 1-2 sentence answer, then add relevant details.\n"
               f"- If the question asks 'what does X cover', list covered items clearly and call out exclusions.\n"
               f"- Do not call search_hr_policies — the policy is already provided.\n"
               if _hr_policy_context else ""),
        )
        guardrail = PromptService.get_guardrail("hr")
        feedback_ctx = (state.get("feedback_context") or "") + _hr_policy_context
        messages = [SystemMessage(content=base + guardrail + feedback_ctx)] + messages

    user_question = next((m.content for m in reversed(messages) if isinstance(m, HumanMessage)), "")

    # ── Deterministic skill-expert search ───────────────────────────────────────
    # "find python developers", "who knows react", "people skilled in AWS" must hit the
    # Alchemy skills portal (honouring ALCHEMY_SKILL_SEARCH_ENABLED) and return a clean,
    # display-ready list. We do NOT leave this to the weak agent model: it tends to pick
    # the internal directory tool (which ignores the flag) and its list then gets mangled
    # by the policy-framed summarizer. Only fires when a skill term actually resolves;
    # name / role-only / department searches reduce to empty or miss and fall through.
    # Trigger on the semantic router's decision (robust) OR the cheap keyword gate
    # (fail-safe). Either way the skill must actually RESOLVE below, so name/department
    # searches that slip in here simply fall through.
    _looks_like_people = (
        (state.get("sub_intent") == "employee_search")
        or _KW_HR_PEOPLE_ROLE.search(user_question)
        or _KW_SKILL_PHRASING.search(user_question)
    ) if isinstance(user_question, str) else False
    if _looks_like_people:
        skill_term = _extract_skill_term(user_question)
        if skill_term:
            try:
                result = search_alchemy_skill_experts.func(skill=skill_term, state=state)
            except Exception:
                result = ""
            _missed = (not result) or ("isn't a recognised skill" in result) \
                or result.startswith("No employees") or ("No employees found" in result)
            if not _missed:
                return {"messages": [AIMessage(content=result.strip())]}
    # ────────────────────────────────────────────────────────────────────────────

    # Skip context gate for action-oriented requests — they need tools, not cached answers.
    _action_sub = state.get("sub_intent") or ""
    _action_text_re = re.compile(
        r'\b(generate|create|make|give|get me|issue|draft|submit|apply|file)\b'
        r'.{0,40}\b(certificate|letter|noc|document|pdf|report|grievance|complaint|leave)\b', re.I
    )
    _skip_ctx = (_action_sub in {"document_request", "grievance", "onboarding", "offboarding",
                                  "apply_leave", "timesheet", "attendance", "appraisal",
                                  "training", "alchemy_my_skills", "alchemy_skills_overview"}
                 or bool(_action_text_re.search(user_question)))
    if not _skip_ctx:
        try:
            context_answer = PromptService.check_context_relevance("hr", user_question)
            if context_answer:
                return {"messages": [AIMessage(content=context_answer)]}
        except Exception:
            pass  # non-fatal — fall through to normal agent

    try:
        response = llm_controls.get_llm("agent", default_timeout=45).bind_tools(hr_tools).invoke(messages)
    except APIConnectionError:
        return {"messages": [AIMessage(content="I'm sorry, I'm having trouble connecting right now — please try again in a moment.")]}

    return {"messages": [response]}

async def deeplink_agent_node(state: AgentState):
    """Deep-Link Agent — automates Zoho leave, PowerApps complaints, and Payroll via Playwright."""
    # Fast-path: leave balance — call service directly, format response, 0 LLM calls
    if state.get("sub_intent") == "leave_balance":
        try:
            from app.services.leave_balance_sync import get_or_refresh
            user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
            result_data = get_or_refresh(user_email)
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
                else:
                    return {"messages": [AIMessage(content="Your leave balance data was retrieved but appears empty. Please try again or check Zoho People directly.")]}
            elif result_data.get("error") == "not_connected":
                return {"messages": [AIMessage(content="Please connect your Zoho account first. Go to **Settings > Connected Accounts** and click **Connect Zoho**.")]}
            elif result_data.get("error"):
                return {"messages": [AIMessage(content=f"I couldn't fetch your leave balance: {result_data['error']}. Please try again.")]}
        except Exception as _lb_err:
            pass

    # Fast-path: leave application params already extracted by regex — call tool directly, 0 LLM calls
    if state.get("sub_intent") == "zoho_leave_fastpath":
        entities = state.get("entities") or {}
        if entities.get("start_date") and entities.get("end_date"):
            try:
                from app.agents.deeplink_agent import submit_zoho_leave
                entities_with_email = {**entities, "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL}
                result_json = submit_zoho_leave.invoke(entities_with_email)
                result_data = json.loads(result_json)
                if result_data.get("success"):
                    return {"messages": [AIMessage(content=result_data["message"])]}
                # Session not set up or not configured — fall through to LLM agent
            except Exception as _fp_err:
                pass

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


# Marker the chat endpoint's _postprocess extracts into the `dynamic_form` interactive payload.
DYNAMIC_FORM_START = "[DYNAMIC_FORM_START]"
DYNAMIC_FORM_END = "[DYNAMIC_FORM_END]"

# Marker for zero-LLM quick-choice card widgets (e.g. referral: policy vs portal).
QUICK_CHOICE_START = "[QUICK_CHOICE_START]"
QUICK_CHOICE_END = "[QUICK_CHOICE_END]"


async def dynamic_form_agent_node(state: AgentState):
    """Form Library node — terminal, 0 LLM. Loads the matched FormTemplate and emits its schema
    inside [DYNAMIC_FORM_START]…[DYNAMIC_FORM_END] markers so _postprocess can turn it into the
    `dynamic_form` interactive widget the frontend renders inline."""
    entities = state.get("entities") or {}
    form_id = entities.get("form_template_id")
    try:
        from app.services.form_library_service import FormLibraryService
        tpl = FormLibraryService.get(form_id) if form_id is not None else None
    except Exception as e:  # noqa: BLE001
        tpl = None

    if not tpl or not tpl.get("enabled"):
        return {"messages": [AIMessage(content="That form isn't available right now. Please try again later.")]}

    payload = {
        "template_id": tpl["id"],
        "name": tpl["name"],
        "description": tpl["description"],
        "fields": tpl["fields"],
        "submit_endpoint": "/api/forms/submit",
    }
    intro = f"Sure — please fill in the **{tpl['name']}** form below and submit."
    content = f"{intro}\n{DYNAMIC_FORM_START}{json.dumps(payload)}{DYNAMIC_FORM_END}"
    return {"messages": [AIMessage(content=content)]}


async def referral_choice_agent_node(state: AgentState):
    """Zero-LLM quick-choice card for employee referral queries.
    Looks up the Zoho Recruit portal URL via a plain DB keyword search — no embeddings,
    no ml01 calls — so this node is truly instant."""
    portal_url: str | None = None
    try:
        from app.database import SessionLocal as _SL
        from app.models import AppLink
        _db = _SL()
        try:
            _kw = "%recruit%"
            from sqlalchemy import or_ as _or
            row = (
                _db.query(AppLink)
                .filter(
                    AppLink.is_active.is_(True),
                    _or(AppLink.name.ilike(_kw), AppLink.purpose.ilike(_kw)),
                )
                .first()
            )
            portal_url = row.url if row else None
        finally:
            _db.close()
    except Exception:
        portal_url = None

    options: list[dict] = [
        {
            "label": "Read Referral Policy",
            "action": "message",
            "value": "Explain the employee referral program, eligibility, and bonus",
            "icon": "book",
        }
    ]
    if portal_url:
        options.append({
            "label": "Go to Referral Portal",
            "action": "link",
            "value": portal_url,
            "icon": "external-link",
        })

    payload = {"question": "What would you like to do?", "options": options}
    content = f"Here's what I can help with for employee referrals:\n{QUICK_CHOICE_START}{json.dumps(payload)}{QUICK_CHOICE_END}"
    return {"messages": [AIMessage(content=content)]}


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

    # Parking charges — deterministic info answer from the admin-configured rates.
    # Zero LLM: avoids the model paraphrasing/inventing numbers or routing to a policy doc.
    if sub_intent == "parking_charges":
        from app.services.parking_payment_service import ParkingPaymentService
        return {"messages": [AIMessage(content=ParkingPaymentService.format_charges())]}

    # Execute-first for policy queries: search embeddings/chunks at Python level,
    # avoiding an unreliable LLM tool-calling round-trip.
    if "policy" in sub_intent:
        # Use full user message for precise search (e.g. "expense reimbursement policy"
        # vs just the extracted entity "reimbursement" which is too generic and returns
        # the wrong document like Certificate Reimbursement Policy).
        topic = (
            next((m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "")
            or entities.get("policy_topic")
            or entities.get("topic")
        )
        from app.services.policy_service import PolicyService
        policy_result = PolicyService.search_admin_docs(str(topic), limit=2)
        if policy_result and "No policies found" not in policy_result:
            # Return policy text directly — zero LLM, eliminates tool-call JSON leak
            return {"messages": [AIMessage(content=policy_result)]}
        else:
            return {"messages": [AIMessage(
                content=f"No policy found for '{topic}'. "
                        f"Please contact the Admin team or email expense.zoho@alignedautomation.com."
            )]}
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

    if sub_intent == "hardware_issue":
        # Deterministic path — create a hardware ticket directly without LLM to avoid
        # the model hallucinating wrong content (e.g. VPN steps for overheating).
        _hw_msg = next((m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "")
        _hw_result = ITService.create_ticket(
            user_email, "Hardware", _hw_msg[:120], _hw_msg, "Medium"
        )
        return {"messages": [AIMessage(content=_hw_result)]}

    if sub_intent == "software_install":
        software_name = (
            entities.get("software_name")
            or entities.get("software")
            or entities.get("application")
            or entities.get("app")
        )
        # Only short-circuit to the email draft when a real product is named.
        # A generic noun ("software", "app") or a sentence fragment means the user
        # hasn't told us *what* to install — fall through to the LLM agent, which
        # asks "which software?" instead of drafting an email for "software".
        if software_name and ITService._looks_like_software_name(str(software_name)):
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


async def doc_agent_node(state: AgentState):
    """Document Agent — generates formal HR letters (NOC, experience cert, etc.)."""
    result = await doc_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": state.get("feedback_context") or "",
    })
    last_ai = next(
        (m for m in reversed(result["messages"]) if isinstance(m, AIMessage)),
        AIMessage(content="Failed to generate document."),
    )
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

    elif yammer_token and sub_intent == "community_search":
        from app.services import yammer_service
        q = (state.get("entities") or {}).get("query") or next(
            (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
        )
        result = await yammer_service.search_with_replies(yammer_token, q)
        if result.get("success"):
            pre_fetched = (
                f"[COMMUNITY SEARCH RESULTS for '{q}']\n{json.dumps(result)}\n[END]\n"
                f"Each thread has the original post AND its replies/comments — the answer is often "
                f"in a reply, not the question. Synthesize a direct answer from the whole thread and "
                f"cite the author + web_url. If nothing relevant, say so plainly."
            )

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


general_tools = [get_announcements, search_hr_policies, search_company_projects, find_apps]
general_tool_node = ToolNode(general_tools)


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


_OFF_TOPIC_RESPONSES = [
    "That's a bit outside what I can help with! For things like salary revisions, promotions, or career changes, "
    "your best path is a direct conversation with your manager or a formal request through HR.",
    "I appreciate the ambition, but that one's above my pay grade! Salary and promotion decisions go through "
    "your manager and HR — I'd suggest scheduling a 1:1 or raising it during your next appraisal cycle.",
    "Ha, I wish I could help with that one! Salary increments and role changes are handled by HR and your "
    "reporting manager. I'm happy to help you find the right HR policy or contact if that would help.",
    "That's not something I can action directly, but I can point you in the right direction — "
    "for compensation or role changes, speak with your manager or reach out to HR formally.",
]

def general_agent(state: AgentState):
    """General Agent — greetings, announcements, and policy Q&A."""
    # Fast-path: greetings don't need LLM — respond instantly
    sub_intent = state.get("sub_intent") or ""
    if sub_intent == "greeting":
        return {"messages": [AIMessage(content=_greeting_response(state))]}

    # Fast-path: off-topic personal wishes — no LLM needed
    if sub_intent == "off_topic":
        return {"messages": [AIMessage(content=_random.choice(_OFF_TOPIC_RESPONSES))]}

    # Fast-path: salary credit date — fixed policy answer, no LLM needed
    if sub_intent == "salary_credit_date":
        return {"messages": [AIMessage(content=_SALARY_CREDIT_RESPONSE)]}

    base = PromptService.get_system_prompt(
        "general",
        "You are Centriq, the AI assistant for Aligned Automation. "
        "You handle company announcements, general policy questions, and company-project questions. "
        "Tools: get_announcements (news/updates), search_hr_policies (policy lookups), "
        "search_company_projects (what projects the company has done, a project's summary/details, demos), "
        "find_apps (which internal app/tool/portal/website to use for a task, e.g. 'where do I book travel'). "
        "Always use tools first, never guess. Only suggest contacting HR/Admin if tools return no results. "
        "Do not offer further assistance unless asked.\n\n"
        "Company fact — the 4 C's (core values): Caring, Curious, Collaborative, Courageous.",
    )
    guardrail = PromptService.get_guardrail("general")
    feedback_ctx = state.get("feedback_context") or ""
    messages = [SystemMessage(content=base + guardrail + feedback_ctx)] + state["messages"]
    try:
        response = llm_controls.get_llm("general", default_timeout=20).bind_tools(general_tools).invoke(messages)
    except APIConnectionError:
        return {"messages": [AIMessage(content="I'm sorry, I'm having trouble connecting right now.")]}

    # If the model returned empty text with no tool calls, surface the last tool result directly.
    # This prevents the "unable to generate a text summary" fallback on weak models.
    if not (response.content or "").strip() and not getattr(response, "tool_calls", None):
        last_tool = next(
            (m for m in reversed(state["messages"]) if isinstance(m, ToolMessage) and m.content),
            None,
        )
        if last_tool:
            response = AIMessage(content=last_tool.content)

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


# Read-only directory / data tools that already return display-ready Markdown.
# Their output is deterministic structured data — running it through the
# summarizer LLM only adds latency and paraphrase drift (e.g. turning a clean
# profile into a chatty letter signed "[Your Name]"), so we pass it through
# verbatim and skip the LLM entirely.
_PASSTHROUGH_TOOLS = {
    "search_employee_directory", "get_employee_profile", "get_org_chart",
    "get_team_roster", "find_skills_expert", "get_department_headcount",
    "search_people_directory", "get_leave_balance", "get_announcements",
    "get_team_absence", "get_team_absence_for",
    "get_my_timesheet", "get_my_attendance", "get_my_appraisal_status",
    "get_my_training_records", "get_my_expense_reports", "get_my_reimbursement_status",
    "get_open_positions", "get_candidate_status",
    "get_my_alchemy_skills", "get_alchemy_skills_overview",
    "search_alchemy_skill_experts", "get_employee_availability",
    # Document generation results are already formatted with the download tag — returning
    # them through the summarizer causes the LLM to misread the tag as a policy excerpt.
    "generate_hr_document",
}


# Tool results that are policy/insurance Q&A — answered with the strong model for grounding.
_POLICY_SEARCH_TOOLS = {"search_hr_policies"}


async def summarizer(state: AgentState):
    """Converts tool results to natural language, preserving download tags.

    For deterministic directory/data tools (see _PASSTHROUGH_TOOLS) the result
    is already formatted, so it is returned as-is with no LLM call."""
    tool_message = state["messages"][-1]
    tool_output = tool_message.content if hasattr(tool_message, "content") else str(tool_message)

    # Zero-LLM fast path for display-ready structured results.
    tool_name = getattr(tool_message, "name", "")
    if tool_name in _PASSTHROUGH_TOOLS:
        return {"messages": [AIMessage(content=str(tool_output).strip())]}

    # The summarizer must ANSWER THE QUESTION, not blindly paraphrase the tool output.
    # Without the question, a weak model paraphrases whatever text it's handed — e.g. turning
    # policy claim-process language into a fabricated "your claim is approved" letter. Pass the
    # employee's actual question and pin the answer strictly to the excerpts.
    user_question = ""
    for _m in reversed(state["messages"]):
        if isinstance(_m, HumanMessage) and isinstance(_m.content, str) and _m.content.strip():
            user_question = _m.content.strip()
            break

    # Use HumanMessage as some models (like llama3.2) return empty for SystemMessage-only prompts
    prompt = [
        HumanMessage(content=f"""You are an HR assistant. Answer the employee's question using ONLY the policy excerpts below.

EMPLOYEE QUESTION:
{user_question or "(answer based on the excerpts below)"}

POLICY EXCERPTS:
{tool_output}

RULES:
1. Answer the question directly and factually. Lead with a 1-2 sentence direct answer, then supporting details.
2. FORMAT: Use bullet points for lists (covered items, required documents, steps). Use **bold** for key terms. Short paragraphs. Never paste raw policy text verbatim.
3. GROUNDING: use ONLY facts present in the excerpts. If the excerpts do not answer the question, say you couldn't find it in the policy and suggest contacting HR — never guess or fill gaps.
2a. EXCLUSIONS OVERRIDE COVERAGE: before answering any "is X covered / will X be reimbursed" question, scan ALL excerpts for an exclusions / general-exclusions / "not covered" list. If the thing asked about (or a clear synonym, e.g. cosmetic = plastic surgery) appears in such a list, the answer is NO — it is NOT covered/reimbursed — even if another excerpt (a claim form or general benefit list) seems to suggest it could be claimed. A generic claim-process or coverage excerpt does NOT override a specific exclusion. Cite the exclusion (e.g. the exclusion code) when present.
3. NEVER write a letter, email, approval, or confirmation. NEVER claim the employee has submitted documents, that a claim was received/verified/processed/approved, or invent any name, amount, account, or date. You are answering a question, not processing a claim. Do not sign off or use "Dear Employee" / "Best regards".
4. Start with the answer itself. Do not begin with "Here's a summary", and do not refer to "tool", "result(s)", or "excerpts". No JSON, curly braces, or metadata.
5. Ignore and do not repeat any bracketed markers like [POLICY_IMG:...]. If and ONLY IF the excerpts contain a [DOWNLOAD_PDF:url:title] tag, include it exactly at the end; otherwise add no links.
""")
    ]
    try:
        # Policy/insurance Q&A is accuracy-critical and grounding-sensitive — answer it with the
        # strong agent model, not the weak summarizer (which paraphrases and drifts). Other tool
        # results stay on the cheap summarizer tier to spare the GPU.
        _tier = "agent" if tool_name in _POLICY_SEARCH_TOOLS else "summarizer"
        response = await llm_controls.get_llm(_tier, default_timeout=30).ainvoke(prompt)
        content = response.content.strip()

        # Belt-and-braces: strip a leaked meta-preamble the weak summarizer model sometimes
        # parrots from its instructions (e.g. "Here's a summary of the tool results for the
        # employee:"). Only removes a leading meta sentence, never real answer content.
        content = _SUMMARY_PREAMBLE_RE.sub("", content, count=1).strip()

        # A download tag in the summary is only legitimate if the underlying tool
        # result actually produced one. Otherwise the model has parroted the
        # example tag from the prompt (e.g. "[DOWNLOAD_PDF:url:title]"), which
        # leaks a bogus "Download title" link into the UI. Strip any invented tag.
        if not DOWNLOAD_TAG_PATTERN.search(tool_output):
            content = DOWNLOAD_TAG_PATTERN.sub("", content).strip()

        # Fallback if content is empty after cleanup
        if not content:
            content = f"I've retrieved the information for you: {tool_output}"

        return {"messages": [AIMessage(content=content)]}
    except Exception as e:
        return {"messages": [AIMessage(content=f"The operation was successful, but I had trouble summarizing the result: {tool_output}")]}



# ═══════════════════════════════════════════════════════════════════════════════
# 5. ROUTING LOGIC
# ═══════════════════════════════════════════════════════════════════════════════

# Friendly names for the per-domain disable message.
_DOMAIN_LABELS = {
    "hr": "HR", "admin": "Admin Services", "it_support": "IT Support",
    "pmo": "PMO", "ms365": "Microsoft 365", "functional_manager": "Manager",
}


def disabled_agent(state: AgentState):
    """Terminal node for domains IT has switched off — emits a friendly notice
    instead of running the (disabled) domain agent. No LLM call."""
    domain = state.get("domain", "")
    label = _DOMAIN_LABELS.get(domain, "This")
    msg = (
        f"⚠️ The {label} assistant is temporarily unavailable — it's been paused by IT, "
        f"likely for maintenance or to manage system load. Please try again shortly, or "
        f"reach out to the IT helpdesk if it's urgent."
    )
    return {"messages": [AIMessage(content=msg)]}


def route_to_agent(state: AgentState):
    domain = state.get("domain", "general")
    # IT kill-switch for individual domains — short-circuit before the agent runs.
    if domain in llm_controls.disabled_domains():
        return "disabled_agent"
    if domain == "dynamic_form": return "dynamic_form_agent"
    if domain == "referral_choice": return "referral_choice_agent"
    status = get_domain_status(domain)
    if domain == "deeplink": return "deeplink_agent"
    if domain == "pmo": return "pmo_agent"
    if domain == "admin": return "admin_agent"
    if domain == "it_support": return "it_agent"
    if domain == "functional_manager": return "manager_agent"
    if domain == "ms365": return "ms365_agent"
    if domain == "document": return "doc_agent"
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
    import redis as _sync_redis
    import redis.asyncio as aioredis
    from langgraph.checkpoint.redis.aio import AsyncRedisSaver
    if not settings.USE_MEMORY_SAVER:
        # Probe synchronously so auth failures are caught here, not inside astream_events().
        _probe = _sync_redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        _probe.ping()
        _probe.close()
        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=False)
        checkpointer = AsyncRedisSaver(redis_client=redis_client)
except Exception as e:
    pass


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
workflow.add_node("dynamic_form_agent", dynamic_form_agent_node)
workflow.add_node("referral_choice_agent", referral_choice_agent_node)
workflow.add_node("ms365_agent", ms365_agent_node)
workflow.add_node("doc_agent", doc_agent_node)
workflow.add_node("general_agent", general_agent)
workflow.add_node("general_tools", general_tool_node)
workflow.add_node("dummy_test_agent", dummy_test_agent)
workflow.add_node("placeholder_agent", placeholder_agent)
workflow.add_node("disabled_agent", disabled_agent)
workflow.add_node("hr_tools", hr_tool_node)
workflow.add_node("summarizer", summarizer)

workflow.set_entry_point("intent_router")
# context_manager sits between router and feedback_lookup:
# intent_router -> context_manager (compress if >6000 tokens) -> feedback_lookup -> domain agent
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
workflow.add_edge("dynamic_form_agent", END)
workflow.add_edge("referral_choice_agent", END)
workflow.add_edge("ms365_agent", END)
workflow.add_edge("doc_agent", END)
workflow.add_edge("dummy_test_agent", END)
workflow.add_edge("placeholder_agent", END)
workflow.add_edge("disabled_agent", END)

app_agent = workflow.compile(checkpointer=checkpointer)
