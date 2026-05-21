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
    """Open Zoho People leave form in Edge browser with form pre-filled. User reviews and clicks Submit.
    start_date and end_date must be YYYY-MM-DD format. leave_type: Casual, Sick, Earned, or Optional."""
    zoho_base = (settings.ZOHO_PEOPLE_URL or "").rstrip("/")
    if not zoho_base:
        return json.dumps({"success": False, "error": "ZOHO_PEOPLE_URL not configured."})

    if not (_SESSIONS_DIR / "zoho.bin").exists():
        return json.dumps({
            "success": False,
            "error": "Zoho session not set up",
            "action": "run_setup",
            "instruction": "Tell the user to type 'setup zoho session' to log in once via SSO.",
        })

    leave_page = zoho_base + "#leavetracker/mydata/applyleave"
    fill_script = _MCP_SERVER_DIR / "_zoho_fill.py"

    subprocess.Popen(
        [
            sys.executable, str(fill_script),
            start_date, end_date, leave_type, reason or "",
            str(_SESSIONS_DIR), leave_page,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )

    def _fmt(iso: str) -> str:
        return _dt.strptime(iso, "%Y-%m-%d").strftime("%d %b %Y")

    return json.dumps({
        "success": True,
        "action_required": "user_submit",
        "message": (
            f"Opening Zoho leave form in Edge: {leave_type} leave "
            f"from {_fmt(start_date)} to {_fmt(end_date)}"
            + (f", reason: {reason}" if reason else "")
            + ". The browser is opening now — please review the pre-filled form and click Submit."
            + " The window closes automatically after 10 minutes."
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


_NATIVE_TOOLS = [submit_zoho_leave, setup_zoho_session]


# -- System prompt -------------------------------------------------------------

_SYSTEM_PROMPT = """You are the External Portal Assistant for Centriq AI.
You automate form submissions in external portals on behalf of the employee.

AVAILABLE TOOLS:
1. setup_zoho_session()
   → Opens Edge so the user can log in via SSO once.

2. submit_zoho_leave(start_date, end_date, leave_type, reason)
   → Opens Zoho People leave form pre-filled in Edge. User reviews and clicks Submit.
   → start_date and end_date: YYYY-MM-DD format.
   → leave_type: "Casual", "Sick", "Earned", or "Optional".

CRITICAL RULES — FOLLOW EXACTLY:

SETUP COMMANDS — act immediately, no questions:
- "setup zoho session" → call setup_zoho_session() RIGHT NOW
- Any variation like "set up zoho", "zoho setup", "setup zoho" → call setup_zoho_session() RIGHT NOW
- NEVER ask any question for a setup command. Just call the tool.

LEAVE SUBMISSION:
- Call submit_zoho_leave immediately once you have dates and leave type.
- Default leave_type to "Casual" if not specified.
- NEVER ask for the year. Always assume the current year is 2026.
- If dates have no year (e.g. "June 10 to June 12"), use 2026 → "2026-06-10" and "2026-06-12".
- Ask ONLY if both start date AND end date are completely absent.

TOOL RESPONSE HANDLING:
- If setup_zoho_session succeeds: say "Zoho session setup is in progress — please log in in the browser window. Once done, you can apply for leave."
- If tool returns action "run_setup": tell user to type "setup zoho session" to open the portal in a browser
- Before calling submit_zoho_leave, tell the user: "Opening Zoho in your browser with the form pre-filled. Please review and click Submit when ready."
- On submit_zoho_leave success (action_required = user_submit): relay the message from the tool exactly

NEVER ask for the user's email. NEVER ask clarifying questions for setup commands.

OUTPUT: Plain text only. No markdown tables. No HTML.
"""


# -- Lazy graph factory --------------------------------------------------------

_compiled_agent = None


def _build_graph(tools):
    tool_node = ToolNode(tools)
    llm = ChatOpenAI(
        base_url=settings.AGENT_BASE_URL,
        api_key=settings.AGENT_API_KEY,
        model=settings.AGENT_MODEL_NAME,
        temperature=0,
        timeout=120,
    ).bind_tools(tools)

    def deeplink_assistant(state: DeeplinkState):
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
