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
import asyncio
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
from app.services.llm_resilience import resilient_invoke, resilient_ainvoke
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
from app.services.pending_action_service import PendingActionService
from app.services import helpdesk_mail
from app.orchestration.resolver import Resolver, Decision, RouteContext

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

class Focus(TypedDict, total=False):
    """What the conversation is currently *about* — the subject a follow-up's
    pronouns ('their', 'those') resolve against. Populated by the state_tracker node
    from each answer and persisted with the rest of AgentState in the checkpointer.
    This is the first piece of the ConversationState abstraction (Phase 1 of the
    routing/agent redesign — see docs/architecture-redesign.md)."""
    kind: str              # "people" | "projects" | "generic"
    entities: List[str]    # named items from the last answer (e.g. the people listed)
    domain: str            # domain that produced the answer
    turn: int              # human-message count at the time it was set (for recency)


_MODE_HINTS: dict[str, str] = {
    "analytics": "\n\n[ACTIVE MODE: Analytics Builder] The user has activated Analytics Builder mode. Prioritise analytics tools, NL-to-data queries, ROI metrics, dashboards, and data exploration. Keep responses data-focused.",
    "training": "\n\n[ACTIVE MODE: Learning Advisor] The user has activated Learning Advisor mode. Prioritise course recommendations (Udemy, TechElevate), skill gap analysis, and learning plans.",
    "project": (
        "\n\n[ACTIVE MODE: Project IQ] The user is in Project IQ mode."
        " OVERRIDES base Rule 2: do NOT call list_projects for every project question."
        " STRICT ANSWER PRIORITY — follow this order for every question:\n"
        "STEP 1 — use the specific Project IQ tool that matches:\n"
        "  - Similarity ('have we done X before?', 'any prior project like Y?') → find_similar_projects\n"
        "  - Lessons/risks ('what goes wrong in X?', 'common risks for Y') → project_lessons\n"
        "  - Experts ('who has delivered X?', 'who has experience with Y?') → find_project_experts\n"
        "  - Reusable assets ('any X component we can reuse?', 'existing Y module') → find_reusable_assets\n"
        "  - Explicit list request ('list all projects', 'show projects') → list_projects\n"
        "  - Named project status/details → get_project_status or get_project_achievements\n"
        "STEP 2 — ONLY if no STEP 1 tool matches, fall back to search_project_corpus.\n"
        "NEVER skip STEP 1 for questions that clearly match. NEVER answer from your own knowledge."
    ),
    "resource": "\n\n[ACTIVE MODE: Resource Finder] The user has activated Resource Finder mode. Prioritise skill-to-availability matching, bench status, and staffing recommendations.",
    "me": (
        "\n\n[ACTIVE MODE: My Workspace] The user has activated My Workspace mode — their personal "
        "Microsoft 365 delegated actions. Prioritise:\n"
        "- Read: inbox (read_my_emails), calendar (read_my_calendar/search_calendar), Teams chats "
        "(read_teams_messages), a Teams channel (read_channel_messages), their communities "
        "(list_my_communities), a community's posts (read_community_posts), their Viva Engage feed "
        "(read_yammer_feed), or search across all communities for a topic (search_communities).\n"
        "- Write: send email (send_email_graph), post to a Teams channel (send_channel_message) or "
        "Viva Engage community (post_to_community), send a Teams chat message (send_teams_message), "
        "create a group chat (create_group_chat).\n"
        "Act on the first clear request — don't redirect to the Outlook/Teams app."
    ),
}


def _get_mode_hint(state: "AgentState") -> str:
    return _MODE_HINTS.get((state.get("active_mode") or "").strip(), "")


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
    resolved_query: Optional[str]      # follow-up rewritten to a standalone query (coref resolved)
    focus: Optional[dict]              # ConversationState: subject of the last answer (see Focus)
    user_role: Optional[str]           # "employee" | "hr" | "admin" | "manager" | "it" | "pmo"
    graph_token: Optional[str]         # user's delegated Microsoft Graph token (from frontend)
    user_location: Optional[str]       # detected from M365 profile (officeLocation / city)
    portal_context: Optional[dict]     # {page, active_filters} — what portal the user is on
    active_mode: Optional[str]         # "analytics" | "training" | "project" | "resource"
    focus_mode_fallback_attempted: bool  # True once a focus-mode fallback fires in this turn; reset each turn
    focus_fallback_pending: bool         # transient routing signal: re-run intent_router without active_mode


# Pending IT email drafts are now persisted via PendingActionService (durable, survives
# restart) under action_type "software_install" — see docs/action-safety-audit.md. The old
# in-memory PENDING_IT_EMAIL_DRAFTS dict was removed (it lost confirmed drafts on restart).

# How long an already-submitted software-install request is treated as "still in progress"
# (email-only, no resolution callback) so we don't draft a duplicate in a new chat. 7 days.
_SOFTWARE_INSTALL_DEDUPE_MINUTES = 7 * 24 * 60

# User explicitly asking to send a previously-submitted request again — bypasses the dedupe.
_RESEND_RE = re.compile(r'\b(re-?send|send\s+(it\s+)?again|send\s+(it\s+)?(once\s+)?more|resubmit)\b', re.I)


def _draft_key(state: AgentState) -> str:
    return state.get("session_id") or state.get("user_email") or settings.DEFAULT_USER_EMAIL


_CONFIRMATION_RE = re.compile(
    r'^(yes|y|yep|yeah|yup|sure|ok|okay|k|confirm|go\s+ahead|sounds\s+good|'
    r'send|send\s+it|submit|submit\s+it|do\s+it|do\s+that|proceed|please\s+send|'
    r'yes\s+send|yes[,\s]+please|please\s+go\s+ahead|yes[,\s]+go\s+ahead)[\s!.]*$',
    re.I,
)

def _is_confirmation(text: str) -> bool:
    normalized = text.strip()
    return bool(_CONFIRMATION_RE.match(normalized))


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
    """Rolling window context manager — now runs off the hot path.

    On-request behaviour (fast, no LLM):
      - Loads the last persisted conversation summary from DB for sessions that exceed
        the token threshold, and injects it into feedback_context so every agent sees it.
      - Schedules async LLM summarization as a background task when the window is large;
        the result is persisted and available on the NEXT request (not this one).

    The expensive LLM summarization call that used to block here is now fire-and-forget,
    triggered only when tokens > 6000 and scheduled via asyncio.create_task so it runs
    after the stream completes.
    """
    messages = state.get("messages", [])
    total_tokens = sum(len(getattr(m, "content", "") or "") // 4 for m in messages)

    # Load persisted summary (fast DB read — no LLM)
    session_id = state.get("session_id")
    persisted_summary = state.get("conversation_summary", "")
    if not persisted_summary and session_id and total_tokens > 4000:
        try:
            persisted_summary = await asyncio.to_thread(_load_conversation_summary, session_id)
        except Exception:
            persisted_summary = ""

    # Schedule background summarization if this window is large enough
    if total_tokens > 6000 and len(messages) > 8 and session_id:
        asyncio.create_task(
            _summarize_conversation_async(session_id, messages[:-6], state.get("domain"))
        )

    if not persisted_summary:
        return {}

    existing_feedback = state.get("feedback_context") or ""
    updated_feedback = (
        f"[CONVERSATION SUMMARY — earlier turns compressed]:\n{persisted_summary}\n\n{existing_feedback}"
    )
    return {
        "conversation_summary": persisted_summary,
        "feedback_context": updated_feedback,
    }


def _load_conversation_summary(thread_id: str) -> str:
    """Synchronous DB read for use with asyncio.to_thread."""
    try:
        from app.models import ConversationSummary
        from app.database import SessionLocal
        db = SessionLocal()
        try:
            row = db.query(ConversationSummary).filter(
                ConversationSummary.thread_id == thread_id
            ).first()
            return row.summary if row else ""
        finally:
            db.close()
    except Exception:
        return ""


async def _summarize_conversation_async(thread_id: str, messages_to_summarize, domain: str) -> None:
    """Background LLM summarization — runs AFTER the stream, never on the hot path."""
    try:
        summary_prompt = (
            "Summarize this conversation history in 3-5 sentences. "
            "Preserve: key facts, dates, employee names, leave types, ticket IDs, "
            "requests made, and decisions reached. Be concise and factual."
        )
        summary_response = await resilient_ainvoke(
            "summarizer",
            [
                SystemMessage(content=summary_prompt),
                HumanMessage(content="\n".join(
                    f"{m.type}: {getattr(m, 'content', '')}" for m in messages_to_summarize
                )),
            ],
            default_timeout=25,
        )
        summary_text = summary_response.content.strip()
        if summary_text:
            await asyncio.to_thread(_save_conversation_summary, thread_id, summary_text, domain)
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
# 2. HR TOOLS
# ═══════════════════════════════════════════════════════════════════════════════

@tool
def get_leave_balance(email: str = "", state: Annotated[dict, InjectedState] = None):
    """Get a leave balance. Defaults to the logged-in user. A manager may pass a
    direct report's name or email to view theirs; HR/admin may view anyone's.
    Access is enforced server-side — never ask the user for someone else's email."""
    from app.services.access_control import check_personal_data_access
    requester_email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    requester_role = (state or {}).get("user_role")
    # If the model echoed the requester's own email, treat it as a self-lookup.
    req_norm = (requester_email or "").strip().lower()
    target_query = email if (email and email.strip().lower() != req_norm) else ""
    decision = check_personal_data_access(requester_email, requester_role, target_query)
    if not decision.allowed:
        return decision.message
    return HRService.get_leave_balance(decision.target_email or requester_email)

@tool
def apply_leave(
    email: str,
    start_date: str,
    end_date: str,
    leave_type: str = "Casual",
    reason: str = "Applied via AI Assistant",
):
    """Hand the user the Zoho People apply-leave form (we never submit leave ourselves).
    Leave application is owned by Zoho People. Infer leave_type/dates from context if given
    (YYYY-MM-DD) so they can be echoed into the form; Zoho's form takes no prefill params."""
    import datetime as _d
    from app.agents.deeplink_agent import _apply_handoff_message

    def _fmt(iso: str) -> str:
        try:
            return _d.datetime.strptime(iso, "%Y-%m-%d").strftime("%d %b %Y")
        except Exception:
            return iso or ""

    return _apply_handoff_message(leave_type, _fmt(start_date), _fmt(end_date))

@tool
def get_my_leaves(email: str = "", state: Annotated[dict, InjectedState] = None):
    """List the logged-in user's leave requests (id, type, dates, status, days).
    Call before cancel_leave so the user can pick which leave to cancel."""
    from app.database import SessionLocal
    from app.models import Leave
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    db = SessionLocal()
    try:
        emp = HRService.get_employee_by_email(db, email)
        if not emp:
            return "Employee record not found."
        leaves = (
            db.query(Leave)
            .filter(Leave.employee_id == emp.id)
            .order_by(Leave.created_at.desc())
            .limit(20)
            .all()
        )
        if not leaves:
            return "No leave records found."
        lines = []
        for l in leaves:
            days = l.days if l.days is not None else (
                (l.end_date - l.start_date).days + 1 if l.start_date and l.end_date else "?"
            )
            period = f"{l.start_date} to {l.end_date}" if l.start_date != l.end_date else str(l.start_date)
            reason = f" — {l.reason}" if l.reason else ""
            lines.append(f"ID {l.id}: {l.leave_type} | {period} | {days} day(s) | {l.status}{reason}")
        return "\n".join(lines)
    finally:
        db.close()

@tool
def cancel_leave(leave_id: int, email: str = "", state: Annotated[dict, InjectedState] = None):
    """Cancel a leave by ID. If the leave was Approved, the balance is automatically restored.
    Call get_my_leaves first if you don't know the leave_id. A user can only cancel
    their own leave."""
    import httpx
    from app.config import settings
    # Cancellation is self-only — bind to the requester, ignore any supplied email.
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
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
def get_team_absence(from_date: str = "", to_date: str = "",
                     state: Annotated[dict, InjectedState] = None):
    """Check who in your team is on leave during a date range.
    Dates in YYYY-MM-DD format; leave blank for the current week.
    Use for: 'who is on leave this week', 'team absence next week', 'is anyone off on Monday'."""
    from app.hr_service import HRService
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    return HRService.get_team_absence(email, from_date, to_date)


@tool
def get_team_absence_for(manager_email: str, from_date: str = "", to_date: str = ""):
    """Check team absence for a specific manager email. Dates YYYY-MM-DD; blank = current week."""
    from app.hr_service import HRService
    return HRService.get_team_absence(manager_email, from_date, to_date)


@tool
def generate_hr_document(doc_type: str, target_email: str = "",
                         state: Annotated[dict, InjectedState] = None):
    """Generate a downloadable HR document PDF.
    doc_type: 'experience_certificate' or 'expense_summary'.
    target_email: employee email (defaults to current user if blank). A user can
    only generate their own documents; managers (for direct reports) and HR/admin
    may generate others'. Access is enforced server-side."""
    import uuid
    from app.database import SessionLocal
    from app.models import Employee, Leave, Reimbursement
    from app.document_generation.generator import generate_pdf
    from app.document_store import store_pdf
    from app.services.access_control import check_personal_data_access

    requester_email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    requester_role = (state or {}).get("user_role")
    req_norm = (requester_email or "").strip().lower()
    target_query = target_email if (target_email and target_email.strip().lower() != req_norm) else ""
    decision = check_personal_data_access(requester_email, requester_role, target_query)
    if not decision.allowed:
        return decision.message
    email = decision.target_email or requester_email
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
    from app.services import actions  # routed through the action registry spine
    return actions.run("hr_query", actor_email=email, category=category,
                       subject=subject, description=description).human_message


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
    from app.services import allocation_snapshot_service as snap
    from sqlalchemy import or_, func

    term = (name_or_email or "").strip()
    if not term:
        return "Please specify an employee name to check availability."
    db = SessionLocal()
    try:
        # Resolve the canonical name from any allocation row (name or employee_id code),
        # then compute capacity from the LATEST snapshot only (not summed across months).
        any_row = db.query(EmployeeAllocation).filter(
            or_(
                EmployeeAllocation.employee_name.ilike(f"%{term}%"),
                func.lower(EmployeeAllocation.employee_id) == term.lower(),
            )
        ).order_by(EmployeeAllocation.allocation_date.desc()).first()

        if not any_row:
            return (f"**{term}** — ✅ Available for work (no project allocation on record).")

        display_name = any_row.employee_name or term
        a = snap.availability_for(db, name=any_row.employee_name,
                                  employee_id=any_row.employee_id)
        current = a["rows"]
        if not current or a["load"] <= 0:
            return f"**{display_name}** — ✅ Available for work (no active allocation; {a['free']:g}% free)."

        head = (f"**{display_name}** — ❌ Not available "
                f"({a['load']:g}% allocated, {a['free']:g}% free):")
        lines = [head]
        for al in current[:5]:
            eff = f"{al.efforts_percent}% efforts" if al.efforts_percent is not None else ""
            detail = " | ".join(x for x in [al.project_name or "Project", eff,
                                            al.billing or ""] if x)
            lines.append(f"- {detail}")
        if a["earliest_free"]:
            lines.append(f"_Soonest project rolloff: {a['earliest_free'].isoformat()}._")
        return "\n".join(lines)
    finally:
        db.close()


@tool
def match_resources(
    skills: str,
    min_years: Optional[float] = None,
    available_by: str = "",
    count: int = 5,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Staff a new or upcoming project: rank employees who fit a requirement by skill
    match, current availability (free capacity / when they roll off their project), and
    experience. Use for 'I need 2 React developers with 3+ years free by July', 'who is
    available for a new data project?', 'find an AWS engineer who isn't fully allocated',
    'who can fit a new automation project?'.

    PREFER THIS over search_alchemy_skill_experts / get_employee_availability whenever the
    user wants candidates for a project (a headcount, an experience floor, a needed-by date,
    or availability is part of the ask) — it combines all three signals and ranks them.

    skills: required skill(s), comma-separated, inferred from the request (e.g. "React, Node, AWS").
    min_years: minimum years of experience, ONLY if the user stated one (else leave null).
    available_by: date needed by in YYYY-MM-DD, ONLY if the user gave one (else blank).
    count: how many candidates to return (default 5; use the user's number if they asked for N).
    Never invent skills, experience, or dates the user did not mention."""
    email = (state or {}).get("user_email") or settings.DEFAULT_USER_EMAIL
    from app.services.resource_matching_service import ResourceMatchingService
    return ResourceMatchingService.match(
        skills=skills, min_years=min_years, available_by=available_by,
        count=count, user_email=email,
    )


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
    match_resources,
]
hr_tool_node = ToolNode(hr_tools)

# ── Sub-intent → tool group binding (≤8 tools per LLM call) ──────────────────
# Binding all 38 hr_tools injects ~3-4k tokens of JSON schema into EVERY agent
# call and degrades tool selection on small models (too many near-duplicate
# choices). The router's sub_intent picks a small relevant group instead.
# Execution is unaffected: hr_tool_node above keeps the FULL list, so any tool
# the model calls still runs. Unknown/missing sub_intents get the core set.

_HR_TOOL_GROUPS: dict[str, list] = {
    "policy_query":       [search_hr_policies, find_apps, submit_hr_query],
    "document_request":   [generate_hr_document, search_hr_policies],
    "employee_search":    [search_alchemy_skill_experts, search_employee_directory,
                           get_employee_profile, get_org_chart, get_team_roster,
                           get_department_headcount, get_employee_availability, find_skills_expert],
    "resource_match":     [match_resources, search_alchemy_skill_experts, get_employee_availability],
    "grievance":          [submit_grievance, submit_grievance_for, search_hr_policies],
    "apply_leave":        [apply_leave, get_leave_balance, get_my_leaves, cancel_leave],
    "submit_leave":       [apply_leave, get_leave_balance, get_my_leaves, cancel_leave],
    "leave_balance":      [get_leave_balance, get_my_leaves, apply_leave, cancel_leave],
    "cancel_leave":       [cancel_leave, get_my_leaves, get_leave_balance],
    "timesheet":          [get_my_timesheet, get_my_attendance],
    "attendance":         [get_my_attendance, get_employee_attendance, get_my_timesheet],
    "team_attendance":    [get_team_absence_for, get_team_absence, get_team_roster],
    "appraisal":          [get_my_appraisal_status, search_hr_policies],
    "training":           [get_my_training_records, search_hr_policies],
    "alchemy_my_skills":  [get_my_alchemy_skills],
    "alchemy_skills_overview": [get_alchemy_skills_overview, search_alchemy_skill_experts],
    "onboarding":         [trigger_onboarding_checklist, search_hr_policies],
    "offboarding":        [trigger_offboarding_checklist, search_hr_policies],
    "expense":            [get_my_expense_reports, get_my_reimbursement_status],
    "reimbursement":      [get_my_reimbursement_status, get_my_expense_reports, search_hr_policies],
    "recruitment":        [get_open_positions, get_candidate_status],
    "open_positions":     [get_open_positions, get_candidate_status],
    "announcements":      [get_announcements, create_announcement, deactivate_announcement],
    "hr_query":           [submit_hr_query, search_hr_policies],
    # ── Structured-data lookups — DB only, no RAG ────────────────────────────
    # These cover queries the LLM used to escalate to search_hr_policies because
    # the profile tool wasn't in scope.  All answers come from SQL in <100ms.
    "employee_contact":   [get_employee_profile, search_employee_directory],
    "profile_lookup":     [get_employee_profile, search_employee_directory, get_org_chart],
    "joining_date":       [get_employee_profile, search_employee_directory],
    "seat_location":      [get_employee_profile, search_employee_directory],
    "blood_group":        [get_employee_profile, search_employee_directory],
    "org_chart":          [get_org_chart, get_team_roster, search_employee_directory],
    "team_roster":        [get_team_roster, get_org_chart, get_team_absence],
    "headcount":          [get_department_headcount, search_employee_directory],
    "skill_lookup":       [search_alchemy_skill_experts, find_skills_expert,
                           search_employee_directory, get_employee_profile],
    "appreciation":       [get_announcements, search_employee_directory],
}

# Fallback for unknown/ambiguous sub_intents — the highest-traffic tools.
# search_hr_policies is intentionally ABSENT here: it triggers a slow RAG search
# and gets called by the LLM for structured queries (phone, joining date, seat, etc.)
# that are already in the DB.  It only appears in tool groups where a policy lookup
# is genuinely appropriate (policy_query, document_request, grievance, hr_query).
_HR_CORE_TOOLS: list = [
    get_leave_balance, get_employee_profile,
    search_employee_directory, generate_hr_document, submit_hr_query,
    find_apps, get_announcements, get_org_chart,
]


def _hr_tools_for(sub_intent: str) -> list:
    return _HR_TOOL_GROUPS.get((sub_intent or "").strip(), _HR_CORE_TOOLS)


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

# Knowledge-miss action handoff (item 3). Match ONLY the synthetic phrases the abstention
# card emits ("<action> about this — <topic>"); the captured group is the original question,
# reused as the ticket/query body. re.S so a multi-line topic is captured whole.
_KW_HANDOFF_IT = re.compile(r'^\s*raise an it ticket about this\s*[—:\-]\s*(.+)$', re.I | re.S)
_KW_HANDOFF_HR = re.compile(r'^\s*raise an hr query about this\s*[—:\-]\s*(.+)$', re.I | re.S)

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

# Resource-matching / staffing intent — finding people to STAFF a (usually new/upcoming)
# project, where availability/experience is part of the ask, not just "who knows X". This
# is distinct from a bare skill lookup ("find python developers") which keeps its simple
# expert-list behaviour. Triggers on an explicit staffing signal: staffing verbs, "for a
# (new) project", "who can fit", "free/available by <date>", or "N <role>" headcount.
_KW_HR_RESOURCE_MATCH = re.compile(
    r'\b(staff(?:ing|ed)?|resourc\w*)\b'
    r'|who\s+(?:can|could|would|might)\s+(?:fit|be\s+a\s+(?:good\s+)?fit|work\s+on)'
    r'|\b(?:for|on|to\s+staff)\s+(?:a|an|the|my|our|this)?\s*(?:new|upcoming)?\s*project'
    r'|\b(?:free|available)\s+(?:by|from|for\s+(?:a|an|the|this|new))\b'
    r'|\b\d+\s+(?:[a-z.+#]+\s+){0,3}?(?:developers?|engineers?|devs?|programmers?|'
    r'designers?|testers?|qa|analysts?|architects?|specialists?|consultants?|'
    r'scientists?|resources?|people|persons?)\b', re.I
)

# Contact / profile direct-lookup patterns — queries where the answer is a single DB row,
# no LLM reasoning needed.  We short-circuit these BEFORE any agent LLM call.
_KW_CONTACT_LOOKUP = re.compile(
    r"(?:"
    # explicit contact fields
    r"\b(?:phone|mobile|contact|number|extension|ext\.?|seat|desk|cabin|floor|location|"
    r"blood\s+group|blood\s+type|joining\s+date|join(?:ed|ing)\s+(?:on|date)|"
    r"date\s+of\s+joining|doj|tenure|experience|grade|level|nationality)\b"
    r"|"
    # "who is X", "tell me about X", "profile of X"
    r"\b(?:who\s+is|profile\s+of|details?\s+(?:of|for|about)|info(?:rmation)?\s+(?:of|about|for)|"
    r"tell\s+me\s+about|show\s+me\s+(?:the\s+)?(?:profile|card|details?)\s+(?:of|for))\b"
    r")",
    re.I
)

# Common words that look like names but aren't — filter these from name extraction.
_NOT_A_NAME = frozenset({
    "what", "where", "when", "which", "who", "how", "is", "are", "was", "were",
    "the", "a", "an", "of", "for", "about", "on", "in", "at", "to", "with",
    "his", "her", "their", "its", "my", "our", "your", "me", "you", "i",
    "phone", "mobile", "contact", "number", "extension", "seat", "desk",
    "location", "blood", "group", "joining", "date", "tenure", "grade", "level",
    "profile", "details", "information", "info", "card", "tell", "show",
    "employee", "person", "colleague", "staff", "member", "tell", "give",
})


def _extract_person_name(query: str) -> str:
    """Extract a person name from a contact/profile query. Returns '' if nothing found."""
    # Pattern 1 — possessive: "Priya's phone number"
    m = re.search(r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)'s\b", query)
    if m:
        return m.group(1).strip()

    # Pattern 2 — "of/for/about <Name>" or "who is <Name>"
    m = re.search(
        r"\b(?:of|for|about|who\s+is|profile\s+of|details?\s+of|about)\s+"
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)",
        query, re.I
    )
    if m:
        candidate = m.group(1).strip()
        if candidate.lower().split()[0] not in _NOT_A_NAME:
            return candidate

    # Pattern 3 — "<Name>'s" (any capitalisation)
    m = re.search(r"(\b[A-Za-z][a-z]+\s+[A-Z][a-z]+)\b", query)
    if m:
        candidate = m.group(1).strip()
        tokens = candidate.lower().split()
        if not any(t in _NOT_A_NAME for t in tokens):
            return candidate

    # Pattern 4 — last resort: two-token capitalised run
    tokens = query.split()
    caps = []
    for t in tokens:
        cleaned = re.sub(r"[^A-Za-z]", "", t)
        if cleaned and cleaned[0].isupper() and cleaned.lower() not in _NOT_A_NAME:
            caps.append(cleaned)
        else:
            if len(caps) >= 2:
                break
            caps = []
    if len(caps) >= 2:
        return " ".join(caps[:2])

    return ""

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _extract_resource_match_args(text: str) -> tuple[str, Optional[float], str, int]:
    """Pull (skills, min_years, available_by 'YYYY-MM-DD', count) from a staffing query.
    Best-effort: any value the user didn't state comes back empty/None so the matcher
    treats it as 'no constraint'."""
    import datetime as _dt
    low = (text or "").lower()

    # headcount: "2 react developers", "need 3 people"
    count = 5
    m = re.search(r'\b(\d{1,2})\s+(?:[a-z.+#]+\s+){0,3}?'
                  r'(?:developers?|engineers?|devs?|programmers?|designers?|testers?|qa|'
                  r'analysts?|architects?|specialists?|consultants?|scientists?|'
                  r'resources?|people|persons?)\b', low)
    if m:
        count = max(1, min(int(m.group(1)), 25))

    # experience floor: "3+ years", "5 yrs experience", "at least 4 years"
    min_years: Optional[float] = None
    m = re.search(r'(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b', low)
    if m:
        min_years = float(m.group(1))

    # needed-by date: explicit ISO / DMY, or "by <Month> [year]" / "by end of <Month>"
    available_by = ""
    m = re.search(r'\b(\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b', text or "")
    if m:
        available_by = m.group(1)
    else:
        m = re.search(r'\bby\s+(?:end\s+of\s+|the\s+end\s+of\s+|mid[- ])?'
                      r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*'
                      r'(?:\s+(\d{4}))?', low)
        if m:
            mon = _MONTHS[m.group(1)]
            today = _dt.date.today()
            year = int(m.group(2)) if m.group(2) else (
                today.year if mon >= today.month else today.year + 1)
            available_by = _dt.date(year, mon, 1).isoformat()

    # skills: reuse the skill-term extractor, then drop numbers / month words / staffing
    # fillers so only real skill tokens remain (e.g. "react", "aws", "data engineering").
    raw = _extract_skill_term(text)
    full_months = {"january", "february", "march", "april", "may", "june", "july",
                   "august", "september", "october", "november", "december"}
    drop = set(_MONTHS) | full_months | {
        "project", "projects", "new", "upcoming", "by", "from", "end", "mid", "free",
        "available", "availability", "years", "year", "yrs", "yr", "plus",
        "can", "could", "would", "might", "should", "fit", "fits", "work", "working",
        "worked", "on", "this", "that", "my", "our", "us", "we", "month", "months",
        "week", "weeks", "role", "roles", "position", "positions", "slot", "slots",
        "requirement", "requirements", "upcoming", "staff", "staffing",
        "at", "least", "minimum", "min", "around", "about", "over", "more", "than",
        # Follow-up / reference words: a message like "show their current project
        # allocation" refers back to an earlier result, not a NEW skill search. Drop
        # these so no fake skill survives — the query then falls through to the HR
        # agent (which has the conversation history + availability/allocation tools)
        # instead of failing with "no employees found with their/current/allocation".
        "show", "list", "display", "give", "get", "tell", "see", "view", "current",
        "currently", "allocation", "allocations", "allocated", "status", "their",
        "them", "they", "his", "her", "its", "the", "an", "now", "please", "who",
        "whats", "what", "of", "to", "in", "for", "and", "is", "are",
    }
    skill_tokens = []
    for t in raw.split():
        t = t.strip("+.-")                      # "3+" -> "3", "node." -> "node"
        if not t or len(t) < 2:
            continue
        if t in drop or re.fullmatch(r'\d+(?:\.\d+)?', t):
            continue
        skill_tokens.append(t)
    skills = ", ".join(skill_tokens)
    return skills, min_years, available_by, count


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
    r'\bhow\s+(do\s+i|can\s+i|to)\b|\bwhat\s+(is|are)\b|\btell\s+me\b|\bexplain\b|'
    r'\bprocess\s+(for|of|to)\b|\bpolic(y|ies)\b|\bprocedure\b|\bguidelines?\b|\bsteps?\s+(for|to)\b',
    re.I,
)
# Action verbs that signal intent to DO something rather than just learn about it.
# When present in an info-phrased message, the normal (lower) form-match threshold applies.
_ACTION_VERB_RE = re.compile(
    r'\b(submit|apply|request|raise|book|register|file|get|need|want|fill)\b',
    re.I,
)

# Form Builder — admin creates a NEW form template. Must run before admin-reimbursement keyword
# so "create a form for gym membership reimbursement requests" routes here, not to admin.
_KW_FORM_BUILDER = re.compile(
    r'\b(create|make|build|generate|set\s*up|add|design|draft)\b[\s\S]{0,60}?\b(?:a\s+|new\s+)?form\b',
    re.I,
)
_KW_FORM_FILL = re.compile(r'\b(fill|submit|open|complete)\b', re.I)

# A form match phrased as an intent to FILL/COMPLETE/SUBMIT enters the conversational fill flow
# (gather field-by-field in chat); anything else ("show/open the X form") renders the widget.
_CONV_FILL_RE = re.compile(r'\b(fill|complete|submit)\b', re.I)
# A fresh "fill … form" request mid-fill should start the new form, not be swallowed as an answer.
_NEW_FILL_REQUEST_RE = re.compile(r'\b(fill|complete|submit)\b[\s\S]{0,40}\bform\b', re.I)

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

# Re-send an already-submitted install request (escape hatch from cross-chat dedupe).
# Captures the product named before "request"/"install" so the idempotency key matches
# the original — e.g. "resend the Slack request", "resubmit slack install".
_KW_IT_RESEND = re.compile(
    r'\b(?:re-?send|resubmit)\b.*?\b'
    r'(?!(?:a|an|the|to|some|my|our|your|another)\b)'
    r'([A-Za-z0-9][A-Za-z0-9.+#]{1,29})\s+(?:request|install(?:ation)?)\b', re.I
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

    # Knowledge-miss → action handoff (see _abstention_handoff_card). These match ONLY the
    # synthetic phrases emitted by the abstention card's quick-choice options, so the user's
    # click routes STRAIGHT to a ticket-creating action — never back into the search that
    # just abstained (which would loop). Matched first so the embedded topic (which may
    # itself contain "vpn"/"leave"/etc.) can't be stolen by a downstream keyword route.
    _m = _KW_HANDOFF_IT.search(text)
    if _m:
        return {"domain": "it_support", "confidence": 1.0,
                "reasoning": "Knowledge-miss handoff → IT ticket",
                "sub_intent": "it_ticket_handoff",
                "entities": {"handoff_topic": _m.group(1).strip()}}
    _m = _KW_HANDOFF_HR.search(text)
    if _m:
        return {"domain": "hr", "confidence": 1.0,
                "reasoning": "Knowledge-miss handoff → HR query",
                "sub_intent": "hr_query_handoff",
                "entities": {"handoff_topic": _m.group(1).strip()}}

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

    # Form Builder — admin creates a NEW form template. Checked very early (confidence=1.0 →
    # fast-exit before the semantic high-tier) so messages like "create a form for gym membership
    # reimbursement requests" can't be stolen by admin-reimbursement or deeplink keyword matches.
    if _KW_FORM_BUILDER.search(text) and not _KW_FORM_FILL.search(text):
        return {"domain": "form_builder", "confidence": 1.0,
                "reasoning": "Keyword: create/design a new form (form builder)",
                "sub_intent": "create_form", "entities": {}}

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

    # HR — resource matching / staffing a project. Checked before the single-person
    # availability and generic people-search gates, because a requirement like "I need
    # 2 React devs free by July" overlaps both but should reach the ranked matcher.
    if _KW_HR_RESOURCE_MATCH.search(text):
        return {"domain": "hr", "confidence": 0.9,
                "reasoning": "Keyword: resource matching / staffing",
                "sub_intent": "resource_match", "entities": {}}

    # HR — availability / staffing (project-allocation lookup). Checked before the
    # generic people search so "are they available for work" reaches the HR agent
    # (which calls get_employee_availability) rather than a fresh directory search.
    if _KW_HR_AVAILABILITY.search(text):
        return {"domain": "hr", "confidence": 0.9,
                "reasoning": "Keyword: employee availability / allocation",
                "sub_intent": "employee_search", "entities": {}}

    # HR — direct contact / profile lookup (phone, seat, joining date, blood group, etc.)
    # Must come BEFORE generic people search so "phone number of X" emits employee_contact,
    # not employee_search, enabling the deterministic fast-path in hr_agent.
    if _KW_CONTACT_LOOKUP.search(text):
        _cname = _extract_person_name(text)
        return {"domain": "hr", "confidence": 0.95,
                "reasoning": "Keyword: contact/profile field lookup",
                "sub_intent": "employee_contact",
                "entities": {"person_name": _cname} if _cname else {}}

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

    # IT — resend an already-submitted install request (must precede the install branch so
    # "resend the slack request" routes by the named product, bypassing dedupe downstream).
    mr = _KW_IT_RESEND.search(text)
    if mr and not re.search(r'\b(leave|parking|zoho|complaint|policy|reimburs|room|meeting|book|visitor|guest|pass)\b', text, re.I):
        sw = mr.group(1).strip()
        if sw and 1 < len(sw) < 35:
            return {"domain": "it_support", "confidence": 0.9,
                    "reasoning": "Keyword: resend software install request",
                    "sub_intent": "software_install",
                    "entities": {"software_name": sw}}

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


# ── ConversationState: focus tracking (Phase 1) ────────────────────────────────
# A list item in an agent answer: "1. **Name**", "- Name — 3 yrs", "2. Project X".
_FOCUS_LIST_RE = re.compile(
    r'^\s*(?:\d+[.)]|[-*•])\s*(?:\*\*)?([A-Z][A-Za-z0-9.&/\' \-]{1,58}?)(?:\*\*)?'
    r'(?:\s*[—:\-].*)?$'
)
_FOCUS_PEOPLE_HINTS = ("developer", "engineer", "employee", "people", "candidate",
                       "skill", "staff", "resource", "expert", "analyst", "manager")


def _extract_focus(last_ai: str, domain, turn: int) -> Optional[dict]:
    """Derive the conversation subject from the last answer: the list of named items
    plus a kind ('people' | 'projects' | 'generic'). Returns None when there's nothing
    worth tracking, so a previous focus is left in place rather than wiped."""
    if not last_ai:
        return None
    names: list[str] = []
    seen = set()
    for line in last_ai.splitlines():
        m = _FOCUS_LIST_RE.match(line)
        if m:
            n = m.group(1).strip().strip('*').strip()
            if n and n.lower() not in seen:
                seen.add(n.lower())
                names.append(n)
    low = last_ai.lower()
    if any(w in low for w in _FOCUS_PEOPLE_HINTS):
        kind = "people"
    elif "project" in low:
        kind = "projects"
    else:
        kind = "generic"
    if not names and kind == "generic":
        return None
    return {"kind": kind, "entities": names[:25], "domain": domain or "", "turn": turn}


def _resolve_anaphora_locally(message: str, focus: Optional[dict], current_turn: int) -> Optional[str]:
    """Resolve a group/possessive follow-up against the tracked focus — NO LLM.

    Returns a standalone query (the original message plus an unambiguous reference to
    the focused entities) or None when local resolution isn't safe (no focus, focus
    has no entities, or the focus is stale — more than one turn old)."""
    if not focus or not focus.get("entities"):
        return None
    f_turn = focus.get("turn")
    if f_turn is not None and current_turn - int(f_turn) > 1:
        return None  # stale — the subject is from an older part of the conversation
    if not _FOLLOWUP_REF_RE.search(message or ""):
        return None
    ents = focus["entities"]
    shown = ", ".join(ents[:8]) + (f" and {len(ents) - 8} more" if len(ents) > 8 else "")
    kind_word = {"people": "people", "projects": "projects"}.get(focus.get("kind"), "items")
    return f"{message.rstrip(' .?!')} — referring to these {kind_word}: {shown}."


def state_tracker(state: AgentState) -> dict:
    """Post-answer node: record what this turn was about into `focus` so the next
    turn's follow-up can resolve its pronouns without an LLM. Runs after the
    answer-producing agents; the first concrete piece of the shared post-hook pipeline
    (Abstraction C). Returns {} when nothing is extractable, leaving any prior focus
    intact."""
    msgs = state.get("messages", [])
    turn = sum(1 for m in msgs if isinstance(m, HumanMessage))
    focus = _extract_focus(_last_ai_message(msgs), state.get("domain"), turn)
    result: dict = {"focus": focus} if focus else {}

    # Focus-mode fallback: if the user is in a pinned focus mode but this turn's agent
    # hit the retrieval veto (nothing in its corpus), clear the mode and re-route so the
    # correct domain agent can answer instead.  Only fires once per turn (loop guard).
    active_mode = state.get("active_mode")
    if active_mode and not state.get("focus_mode_fallback_attempted"):
        last_human_idx = max(
            (i for i, m in enumerate(msgs) if isinstance(m, HumanMessage)),
            default=-1,
        )
        turn_msgs = msgs[last_human_idx + 1:] if last_human_idx >= 0 else []
        try:
            from app.services.policy_service import RETRIEVAL_VETO_SENTINEL
            veto_hit = any(
                isinstance(m, ToolMessage) and RETRIEVAL_VETO_SENTINEL in (m.content or "")
                for m in turn_msgs
            )
        except Exception:
            veto_hit = False
        if veto_hit:
            log.info(
                "[state_tracker] focus-mode fallback: active_mode=%r had a retrieval veto — "
                "clearing mode and re-routing to intent_router",
                active_mode,
            )
            result["active_mode"] = None
            result["focus_mode_fallback_attempted"] = True
            result["focus_fallback_pending"] = True

    return result


# ── History-aware follow-up resolution (coreference / query rewriting) ─────────
# A referential follow-up ("show their allocation", "what about those people")
# depends on the previous turn's subject. Routing each message in isolation loses
# that subject and mis-routes the turn. The resolver below rewrites such a message
# into a standalone query BEFORE the router sees it, so both routing and the agent
# act on the resolved intent. Triggers only on group/possessive anaphora that
# clearly point back at a prior answer — terse acks and self-standing questions are
# left untouched (the rewrite LLM is also told to pass through anything already
# self-contained, so false positives are cheap).
_FOLLOWUP_REF_RE = re.compile(
    r"\b(their|theirs|them|they|those|these|his|her|hers|its|that one|the same|the above)\b",
    re.I,
)


def _needs_followup_resolution(last_human: str, last_ai: str) -> bool:
    if not last_human or not last_ai or len(last_ai.strip()) < 40:
        return False
    # Terse acks and domain-clarify replies carry no resolvable subject — skip.
    if _is_confirmation(last_human) or _is_cancellation(last_human):
        return False
    if _CLARIFY_REPLY_RE.match(last_human):
        return False
    return bool(_FOLLOWUP_REF_RE.search(last_human))


async def followup_resolver(state: AgentState) -> dict:
    """Rewrite a referential follow-up into a self-contained query using the prior turn.

    Runs as the graph entry node, before intent_router. Sets `resolved_query` when (and
    only when) the latest message is an anaphoric follow-up; the router and feedback_lookup
    then prefer the resolved text. Fail-soft: any error or implausible rewrite returns {}
    so the raw message is used unchanged."""
    # Reset per-turn fallback flags at the start of every new human message.
    _turn_reset: dict = {"focus_mode_fallback_attempted": False, "focus_fallback_pending": False}
    msgs = state.get("messages", [])
    last_human = next((m.content for m in reversed(msgs) if isinstance(m, HumanMessage)), "")
    last_ai = _last_ai_message(msgs)
    if not isinstance(last_human, str) or not _needs_followup_resolution(last_human, last_ai):
        return _turn_reset
    # Fast path (Phase 1): resolve the pronoun against the tracked focus with zero LLM.
    # Only falls through to the LLM rewrite when there's no usable/recent focus.
    current_turn = sum(1 for m in msgs if isinstance(m, HumanMessage))
    local = _resolve_anaphora_locally(last_human, state.get("focus"), current_turn)
    if local:
        log.info("[followup_resolver] resolved locally (no LLM) %r -> %r", last_human, local)
        return {**_turn_reset, "resolved_query": local}
    prev_human = next(
        (m.content for m in reversed(msgs)
         if isinstance(m, HumanMessage) and m.content != last_human),
        "",
    )
    try:
        resp = await resilient_ainvoke(
            "router",
            [
                SystemMessage(content=(
                    "You rewrite a user's latest message into ONE self-contained question by "
                    "resolving pronouns and references (their, them, those, that one) using the "
                    "conversation. Carry forward the specific names / items the previous "
                    "assistant message referred to. Output ONLY the rewritten question — no "
                    "preamble, no quotes. If it is already self-contained, output it unchanged. "
                    "Never add facts not implied by the conversation."
                )),
                HumanMessage(content=(
                    f"Previous user message:\n{prev_human}\n\n"
                    f"Previous assistant answer:\n{last_ai[:1800]}\n\n"
                    f"Latest user message:\n{last_human}\n\n"
                    "Rewrite the latest message as a standalone question."
                )),
            ],
            default_timeout=20,
        )
        rewritten = (resp.content or "").strip().strip('"').strip()
    except Exception:
        return _turn_reset
    if rewritten and rewritten.lower() != last_human.strip().lower() and len(rewritten) <= 400:
        log.info("[followup_resolver] resolved %r -> %r", last_human, rewritten)
        return {**_turn_reset, "resolved_query": rewritten}
    return _turn_reset


# ── Routing clarification gate (wrong-answer prevention) ──────────────────────
# When the router can't pick a domain confidently, the clarify node shows a quick-choice
# card. Clicking an option sends "<Label>: <original question>" back as the next message,
# which the regex below routes deterministically (confidence 1.0, zero LLM).
_CLARIFY_DOMAIN_LABELS = {
    "hr": "HR",
    "it_support": "IT Support",
    "admin": "Admin & Facilities",
    "pmo": "PMO / Projects",
    "functional_manager": "Manager",
    "ms365": "Microsoft 365",
    "general": "General",
}
_CLARIFY_LABEL_TO_DOMAIN = {v.lower(): k for k, v in _CLARIFY_DOMAIN_LABELS.items()}
_CLARIFY_REPLY_RE = re.compile(
    r'^\s*(' + '|'.join(re.escape(v) for v in _CLARIFY_DOMAIN_LABELS.values()) + r')\s*:\s*(.+)$',
    re.IGNORECASE | re.DOTALL,
)

# Leave-balance fast-path (must beat sticky domain so short queries aren't swallowed).
_LEAVE_BALANCE_RE = re.compile(
    r'\b(leave\s+balance|how\s+many\s+leave|remaining\s+leave|leave\s+status'
    r'|my\s+leave|check\s+.*leave|leaves?\s+(left|remaining|available))\b',
    re.IGNORECASE,
)


# ── Routing Resolver (Phase 3, strangler migration) ─────────────────────────────────────────
# The deterministic fast-paths that historically opened intent_router are now registered
# strategies on ROUTER_RESOLVER. They run on the RAW message (before any resolved_query rewrite),
# in this precedence order. The keyword/sticky/semantic/LLM layers below remain inline for now and
# will migrate into strategies in later slices. See app/services/resolver.py.

def _clarify_reply_strategy(ctx: RouteContext) -> Optional[Decision]:
    """The user picked a domain from the clarify card — an explicit choice outranks all heuristics."""
    m = _CLARIFY_REPLY_RE.match(ctx.message)
    if not m:
        return None
    chosen = _CLARIFY_LABEL_TO_DOMAIN.get(m.group(1).lower())
    if not chosen:
        return None
    return Decision(domain=chosen, reasoning="User selected this domain on the clarification card.")


def _pending_action_strategy(ctx: RouteContext) -> Optional[Decision]:
    """A yes/no while an IT email draft is pending → confirm or cancel it. Only touches the
    durable store on a yes/no message, so there's no DB read on ordinary turns."""
    is_yes, is_no = _is_confirmation(ctx.message), _is_cancellation(ctx.message)
    if not (is_yes or is_no):
        return None
    if not PendingActionService.has_pending(_draft_key(ctx.state), "software_install"):
        return None
    if is_yes:
        return Decision(domain="it_support", sub_intent="software_install_confirm",
                        reasoning="User confirmed a pending IT email draft.")
    return Decision(domain="it_support", sub_intent="software_install_cancel",
                    reasoning="User cancelled a pending IT email draft.")


def _form_fill_confirm_strategy(ctx: RouteContext) -> Optional[Decision]:
    """A yes/no while a conversational form fill is STAGED (summary shown, awaiting submit) →
    submit or discard. High-precision, like the other draft-confirmation strategies: only touches
    the store on a yes/no message, and only claims the turn when the fill is in the 'ready' phase
    (so a yes/no during gathering stays a field answer, handled later by the continue strategy)."""
    if not (_is_confirmation(ctx.message) or _is_cancellation(ctx.message)):
        return None
    p = PendingActionService.get_pending(_draft_key(ctx.state), "form_fill")
    if not p or (p.get("payload") or {}).get("phase") != "ready":
        return None
    return Decision(domain="form_fill", sub_intent="continue",
                    reasoning="Confirm/cancel a staged conversational form fill.")


def _form_fill_continue_strategy(ctx: RouteContext) -> Optional[Decision]:
    """Low-priority continuation: a reply during an in-progress fill that no confident intent
    claimed is treated as the answer to the pending field question. Registered LATE in
    MAIN_RESOLVER (after the exact/keyword-high/semantic-high/form-library classifiers, before the
    fuzzy fallbacks), so a clear new intent — 'what's my leave balance?' — escapes the fill while a
    bare field answer — 'Pune' — stays in it. A fresh 'fill … form' is left to the form matcher so
    the user can switch forms (the new fill supersedes the old pending)."""
    if _NEW_FILL_REQUEST_RE.search(ctx.message):
        return None
    if not PendingActionService.has_pending(_draft_key(ctx.state), "form_fill"):
        return None
    return Decision(domain="form_fill", sub_intent="continue",
                    reasoning="Continuing an in-progress conversational form fill (no stronger intent).")


def _leave_balance_strategy(ctx: RouteContext) -> Optional[Decision]:
    """Leave-balance query → Zoho deeplink. Runs before sticky so short queries aren't swallowed."""
    if not _LEAVE_BALANCE_RE.search(ctx.message):
        return None
    return Decision(domain="deeplink", sub_intent="leave_balance",
                    reasoning="Fast-path: leave balance query -> deeplink/Zoho.")


_MS365_ACTION_TYPES = frozenset({
    "ms365_email", "ms365_channel_post", "ms365_teams_message", "ms365_community_post",
    "ms365_group_chat",
})


def _ms365_pending_action_strategy(ctx: RouteContext) -> Optional[Decision]:
    """A yes/no while an MS365 write action is staged → confirm or cancel it."""
    is_yes, is_no = _is_confirmation(ctx.message), _is_cancellation(ctx.message)
    if not (is_yes or is_no):
        return None
    dk = _draft_key(ctx.state)
    hit_type = next((at for at in _MS365_ACTION_TYPES if PendingActionService.has_pending(dk, at)), None)
    if not hit_type:
        return None
    if is_yes:
        return Decision(domain="ms365", sub_intent="ms365_send_confirm",
                        entities={"pending_action_type": hit_type},
                        reasoning=f"User confirmed a pending {hit_type} action.")
    return Decision(domain="ms365", sub_intent="ms365_send_cancel",
                    entities={"pending_action_type": hit_type},
                    reasoning=f"User cancelled a pending {hit_type} action.")


def _announcement_pending_action_strategy(ctx: RouteContext) -> Optional[Decision]:
    """A yes/no while an announcement draft is staged → confirm or cancel it."""
    is_yes, is_no = _is_confirmation(ctx.message), _is_cancellation(ctx.message)
    if not (is_yes or is_no):
        return None
    if not PendingActionService.has_pending(_draft_key(ctx.state), "announcement"):
        return None
    if is_yes:
        return Decision(domain="hr", sub_intent="announcement_confirm",
                        reasoning="User confirmed a pending announcement draft.")
    return Decision(domain="hr", sub_intent="announcement_cancel",
                    reasoning="User cancelled a pending announcement draft.")


# Each focus mode pins routing to a fixed (domain, sub_intent) until the user
# leaves it. This is what makes a mode FOCUSED: we skip the keyword/semantic
# classifier cascade entirely instead of re-deciding the domain every turn (which
# is how "find a React dev" in Resource Finder used to land on the wrong node).
# - analytics → the chart builder node.
# - training / project → the PMO agent (Udemy/training tools + Project IQ tools);
#   the sub_intents below are intentionally not special-cased by the PMO
#   smart_dispatcher, so they fall through to the LLM with the full toolset, and
#   _MODE_HINTS nudges which tools to prefer.
# - resource → the HR agent's resource_match tool group (match_resources et al).
_MODE_ROUTES: dict[str, tuple[str, str]] = {
    "analytics": ("analytics", "builder"),
    "training":  ("pmo", "training"),
    "project":   ("pmo", "project_iq"),
    "resource":  ("hr", "resource_match"),
}


def _active_mode_strategy(ctx: RouteContext) -> Optional[Decision]:
    """An explicit assistant mode makes routing sticky to that mode's domain.

    Reads from the SkillSpec registry (ARB #45) instead of the hardcoded
    _MODE_ROUTES dict — new modes are added as data in capability_registry.py.
    Confirmation and clarify strategies above this point still win, so a
    pending yes/no isn't swallowed while in a focus mode.
    """
    mode = (ctx.state.get("active_mode") or "").strip()
    if not mode:
        return None
    # Try the declarative registry first (ARB #45)
    from app.services.capability_registry import route_for_mode
    spec = route_for_mode(mode)
    if spec:
        domain, sub_intent, _ = spec
        return Decision(domain=domain, sub_intent=sub_intent,
                        reasoning=f"{mode} mode active — routing pinned to {domain} (skill registry).")
    # Fallback: legacy _MODE_ROUTES for any mode not yet in the registry
    route = _MODE_ROUTES.get(mode)
    if route:
        domain, sub_intent = route
        return Decision(domain=domain, sub_intent=sub_intent,
                        reasoning=f"{mode} mode active — routing pinned to {domain}.")
    return None


# Strategies on the RAW message, before any resolved_query rewrite, in precedence order.
ROUTER_RESOLVER = Resolver()
ROUTER_RESOLVER.register("clarify_reply", _clarify_reply_strategy)
ROUTER_RESOLVER.register("pending_action", _pending_action_strategy)
ROUTER_RESOLVER.register("ms365_pending_action", _ms365_pending_action_strategy)
ROUTER_RESOLVER.register("announcement_pending_action", _announcement_pending_action_strategy)
# Explicit mode stickiness sits after the pending-action/clarify confirmations (so a staged
# yes/no still resolves) but before every keyword/semantic classifier below.
ROUTER_RESOLVER.register("active_mode", _active_mode_strategy)
# Only the STAGED-fill yes/no is high-precision enough to short-circuit here; the gathering-phase
# continuation runs late in MAIN_RESOLVER so confident new intents can escape an in-progress fill.
ROUTER_RESOLVER.register("form_fill_confirm", _form_fill_confirm_strategy)
ROUTER_RESOLVER.register("leave_balance", _leave_balance_strategy)


def _leave_params_strategy(ctx: RouteContext) -> Optional[Decision]:
    """Unambiguous leave application (dates + type extracted) → Zoho fast-path, no LLM."""
    params = _try_extract_leave_params(ctx.message)
    if not params:
        return None
    return Decision(domain="deeplink", sub_intent="zoho_leave_fastpath", entities=params,
                    reasoning="Zoho leave params extracted without LLM.")


def _exact_dict_strategy(ctx: RouteContext) -> Optional[Decision]:
    """Fast Intent Dictionary: O(1) exact normalised match against the curated/learned phrasing
    map (precomputed into ctx.exact). Microseconds, zero LLM load, 100% precise."""
    if ctx.exact is None:
        return None
    entities = _extract_entities(ctx.message, ctx.exact.domain, ctx.exact.sub_intent)
    return Decision(domain=ctx.exact.domain, sub_intent=ctx.exact.sub_intent,
                    entities=entities, confidence=1.0, reasoning=ctx.exact.reasoning)


def _keyword_high_strategy(ctx: RouteContext) -> Optional[Decision]:
    """Zero-LLM keyword fast-exit: a confidence==1.0 keyword route is deterministic and must NOT
    be overridden by the semantic router (which could re-route it to an LLM agent and time out).
    Fires before the semantic high-tier strategy."""
    kr = ctx.keyword_result
    if not (kr and kr.get("confidence", 0) >= 1.0):
        return None
    return Decision(domain=kr["domain"], sub_intent=kr["sub_intent"],
                    entities=kr.get("entities", {}), confidence=1.0, reasoning=kr["reasoning"])


def _semantic_high_strategy(ctx: RouteContext) -> Optional[Decision]:
    """Semantic intent router (high tier): a strong, top-k-agreeing pgvector k-NN match routes
    directly with 0 LLM calls and cannot hallucinate a domain (output space = stored labels).
    ctx.decision is always populated here (exact misses reach this point), so no recompute."""
    d = ctx.decision
    if d is None or d.tier != "high":
        return None
    entities = _extract_entities(ctx.message, d.domain, d.sub_intent)
    return Decision(domain=d.domain, sub_intent=d.sub_intent, entities=entities,
                    confidence=d.similarity, reasoning=d.reasoning)


async def _form_library_strategy(ctx: RouteContext) -> Optional[Decision]:
    """Form Library (layer 5.5): match the message against admin-defined fillable forms (pgvector
    k-NN over enabled FormTemplate embeddings). A confident match short-circuits to render the form
    inline — fully data-driven, so a new admin form is chat-triggerable with no code change. Runs
    AFTER exact/semantic-high (a precise domain intent always wins). Info-style questions with no
    action verb need a stronger match (so "what is the process for X?" gets a real answer, not a
    widget). Fail-soft: returns None if the embed model is down."""
    try:
        from app.services.form_library_service import FormLibraryService
        _is_info_no_action = _INFO_QUERY_RE.search(ctx.message) and not _ACTION_VERB_RE.search(ctx.message)
        _threshold = settings.FORM_MATCH_INFO_SIM_THRESHOLD if _is_info_no_action else None
        form_match = await asyncio.to_thread(FormLibraryService.match, ctx.message, _threshold)
    except Exception as e:  # noqa: BLE001
        log.warning("[intent_router] FormLibraryService.match raised unexpectedly: %s", e)
        form_match = None
    if not form_match:
        return None
    # Intent to FILL/COMPLETE/SUBMIT → conversational gather flow; otherwise render the widget.
    if _CONV_FILL_RE.search(ctx.message):
        return Decision(domain="form_fill", sub_intent="start",
                        entities={"form_template_id": form_match["id"], "form_name": form_match["name"]},
                        confidence=form_match["similarity"],
                        reasoning=f"User wants to fill the '{form_match['name']}' form conversationally.")
    return Decision(domain="dynamic_form", sub_intent=f"form:{form_match['id']}",
                    entities={"form_template_id": form_match["id"]},
                    confidence=form_match["similarity"],
                    reasoning=f"Message matched the '{form_match['name']}' form.")


def _keyword_fallback_strategy(ctx: RouteContext) -> Optional[Decision]:
    """Keyword regex safety net beneath the semantic high tier (any confidence). 0 LLM calls.
    Phased out once the semantic router's accuracy is confirmed against live traffic."""
    kr = ctx.keyword_result
    if not kr:
        return None
    return Decision(domain=kr["domain"], sub_intent=kr["sub_intent"],
                    entities=kr.get("entities", {}), confidence=kr["confidence"],
                    reasoning=kr["reasoning"])


async def _llm_fallback_strategy(ctx: RouteContext) -> Optional[Decision]:
    """Terminal strategy: the generative LLM router, the last resort when no deterministic /
    semantic layer was confident. An ambiguous semantic tier hands its top-k shortlist as a soft
    hint (constrains the 8-way choice to 2-3, cutting hallucination); low/unavailable → plain
    router. Below CLARIFY_CONF_THRESHOLD a confident-but-wrong domain is the worst failure, so it
    offers a domain_clarify card (LLM pick + shortlist, enabled domains only, general escape hatch)
    instead of guessing. Always returns a Decision."""
    d = ctx.decision
    candidate_domains = d.candidate_domains if (d is not None and d.tier == "ambiguous") else None
    try:
        result = await classify_intent_async(ctx.message, candidate_domains=candidate_domains)
    except APIConnectionError:
        return Decision(domain="general", confidence=0.5, reasoning="LLM connection failed.")

    if result["confidence"] < settings.CLARIFY_CONF_THRESHOLD and result["domain"] != "general":
        clarify_domains: list[str] = []
        for dom in [result["domain"]] + (candidate_domains or []):
            if (dom in _CLARIFY_DOMAIN_LABELS and dom not in clarify_domains
                    and llm_controls.is_domain_enabled(dom)):
                clarify_domains.append(dom)
        if "general" not in clarify_domains:
            clarify_domains.append("general")
        if len(clarify_domains) >= 2:
            return Decision(
                domain="domain_clarify", sub_intent="domain_clarify",
                confidence=result["confidence"],
                reasoning=(f"Routing confidence {result['confidence']:.2f} is below "
                           f"{settings.CLARIFY_CONF_THRESHOLD} — asking the user to pick the domain."),
                entities={"clarify_domains": clarify_domains[:4], "clarify_question": ctx.message},
            )

    return Decision(domain=result["domain"], sub_intent=result.get("sub_intent", "unknown"),
                    entities=result.get("entities", {}), confidence=result["confidence"],
                    reasoning=result["reasoning"])


# Strategies on the RESOLVED message, after the resolved_query rewrite and the sticky-domain
# decision, sharing a RouteContext (keyword_result/exact/decision computed once). This list is now
# the COMPLETE post-rewrite routing pipeline — _llm_fallback is the terminal catch-all (always
# returns). See docs/architecture-redesign.md §4.2.
MAIN_RESOLVER = Resolver()
MAIN_RESOLVER.register("leave_params", _leave_params_strategy)
MAIN_RESOLVER.register("exact_dict", _exact_dict_strategy)
MAIN_RESOLVER.register("keyword_high", _keyword_high_strategy)
MAIN_RESOLVER.register("semantic_high", _semantic_high_strategy)
MAIN_RESOLVER.register("form_library", _form_library_strategy)
# Runs after the high-precision classifiers but before the fuzzy fallbacks: an in-progress fill
# only claims a reply that no confident intent wanted (see _form_fill_continue_strategy).
MAIN_RESOLVER.register("form_fill_continue", _form_fill_continue_strategy)
MAIN_RESOLVER.register("keyword_fallback", _keyword_fallback_strategy)
MAIN_RESOLVER.register("llm_fallback", _llm_fallback_strategy)


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

    # Deterministic fast-paths (clarify reply -> pending-action confirm/cancel -> leave balance),
    # in precedence order, on the RAW message. Migrated to named, individually-tested strategies
    # (Phase 3 strangler step 1). The keyword/sticky/semantic/LLM layers below are still inline.
    _early = await ROUTER_RESOLVER.resolve(RouteContext(message=last_human, state=state))
    if _early is not None:
        return _early.as_route()

    # History-aware follow-up: if followup_resolver rewrote this referential message into a
    # standalone query, classify on THAT (so "show their allocation" routes by its real
    # subject, not as a fresh project query). Deterministic fast-paths above (clarify reply,
    # pending-draft confirm, leave-balance) intentionally use the raw text; everything from
    # here on — keyword, semantic, sticky, sub-intent + entity extraction — uses the resolved.
    last_human = state.get("resolved_query") or last_human

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
    # classify() calls the embedding model (blocking I/O) — run in thread to avoid
    # freezing the event loop while other concurrent streams are active.
    decision = await asyncio.to_thread(SemanticRouterService.classify, last_human) if exact is None else None
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
        # Turn-count decay: after many turns the conversation may have wandered far from the
        # original domain (e.g. an HR query from yesterday leaves the session sticky to "hr",
        # and today's "what's the status?" gets misrouted). More than 12 messages (6 full turns)
        # have passed since the domain was set, so require explicit continuation signals only —
        # a short terse message alone no longer keeps stickiness.
        all_msgs = state.get("messages", [])
        _human_msg_count = sum(1 for m in all_msgs if isinstance(m, HumanMessage))
        _stale_sticky = _human_msg_count > 6

        # Priority 1 — a fresh signal pointing to a different domain is a topic switch: never sticky.
        # Priority 2 — a genuine follow-up (references prior context / terse ack / AI just asked):
        #   stay in the sticky domain unless the conversation is stale (decay).
        # Otherwise — a self-standing new request with no usable away-signal (tier low/unavailable):
        #   fall through to normal classification.
        if not topic_switch and _is_continuation(last_human, last_ai) and not _stale_sticky:
            return {
                "domain": existing_domain,
                "route_confidence": 0.95,
                "route_reasoning": f"Follow-up in context of {existing_domain} — staying sticky.",
                "sub_intent": "followup",
                "entities": {},
            }
        if topic_switch:
            pass

    # Post-rewrite layers, in precedence order, sharing one RouteContext (keyword_result/exact/
    # decision precomputed above for the sticky override, reused here — no recompute). Migrated to
    # named strategies (Phase 3): leave-params → exact dictionary → keyword(conf==1.0) →
    # semantic-high → form-library → keyword(any fallback). Only the LLM-router fallback (+ clarify
    # gate) below remains inline (it owns the decision-based candidate shortlist).
    _ctx = RouteContext(message=last_human, state=state,
                        keyword_result=keyword_result, exact=exact, decision=decision)
    _decision = await MAIN_RESOLVER.resolve(_ctx)
    if _decision is not None:
        return _decision.as_route()

    # Safety net: the llm_fallback strategy is terminal and always returns, so this is reachable
    # only if a strategy raised and was skipped. Never leave the router without a route.
    return {"domain": "general", "route_confidence": 0.5,
            "route_reasoning": "Resolver produced no decision (all strategies deferred/skipped).",
            "sub_intent": "unknown", "entities": {}}


# ── Module-level TTL caches ───────────────────────────────────────────────────
# MULTI-WORKER NOTE: these dicts live in the worker process's heap.  In a
# single-worker deployment (the current topology) they are safe.  In a
# multi-worker deployment (>1 uvicorn/gunicorn workers) each worker gets its
# own copy — no data corruption, but cache misses multiply by worker count.
# Migration path: swap for Redis SETEX calls via get_redis_client() when
# multi-worker is needed.  Track issue: ARB item #32.
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

    # ── Parallel pre_work: nudge + feedback run concurrently ────────────────
    async def _get_nudge():
        nudge_cached = _app_nudge_cache.get(last_human[:160])
        if nudge_cached and now - nudge_cached[1] < _APP_NUDGE_TTL:
            return nudge_cached[0]
        try:
            result = await asyncio.to_thread(_app_directory_nudge, last_human)
        except Exception:
            result = ""
        _app_nudge_cache[last_human[:160]] = (result, now)
        if len(_app_nudge_cache) > 500:
            for k in sorted(_app_nudge_cache, key=lambda k: _app_nudge_cache[k][1])[:100]:
                _app_nudge_cache.pop(k, None)
        return result

    async def _get_feedback():
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
        if _feedback_count_cache["count"] < 3:
            return ""
        cache_key = f"{domain}:{last_human[:120]}"
        cached = _feedback_result_cache.get(cache_key)
        if cached and now - cached[1] < _FEEDBACK_RESULT_TTL:
            return cached[0]
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
        return fb_ctx

    # Skip the AppDirectory nudge for terminal zero-LLM domains — the nudge context is never
    # read by those nodes, and the 0.62 cosine threshold often injects misleading app suggestions
    # (e.g. ManageEngine "All Requests" being suggested for "create a form…"). Also saves one
    # embedding call per request on these fast-path routes.
    _NUDGE_SKIP_DOMAINS = {"dynamic_form", "form_fill", "form_builder", "referral_choice", "domain_clarify", "deeplink"}
    _skip_nudge = state.get("domain") in _NUDGE_SKIP_DOMAINS

    async def _noop():
        return ""

    app_nudge, fb_ctx = await asyncio.gather(
        _noop() if _skip_nudge else _get_nudge(),
        _get_feedback(),
    )

    # Surface a resolved follow-up to the agent's LLM so it answers the standalone intent
    # (with the prior turn's people/items) rather than the bare pronoun message.
    resolved_q = state.get("resolved_query")
    resolved_note = ""
    if resolved_q and resolved_q.strip().lower() != last_human.strip().lower():
        resolved_note = (
            f"\n\n[FOLLOW-UP CONTEXT] The user's latest message is a follow-up referring to the "
            f"previous turn. It resolves to this standalone request: \"{resolved_q}\". "
            f"Answer that request, using the people/items from the previous answer.\n"
        )

    combined = resolved_note + (fb_ctx or "") + (app_nudge or "")
    return {"feedback_context": combined} if combined else {}


def hr_agent(state: AgentState):
    """HR Agent — handles leave and policies."""
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    sub_intent = state.get("sub_intent") or ""
    messages = state["messages"]
    draft_key = _draft_key(state)

    # ── Announcement: confirm the pending draft ─────────────────────────────
    if sub_intent == "announcement_confirm":
        claimed = PendingActionService.confirm(draft_key, "announcement")
        if not claimed:
            return {"messages": [AIMessage(content=(
                "I don't have a pending announcement draft to publish. "
                "Please describe the announcement again and I'll prepare a new draft."
            ))]}
        ann_params = (claimed.get("payload") or {}).get("params") or {}
        try:
            result = AnnouncementService.create(
                title=ann_params.get("title", ""),
                body=ann_params.get("body", ""),
                category=ann_params.get("category", "General"),
                created_by=user_email,
                created_by_domain="hr",
                target_audience=ann_params.get("target_audience", "all"),
                expires_days=int(ann_params.get("expires_days") or 0) or None,
            )
            return {"messages": [AIMessage(content=(
                f"Done — your announcement **\"{ann_params.get('title', '')}\"** has been published. {result}"
                if isinstance(result, str) else
                f"Done — your announcement **\"{ann_params.get('title', '')}\"** has been published."
            ))]}
        except Exception as exc:
            log.warning("[hr_agent] announcement publish failed: %s", exc)
            return {"messages": [AIMessage(content="I couldn't publish the announcement. Please try again.")]}

    # ── Announcement: cancel the pending draft ──────────────────────────────
    if sub_intent == "announcement_cancel":
        PendingActionService.cancel(draft_key, "announcement")
        return {"messages": [AIMessage(content="No problem — the announcement draft was discarded and nothing was published.")]}

    # Knowledge-miss handoff (item 3): the user accepted "raise it with HR" from an
    # abstention card. Create the HR query DIRECTLY — do NOT search policy first (the
    # search is exactly what abstained, so re-running it would dead-end or loop) — and
    # return the receipt verbatim.
    if sub_intent == "hr_query_handoff":
        _topic = str((state.get("entities") or {}).get("handoff_topic")
                     or next((m.content for m in reversed(messages) if isinstance(m, HumanMessage)), "")).strip()
        _subj = (_topic[:77] + "…") if len(_topic) > 78 else (_topic or "HR assistance request")
        try:
            from app.services import actions  # routed through the action registry spine
            _receipt = actions.run(
                "hr_query", actor_email=user_email, category="General",
                subject=_subj, description=_topic or _subj,
            ).human_message
        except Exception:
            _receipt = ("I couldn't log the HR query automatically — please reach out to HR "
                        "directly and they'll help you with this.")
        return {"messages": [AIMessage(content=_receipt)]}

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
        _portal = state.get("portal_context") or {}
        _portal_page = _portal.get("page") if _portal else None
        _portal_line = (
            f"\nUser is currently on the **{_portal_page}** portal page — "
            f"prefer filtering/answering in that context when relevant.\n"
            if _portal_page else ""
        )
        base = PromptService.get_system_prompt(
            "hr",
            f"You are Centriq HR Assistant for Aligned Automation.\n"
            f"Employee email: {user_email}.{_loc_line} Never ask who the user is.\n"
            f"ROLE: {role_instruction}\n"
            f"{_portal_line}\n"
            f"Tool routing — act immediately:\n"
            f"- Leave balance → get_leave_balance() for the user's own; if they ask about a "
            f"specific OTHER person (e.g. 'Priya's leave balance'), pass that person's name/email "
            f"as get_leave_balance(email='<that person>'). Access is enforced server-side — "
            f"do not pre-judge whether they're allowed; just pass the name and relay the result.\n"
            f"- Apply leave → apply_leave with inferred leave_type (default Casual)\n"
            f"- Cancel/withdraw leave → call get_my_leaves(email='{user_email}') to list leaves, "
            f"then call cancel_leave(email='{user_email}', leave_id=<id>)\n"
            f"- Policy question → search_hr_policies, answer from result\n"
            f"- Who is X / contact/phone/extension/seat/joining date/blood group/tenure/grade "
            f"for a person → get_employee_profile(name_or_email). All these fields are returned "
            f"directly from the profile — do NOT call search_hr_policies for personal facts.\n"
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
        messages = [SystemMessage(content=base + _get_mode_hint(state) + guardrail + feedback_ctx)] + messages

    user_question = next((m.content for m in reversed(messages) if isinstance(m, HumanMessage)), "")

    # ── Deterministic resource-matching (staffing) ──────────────────────────────
    # "I need 2 React devs with 3+ yrs free by July", "who can fit a new data project?".
    # Ranks candidates by skill + availability + experience. Done deterministically (not
    # left to the weak agent model) so the multi-signal extraction and ranking are
    # reliable; only fires when a skill term actually resolves, else falls through.
    if isinstance(user_question, str) and (
        state.get("sub_intent") == "resource_match"
        or _KW_HR_RESOURCE_MATCH.search(user_question)
    ):
        _skills, _min_yrs, _avail_by, _cnt = _extract_resource_match_args(user_question)
        if _skills:
            from app.services.resource_matching_service import ResourceMatchingService
            try:
                _res = ResourceMatchingService.match(
                    skills=_skills, min_years=_min_yrs, available_by=_avail_by,
                    count=_cnt, user_email=user_email)
                if _res:
                    return {"messages": [AIMessage(content=_res.strip())]}
            except Exception as _exc:
                log.warning("[resource_match] failed for %r: %s", user_question, _exc)

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
    # ── Deterministic employee profile / contact lookup (SQL fast-path) ─────────
    # For phone, seat, extension, joining date, blood group, tenure, etc.
    # The LLM is bypassed entirely: we call EmployeeService directly.
    # Result: < 1 second instead of ~60 seconds; LLM never sees employee data.
    _PROFILE_INTENTS = {"employee_contact", "profile_lookup", "joining_date",
                        "seat_location", "blood_group"}
    if sub_intent in _PROFILE_INTENTS or _KW_CONTACT_LOOKUP.search(user_question or ""):
        _entities = state.get("entities") or {}
        _pname = (
            _entities.get("person_name")
            or _extract_person_name(user_question or "")
        )
        if _pname:
            from app.services.employee_service import EmployeeService
            try:
                _profile_result = EmployeeService.get_profile(_pname)
                if _profile_result and "No employee profile found" not in _profile_result:
                    return {"messages": [AIMessage(content=_profile_result.strip())]}
            except Exception as _exc:
                log.warning("[profile_fast_path] failed for %r: %s", _pname, _exc)
            # If not found or error, fall through to the LLM agent which can
            # try search_employee_directory or ask a clarifying question.
    # ────────────────────────────────────────────────────────────────────────────

    # NOTE: the custom-context gate now runs once for every domain in the shared
    # `context_gate` graph node (between feedback_lookup and the agents) — it is no
    # longer wired per-agent here.

    # Bind only the sub-intent-relevant tool group (≤8 schemas) instead of all 38 —
    # cuts ~3-4k prompt tokens per call and improves tool selection on small models.
    _bound_tools = _hr_tools_for(sub_intent)
    try:
        response = resilient_invoke("agent", messages,
                                    build=lambda l: l.bind_tools(_bound_tools),
                                    default_timeout=45)
    except APIConnectionError:
        return {"messages": [AIMessage(content="I'm sorry, I'm having trouble connecting right now — please try again in a moment.")]}

    # ── Intercept create_announcement before it fires (Phase 2 action safety) ──
    # If the LLM called create_announcement we stage it instead of letting the
    # hr_tools ToolNode execute it. The summarizer never sees this path so the
    # confirmation card isn't swallowed by the policy-framed summarizer.
    for tc in getattr(response, "tool_calls", None) or []:
        if tc.get("name") != "create_announcement":
            continue
        ann_args = tc.get("args") or {}
        idem = f"announcement:{user_email}:{ann_args.get('title', '')}"
        PendingActionService.create(
            session_key=draft_key,
            action_type="announcement",
            payload={"params": ann_args},
            user_email=user_email,
            idempotency_key=idem,
        )
        card_payload = json.dumps({
            "question": f"Publish the announcement **\"{ann_args.get('title', 'Untitled')}\"** now?",
            "preview": (ann_args.get("body") or "")[:300],
            "choices": [{"label": "Publish", "value": "yes"}, {"label": "Cancel", "value": "cancel"}],
        })
        return {"messages": [AIMessage(content=(
            f"Here's the announcement I've prepared. Confirm to publish it company-wide.\n\n"
            f"{QUICK_CHOICE_START}{card_payload}{QUICK_CHOICE_END}"
        ))]}

    # Guard: weak models sometimes return empty content with no tool calls.
    # Surface the last ToolMessage (second-pass scenario) or return an explicit fallback.
    if not (response.content or "").strip() and not getattr(response, "tool_calls", None):
        last_tool = next(
            (m for m in reversed(state["messages"]) if isinstance(m, ToolMessage) and m.content),
            None,
        )
        if last_tool:
            response = AIMessage(content=last_tool.content)
        else:
            response = AIMessage(content="I wasn't able to complete your request. Please try again or rephrase your question.")

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

    # Fast-path: leave params extracted by regex — hand back the Zoho apply-leave form
    # deep-link (0 LLM, no internal record; Zoho owns leave application).
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


def _ms365_confirmation_card(action_type: str, params: dict) -> str:
    """Build the user-facing confirmation card for a staged MS365 write action.

    Email → EMAIL_DRAFT widget (editable before send).
    Teams DM / channel / community → QUICK_CHOICE "Send / Cancel" card.
    """
    if action_type == "ms365_email":
        draft_json = json.dumps({
            "to": params.get("to", ""),
            "subject": params.get("subject", ""),
            "body": params.get("body", ""),
            "cc": params.get("cc", ""),
        })
        return (
            "I've prepared this email for you. Review it below and click Send when you're ready.\n\n"
            f"[EMAIL_DRAFT_START]{draft_json}[EMAIL_DRAFT_END]"
        )
    if action_type == "ms365_teams_message":
        card_payload = json.dumps({
            "question": f"Send this Teams message to **{params.get('display_name', 'them')}**?",
            "preview": params.get("message", "")[:200],
            "choices": [{"label": "Send", "value": "yes"}, {"label": "Cancel", "value": "cancel"}],
        })
        return (
            f"Ready to send a Teams message to **{params.get('display_name', 'them')}**. "
            f"Confirm below.\n\n{QUICK_CHOICE_START}{card_payload}{QUICK_CHOICE_END}"
        )
    if action_type == "ms365_channel_post":
        card_payload = json.dumps({
            "question": (
                f"Post to **{params.get('team_name', 'the team')} › "
                f"{params.get('channel_name', 'channel')}**?"
            ),
            "preview": params.get("message", "")[:200],
            "choices": [{"label": "Post", "value": "yes"}, {"label": "Cancel", "value": "cancel"}],
        })
        return (
            f"Ready to post to **{params.get('team_name')} › {params.get('channel_name')}**. "
            f"Confirm below.\n\n{QUICK_CHOICE_START}{card_payload}{QUICK_CHOICE_END}"
        )
    if action_type == "ms365_community_post":
        card_payload = json.dumps({
            "question": f"Post to the **{params.get('community_name', 'community')}** Viva Engage community?",
            "preview": params.get("message", "")[:200],
            "choices": [{"label": "Post", "value": "yes"}, {"label": "Cancel", "value": "cancel"}],
        })
        return (
            f"Ready to post to the **{params.get('community_name')}** community on Viva Engage. "
            f"Confirm below.\n\n{QUICK_CHOICE_START}{card_payload}{QUICK_CHOICE_END}"
        )
    if action_type == "ms365_group_chat":
        member_emails = params.get("member_emails", [])
        card_payload = json.dumps({
            "question": f"Create the group chat **'{params.get('topic', 'New Group Chat')}'**?",
            "preview": f"{len(member_emails)} member(s): {', '.join(member_emails[:5])}",
            "choices": [{"label": "Create", "value": "yes"}, {"label": "Cancel", "value": "cancel"}],
        })
        return (
            f"Ready to create the group chat **'{params.get('topic', 'New Group Chat')}'** "
            f"with {len(member_emails)} member(s). "
            f"Confirm below.\n\n{QUICK_CHOICE_START}{card_payload}{QUICK_CHOICE_END}"
        )
    # Fallback
    card_payload = json.dumps({
        "question": "Send this message?",
        "choices": [{"label": "Send", "value": "yes"}, {"label": "Cancel", "value": "cancel"}],
    })
    return f"Confirm the action below.\n\n{QUICK_CHOICE_START}{card_payload}{QUICK_CHOICE_END}"


async def _execute_ms365_action(claimed: dict, graph_token: str, yammer_token: str) -> dict:
    """Dispatch a confirmed MS365 write action to the actual API.

    `claimed` is the PendingAction payload from PendingActionService.confirm().
    Returns the service result dict {"success": bool, ...}.
    """
    payload = claimed.get("payload") or {}
    action_type = payload.get("action_type") or ""
    params = payload.get("params") or {}

    if action_type == "ms365_email":
        from app.services import ms365_service as _ms
        to_list = [a.strip() for a in params.get("to", "").split(",") if a.strip()]
        cc_raw = params.get("cc", "")
        cc_list = [a.strip() for a in cc_raw.split(",") if a.strip()] if cc_raw else None
        return await _ms.send_email(graph_token, to_list, params.get("subject", ""), params.get("body", ""), cc_list)

    if action_type == "ms365_channel_post":
        from app.services import ms365_service as _ms
        return await _ms.send_channel_message(
            graph_token, params["team_id"], params["channel_id"], params.get("message", "")
        )

    if action_type == "ms365_teams_message":
        from app.services import ms365_service as _ms
        return await _ms.send_teams_message(graph_token, params["chat_id"], params.get("message", ""))

    if action_type == "ms365_community_post":
        from app.services import yammer_service as _ys
        return await _ys.post_to_community(yammer_token, int(params["group_id"]), params.get("message", ""))

    if action_type == "ms365_group_chat":
        from app.services import ms365_service as _ms
        return await _ms.create_group_chat(graph_token, params.get("topic", "Group Chat"), params.get("member_emails", []))

    return {"success": False, "error": "unknown_action_type", "message": f"Unknown MS365 action type: {action_type}"}


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

    # Pre-fill identity-bound fields from the logged-in user's profile so they only confirm.
    # Skipped for anonymous forms — pre-filling identity there would defeat the anonymity promise.
    prefill: dict = {}
    if not tpl.get("is_anonymous"):
        try:
            from app.services.form_library_service import FormLibraryService as _FLS
            user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
            prefill = _FLS.build_prefill(tpl["fields"], user_email)
        except Exception as e:  # noqa: BLE001
            log.warning("[dynamic_form] prefill failed (rendering empty): %s", e)
            prefill = {}

    payload = {
        "template_id": tpl["id"],
        "name": tpl["name"],
        "description": tpl["description"],
        "fields": tpl["fields"],
        "submit_endpoint": "/api/forms/submit",
        "prefill": prefill,
    }
    intro = f"Sure — please fill in the **{tpl['name']}** form below and submit."
    content = f"{intro}\n{DYNAMIC_FORM_START}{json.dumps(payload)}{DYNAMIC_FORM_END}"
    return {"messages": [AIMessage(content=content)]}


# ── Conversational form fill (item #2) ──────────────────────────────────────────
_FORM_FILL_ACTION = "form_fill"


def _form_field_question(missing: list, intro: str = "") -> str:
    """Build a concise question for the next missing field(s). Asks up to two at a time so the
    conversation stays light, and lists the choices for select fields."""
    asks = []
    for f in missing[:2]:
        label = f.get("label") or f.get("name")
        if f.get("type") == "select" and f.get("options"):
            asks.append(f"**{label}** ({' / '.join(f['options'])})")
        else:
            asks.append(f"**{label}**")
    if len(asks) == 1:
        body = f"What's the {asks[0]}?"
    else:
        body = "Could you give me the " + ", ".join(asks[:-1]) + f" and {asks[-1]}?"
    return (intro + body + "\n\n_(Answer in one message, or say **cancel** to stop.)_").strip()


async def form_fill_agent_node(state: AgentState):
    """Conversational Form Library fill — gathers an admin-defined form's fields turn-by-turn,
    pre-filling identity, extracting whatever the user states in natural language, and asking only
    for what's still missing. When every required field is in hand it shows a summary and asks for
    an explicit yes (the write-confirmation gate the rest of the action layer uses), then submits
    via the same path the inline widget does (FormLibraryService.submit → FormSubmission + notify)."""
    from app.services.form_library_service import FormLibraryService

    dk = _draft_key(state)
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    msg = next((m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "").strip()
    entities = state.get("entities") or {}

    pending = PendingActionService.get_pending(dk, _FORM_FILL_ACTION)
    # A fresh "start" (user named a form) supersedes any in-progress fill, so switching forms
    # mid-conversation uses the newly matched form rather than continuing the old one.
    if state.get("sub_intent") == "start":
        pending = None
    starting = pending is None
    payload = (pending or {}).get("payload", {})
    form_id = (payload.get("form_template_id") if pending else None) or entities.get("form_template_id")

    try:
        tpl = FormLibraryService.get(form_id) if form_id is not None else None
    except Exception:
        tpl = None
    if not tpl or not tpl.get("enabled"):
        PendingActionService.cancel(dk, _FORM_FILL_ACTION)
        return {"messages": [AIMessage(content="That form isn't available right now. Please try again later.")]}
    fields = tpl.get("fields") or []

    # User backs out at any point.
    if _is_cancellation(msg):
        PendingActionService.cancel(dk, _FORM_FILL_ACTION)
        return {"messages": [AIMessage(content=f"No problem — I've cancelled the **{tpl['name']}**. Just ask when you'd like to start again.")]}

    phase = payload.get("phase", "gathering")
    collected = dict(payload.get("collected") or {})

    # ── Final confirmation gate: explicit yes while everything is staged → submit. ──
    if phase == "ready" and _is_confirmation(msg):
        snap = PendingActionService.confirm(dk, _FORM_FILL_ACTION)   # atomic — guards double-submit
        if not snap:
            return {"messages": [AIMessage(content="Looks like that was already submitted.")]}
        final_values = dict(snap.get("payload", {}).get("collected") or {})
        res = await asyncio.to_thread(FormLibraryService.submit, tpl["id"], user_email, final_values)
        if res.get("status") != "ok":
            # Validation failed at submit — re-open for correction so the turn isn't a dead end.
            PendingActionService.create(dk, _FORM_FILL_ACTION, {
                "form_template_id": tpl["id"], "form_name": tpl["name"],
                "collected": final_values, "phase": "gathering"}, user_email)
            return {"messages": [AIMessage(content=f"I couldn't submit it: {res.get('message', 'please check the details.')} What should I fix?")]}
        return {"messages": [AIMessage(content=res.get("message") or f"Your **{tpl['name']}** has been submitted.")]}

    # ── Seed identity pre-fill on the first turn (never for anonymous forms). ──
    if starting and not tpl.get("is_anonymous"):
        try:
            collected.update(FormLibraryService.build_prefill(fields, user_email))
        except Exception:
            pass

    # ── Extract whatever the user just provided. In the ready phase a non-yes reply is an
    #    edit, so allow it to overwrite; while gathering, only fill gaps. ──
    skip = set() if phase == "ready" else set(collected.keys())
    try:
        collected.update(await asyncio.to_thread(FormLibraryService.extract_values, msg, fields, skip))
    except Exception as e:  # noqa: BLE001
        log.warning("[form_fill] extraction failed: %s", e)

    missing_required = [f for f in fields if f.get("required") and not collected.get(f.get("name"))]

    if missing_required:
        PendingActionService.create(dk, _FORM_FILL_ACTION, {
            "form_template_id": tpl["id"], "form_name": tpl["name"],
            "collected": collected, "phase": "gathering"}, user_email)
        intro = ""
        if starting:
            seeded = [f.get("label") or f.get("name") for f in fields if collected.get(f.get("name"))]
            note = f" I've filled in {', '.join(seeded)} from your profile." if seeded else ""
            intro = f"Sure — let's complete your **{tpl['name']}**.{note}\n\n"
        return {"messages": [AIMessage(content=_form_field_question(missing_required, intro))]}

    # ── All required gathered → summary + explicit confirmation. ──
    PendingActionService.create(dk, _FORM_FILL_ACTION, {
        "form_template_id": tpl["id"], "form_name": tpl["name"],
        "collected": collected, "phase": "ready"}, user_email)
    lines = [
        f"- **{f.get('label') or f.get('name')}:** {collected.get(f.get('name'))}"
        for f in fields if collected.get(f.get("name")) not in (None, "", False)
    ]
    summary = "\n".join(lines)
    content = (f"Here's your **{tpl['name']}** ready to go:\n\n{summary}\n\n"
               "Reply **yes** to submit, or tell me what to change.")
    return {"messages": [AIMessage(content=content)]}


FORM_BUILDER_START = "[FORM_BUILDER_START]"
FORM_BUILDER_END = "[FORM_BUILDER_END]"


async def form_builder_agent_node(state: AgentState):
    """Form Builder node — drafts a new FormTemplate for admin review via LLM, then emits
    the draft inside [FORM_BUILDER_START]…[FORM_BUILDER_END] markers for _postprocess to
    turn into the `form_builder` interactive widget. Role-gated: non-admins get a polite
    redirect without calling the LLM."""
    role = (state.get("user_role") or "employee").lower()
    if role not in {"admin", "super admin"}:
        return {"messages": [AIMessage(content=(
            "Creating new forms is an admin capability. If you need a specific form that "
            "doesn't exist yet, please ask your admin team — or tell me what you're trying "
            "to request and I'll point you to the right existing process."
        ))]}

    last_human = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
    )

    import json as _json
    import re as _re
    from app.services import llm_controls_service as llm_controls

    try:
        model = llm_controls.get_llm("general", default_timeout=60)
        prompt = (
            "You are a form designer for an employee self-service portal. From the request below, "
            "design a fillable form.\n\n"
            f"Request: {last_human}\n\n"
            "Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:\n"
            '{"name": "Short Form Name", "description": "One sentence on what this form is for.", '
            '"category": "HR|Admin|IT|Finance|General", "fields": [{"label": "Field Label", '
            '"type": "text|textarea|date|select|number|email|checkbox|user|image", "required": true, '
            '"options": ["only for select"], "placeholder": "optional hint"}]}\n\n'
            "Rules:\n"
            "- 3 to 8 fields, ordered logically. Mark genuinely essential fields required.\n"
            "- Use 'select' with sensible options for categorical answers, 'textarea' for descriptions, "
            "'date' for dates, 'user' for picking an employee, 'image' for photo evidence.\n"
            "- Do NOT add fields for the submitter's own name/email — the portal knows the logged-in user."
        )
        response = await asyncio.to_thread(model.invoke, prompt)
        raw = (response.content or "").strip()
        m = _re.search(r"\{.*\}", raw, _re.DOTALL)
        if not m:
            raise ValueError("Model returned no JSON")
        draft = _json.loads(m.group(0))

        # Sanitize fields using the same helper as the HTTP route.
        from app.routes.form_library_routes import _sanitize_generated_fields
        fields = _sanitize_generated_fields(draft.get("fields") or [])
        if not fields:
            raise ValueError("No fields generated")

        payload = {
            "name": str(draft.get("name") or "Untitled Form").strip()[:120],
            "description": str(draft.get("description") or "").strip()[:500],
            "category": str(draft.get("category") or "General").strip()[:50],
            "fields": fields,
        }
        intro = f"Here's a draft of **\"{payload['name']}\"** — edit anything you like, then create it."
        content = f"{intro}\n{FORM_BUILDER_START}{_json.dumps(payload)}{FORM_BUILDER_END}"
    except Exception as exc:
        log.warning("form_builder_agent_node draft generation failed: %s", exc)
        return {"messages": [AIMessage(content=(
            "I couldn't draft that form right now (the model may be busy). "
            "Please try again, or create it manually from the Form Library page."
        ))]}

    return {"messages": [AIMessage(content=content)]}


CHART_START = "[CHART_START]"
CHART_END = "[CHART_END]"


async def analytics_agent_node(state: AgentState):
    """Analytics Builder node — active only while the user is in analytics mode (routed here
    by _active_mode_strategy). Hands the message to the conversational chart builder and emits
    the ChartSpec inside [CHART_START]…[CHART_END] markers for _postprocess to turn into the
    `chart` interactive widget. On a miss, returns the builder's explanation as plain text so
    the user stays in the mode and can rephrase."""
    import json as _json
    from app.database import SessionLocal as _SL
    from app.services import analytics_builder_service as _builder

    last_human = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
    )
    # Recent turns as builder history (role/content dicts), excluding the current message.
    history: list[dict] = []
    for m in state["messages"][-7:-1]:
        if isinstance(m, HumanMessage):
            history.append({"role": "user", "content": m.content})
        elif isinstance(m, AIMessage) and isinstance(m.content, str):
            history.append({"role": "assistant", "content": m.content})

    role = (state.get("user_role") or "employee").lower()
    user_email = state.get("user_email")

    db = _SL()
    try:
        result = await asyncio.to_thread(
            _builder.builder_chat, db, last_human, history, role, user_email
        )
    except Exception as exc:
        log.exception("analytics_agent_node builder_chat failed: %s", exc)
        return {"messages": [AIMessage(content=(
            "I couldn't build that chart right now. Try describing it differently — "
            "e.g. \"headcount by function as a bar chart\" — or type `/exit` to leave Analytics mode."
        ))]}
    finally:
        db.close()

    explanation = result.get("explanation") or "Here's your chart."
    chart = result.get("chart")
    if result.get("ok") and chart:
        content = f"{explanation}\n{CHART_START}{_json.dumps(chart)}{CHART_END}"
    else:
        # Miss: surface the explanation and any suggestions as plain text; stay in mode.
        suggestions = result.get("suggestions") or []
        if suggestions:
            explanation += "\n\nTry: " + " · ".join(suggestions[:4])
        content = explanation
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


async def domain_clarify_agent_node(state: AgentState):
    """Zero-LLM clarification card — terminal node for low-confidence routes.
    Asking beats guessing: the user picks the area, the option's value comes back as
    "<Label>: <original question>", and the router's clarify-reply regex routes it
    deterministically on the next turn."""
    entities = state.get("entities") or {}
    question = (entities.get("clarify_question") or "").strip()
    domains = entities.get("clarify_domains") or []

    options = [
        {
            "label": _CLARIFY_DOMAIN_LABELS[d],
            "action": "message",
            "value": f"{_CLARIFY_DOMAIN_LABELS[d]}: {question}",
        }
        for d in domains if d in _CLARIFY_DOMAIN_LABELS
    ]
    if not question or len(options) < 2:
        return {"messages": [AIMessage(
            content="I'm not sure I understood that — could you rephrase with a bit more detail?"
        )]}

    payload = {
        "question": "Which area is this about? I want to answer from the right team.",
        "options": options,
    }
    content = (
        "I want to make sure I route this correctly.\n"
        f"{QUICK_CHOICE_START}{json.dumps(payload)}{QUICK_CHOICE_END}"
    )
    return {"messages": [AIMessage(content=content)]}


def _reroute_card_on_empty_retrieval(state: AgentState, result_messages: list, current_domain: str):
    """Reversible routing — returns an AIMessage clarify card, or None to keep the agent's answer.

    Fires only when BOTH hold:
      1. The route was an LLM-router guess (route_confidence < 0.8). Deterministic,
         exact-match, semantic-high, and user-clarified routes keep their honest
         not-found answer — second-guessing those would loop.
      2. This agent's policy retrieval hit the semantic veto (RETRIEVAL_VETO_SENTINEL
         in a ToolMessage) — the scoped corpus has nothing relevant, so the domain
         pick itself is the prime suspect.
    The card offers the other major domains; a click re-enters the router on the
    deterministic clarify-reply path."""
    from app.services.policy_service import RETRIEVAL_VETO_SENTINEL
    try:
        if (state.get("route_confidence") or 1.0) >= 0.8:
            return None
        veto_hit = any(
            isinstance(m, ToolMessage) and RETRIEVAL_VETO_SENTINEL in (m.content or "")
            for m in result_messages
        )
        if not veto_hit:
            return None
        question = next(
            (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
        ).strip()
        if not question:
            return None
        candidates = [
            d for d in ("hr", "it_support", "admin", "general")
            if d != current_domain and llm_controls.is_domain_enabled(d)
        ]
        options = [
            {"label": _CLARIFY_DOMAIN_LABELS[d], "action": "message",
             "value": f"{_CLARIFY_DOMAIN_LABELS[d]}: {question}"}
            for d in candidates
        ]
        if len(options) < 2:
            return None
        current_label = _CLARIFY_DOMAIN_LABELS.get(current_domain, current_domain)
        payload = {
            "question": "Should I check one of these areas instead?",
            "options": options,
        }
        return AIMessage(content=(
            f"I couldn't find anything about this in the {current_label} documents — "
            f"it may belong to a different area.\n"
            f"{QUICK_CHOICE_START}{json.dumps(payload)}{QUICK_CHOICE_END}"
        ))
    except Exception:
        return None  # never let the reroute check break a working answer


# Domains whose knowledge-miss can be converted into a concrete action handoff.
# spec = (team_shown_to_user, action_phrase). The action_phrase is what the quick-choice
# button sends back; _KW_HANDOFF_IT / _KW_HANDOFF_HR route it deterministically to a
# ticket-creating action. Admin policy misses (reimbursement, certification, relocation…)
# are HR-adjacent, so they hand off to the general HR query queue.
_ABSTENTION_HANDOFF = {
    "it_support": ("the IT team", "Raise an IT ticket about this"),
    "hr":         ("HR",          "Raise an HR query about this"),
    "admin":      ("HR",          "Raise an HR query about this"),
}


def _abstention_handoff_card(state: AgentState, result_messages: list, current_domain: str):
    """Genuine knowledge miss → offer to convert the abstain into an action (raise a ticket /
    route to the team) instead of a dead-end "not found". Returns a quick-choice AIMessage, or
    None to keep the honest not-found answer.

    Fires only when the scoped corpus truly had nothing (semantic veto) AND the domain has an
    action target. This COMPLEMENTS _reroute_card_on_empty_retrieval, which offers other
    *knowledge* areas when the domain pick itself is suspect (low route confidence): callers
    try the reroute first, then fall back to this handoff — so a confident-but-empty answer
    (the real knowledge miss) becomes a resolved action rather than a dead end."""
    from app.services.policy_service import RETRIEVAL_VETO_SENTINEL
    try:
        spec = _ABSTENTION_HANDOFF.get(current_domain)
        if not spec:
            return None
        veto_hit = any(
            isinstance(m, ToolMessage) and RETRIEVAL_VETO_SENTINEL in (m.content or "")
            for m in result_messages
        )
        if not veto_hit:
            return None
        question = next(
            (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
        ).strip()
        if not question:
            return None
        team, action_phrase = spec
        current_label = _CLARIFY_DOMAIN_LABELS.get(current_domain, current_domain)
        options = [
            {"label": f"Yes, raise it with {team}", "action": "message",
             "value": f"{action_phrase} — {question}"},
        ]
        # Failed-query rescue: turn a dead end into discovery by offering the
        # nearest things the assistant CAN do (role-aware), as tap-to-run chips.
        try:
            from app.services import capability_registry as _caps
            for cap in _caps.nearest_capabilities(
                question, role=state.get("user_role"), domain=current_domain, limit=3
            ):
                ex = cap.examples[0]
                options.append({"label": cap.title, "action": "message", "value": ex})
        except Exception:
            pass
        options.append({"label": "No, thanks", "action": "message", "value": "No thanks"})
        payload = {
            "question": f"Want me to raise it with {team} so someone can follow up — or try one of these?",
            "options": options,
        }
        return AIMessage(content=(
            f"I couldn't find anything about this in the {current_label} resources — "
            f"it may not be documented yet.\n"
            f"{QUICK_CHOICE_START}{json.dumps(payload)}{QUICK_CHOICE_END}"
        ))
    except Exception:
        return None  # never let the handoff check break a working answer


async def pmo_agent_node(state: AgentState):
    """PMO Agent - handles project and report requests."""
    result = await pmo_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": _location_prefix(state) + _get_mode_hint(state) + (state.get("feedback_context") or ""),
        "sub_intent": state.get("sub_intent") or "",
        "entities": state.get("entities") or {},
        "user_role": state.get("user_role") or "employee",
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), None)
    if not last_ai or not (last_ai.content or "").strip():
        last_tool = next((m for m in reversed(result["messages"]) if isinstance(m, ToolMessage) and m.content), None)
        last_ai = AIMessage(content=last_tool.content if last_tool else "Failed to process PMO request.")
    reroute = _reroute_card_on_empty_retrieval(state, result["messages"], "pmo")
    if reroute:
        return {"messages": [reroute]}
    handoff = _abstention_handoff_card(state, result["messages"], "pmo")
    return {"messages": [handoff or last_ai]}


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
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), None)
    if not last_ai or not (last_ai.content or "").strip():
        last_tool = next((m for m in reversed(result["messages"]) if isinstance(m, ToolMessage) and m.content), None)
        last_ai = AIMessage(content=last_tool.content if last_tool else "Failed to process Admin request.")
    reroute = _reroute_card_on_empty_retrieval(state, result["messages"], "admin")
    if reroute:
        return {"messages": [reroute]}
    handoff = _abstention_handoff_card(state, result["messages"], "admin")
    return {"messages": [handoff or last_ai]}


async def it_agent_node(state: AgentState):
    """IT Agent - handles software install, tickets, etc."""
    entities = state.get("entities") or {}
    sub_intent = state.get("sub_intent") or ""
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    draft_key = _draft_key(state)

    if sub_intent == "software_install_confirm":
        # confirm() atomically claims the pending action (pending->executed). A duplicate
        # confirm finds nothing and returns None, so the email is never sent twice.
        claimed = PendingActionService.confirm(draft_key, "software_install")
        if not claimed:
            return {"messages": [AIMessage(content="I do not have a pending IT email draft to send. Please start the software install request again.")]}
        software_name = (claimed.get("payload") or {}).get("software_name", "")
        response = ITService.send_software_install_request(user_email, software_name)
        return {"messages": [AIMessage(content=response)]}

    if sub_intent == "software_install_cancel":
        PendingActionService.cancel(draft_key, "software_install")
        return {"messages": [AIMessage(content="No problem. I discarded the pending IT email draft and did not send anything.")]}

    if sub_intent == "hardware_issue":
        # Deterministic path — create a hardware ticket directly without LLM to avoid
        # the model hallucinating wrong content (e.g. VPN steps for overheating).
        _hw_msg = next((m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "")
        from app.services import actions  # routed through the action registry spine
        _hw_result = actions.run(
            "it_ticket", actor_email=user_email, category="Hardware",
            subject=(_hw_msg[:120] or "Hardware issue"),
            description=(_hw_msg or "Hardware issue"), priority="Medium",
        ).human_message
        return {"messages": [AIMessage(content=_hw_result)]}

    if sub_intent == "it_ticket_handoff":
        # Knowledge-miss handoff (item 3): user accepted "raise an IT ticket" from an
        # abstention card. Create the ticket directly — no search_it_docs first (it just
        # abstained, so re-running it would loop). create_ticket is idempotent on
        # double-clicks. Returns the receipt verbatim.
        _topic = str(entities.get("handoff_topic")
                     or next((m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), "")).strip()
        from app.services import actions  # routed through the action registry spine
        _result = actions.run(
            "it_ticket", actor_email=user_email, category="General",
            subject=(_topic[:120] or "IT assistance request"),
            description=(_topic or "IT assistance request"), priority="Medium",
        ).human_message
        return {"messages": [AIMessage(content=_result)]}

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
            sw = str(software_name)
            idem = f"software_install:{user_email}:{sw.lower()}"

            _last_human = next(
                (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
            )
            _wants_resend = bool(_RESEND_RE.search(str(_last_human)))

            if not _wants_resend:
                # Authoritative dedupe: the IT helpdesk emails the user at each lifecycle step
                # (logged -> assigned -> approved -> resolved) carrying the real RE-#### id. We
                # read those to learn the live status. An OPEN request -> don't draft a
                # duplicate; show its id/status/technician. A RESOLVED one -> a new request is
                # legitimate, fall through and draft. (Needs connected MS365; fails soft.)
                status = await helpdesk_mail.find_request_status(state.get("graph_token") or "", sw)
                if status and status.get("is_open"):
                    PendingActionService.attach_external_ref(idem, status["request_id"])
                    _label = {
                        "logged": "logged and awaiting pickup",
                        "assigned": "assigned to an IT technician",
                        "approved": "approved and being actioned",
                    }.get(status["status"], "in progress")
                    _who = f" ({status['technician']})" if status.get("technician") else ""
                    return {"messages": [AIMessage(content=(
                        f"You've already raised this with IT — request **{status['request_id']}** "
                        f"for **{sw}** is **{_label}**{_who}. I didn't send a duplicate.\n\n"
                        f"If you think it was missed, reply *\"resend the {sw} request\"* and I'll send it again."
                    ))]}
                # status present but resolved/closed -> treat as no open request; fall through.

                # Fallback (MS365 not connected, or no lifecycle mail yet): treat a request we
                # recorded in the last week as still in progress.
                prior = None if status else PendingActionService.find_executed_by_key(
                    idem, within_minutes=_SOFTWARE_INSTALL_DEDUPE_MINUTES
                )
                if prior:
                    when = prior.get("created_at")
                    when_txt = f" on {when:%b %d}" if when else ""
                    ref = (prior.get("payload") or {}).get("helpdesk_request_id")
                    ref_txt = f" (request **{ref}**)" if ref else ""
                    return {"messages": [AIMessage(content=(
                        f"You've already submitted a request to install **{sw}**{when_txt}{ref_txt}, "
                        f"and it's still being processed by IT — I haven't sent a duplicate. "
                        f"If it's urgent or you think it was missed, reply *\"resend the {sw} request\"* "
                        f"and I'll send it again."
                    ))]}

            PendingActionService.create(
                session_key=draft_key,
                action_type="software_install",
                payload={"software_name": sw},
                user_email=user_email,
                idempotency_key=idem,
            )
            return {"messages": [AIMessage(content=ITService.request_software_install(user_email, sw))]}

    entity_hint = ""
    if entities:
        entity_hint = f"\n[Router extracted: sub_intent={sub_intent}, entities={entities}]"
    result = await it_agent.ainvoke({
        "messages": state["messages"],
        "user_email": user_email,
        "feedback_context": _location_prefix(state) + (state.get("feedback_context") or "") + entity_hint,
        "user_role": state.get("user_role") or "employee",
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), None)
    if not last_ai or not (last_ai.content or "").strip():
        last_tool = next((m for m in reversed(result["messages"]) if isinstance(m, ToolMessage) and m.content), None)
        last_ai = AIMessage(content=last_tool.content if last_tool else "Failed to process IT request.")
    reroute = _reroute_card_on_empty_retrieval(state, result["messages"], "it_support")
    if reroute:
        return {"messages": [reroute]}
    handoff = _abstention_handoff_card(state, result["messages"], "it_support")
    return {"messages": [handoff or last_ai]}


async def manager_agent_node(state: AgentState):
    """Manager Agent - handles team approvals, assignments, etc."""
    result = await manager_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": _location_prefix(state) + (state.get("feedback_context") or ""),
        "user_role": state.get("user_role") or "employee",
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), None)
    if not last_ai or not (last_ai.content or "").strip():
        last_tool = next((m for m in reversed(result["messages"]) if isinstance(m, ToolMessage) and m.content), None)
        last_ai = AIMessage(content=last_tool.content if last_tool else "Failed to process Manager request.")
    reroute = _reroute_card_on_empty_retrieval(state, result["messages"], "functional_manager")
    if reroute:
        return {"messages": [reroute]}
    handoff = _abstention_handoff_card(state, result["messages"], "functional_manager")
    return {"messages": [handoff or last_ai]}


async def doc_agent_node(state: AgentState):
    """Document Agent — generates formal HR letters (NOC, experience cert, etc.)."""
    result = await doc_agent.ainvoke({
        "messages": state["messages"],
        "user_email": state.get("user_email") or settings.DEFAULT_USER_EMAIL,
        "feedback_context": state.get("feedback_context") or "",
    })
    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), None)
    if not last_ai or not (last_ai.content or "").strip():
        last_tool = next((m for m in reversed(result["messages"]) if isinstance(m, ToolMessage) and m.content), None)
        last_ai = AIMessage(content=last_tool.content if last_tool else "Failed to generate document.")
    return {"messages": [last_ai]}


async def ms365_agent_node(state: AgentState):
    """MS365 Agent — reads emails, sends emails, calendar, Teams, Yammer.

    Execute-first: for unambiguous read intents, pre-fetch data at the Python
    level and inject it into feedback_context so the LLM only formats (1 call).

    Write safety (Phase 2): all T3 write tools return a __pending__ signal which
    this node intercepts, stages via PendingActionService, and surfaces as a
    confirmation card. On yes/no the ROUTER_RESOLVER fires ms365_send_confirm or
    ms365_send_cancel before the sub-agent is even invoked.
    """
    sub_intent = state.get("sub_intent") or ""
    graph_token = state.get("graph_token") or ""
    user_email = (state.get("user_email") or settings.DEFAULT_USER_EMAIL).lower().strip()
    draft_key = _draft_key(state)

    # Fetch Yammer token on-demand (separate audience from Graph)
    yammer_token = ""
    try:
        from app.services.oauth_service import get_yammer_token
        yammer_token = await get_yammer_token(user_email) or ""
    except Exception:
        pass

    # ── Confirm a staged MS365 write action ────────────────────────────────
    if sub_intent == "ms365_send_confirm":
        at = (state.get("entities") or {}).get("pending_action_type") or ""
        claimed = PendingActionService.confirm(draft_key, at) if at else None
        if not claimed:
            return {"messages": [AIMessage(content=(
                "I don't have a pending message to send. "
                "Please start the request again and I'll prepare a fresh draft."
            ))]}
        result = await _execute_ms365_action(claimed, graph_token, yammer_token)
        if result.get("success"):
            payload = claimed.get("payload") or {}
            pparams = payload.get("params") or {}
            at_label = {
                "ms365_email": f"email to **{pparams.get('to', 'the recipient')}**",
                "ms365_teams_message": f"Teams message to **{pparams.get('display_name', 'them')}**",
                "ms365_channel_post": (
                    f"post to **{pparams.get('team_name', 'the team')} › "
                    f"{pparams.get('channel_name', 'channel')}**"
                ),
                "ms365_community_post": f"post to the **{pparams.get('community_name', 'community')}** community",
                "ms365_group_chat": f"group chat **'{pparams.get('topic', 'Group Chat')}'**",
            }.get(at, "message")
            verb = "created" if at == "ms365_group_chat" else "sent"
            return {"messages": [AIMessage(content=f"Done — your {at_label} has been {verb}.")]}
        return {"messages": [AIMessage(content=(
            f"I couldn't send it: {result.get('message') or result.get('error') or 'unknown error'}. "
            f"Please try again."
        ))]}

    # ── Cancel a staged MS365 write action ─────────────────────────────────
    if sub_intent == "ms365_send_cancel":
        at = (state.get("entities") or {}).get("pending_action_type") or ""
        if at:
            PendingActionService.cancel(draft_key, at)
        return {"messages": [AIMessage(content="No problem — I discarded the draft and nothing was sent.")]}

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

    feedback_ctx = _location_prefix(state) + _get_mode_hint(state) + (state.get("feedback_context") or "")
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

    # ── Intercept __pending__ signals from write tools ──────────────────────
    # Write tools return {"__pending__": true, "action_type": ..., "params": {...}, ...}
    # instead of calling the API. We stage the action and return a confirmation card.
    for msg in reversed(result["messages"]):
        if not isinstance(msg, ToolMessage):
            continue
        try:
            sig = json.loads(msg.content or "")
        except (ValueError, TypeError):
            continue
        if not isinstance(sig, dict) or not sig.get("__pending__"):
            continue
        at = sig.get("action_type", "")
        params = sig.get("params") or {}
        idem = f"{at}:{user_email}:{json.dumps(params, sort_keys=True)}"
        PendingActionService.create(
            session_key=draft_key,
            action_type=at,
            payload={"action_type": at, "params": params},
            user_email=user_email,
            idempotency_key=idem,
        )
        return {"messages": [AIMessage(content=_ms365_confirmation_card(at, params))]}

    last_ai = next((m for m in reversed(result["messages"]) if isinstance(m, AIMessage)), None)
    if not last_ai or not (last_ai.content or "").strip():
        last_tool = next((m for m in reversed(result["messages"]) if isinstance(m, ToolMessage) and m.content), None)
        last_ai = AIMessage(content=last_tool.content if last_tool else "Failed to process Microsoft 365 request.")
    return {"messages": [last_ai]}


general_tools = [get_announcements, search_hr_policies, search_company_projects, find_apps]
general_tool_node = ToolNode(general_tools)


def _greeting_response(state: AgentState) -> str:
    """Build a role-aware, time-aware greeting — 0 LLM calls, <1ms.

    Onboards the user on their first message: instead of a static menu, it leads
    with a few capabilities their role actually has, plus any live signal (e.g.
    pending approvals) worth nudging them toward."""
    import datetime as _dt
    from app.services import capability_registry as _caps
    hour = _dt.datetime.now().hour
    email = state.get("user_email") or ""
    role = state.get("user_role") or "employee"
    name = email.split("@")[0].replace(".", " ").title() if email and "@" in email else ""
    if hour < 12:
        period = "Good morning"
    elif hour < 17:
        period = "Good afternoon"
    else:
        period = "Good evening"
    greeting = f"{period}{', ' + name if name else ''}!"

    # Live signal — surface a pending count if there's something waiting on them.
    live_line = ""
    if email:
        try:
            from app.services import nudge_service
            n = nudge_service.count_unread(email)
            if n:
                live_line = f" You have **{n}** thing{'s' if n != 1 else ''} that may need your attention — just ask \"what needs my attention?\""
        except Exception:
            pass

    # Lead with a few role-appropriate capabilities rather than a fixed menu.
    visible = _caps.capabilities_for_role(role)[:4]
    if visible:
        bullets = "\n".join(f"- {c.title} — _e.g. \"{c.examples[0]}\"_" for c in visible)
        body = (
            f" I'm Centriq, your workplace assistant. Here are a few things I can help you with:\n\n"
            f"{bullets}\n\nWhat would you like to do?"
        )
    else:
        body = " I'm Centriq, your workplace assistant. What do you need help with?"
    return f"{greeting}{live_line}{body}"


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
    messages = [SystemMessage(content=base + _get_mode_hint(state) + guardrail + feedback_ctx)] + state["messages"]
    try:
        response = resilient_invoke("general", messages,
                                    build=lambda l: l.bind_tools(general_tools),
                                    default_timeout=20)
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
    return "state_tracker"


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
from app.services.tool_registry import ToolRegistry as _ToolRegistry

# Kept as thin shims so existing call sites in this file still work unchanged.
# Both properties are computed live from the registry (dynamic connector ops included).
class _PassthroughProxy:
    def __contains__(self, item):
        return _ToolRegistry.is_passthrough(item)

class _PolicyProxy:
    def __contains__(self, item):
        return _ToolRegistry.is_policy(item)

_PASSTHROUGH_TOOLS = _PassthroughProxy()
_POLICY_SEARCH_TOOLS = _PolicyProxy()


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

    # Reversible routing (HR path): retrieval hit the semantic veto on an LLM-guessed
    # route — offer a re-route card instead of summarizing a not-found message.
    reroute = _reroute_card_on_empty_retrieval(state, [tool_message], "hr")
    if reroute:
        return {"messages": [reroute]}
    handoff = _abstention_handoff_card(state, [tool_message], "hr")
    if handoff:
        return {"messages": [handoff]}

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
        response = await resilient_ainvoke(_tier, prompt, default_timeout=30)
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


async def connector_agent(state: AgentState):
    """Generic ReAct agent for connector: domains.

    Builds StructuredTools from published ConnectorOperations at runtime,
    binds them to the agent LLM, and runs a ReAct loop (≤2 tool rounds).
    Falls back to a friendly message if the connector registry is empty.
    """
    from app.connectors.registry import ConnectorRegistry
    from app.connectors.tool_factory import build_tools_for_request

    domain = state.get("domain", "")
    user_email = state.get("user_email", "")
    user_role = state.get("user_role", "employee")
    department = state.get("department", "")
    messages = list(state.get("messages", []))

    slug = domain.removeprefix("connector:")

    # Resolve connector + its operations
    connector = await ConnectorRegistry.get_connector_by_slug(slug)
    if connector is None:
        return {"messages": [AIMessage(
            content=f"The '{slug}' connector is not available. Please ask an admin to publish it."
        )]}

    ops = await ConnectorRegistry.list_operations_for_user(user_email, user_role, department)
    ops = [o for o in ops if o["connector_id"] == connector["id"]]

    if not ops:
        return {"messages": [AIMessage(
            content=f"No operations are available to you for the '{slug}' connector."
        )]}

    tools = build_tools_for_request(ops, user_email, max_tools=8)

    system_prompt = (
        f"You are an AI assistant integrated with the {connector['name']} system. "
        f"Use the provided tools to fulfil the user's request. "
        f"Be concise. If a tool returns an error, explain it plainly and suggest next steps. "
        f"Do not make up data — only use what the tools return."
    )
    full_messages = [SystemMessage(content=system_prompt)] + messages

    # ReAct loop — max 2 tool rounds
    for _ in range(2):
        response = await resilient_ainvoke("agent", full_messages,
                                           build=lambda l: l.bind_tools(tools),
                                           default_timeout=45)
        full_messages.append(response)

        if not (hasattr(response, "tool_calls") and response.tool_calls):
            break

        # Execute all tool calls
        for tc in response.tool_calls:
            tool_fn = next((t for t in tools if t.name == tc["name"]), None)
            if tool_fn is None:
                tool_result = f"Tool '{tc['name']}' not found."
            else:
                try:
                    tool_result = await tool_fn.ainvoke(tc.get("args", {}))
                except Exception as exc:
                    tool_result = f"Tool error: {exc}"
            full_messages.append(ToolMessage(content=str(tool_result), tool_call_id=tc["id"]))

    # Return only the new messages (diff from original)
    new_messages = full_messages[len(messages) + 1:]  # +1 for system message
    return {"messages": new_messages}


# ── Shared custom-context gate ─────────────────────────────────────────────────
# Real conversational-assistant domains whose admins can configure custom context.
# Action/UI-flow pseudo-domains (forms, connectors, deeplink, clarify) are never gated.
_CONTEXT_GATED_DOMAINS = {
    "hr", "pmo", "admin", "it_support", "functional_manager", "ms365",
    "document", "general",
}

# Action-oriented sub-intents that must reach their tools, never a cached context answer.
_CTX_SKIP_SUBINTENTS = {
    "document_request", "grievance", "onboarding", "offboarding",
    "apply_leave", "submit_leave", "zoho_leave_fastpath", "leave_balance",
    "timesheet", "attendance", "appraisal", "training",
    "alchemy_my_skills", "alchemy_skills_overview",
    "generate_report", "download_report", "pdf_report", "export_report", "create_report",
}

# Action phrasings (verb + object) that should always run live against tools.
_CTX_ACTION_TEXT_RE = re.compile(
    r'\b(generate|create|make|give|get me|issue|draft|submit|apply|file)\b'
    r'.{0,40}\b(certificate|letter|noc|document|pdf|report|grievance|complaint|leave)\b',
    re.I,
)


def context_gate(state: AgentState) -> dict:
    """Single graph node: for the routed domain, short-circuit with an admin-configured
    custom-context answer when one directly covers the question. Replaces the old
    per-agent gate so every domain behaves identically. Falls through (returns {}) for
    action requests, ungated domains, or when no context matches."""
    domain = (state.get("domain") or "general").strip()
    if domain not in _CONTEXT_GATED_DOMAINS:
        return {}
    if (state.get("sub_intent") or "") in _CTX_SKIP_SUBINTENTS:
        return {}
    user_question = next(
        (m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage)), ""
    )
    if not isinstance(user_question, str) or not user_question:
        return {}
    if _CTX_ACTION_TEXT_RE.search(user_question):
        return {}
    try:
        answer = PromptService.check_context_relevance(domain, user_question)
        if answer:
            return {"messages": [AIMessage(content=answer)]}
    except Exception:
        pass  # non-fatal — fall through to the routed agent
    return {}


def route_after_context_gate(state: AgentState):
    """If the gate produced an answer (last message is now an AIMessage), end the turn;
    otherwise route to the domain agent exactly as before."""
    if isinstance(state["messages"][-1], AIMessage):
        return END
    return route_to_agent(state)


def route_to_agent(state: AgentState):
    domain = state.get("domain", "general")
    # IT kill-switch for individual domains — short-circuit before the agent runs.
    if domain in llm_controls.disabled_domains():
        return "disabled_agent"
    if domain == "dynamic_form": return "dynamic_form_agent"
    if domain == "form_fill": return "form_fill_agent"
    if domain == "form_builder": return "form_builder_agent"
    if domain == "analytics": return "analytics_agent"
    if domain == "referral_choice": return "referral_choice_agent"
    if domain == "domain_clarify": return "domain_clarify_agent"
    if domain.startswith("connector:"):
        return "connector_agent"
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

def route_after_state_tracker(state: AgentState) -> str:
    """After state_tracker runs, check whether a focus-mode fallback was triggered.
    If so, re-run intent_router without the locked active_mode so the correct domain
    agent can answer.  Otherwise end the turn normally."""
    if state.get("focus_fallback_pending"):
        return "intent_router"
    return END


def should_continue_hr(state: AgentState):
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "hr_tools"
    return "state_tracker"


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

workflow.add_node("followup_resolver", followup_resolver)
workflow.add_node("intent_router", intent_router)
workflow.add_node("context_manager", context_manager_node)
workflow.add_node("feedback_lookup", feedback_lookup)
workflow.add_node("context_gate", context_gate)
workflow.add_node("hr_agent", hr_agent)
workflow.add_node("pmo_agent", pmo_agent_node)
workflow.add_node("admin_agent", admin_agent_node)
workflow.add_node("it_agent", it_agent_node)
workflow.add_node("manager_agent", manager_agent_node)
workflow.add_node("deeplink_agent", deeplink_agent_node)
workflow.add_node("dynamic_form_agent", dynamic_form_agent_node)
workflow.add_node("form_fill_agent", form_fill_agent_node)
workflow.add_node("form_builder_agent", form_builder_agent_node)
workflow.add_node("analytics_agent", analytics_agent_node)
workflow.add_node("referral_choice_agent", referral_choice_agent_node)
workflow.add_node("domain_clarify_agent", domain_clarify_agent_node)
workflow.add_node("ms365_agent", ms365_agent_node)
workflow.add_node("doc_agent", doc_agent_node)
workflow.add_node("general_agent", general_agent)
workflow.add_node("general_tools", general_tool_node)
workflow.add_node("dummy_test_agent", dummy_test_agent)
workflow.add_node("placeholder_agent", placeholder_agent)
workflow.add_node("disabled_agent", disabled_agent)
workflow.add_node("hr_tools", hr_tool_node)
workflow.add_node("summarizer", summarizer)
workflow.add_node("connector_agent", connector_agent)
workflow.add_node("state_tracker", state_tracker)

workflow.set_entry_point("followup_resolver")
# followup_resolver rewrites referential follow-ups into standalone queries BEFORE routing.
# followup_resolver -> intent_router -> context_manager (compress if >6000 tokens)
#   -> feedback_lookup -> context_gate -> domain agent
workflow.add_edge("followup_resolver", "intent_router")
workflow.add_edge("intent_router", "context_manager")
workflow.add_edge("context_manager", "feedback_lookup")
# Shared custom-context gate runs once for the routed domain; either answers and ends
# the turn, or falls through to the domain agent.
workflow.add_edge("feedback_lookup", "context_gate")
workflow.add_conditional_edges("context_gate", route_after_context_gate)
workflow.add_conditional_edges("hr_agent", should_continue_hr)
workflow.add_conditional_edges("general_agent", should_continue_general)
workflow.add_edge("hr_tools", "summarizer")
workflow.add_edge("general_tools", "general_agent")
# Substantive answer-producing paths flow through state_tracker (records `focus` for
# the next turn's coref) before ending. UI-flow / placeholder / disabled paths don't
# produce a subject, so they end directly.
workflow.add_edge("summarizer", "state_tracker")
workflow.add_edge("pmo_agent", "state_tracker")
workflow.add_edge("admin_agent", "state_tracker")
workflow.add_edge("it_agent", "state_tracker")
workflow.add_edge("manager_agent", "state_tracker")
workflow.add_edge("deeplink_agent", "state_tracker")
workflow.add_edge("ms365_agent", "state_tracker")
workflow.add_edge("doc_agent", "state_tracker")
workflow.add_edge("connector_agent", "state_tracker")
workflow.add_conditional_edges("state_tracker", route_after_state_tracker)
workflow.add_edge("dynamic_form_agent", END)
workflow.add_edge("form_fill_agent", END)
workflow.add_edge("form_builder_agent", END)
workflow.add_edge("analytics_agent", END)
workflow.add_edge("referral_choice_agent", END)
workflow.add_edge("domain_clarify_agent", END)
workflow.add_edge("dummy_test_agent", END)
workflow.add_edge("placeholder_agent", END)
workflow.add_edge("disabled_agent", END)

app_agent = workflow.compile(checkpointer=checkpointer)
