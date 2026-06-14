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


# -- Helpers ------------------------------------------------------------------

_ROOM_SUFFIXES = (" conference room", " meeting room", " board room", " room", " cabin")


def _normalize_room_query(name: str) -> str:
    """Strip generic room-word suffixes so 'Salween Room' matches 'Salween'."""
    n = name.lower().strip()
    for suffix in _ROOM_SUFFIXES:
        if n.endswith(suffix):
            return n[: -len(suffix)].strip()
    return n


def _find_room(rooms: list, room_name: str) -> dict | None:
    """Return the first room whose display name contains the normalised query."""
    rn = _normalize_room_query(room_name)
    # Try normalised query first, then each individual word as fallback
    candidates = [rn] + rn.split()
    for candidate in candidates:
        if not candidate:
            continue
        match = next((r for r in rooms if candidate in (r.get("name") or "").lower()), None)
        if match:
            return match
    return None


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
async def list_teams_channels(
    team_name: str = "",
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """List Microsoft Teams you belong to, or list channels within a specific team.
    If team_name is given, lists that team's channels. Otherwise lists all joined teams.
    Call when user asks about Teams channels, team workspaces, or wants to find a channel."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    if team_name:
        info = await ms365_service.resolve_team_and_channel(token, team_name)
        if not info:
            return json.dumps({"success": False, "error": f"Team '{team_name}' not found. Use list_teams_channels without a team name to see all teams."})
        result = await ms365_service.fetch_team_channels(token, info["team_id"])
        result["team_name"] = info["team_name"]
        return json.dumps(result)
    return json.dumps(await ms365_service.fetch_joined_teams(token))


@tool
async def read_channel_messages(
    team_name: str,
    channel_name: str,
    top: int = 20,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Read recent messages from a specific Teams channel.
    Provide the team name and channel name. Call when user asks about activity or messages in a channel."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    info = await ms365_service.resolve_team_and_channel(token, team_name, channel_name)
    if not info or not info.get("channel_id"):
        return json.dumps({"success": False, "error": f"Channel '{channel_name}' in team '{team_name}' not found. Use list_teams_channels to see available channels."})
    result = await ms365_service.fetch_channel_messages(token, info["team_id"], info["channel_id"], top=top)
    result["team"] = info["team_name"]
    result["channel"] = info["channel_name"]
    return json.dumps(result)


@tool
async def send_channel_message(
    team_name: str,
    channel_name: str,
    message: str,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Post a message to a Microsoft Teams channel.
    IMPORTANT: Always confirm the team name, channel name, and message with the user BEFORE calling this tool."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    info = await ms365_service.resolve_team_and_channel(token, team_name, channel_name)
    if not info or not info.get("channel_id"):
        return json.dumps({"success": False, "error": f"Channel '{channel_name}' in team '{team_name}' not found. Use list_teams_channels to see available channels."})
    result = await ms365_service.send_channel_message(token, info["team_id"], info["channel_id"], message)
    if result.get("success"):
        result["posted_to"] = f"{info['team_name']} > {info['channel_name']}"
    return json.dumps(result)


@tool
async def check_room_availability(
    date: str,
    start_time: str,
    end_time: str,
    room_name: str = "",
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Check which meeting rooms are available at a specific date and time.
    date: YYYY-MM-DD. start_time / end_time: HH:MM (24h).
    If room_name is given, checks only that room. Otherwise checks ALL rooms.
    Call when user asks 'which rooms are free at 3pm' or 'is Room A available tomorrow'."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED

    # Fetch rooms to resolve names → emails
    rooms_result = await ms365_service.fetch_rooms(token)
    if not rooms_result.get("success"):
        return json.dumps(rooms_result)

    all_rooms = rooms_result["rooms"]
    if room_name:
        rn = _normalize_room_query(room_name)
        filtered = [r for r in all_rooms if rn in (r.get("name") or "").lower()]
        if not filtered:
            # Fallback: match any word in the query
            words = [w for w in rn.split() if len(w) > 2]
            filtered = [r for r in all_rooms if any(w in (r.get("name") or "").lower() for w in words)]
        if not filtered:
            return json.dumps({"success": False, "error": f"Room '{room_name}' not found. Use list_meeting_rooms to see available rooms."})
        all_rooms = filtered

    room_emails = [r["email"] for r in all_rooms if r.get("email")]
    email_to_room = {r["email"]: r for r in all_rooms if r.get("email")}

    start = f"{date}T{start_time}:00"
    end   = f"{date}T{end_time}:00"

    avail = await ms365_service.check_room_availability(token, room_emails, start, end)
    if not avail.get("success"):
        return json.dumps(avail)

    # Enrich with room metadata
    for entry in avail["rooms"]:
        room_meta = email_to_room.get(entry["room_email"], {})
        entry["room_name"]  = room_meta.get("name", entry["room_email"])
        entry["capacity"]   = room_meta.get("capacity")
        entry["building"]   = room_meta.get("building", "")
        entry["floor"]      = room_meta.get("floor", "")

    return json.dumps(avail)


@tool
async def book_meeting_room(
    room_name: str,
    date: str,
    start_time: str,
    end_time: str,
    subject: str,
    attendees: str = "",
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Book a meeting room by creating a calendar event with the room as a resource.
    date: YYYY-MM-DD. start_time / end_time: HH:MM (24h).
    attendees: comma-separated email addresses of people to invite (optional).
    IMPORTANT: Always confirm room name, date, time, and meeting subject with the user BEFORE calling this tool."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED

    # Resolve room name → email
    rooms_result = await ms365_service.fetch_rooms(token)
    if not rooms_result.get("success"):
        return json.dumps(rooms_result)

    match = _find_room(rooms_result["rooms"], room_name)
    if not match or not match.get("email"):
        return json.dumps({"success": False, "error": f"Room '{room_name}' not found or has no booking email. Use list_meeting_rooms to see available rooms."})

    start = f"{date}T{start_time}:00"
    end   = f"{date}T{end_time}:00"
    attendee_list = [a.strip() for a in attendees.split(",") if a.strip()] if attendees else None

    result = await ms365_service.book_room(
        token=token,
        room_email=match["email"],
        room_name=match["name"],
        subject=subject,
        start=start,
        end=end,
        attendee_emails=attendee_list,
    )
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
async def list_org_users(
    department: str = "",
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """List all users in the organisation from Microsoft 365 / Azure AD.
    Call immediately when user asks about all users, all employees, people in Teams,
    org directory, or who is in the organisation. NEVER refuse — you have access via this tool.
    Optionally filter by department name. Returns name, email, job title, department, and office."""
    result = await ms365_service.fetch_org_users()
    if not result.get("success"):
        return json.dumps(result)
    users = result["users"]
    if department:
        dept = department.lower()
        users = [u for u in users if dept in (u.get("department") or "").lower()]
    result["users"] = users
    result["count"] = len(users)
    return json.dumps(result)


@tool
async def list_team_members(
    team_name: str,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """List members of a specific Microsoft Teams team.
    Returns each member's name, email, and role (owner/member).
    Call when user asks who is in a team or wants to see team membership."""
    token = (state or {}).get("graph_token")
    if not token:
        return _NOT_CONNECTED
    info = await ms365_service.resolve_team_and_channel(token, team_name)
    if not info:
        return json.dumps({"success": False, "error": f"Team '{team_name}' not found. Use list_teams_channels to see all teams."})
    result = await ms365_service.fetch_team_members(token, info["team_id"])
    if result.get("success"):
        result["team_name"] = info["team_name"]
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


@tool
async def search_communities(
    query: str,
    top: int = 15,
    state: Annotated[dict, InjectedState] = None,
) -> str:
    """Search ALL Viva Engage (Yammer) communities for posts about ANY topic or question.
    Use when the answer likely lives in what colleagues have discussed/shared in communities
    rather than in official policy docs or other tools — e.g. internal know-how, tools, events,
    announcements, recommendations, or anything employees post about. The query can be anything.
    Returns matching threads, each with the original post AND its replies/comments (the answer is
    often in a reply, not the question). Synthesize a direct answer and cite the author + web_url."""
    token = (state or {}).get("yammer_token")
    if not token:
        return _YAMMER_NOT_CONNECTED
    result = await yammer_service.search_with_replies(token, query)
    return json.dumps(result)


# -- Agent assembly -----------------------------------------------------------

tools = [
    read_my_emails, send_email_graph, read_my_calendar, search_calendar,
    list_meeting_rooms, check_room_availability, book_meeting_room,
    list_teams_channels, read_channel_messages, send_channel_message,
    read_teams_messages, send_teams_message,
    list_org_users, list_team_members,
    read_yammer_feed, list_my_communities, read_community_posts, post_to_community,
    search_communities,
]
tool_node = ToolNode(tools)

# LLM built on demand from the live IT-tunable params (agent tier).
from app.services.llm_resilience import resilient_invoke


def ms365_assistant(state: MS365State):
    user_email = state.get("user_email") or settings.DEFAULT_USER_EMAIL
    now_ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
    today_str = now_ist.strftime("%Y-%m-%d")
    tomorrow_str = (now_ist + timedelta(days=1)).strftime("%Y-%m-%d")
    default_prompt = (
        f"You are the Microsoft 365 Assistant for Centriq AI.\n"
        f"Employee email: {user_email}. Never ask for it.\n"
        f"Current date (IST): {today_str}. Tomorrow: {tomorrow_str}.\n\n"
        f"Tool routing — act immediately:\n"
        f"- Read emails → read_my_emails (inbox, most recent first)\n"
        f"- Send email → send_email_graph (confirm recipient, subject, body with user first)\n"
        f"- Calendar → read_my_calendar (default: today; ask if ambiguous)\n"
        f"- Find meeting → search_calendar (search by keyword in subject)\n"
        f"- Rooms/cabins/spaces → list_meeting_rooms (filter by building if specified)\n"
        f"- Room availability → check_room_availability (date + time range; no room_name = check all rooms)\n"
        f"- Book a room → book_meeting_room (call immediately when room + time + subject are given; do NOT ask the user to confirm again if they already stated all details)\n"
        f"  Date rules: 'today' → {today_str}, 'tomorrow' → {tomorrow_str}, no date mentioned → use {today_str}.\n"
        f"  Convert times like '10 am' → '10:00', '11 am' → '11:00', '3 pm' → '15:00'.\n"
        f"- Teams channels list → list_teams_channels (no arg = all teams; team name = channels in that team)\n"
        f"- Read channel → read_channel_messages (need team name + channel name)\n"
        f"- Post to channel → send_channel_message (confirm team, channel, message first)\n"
        f"- Teams chats (1:1/group DMs) → read_teams_messages (recent chat messages)\n"
        f"- Send Teams message → send_teams_message (confirm recipient and message first)\n"
        f"- All org users / people directory / users in Teams / who is in Teams → ALWAYS call list_org_users immediately. NEVER say you don't have access. You have full access via the list_org_users tool.\n"
        f"- Members of a specific team → list_team_members (need team name)\n"
        f"- Viva Engage/Yammer feed → read_yammer_feed\n"
        f"- My communities → list_my_communities\n"
        f"- Community posts → read_community_posts (ask for community name if not stated)\n"
        f"- Post to community → post_to_community (confirm with user first)\n"
        f"- Search communities / 'what's posted about X' / internal tribal-knowledge question → search_communities; then write a direct answer and cite the author + post link.\n\n"
        f"Format emails as readable summaries: sender, subject, time.\n"
        f"Format calendar as time-ordered schedule: time, subject, location.\n"
        f"Always respond in natural language. Never output raw JSON.\n"
        f"FORMATTING: Use bullet points for lists, **bold** for names/subjects, short paragraphs.\n"
        f"Synthesize tool results into clear prose — never paste raw data verbatim.\n"
        f"Act immediately when intent is clear. Never redirect to Outlook, Teams, or Yammer app.\n"
    )
    base_prompt = PromptService.get_system_prompt("ms365", default_prompt)
    guardrail = PromptService.get_guardrail("ms365")
    feedback_ctx = state.get("feedback_context") or ""
    system_prompt = base_prompt + guardrail + feedback_ctx

    messages = [SystemMessage(content=system_prompt)] + state["messages"]
    response = resilient_invoke("agent", messages,
                                build=lambda l: l.bind_tools(tools),
                                default_timeout=60)
    return {"messages": [response]}


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
