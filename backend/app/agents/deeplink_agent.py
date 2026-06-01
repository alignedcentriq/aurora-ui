"""
Deep-Link Agent — automates external portals via native Python tools.
Uses direct subprocess calls instead of MCP to avoid the 20-30s subprocess
startup overhead that was causing 90s frontend timeouts.
"""
import sys
import json
import subprocess
from datetime import datetime as _dt
from pathlib import Path
from typing import Annotated, List, TypedDict

from langchain_core.messages import BaseMessage, SystemMessage, AIMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from app.config import settings

_MCP_SERVER_DIR = Path(__file__).resolve().parent.parent.parent / "mcp_server"
_SESSIONS_DIR = _MCP_SERVER_DIR / "sessions"


# -- State ---------------------------------------------------------------------

class DeeplinkState(TypedDict):
    messages: Annotated[List[BaseMessage], "The messages in the conversation"]
    user_email: str
    feedback_context: str


# -- Native tools (no MCP subprocess overhead) ---------------------------------

@tool
def submit_zoho_leave(start_date: str, end_date: str, leave_type: str, reason: str = "") -> str:
    """Apply leave via Zoho People API. Falls back to a direct Zoho link if API is unavailable.
    start_date and end_date must be YYYY-MM-DD format. leave_type: Casual, Sick, Earned, or Optional."""
    zoho_link = (
        ((settings.ZOHO_PEOPLE_URL or "").rstrip("/") + "#leavetracker/applyleave")
        if settings.ZOHO_PEOPLE_URL
        else "https://people.zoho.com"
    )

    # Apply leave internally via HRService (creates record + sends approval email)
    try:
        from app.hr_service import HRService
        result_msg = HRService.apply_leave(
            settings.DEFAULT_USER_EMAIL, start_date, end_date, leave_type, reason or ""
        )
        return json.dumps({"success": True, "message": result_msg})
    except Exception as exc:
        print(f"[submit_zoho_leave] Internal apply error: {exc}")

    # API not configured or failed — return fallback link
    def _fmt(iso: str) -> str:
        try:
            return _dt.strptime(iso, "%Y-%m-%d").strftime("%d %b %Y")
        except Exception:
            return iso

    return json.dumps({
        "success":    False,
        "fallback":   True,
        "link":       zoho_link,
        "leave_type": leave_type,
        "start_date": start_date,
        "end_date":   end_date,
        "message": (
            f"Please apply your {leave_type} leave ({_fmt(start_date)} to {_fmt(end_date)}) "
            "directly in Zoho People."
        ),
    })


@tool
def setup_zoho_session() -> str:
    """Open Edge browser non-headlessly so the user can complete Zoho People SSO login.
    Saves session cookies automatically once login is detected."""
    setup_script = _MCP_SERVER_DIR / "_zoho_setup.py"
    if not setup_script.exists():
        return json.dumps({"success": False, "error": "Setup script not found."})

    subprocess.Popen(
        [sys.executable, str(setup_script)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )

    return json.dumps({
        "success": True,
        "message": (
            "Edge is opening for Zoho login. Please complete the SSO sign-in in the browser window. "
            "Your session will be saved automatically once you're logged in. "
            "After login you can apply for leave directly."
        ),
    })


@tool
def submit_powerapps_complaint(
    action_item: str,
    priority: str = "Medium",
    location: str = "Other",
) -> str:
    """Submit a complaint to the PowerApps Admin Action Tracker via Power Automate webhook.
    Falls back to a direct link if the webhook is not configured.

    action_item: Description of the issue / action required.
    priority: High, Medium, or Low. Default Medium.
    location: One of — T-1 6th Floor, T-2 10th Floor, T-3 6th Floor, T-3 8th Floor,
              Bangalore Office, Indore Office, Other.
    """
    import datetime
    import requests as _req

    priority_map = {"high": "High", "medium": "Medium", "low": "Low"}
    priority = priority_map.get(priority.lower(), "Medium")

    webhook_url   = settings.PA_WEBHOOK_COMPLAINT_NEW or ""
    powerapps_url = settings.POWERAPPS_URL or ""

    if webhook_url:
        payload = {
            "action_item":   action_item,
            "priority":      priority,
            "location":      location or "Other",
            "submitted_by":  settings.DEFAULT_USER_EMAIL,
            "submitted_at":  datetime.datetime.utcnow().isoformat() + "Z",
        }
        try:
            resp = _req.post(webhook_url, json=payload, timeout=10)
            resp.raise_for_status()
            return json.dumps({
                "success": True,
                "message": "Your complaint has been submitted via Power Automate. The flow will create the ticket shortly.",
            })
        except Exception as exc:
            return json.dumps({
                "success": False,
                "error":   str(exc),
                "link":    powerapps_url,
            })

    # Webhook not configured — return fallback link
    return json.dumps({
        "success":  False,
        "fallback": True,
        "link":     powerapps_url,
        "message":  "Power Automate webhook not configured — please open the form manually.",
    })


@tool
def setup_powerapps_session() -> str:
    """Open Edge browser non-headlessly so the user can complete PowerApps Azure AD SSO login.
    Saves the session profile automatically once login is detected."""
    setup_script = _MCP_SERVER_DIR / "_powerapps_setup.py"
    if not setup_script.exists():
        return json.dumps({"success": False, "error": "PowerApps setup script not found."})

    subprocess.Popen(
        [sys.executable, str(setup_script)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )

    return json.dumps({
        "success": True,
        "message": (
            "Edge is opening for PowerApps login. Please complete the Azure AD sign-in in the "
            "browser window. Your session will be saved automatically once you're logged in. "
            "After login you can raise complaints directly."
        ),
    })


@tool
def get_zoho_leave_balance() -> str:
    """Return the employee's current leave balance from Zoho People.
    Served from DB cache when fresh (< 15 min old); otherwise runs a headless
    scrape for this user only, caches the result, and returns it."""
    try:
        from app.config import settings as _settings
        from app.services.leave_balance_sync import get_or_refresh
        return json.dumps(get_or_refresh(_settings.DEFAULT_USER_EMAIL))
    except Exception as exc:
        return json.dumps({"success": False, "error": f"Failed to fetch leave balance: {exc}"})


_NATIVE_TOOLS = [
    submit_zoho_leave, setup_zoho_session,
    submit_powerapps_complaint, setup_powerapps_session,
    get_zoho_leave_balance,
]


# -- System prompt -------------------------------------------------------------

_SYSTEM_PROMPT = """You are the External Portal Assistant for Centriq AI.
You automate form submissions in external portals on behalf of the employee.

AVAILABLE TOOLS:
1. setup_zoho_session()        → Opens Edge so the user can log in to Zoho via SSO once.
2. submit_zoho_leave(...)      → Opens Zoho People leave form pre-filled. User clicks Submit.
3. setup_powerapps_session()   → Opens Edge so the user can log in to PowerApps via Azure AD SSO once.
4. submit_powerapps_complaint(action_item, priority, location)
   → Opens the Admin Action Tracker (PowerApps) complaint form pre-filled in Edge.
   → User reviews, attaches files if needed, and clicks Submit Ticket themselves.
   → priority: "High", "Medium" (default), or "Low".
   → location: one of — T-1 6th Floor, T-2 10th Floor, T-3 6th Floor, T-3 8th Floor,
                        Bangalore Office, Indore Office, Other.

─── SETUP COMMANDS — act immediately, no questions ───────────────────────────
- "setup zoho session" / "set up zoho" / "zoho setup" → call setup_zoho_session() NOW
- "setup powerapps session" / "set up powerapps" / "powerapps setup" → call setup_powerapps_session() NOW
- NEVER ask any clarifying question for a setup command.

─── LEAVE SUBMISSION ─────────────────────────────────────────────────────────
- Call submit_zoho_leave immediately once you have dates and leave type.
- Default leave_type to "Casual" if not specified.
- NEVER ask for the year — always assume 2026.
- If dates have no year (e.g. "June 10 to June 12") → "2026-06-10" and "2026-06-12".
- Ask ONLY if both start date AND end date are completely absent.

Tool response handling:
- result.success = true  → confirm: "Your [leave_type] leave has been applied in Zoho."
                           Add request_id if present: "Request ID: {id}"
- result.fallback = true → say: "I couldn't apply via API. Please apply directly in Zoho:"
                           then show result.link as a clickable link.
                           Remind the user to fill: leave type, from, to dates from result fields.
- result.error (no fallback) → tell user the submission failed and to try again.

─── POWERAPPS COMPLAINT SUBMISSION ───────────────────────────────────────────
Trigger: user says "raise a complaint", "file a complaint", "submit a complaint",
         "log a complaint", "I want to raise a ticket", "I have a premises/facility issue",
         or describes any infrastructure/office problem they want to formally report.

Required fields:
  - action_item  : description of the issue — infer from user's message.
  - location     : MUST be one of the valid location values.
                   Ask if not provided: "Which location is this for?
                   (T-1 6th Floor, T-2 10th Floor, T-3 6th Floor, T-3 8th Floor,
                   Bangalore Office, Indore Office, or Other)"
  - priority     : default "Medium"; use "High" if user says urgent/critical/asap.

EXACT STEPS:
  STEP 1 — User describes the issue. If location is missing → ask ONLY for location.
  STEP 2 — Once location is provided → call submit_powerapps_complaint immediately.
  NEVER ask for priority — default silently to "Medium" unless urgency is explicit.
  NEVER ask for Ticket ID — it is auto-generated by the app.

Tool response handling:
- result.success = true  → confirm: "Your complaint has been submitted via Power Automate."
- result.fallback = true → say: "The webhook isn't set up yet. Please open the form manually:"
                           then show result.link as a clickable link.
- result.error + link    → say submission failed, show result.link as fallback.
- result.error (no link) → tell user submission failed and to contact admin.

─── LEAVE BALANCE ────────────────────────────────────────────────────────────
Trigger: user asks "how many leaves do I have", "what is my leave balance",
         "check my leave balance", "remaining leaves", "leave status", or any
         leave-balance / leave-availability query.
- Call get_zoho_leave_balance() immediately — no clarifying questions needed.
- If result.success = true and balances list is non-empty:
  Format as a clear per-type summary, e.g.:
    Casual Leave   — 9 days remaining (used 3 of 12)
    Sick Leave     — 11 days remaining (used 1 of 12)
  If total/used are missing, just show the balance.
- If result.success = true but balances list is empty, use raw_text to extract
  leave balance numbers and summarise them for the user.
- If result.action = "run_setup": tell user to type 'setup zoho session' first.
- If result.error: tell user the balance could not be fetched and to try again.

─── SETUP RESPONSES ──────────────────────────────────────────────────────────
- setup_zoho_session success → relay message from tool exactly.
- setup_powerapps_session success → relay message from tool exactly.
- Any tool returns action "run_setup" → tell user to type the relevant setup command.

NEVER ask for the user's email. OUTPUT: Plain text only. No markdown tables. No HTML.
"""


# -- Lazy graph factory --------------------------------------------------------

_compiled_agent = None


def _build_graph(tools):
    from app.services import llm_controls_service as llm_controls
    tool_node = ToolNode(tools)

    def deeplink_assistant(state: DeeplinkState):
        # Built per call from the live IT-tunable params (agent tier).
        llm = llm_controls.get_llm("agent", default_timeout=45).bind_tools(tools)
        messages = [SystemMessage(content=_SYSTEM_PROMPT)] + state["messages"]
        return {"messages": [llm.invoke(messages)]}

    def should_continue(state: DeeplinkState):
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    wf = StateGraph(DeeplinkState)
    wf.add_node("deeplink_assistant", deeplink_assistant)
    wf.add_node("tools", tool_node)
    wf.set_entry_point("deeplink_assistant")
    wf.add_conditional_edges("deeplink_assistant", should_continue, ["tools", END])
    wf.add_edge("tools", "deeplink_assistant")
    return wf.compile()


def get_deeplink_agent():
    """Return the compiled deeplink agent (built lazily on first call)."""
    global _compiled_agent
    if _compiled_agent is None:
        _compiled_agent = _build_graph(_NATIVE_TOOLS)
    return _compiled_agent


def reset_deeplink_agent():
    """Force-rebuild the agent on next call (used after tool list changes)."""
    global _compiled_agent
    _compiled_agent = None
