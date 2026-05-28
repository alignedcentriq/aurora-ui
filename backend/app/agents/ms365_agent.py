"""
Microsoft 365 Agent — email, calendar, and Teams via Graph API.

Uses the delegated OAuth token stored in ConnectedAccount to call
Microsoft Graph on behalf of the user.
"""

import json
from datetime import datetime, timedelta
from typing import Annotated, List, TypedDict

from langchain_core.messages import BaseMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import InjectedState, ToolNode
from langchain_openai import ChatOpenAI

from app.config import settings
from app.services import ms365_service
from app.services import yammer_service
from app.services.prompt_service import PromptService


# -- State --------------------------------------------------------------------

class MS365State(TypedDict):
    messages: Annotated[List[BaseMessage], "The messages in the conversation"]
    user_email: str
    feedback_context: str
    graph_token: str
    yammer_token: str


# -- Helpers ------------------------------------------------------------------

_NOT_CONNECTED = json.dumps({
    "error": "ms365_not_connected",
    "message": (
        "Your Microsoft 365 account is not connected. "
        "Please connect it in Settings > Connected Accounts."
    ),
})


def _today_range() -> tuple[str, str]:
    """Return ISO start/end for today (IST)."""
    now = datetime.utcnow() + timedelta(hours=5, minutes=30)
    start = now.replace(hour=0, minute=0, second=0).strftime("%Y-%m-%dT%H:%M:%S")
    end = now.replace(hour=23, minute=59, second=59).strftime("%Y-%m-%dT%H:%M:%S")
    return start, end


def _week_range() -> tuple[str, str]:
    """Return ISO start/end for the next 7 days."""
    now = datetime.utcnow() + timedelta(hours=5, minutes=30)
    start = now.replace(hour=0, minute=0, second=0).strftime("%Y-%m-%dT%H:%M:%S")
    end = (now + timedelta(days=7)).replace(hour=23, minute=59, second=59).strftime("%Y-%m-%dT%H:%M:%S")
    return start, end


def _date_to_iso(date_str: str) -> str:
    """Convert YYYY-MM-DD to ISO datetime string."""
    if "T" in date_str:
        return date_str
    return f"{date_str}T00:00:00"


def _date_to_iso_end(date_str: str) -> str:
    """Convert YYYY-MM-DD to end-of-day ISO datetime string."""
    if "T" in date_str:
        return date_str
    return f"{date_str}T23:59:59"


# -- Tools --------------------------------------------------------------------

@tool
async def read_my_emails(
    top: int = 15,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Read recent inbox emails. Returns subject, sender, date, and preview
    for the most recent messages. Call immediately when user asks about emails or inbox."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    result = await ms365_service.fetch_my_emails(token, top=top)
    return json.dumps(result)


@tool
async def send_email_graph(
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Send an email via Microsoft Outlook. to and cc accept comma-separated email addresses.
    IMPORTANT: Always confirm the recipient, subject, and body with the user BEFORE calling this tool.
    Do not send without explicit user confirmation."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    to_list = [a.strip() for a in to.split(",") if a.strip()]
    cc_list = [a.strip() for a in cc.split(",") if a.strip()] if cc else None
    result = await ms365_service.send_email(token, to_list, subject, body, cc_list)
    return json.dumps(result)


@tool
async def read_my_calendar(
    start_date: str,
    end_date: str,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Read calendar events for a date range. Dates should be YYYY-MM-DD format.
    Use today's date when user says 'today'. Use the next 7 days for 'this week'."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    start = _date_to_iso(start_date)
    end = _date_to_iso_end(end_date)
    result = await ms365_service.fetch_calendar_view(token, start, end)
    return json.dumps(result)


@tool
async def search_calendar(
    keyword: str,
    start_date: str = "",
    end_date: str = "",
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Search calendar events by keyword in subject, organizer, or location.
    If no dates are given, searches the next 7 days."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    if start_date and end_date:
        start = _date_to_iso(start_date)
        end = _date_to_iso_end(end_date)
    else:
        start, end = _week_range()
    result = await ms365_service.search_calendar(token, keyword, start, end)
    return json.dumps(result)


@tool
async def list_meeting_rooms(
    building: str = "",
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """List meeting rooms and cabins available in the organisation.
    Optionally filter by building name. Returns room name, location, capacity,
    floor, and booking email. Call when user asks about rooms, cabins, meeting rooms,
    or available spaces for booking."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    result = await ms365_service.fetch_rooms(token)
    if not result.get("success"):
        return json.dumps(result)
    rooms = result["rooms"]
    if building:
        bld = building.lower()
        rooms = [r for r in rooms if bld in (r.get("building") or "").lower() or bld in (r.get("name") or "").lower()]
    result["rooms"] = rooms
    result["count"] = len(rooms)
    return json.dumps(result)


@tool
async def read_teams_messages(
    top: int = 15,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Read recent Microsoft Teams chat messages. Returns the latest chats
    with last message preview. Call when user asks about Teams messages or chats."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    result = await ms365_service.fetch_teams_chats(token, top=top)
    return json.dumps(result)


@tool
async def send_teams_message(
    person: str,
    message: str,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Send a message to someone on Microsoft Teams. Provide the person's name or email.
    The tool finds the correct chat and sends the message.
    IMPORTANT: Always confirm the recipient and message with the user BEFORE calling this tool."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    chat = await ms365_service.find_chat_by_participant(token, person)
    if not chat:
        return json.dumps({"success": False, "error": f"No Teams chat found with '{person}'. Make sure you have an existing chat with them."})
    result = await ms365_service.send_teams_message(token, chat["chat_id"], message)
    if result.get("success"):
        result["sent_to"] = chat.get("matched_name") or chat.get("matched_email") or person
    return json.dumps(result)


# -- Yammer / Viva Engage Tools -----------------------------------------------

_YAMMER_NOT_CONNECTED = json.dumps({
    "error": "yammer_not_connected",
    "message": (
        "Your Viva Engage (Yammer) account is not connected. "
        "Please connect your Microsoft 365 account in Settings > Connected Accounts."
    ),
})


@tool
async def read_yammer_feed(
    top: int = 20,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Read your Viva Engage (Yammer) home feed. Returns recent posts from
    communities you follow. Call when user asks about Yammer or Viva Engage feed."""
    token = (state or {}).get("yammer_token")
    if not token:
        return _YAMMER_NOT_CONNECTED
    result = await yammer_service.fetch_my_feed(token, top=top)
    return json.dumps(result)


@tool
async def list_my_communities(
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """List Viva Engage (Yammer) communities you belong to.
    Returns community names, descriptions, and member counts."""
    token = (state or {}).get("yammer_token")
    if not token:
        return _YAMMER_NOT_CONNECTED
    result = await yammer_service.fetch_my_communities(token)
    return json.dumps(result)


@tool
async def read_community_posts(
    community_name: str,
    top: int = 20,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Read recent posts from a specific Viva Engage community.
    Provide the community name — the tool resolves it to the correct group."""
    token = (state or {}).get("yammer_token")
    if not token:
        return _YAMMER_NOT_CONNECTED
    group_id = await yammer_service.resolve_community_id(token, community_name)
    if not group_id:
        return json.dumps({"success": False, "error": f"Community '{community_name}' not found. Use list_my_communities to see available communities."})
    result = await yammer_service.fetch_community_messages(token, group_id, top=top)
    return json.dumps(result)


@tool
async def post_to_community(
    community_name: str,
    message: str,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Post a message to a Viva Engage community.
    IMPORTANT: Always confirm the community name and message content with the user BEFORE calling this tool."""
    token = (state or {}).get("yammer_token")
    if not token:
        return _YAMMER_NOT_CONNECTED
    group_id = await yammer_service.resolve_community_id(token, community_name)
    if not group_id:
        return json.dumps({"success": False, "error": f"Community '{community_name}' not found. Use list_my_communities to see available communities."})
    result = await yammer_service.post_to_community(token, group_id, message)
    return json.dumps(result)


# -- Agent assembly -----------------------------------------------------------

tools = [
    read_my_emails, send_email_graph, read_my_calendar, search_calendar,
    list_meeting_rooms,
    read_teams_messages, send_teams_message,
    read_yammer_feed, list_my_communities, read_community_posts, post_to_community,
]
tool_node = ToolNode(tools)

_ms365_llm = ChatOpenAI(
    base_url=settings.AGENT_BASE_URL,
    api_key=settings.AGENT_API_KEY,
    model=settings.AGENT_MODEL_NAME,
    temperature=settings.AGENT_TEMPERATURE,
    timeout=60,
).bind_tools(tools)


def ms365_assistant(state: MS365State):
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    default_prompt = (
        f"You are the Microsoft 365 Assistant for Centriq AI.\n"
        f"Employee email: {user_email}. Never ask for it.\n"
        f"Always respond in English regardless of the language of the user's message.\n\n"
        f"Tool routing — act immediately:\n"
        f"- Read emails → read_my_emails (inbox, most recent first)\n"
        f"- Send email → send_email_graph (confirm recipient, subject, body with user first)\n"
        f"- Calendar → read_my_calendar (default: today; ask if ambiguous)\n"
        f"- Find meeting → search_calendar (search by keyword in subject)\n"
        f"- Rooms/cabins/spaces → list_meeting_rooms (filter by building if specified)\n"
        f"- Teams chats → read_teams_messages (recent chat messages)\n"
        f"- Send Teams message → send_teams_message (confirm recipient and message first)\n"
        f"- Viva Engage/Yammer feed → read_yammer_feed\n"
        f"- My communities → list_my_communities\n"
        f"- Community posts → read_community_posts (ask for community name if not stated)\n"
        f"- Post to community → post_to_community (confirm with user first)\n\n"
        f"Format emails as readable summaries: sender, subject, time.\n"
        f"Format calendar as time-ordered schedule: time, subject, location.\n"
        f"Act immediately when intent is clear. Never redirect to Outlook, Teams, or Yammer app.\n"
    )
    base_prompt = PromptService.get_system_prompt("ms365", default_prompt)
    guardrail = PromptService.get_guardrail("ms365")
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + guardrail + feedback_ctx

    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    return {"messages": [_ms365_llm.invoke(messages)]}


def should_continue(state: MS365State):
    if state["messages"][-1].tool_calls:
        return "tools"
    return END


# -- Graph --------------------------------------------------------------------

workflow = StateGraph(MS365State)
workflow.add_node("ms365_assistant", ms365_assistant)
workflow.add_node("tools", tool_node)
workflow.set_entry_point("ms365_assistant")
workflow.add_conditional_edges("ms365_assistant", should_continue, ["tools", END])
workflow.add_edge("tools", "ms365_assistant")

ms365_agent = workflow.compile()
