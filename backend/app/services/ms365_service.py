"""
Microsoft Graph API service for Connected Accounts.

Provides async functions to read emails, send emails, read calendar,
search calendar, and read Teams chats using a delegated user token.
"""

import logging
from datetime import datetime, timedelta

import httpx

log = logging.getLogger("aurora-logger")

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_TIMEOUT = 15.0


def _headers(token: str, extra: dict | None = None) -> dict:
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def _error(msg: str, status: int | None = None) -> dict:
    log.warning("[ms365] %s (status=%s)", msg, status)
    if status == 401:
        return {
            "success": False,
            "error": "Your Microsoft session has expired. Please reconnect your account in Settings > Connected Accounts.",
        }
    return {"success": False, "error": msg}


# -- User profile -------------------------------------------------------------

async def fetch_my_profile(token: str) -> dict:
    """Fetch the logged-in user's M365 profile (officeLocation, city, country)."""
    url = f"{GRAPH_BASE}/me"
    params = {"$select": "officeLocation,city,state,country,displayName"}
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(url, headers=_headers(token), params=params)
        resp.raise_for_status()
        return resp.json()


# -- Emails -------------------------------------------------------------------

async def fetch_my_emails(token: str, top: int = 15) -> dict:
    """Fetch recent inbox emails."""
    url = f"{GRAPH_BASE}/me/messages"
    params = {
        "$top": str(min(top, 50)),
        "$select": "id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments",
        "$orderby": "receivedDateTime desc",
        "$filter": "parentFolderId eq 'inbox'",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        emails = []
        for m in data.get("value", []):
            sender = m.get("from", {}).get("emailAddress", {})
            emails.append({
                "subject": m.get("subject", "(no subject)"),
                "from_name": sender.get("name", ""),
                "from_email": sender.get("address", ""),
                "received": m.get("receivedDateTime", ""),
                "preview": (m.get("bodyPreview") or "")[:200],
                "is_read": m.get("isRead", False),
                "has_attachments": m.get("hasAttachments", False),
            })
        return {"success": True, "count": len(emails), "emails": emails}

    except httpx.HTTPStatusError as e:
        return _error(f"Graph API error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch emails: {e}")


# -- Send Email ---------------------------------------------------------------

async def send_email(
    token: str,
    to: list[str],
    subject: str,
    body: str,
    cc: list[str] | None = None,
) -> dict:
    """Send an email via Microsoft Graph."""
    url = f"{GRAPH_BASE}/me/sendMail"
    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "Text", "content": body},
            "toRecipients": [
                {"emailAddress": {"address": addr.strip()}} for addr in to if addr.strip()
            ],
        },
        "saveToSentItems": True,
    }
    if cc:
        payload["message"]["ccRecipients"] = [
            {"emailAddress": {"address": addr.strip()}} for addr in cc if addr.strip()
        ]

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=_headers(token), json=payload)
            resp.raise_for_status()
        return {"success": True, "message": f"Email sent to {', '.join(to)}."}

    except httpx.HTTPStatusError as e:
        return _error(f"Failed to send email: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to send email: {e}")


# -- Calendar View ------------------------------------------------------------

async def fetch_calendar_view(token: str, start: str, end: str) -> dict:
    """Fetch calendar events for a date range.

    Args:
        start: ISO 8601 datetime string (e.g. 2026-05-26T00:00:00)
        end:   ISO 8601 datetime string (e.g. 2026-05-26T23:59:59)
    """
    url = f"{GRAPH_BASE}/me/calendarView"
    params = {
        "startDateTime": start,
        "endDateTime": end,
        "$select": "id,subject,start,end,location,organizer,isAllDay,isCancelled",
        "$top": "50",
        "$orderby": "start/dateTime",
    }
    headers = _headers(token, {"Prefer": 'outlook.timezone="Asia/Kolkata"'})

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()

        events = []
        for ev in data.get("value", []):
            if ev.get("isCancelled"):
                continue
            loc = ev.get("location", {})
            org = ev.get("organizer", {}).get("emailAddress", {})
            events.append({
                "subject": ev.get("subject", "(no title)"),
                "start": ev.get("start", {}).get("dateTime", ""),
                "end": ev.get("end", {}).get("dateTime", ""),
                "is_all_day": ev.get("isAllDay", False),
                "location": loc.get("displayName", ""),
                "organizer_name": org.get("name", ""),
                "organizer_email": org.get("address", ""),
            })
        return {"success": True, "count": len(events), "events": events}

    except httpx.HTTPStatusError as e:
        return _error(f"Calendar error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch calendar: {e}")


# -- Search Calendar (client-side filter) -------------------------------------

async def search_calendar(
    token: str,
    keyword: str,
    start: str,
    end: str,
) -> dict:
    """Fetch calendar events in a range and filter by keyword in subject."""
    result = await fetch_calendar_view(token, start, end)
    if not result.get("success"):
        return result

    kw = keyword.lower()
    matched = [
        ev for ev in result["events"]
        if kw in (ev.get("subject") or "").lower()
        or kw in (ev.get("organizer_name") or "").lower()
        or kw in (ev.get("location") or "").lower()
    ]
    return {"success": True, "keyword": keyword, "count": len(matched), "events": matched}


# -- Room Availability & Booking ----------------------------------------------

async def check_room_availability(
    token: str,
    room_emails: list[str],
    start: str,
    end: str,
) -> dict:
    """
    Check free/busy schedule for one or more rooms.
    start/end: ISO 8601 datetime strings (e.g. '2026-05-28T09:00:00').
    Returns per-room availability and any booked slots within the window.
    """
    url = f"{GRAPH_BASE}/me/calendar/getSchedule"
    payload = {
        "schedules": room_emails,
        "startTime": {"dateTime": start, "timeZone": "Asia/Kolkata"},
        "endTime":   {"dateTime": end,   "timeZone": "Asia/Kolkata"},
        "availabilityViewInterval": 30,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=_headers(token), json=payload)
            resp.raise_for_status()
            data = resp.json()

        results = []
        for entry in data.get("value", []):
            # scheduleItems may be empty for room resources due to privacy settings.
            # availabilityView is always populated: each char = one 30-min slot,
            # values: 0=free 1=tentative 2=busy 3=OOF 4=workingElsewhere.
            # Use it as the primary source; fall back to scheduleItems if absent.
            availability_view = entry.get("availabilityView", "")

            booked = []
            for item in entry.get("scheduleItems", []):
                if item.get("status") in ("busy", "tentative", "oof"):
                    booked.append({
                        "status": item.get("status"),
                        "start": item.get("start", {}).get("dateTime", ""),
                        "end":   item.get("end",   {}).get("dateTime", ""),
                        "subject": item.get("subject") or "",
                    })

            if availability_view:
                # Any non-zero character means a conflict in that slot
                is_free = all(c == "0" for c in availability_view)
            else:
                is_free = len(booked) == 0

            results.append({
                "room_email": entry.get("scheduleId", ""),
                "availability_view": availability_view,
                "is_free": is_free,
                "booked_slots": booked,
            })
        return {"success": True, "window_start": start, "window_end": end, "rooms": results}

    except httpx.HTTPStatusError as e:
        return _error(f"getSchedule error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to check room availability: {e}")


async def book_room(
    token: str,
    room_email: str,
    room_name: str,
    subject: str,
    start: str,
    end: str,
    attendee_emails: list[str] | None = None,
    is_online_meeting: bool = False,
) -> dict:
    """
    Create a calendar event and invite the room as a resource attendee.
    start/end: ISO 8601 datetime strings.
    attendee_emails: optional list of additional people to invite.
    """
    url = f"{GRAPH_BASE}/me/events"
    attendees = [
        {"emailAddress": {"address": room_email, "name": room_name}, "type": "resource"}
    ]
    if attendee_emails:
        for addr in attendee_emails:
            attendees.append({"emailAddress": {"address": addr.strip()}, "type": "required"})

    payload = {
        "subject": subject,
        "start": {"dateTime": start, "timeZone": "Asia/Kolkata"},
        "end":   {"dateTime": end,   "timeZone": "Asia/Kolkata"},
        "location": {"displayName": room_name, "locationEmailAddress": room_email},
        "attendees": attendees,
        "isOnlineMeeting": is_online_meeting,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=_headers(token), json=payload)
            resp.raise_for_status()
            event = resp.json()
        return {
            "success": True,
            "event_id": event.get("id", ""),
            "subject": event.get("subject", ""),
            "room": room_name,
            "start": start,
            "end": end,
            "message": f"Room '{room_name}' booked for '{subject}' from {start} to {end}.",
        }
    except httpx.HTTPStatusError as e:
        return _error(f"Room booking error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to book room: {e}")


# -- Teams Channels -----------------------------------------------------------

async def fetch_joined_teams(token: str) -> dict:
    """Fetch all Teams the user is a member of."""
    url = f"{GRAPH_BASE}/me/joinedTeams"
    params = {"$select": "id,displayName,description"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()
        teams = [
            {"id": t.get("id", ""), "name": t.get("displayName", ""), "description": t.get("description", "")}
            for t in data.get("value", [])
        ]
        return {"success": True, "count": len(teams), "teams": teams}
    except httpx.HTTPStatusError as e:
        return _error(f"Teams list error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch teams: {e}")


async def fetch_team_channels(token: str, team_id: str) -> dict:
    """Fetch channels for a specific team."""
    url = f"{GRAPH_BASE}/teams/{team_id}/channels"
    params = {"$select": "id,displayName,description,membershipType"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()
        channels = [
            {
                "id": c.get("id", ""),
                "name": c.get("displayName", ""),
                "description": c.get("description", ""),
                "type": c.get("membershipType", ""),
            }
            for c in data.get("value", [])
        ]
        return {"success": True, "count": len(channels), "channels": channels}
    except httpx.HTTPStatusError as e:
        return _error(f"Channels list error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch channels: {e}")


async def fetch_channel_messages(token: str, team_id: str, channel_id: str, top: int = 20) -> dict:
    """Fetch recent messages from a Teams channel."""
    url = f"{GRAPH_BASE}/teams/{team_id}/channels/{channel_id}/messages"
    params = {"$top": str(min(top, 50)), "$orderby": "createdDateTime desc"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()
        messages = []
        for m in data.get("value", []):
            sender = m.get("from", {}) or {}
            user = sender.get("user", {}) or {}
            body = m.get("body", {}) or {}
            content = body.get("content", "")
            # Strip basic HTML tags for readability
            import re
            content = re.sub(r"<[^>]+>", "", content).strip()
            messages.append({
                "id": m.get("id", ""),
                "sender": user.get("displayName", ""),
                "sent": m.get("createdDateTime", ""),
                "content": content[:500],
                "subject": m.get("subject", ""),
            })
        return {"success": True, "count": len(messages), "messages": messages}
    except httpx.HTTPStatusError as e:
        return _error(f"Channel messages error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch channel messages: {e}")


async def send_channel_message(token: str, team_id: str, channel_id: str, content: str) -> dict:
    """Post a message to a Teams channel."""
    url = f"{GRAPH_BASE}/teams/{team_id}/channels/{channel_id}/messages"
    payload = {"body": {"contentType": "text", "content": content}}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=_headers(token), json=payload)
            resp.raise_for_status()
        return {"success": True, "message": "Message posted to channel."}
    except httpx.HTTPStatusError as e:
        return _error(f"Channel send error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to send channel message: {e}")


async def resolve_team_and_channel(token: str, team_name: str, channel_name: str = "") -> dict | None:
    """Find team_id and channel_id by name. Returns None if not found."""
    teams_result = await fetch_joined_teams(token)
    if not teams_result.get("success"):
        return None
    tname = team_name.lower()
    team = next((t for t in teams_result["teams"] if tname in t["name"].lower()), None)
    if not team:
        return None
    if not channel_name:
        return {"team_id": team["id"], "team_name": team["name"], "channel_id": None, "channel_name": None}
    channels_result = await fetch_team_channels(token, team["id"])
    if not channels_result.get("success"):
        return None
    cname = channel_name.lower()
    channel = next((c for c in channels_result["channels"] if cname in c["name"].lower()), None)
    if not channel:
        return None
    return {
        "team_id": team["id"], "team_name": team["name"],
        "channel_id": channel["id"], "channel_name": channel["name"],
    }


# -- Rooms / Places -----------------------------------------------------------

import time as _time

_rooms_cache: dict[str, tuple[dict, float]] = {}
_ROOMS_CACHE_TTL = 300.0  # 5 minutes — room list rarely changes


async def fetch_rooms(token: str) -> dict:
    """Fetch all meeting rooms from the organisation's room directory.

    Results are cached per-token for 5 minutes to avoid repeated Graph API
    calls within a single room-booking flow (availability check + booking).
    """
    # Use a short token fingerprint as key (avoid storing full token)
    cache_key = token[-16:] if token else ""
    cached = _rooms_cache.get(cache_key)
    if cached:
        result, ts = cached
        if _time.monotonic() - ts < _ROOMS_CACHE_TTL:
            return result

    url = f"{GRAPH_BASE}/places/microsoft.graph.room"
    params = {
        "$select": "id,displayName,emailAddress,capacity,building,floorNumber,floorLabel,isWheelChairAccessible,phone",
        "$top": "100",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        rooms = []
        for r in data.get("value", []):
            rooms.append({
                "name": r.get("displayName", ""),
                "email": r.get("emailAddress", ""),
                "capacity": r.get("capacity"),
                "building": r.get("building", ""),
                "floor": r.get("floorLabel") or (str(r["floorNumber"]) if r.get("floorNumber") is not None else ""),
                "wheelchair_accessible": r.get("isWheelChairAccessible", False),
                "phone": r.get("phone", ""),
            })
        result = {"success": True, "count": len(rooms), "rooms": rooms}
        if cache_key:
            _rooms_cache[cache_key] = (result, _time.monotonic())
        return result

    except httpx.HTTPStatusError as e:
        return _error(f"Rooms error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch rooms: {e}")


async def fetch_room_lists(token: str) -> dict:
    """Fetch room lists (buildings/groups) from the organisation's room directory."""
    url = f"{GRAPH_BASE}/places/microsoft.graph.roomList"
    params = {
        "$select": "id,displayName,emailAddress,phone",
        "$top": "50",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        lists = [
            {
                "name": rl.get("displayName", ""),
                "email": rl.get("emailAddress", ""),
                "phone": rl.get("phone", ""),
            }
            for rl in data.get("value", [])
        ]
        return {"success": True, "count": len(lists), "room_lists": lists}

    except httpx.HTTPStatusError as e:
        return _error(f"Room lists error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch room lists: {e}")


async def fetch_my_room_bookings(token: str, days: int = 7) -> dict:
    """Fetch the user's upcoming calendar events that include a room resource.

    Looks forward `days` days from now. Identifies room bookings by checking
    for attendees with type='resource' (how book_room() adds the room).
    """
    now = datetime.utcnow()
    end = now + timedelta(days=days)
    url = f"{GRAPH_BASE}/me/calendarView"
    params = {
        "startDateTime": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "endDateTime":   end.strftime("%Y-%m-%dT%H:%M:%S"),
        "$select": "id,subject,start,end,location,attendees,organizer,webLink",
        "$top": "50",
        "$orderby": "start/dateTime asc",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        bookings = []
        for event in data.get("value", []):
            room_name = room_email = ""
            for att in event.get("attendees", []):
                if att.get("type") == "resource":
                    room_name  = att.get("emailAddress", {}).get("name", "")
                    room_email = att.get("emailAddress", {}).get("address", "")
                    break
            # Also fall back to location field if no resource attendee found
            if not room_name:
                loc = event.get("location", {})
                if loc.get("locationEmailAddress"):
                    room_name  = loc.get("displayName", "")
                    room_email = loc.get("locationEmailAddress", "")
            if not room_name and not room_email:
                continue  # not a room booking
            bookings.append({
                "id":         event["id"],
                "subject":    event.get("subject") or "(No title)",
                "start":      event.get("start", {}).get("dateTime", ""),
                "end":        event.get("end",   {}).get("dateTime", ""),
                "room_name":  room_name,
                "room_email": room_email,
                "web_link":   event.get("webLink", ""),
            })
        return {"success": True, "count": len(bookings), "bookings": bookings}

    except httpx.HTTPStatusError as e:
        return _error(f"Bookings error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch room bookings: {e}")


async def cancel_event(token: str, event_id: str) -> dict:
    """Delete a calendar event (cancels the room booking and notifies attendees)."""
    url = f"{GRAPH_BASE}/me/events/{event_id}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.delete(url, headers=_headers(token))
        if resp.status_code == 204:
            return {"success": True}
        resp.raise_for_status()
        return {"success": True}
    except httpx.HTTPStatusError as e:
        return _error(f"Cancel error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to cancel event: {e}")


# -- Teams Chats --------------------------------------------------------------

async def send_teams_message(token: str, chat_id: str, content: str) -> dict:
    """Send a message to a Teams chat by chat ID."""
    url = f"{GRAPH_BASE}/me/chats/{chat_id}/messages"
    payload = {"body": {"content": content}}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=_headers(token), json=payload)
            resp.raise_for_status()
        return {"success": True, "message": "Message sent in Teams."}

    except httpx.HTTPStatusError as e:
        return _error(f"Teams send error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to send Teams message: {e}")


async def find_chat_by_participant(token: str, person: str) -> dict | None:
    """Search recent chats to find one matching a person name, email, or group chat topic."""
    url = f"{GRAPH_BASE}/me/chats"
    params = {
        "$top": "50",
        "$expand": "members",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        person_lower = person.lower()
        for chat in data.get("value", []):
            topic = (chat.get("topic") or "").lower()

            # Match group chats by topic name
            if topic and person_lower in topic:
                return {
                    "chat_id": chat.get("id"),
                    "chat_type": chat.get("chatType", ""),
                    "topic": chat.get("topic", ""),
                    "matched_name": chat.get("topic", ""),
                    "matched_email": "",
                }

            # Match 1:1 / group chats by member name or email
            members = chat.get("members", [])
            for m in members:
                display_name = (m.get("displayName") or "").lower()
                email = (m.get("email") or "").lower()
                if person_lower in display_name or person_lower in email:
                    return {
                        "chat_id": chat.get("id"),
                        "chat_type": chat.get("chatType", ""),
                        "topic": chat.get("topic") or "(direct message)",
                        "matched_name": m.get("displayName", ""),
                        "matched_email": m.get("email", ""),
                    }
        return None

    except Exception:
        return None


# Only sync real org accounts on this mail domain. The tenant directory holds
# 50k+ objects (guests, devices, shared mailboxes) — filtering server-side via
# Graph's $filter keeps the fetch to ~1.1k users instead of paginating everything.
_ORG_MAIL_DOMAIN = "@alignedautomation.com"

# Service / resource / shared accounts that are not real people. Matched against
# the display name and the email local-part so they are never stored as users.
_NON_HUMAN_SUBSTR = (
    "conference", "war room", "warroom", "boardroom", "meeting room",
    "publishing", "external", "accounting", "accounts", "expense",
    "alchemy", "agreement", "zohouser", "automation services", "pvt ltd",
    "tech support", "helpdesk", "administrator", "noreply", "no-reply",
)
_NON_HUMAN_SEG = {
    "admin", "administrator", "hr", "it", "info", "accounts", "accounting",
    "support", "noreply", "alignedautomation", "publishing", "alchemy", "auto",
    "external", "sales", "finance", "marketing", "helpdesk", "reception",
    "facilities", "payroll", "warroom", "agreement",
}


def _is_non_human(name: str, email: str) -> bool:
    """Heuristic: True for conference rooms, shared mailboxes, and service accounts."""
    import re
    n = (name or "").lower()
    local = (email or "").split("@")[0].lower()
    if any(d in n or d in local for d in _NON_HUMAN_SUBSTR):
        return True
    return any(seg in _NON_HUMAN_SEG for seg in re.split(r"[._\-]", local))


async def fetch_org_users(token: str, top: int = 100) -> dict:
    """Fetch org users whose mail is on the company domain, filtered server-side.

    Uses Graph advanced query (`$filter=endsWith(...)` + `$count=true` +
    `ConsistencyLevel: eventual`) so the directory's tens of thousands of guest
    and resource objects are never paginated client-side.
    """
    url = f"{GRAPH_BASE}/users"
    params = {
        "$select": "id,displayName,mail,jobTitle,department,officeLocation,userPrincipalName",
        "$filter": f"endsWith(mail,'{_ORG_MAIL_DOMAIN}')",
        "$count": "true",
        "$top": str(min(top, 999)),
    }
    headers = _headers(token, {"ConsistencyLevel": "eventual"})
    try:
        users = []
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            while url:
                resp = await client.get(url, headers=headers, params=params)
                resp.raise_for_status()
                data = resp.json()
                for u in data.get("value", []):
                    email = u.get("mail") or u.get("userPrincipalName", "")
                    name = u.get("displayName", "")
                    if _is_non_human(name, email):
                        continue
                    users.append({
                        "name": name,
                        "email": email,
                        "job_title": u.get("jobTitle", ""),
                        "department": u.get("department", ""),
                        "office": u.get("officeLocation", ""),
                    })
                url = data.get("@odata.nextLink")
                params = {}  # nextLink already has params baked in
        return {"success": True, "count": len(users), "users": users}
    except httpx.HTTPStatusError as e:
        return _error(f"Users list error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch org users: {e}")


async def sync_users_to_db(token: str, limit: int = 100) -> dict:
    """Fetch company-domain users from Azure AD and bulk-upsert into ms365_users.

    Filters server-side (see fetch_org_users) and caps at `limit` users (default
    100) so a single Graph page is fetched — no full-directory pagination. Upserts
    in one statement keyed on azure_id.
    """
    import httpx as _httpx
    from app.database import SessionLocal
    from app.models import MS365User
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    import datetime as _dt

    url = f"{GRAPH_BASE}/users"
    params = {
        "$select": "id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation",
        "$filter": f"endsWith(mail,'{_ORG_MAIL_DOMAIN}')",
        "$count": "true",
        "$top": str(min(limit, 999)),
    }
    headers = _headers(token, {"ConsistencyLevel": "eventual"})

    seen: dict[str, dict] = {}
    try:
        async with _httpx.AsyncClient(timeout=30.0) as client:
            while url and len(seen) < limit:
                resp = await client.get(url, headers=headers, params=params)
                resp.raise_for_status()
                data = resp.json()
                for u in data.get("value", []):
                    azure_id = u.get("id", "")
                    if not azure_id:
                        continue
                    email = (u.get("mail") or u.get("userPrincipalName") or "").lower()
                    name = u.get("displayName", "")
                    if _is_non_human(name, email):
                        continue
                    seen[azure_id] = {  # dedupe by azure_id to satisfy ON CONFLICT
                        "azure_id": azure_id,
                        "email": email,
                        "name": name,
                        "job_title": u.get("jobTitle") or "",
                        "department": u.get("department") or "",
                        "office_location": u.get("officeLocation") or "",
                    }
                    if len(seen) >= limit:
                        break
                url = data.get("@odata.nextLink")
                params = {}
    except _httpx.HTTPStatusError as e:
        return _error(f"Sync error fetching users: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Sync error: {e}")

    rows = list(seen.values())
    if not rows:
        return {"success": True, "synced": 0, "total_fetched": 0}

    now = _dt.datetime.utcnow()
    for r in rows:
        r["synced_at"] = now

    db = SessionLocal()
    try:
        stmt = pg_insert(MS365User).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["azure_id"],
            set_={
                "email": stmt.excluded.email,
                "name": stmt.excluded.name,
                "job_title": stmt.excluded.job_title,
                "department": stmt.excluded.department,
                "office_location": stmt.excluded.office_location,
                "synced_at": stmt.excluded.synced_at,
            },
        )
        db.execute(stmt)
        db.commit()
    except Exception as e:
        db.rollback()
        return _error(f"DB upsert error: {e}")
    finally:
        db.close()

    return {"success": True, "synced": len(rows), "total_fetched": len(rows)}


async def fetch_team_members(token: str, team_id: str) -> dict:
    """Fetch members of a specific Microsoft Teams team."""
    url = f"{GRAPH_BASE}/teams/{team_id}/members"
    params = {"$select": "id,displayName,email,roles"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()
        members = [
            {
                "name": m.get("displayName", ""),
                "email": m.get("email", ""),
                "role": "owner" if "owner" in (m.get("roles") or []) else "member",
            }
            for m in data.get("value", [])
        ]
        return {"success": True, "count": len(members), "members": members}
    except httpx.HTTPStatusError as e:
        return _error(f"Team members error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch team members: {e}")


async def fetch_teams_chats(token: str, top: int = 15) -> dict:
    """Fetch recent Teams chats with last message preview."""
    url = f"{GRAPH_BASE}/me/chats"
    params = {
        "$top": str(min(top, 50)),
        "$expand": "lastMessagePreview",
        "$orderby": "lastMessagePreview/createdDateTime desc",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        chats = []
        for c in data.get("value", []):
            preview = c.get("lastMessagePreview") or {}
            sender = preview.get("from", {}).get("user", {})
            chats.append({
                "chat_type": c.get("chatType", ""),
                "topic": c.get("topic") or "(direct message)",
                "last_message": (preview.get("body", {}).get("content") or "")[:200],
                "last_sender": sender.get("displayName", ""),
                "last_time": preview.get("createdDateTime", ""),
            })
        return {"success": True, "count": len(chats), "chats": chats}

    except httpx.HTTPStatusError as e:
        return _error(f"Teams error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch Teams chats: {e}")
