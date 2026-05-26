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


# -- Rooms / Places -----------------------------------------------------------

async def fetch_rooms(token: str) -> dict:
    """Fetch all meeting rooms from the organisation's room directory."""
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
        return {"success": True, "count": len(rooms), "rooms": rooms}

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
