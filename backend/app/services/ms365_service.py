"""
Microsoft Graph API service for Connected Accounts.

Provides async functions to read emails, send emails, read calendar,
search calendar, and read Teams chats using a delegated user token.
"""

import asyncio
import logging
import time
from datetime import datetime, timedelta

import httpx

log = logging.getLogger("aurora-logger")

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_TIMEOUT = 15.0

# ── Profile-photo cache ──────────────────────────────────────────────────────
# The Employee Directory renders hundreds of avatars, each an <img> that hits the
# photo proxy. Without a server-side cache every render is a live Graph call, and a
# burst of them gets throttled (429) → faces intermittently fall back to initials.
# We cache the bytes per email (and remember "this user genuinely has no photo")
# so each user is fetched from Graph at most once per TTL across all viewers, and a
# small semaphore caps how many photo calls hit Graph at once so we never flood it.
#   value = (bytes | None, content_type, expires_at).  bytes is None for a real 404.
_photo_cache: dict[str, tuple[bytes | None, str, float]] = {}
_PHOTO_POS_TTL = 24 * 3600   # a real photo is stable — cache a day
_PHOTO_NEG_TTL = 6 * 3600    # "no photo" — re-check occasionally in case one is added
_PHOTO_CACHE_MAX = 5000
_photo_semaphore = asyncio.Semaphore(6)


def _headers(token: str, extra: dict | None = None) -> dict:
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


def _app_token() -> str:
    """App-only Graph token (client-credentials) for org-directory reads.

    Org-wide reads (all users, any user's profile/manager/reports) use the
    *application* User.Read.All permission on the GRAPH_* app — NOT the delegated
    per-user token. This is why these calls need no Connected Account and never
    hit the delegated-consent ("admin approval") wall. See graph_sync.GraphClient.
    Token is cached ~1h inside GraphClient, so the sync fetch runs rarely.
    """
    from app.graph_sync import graph_client
    return graph_client._get_token()


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


async def fetch_user_by_email(email: str) -> dict:
    """Look up any org user's full profile by email/UPN (app-only User.Read.All).

    The email/UPN is a valid Graph key, so /users/{email} resolves directly.
    Returns a normalized profile dict with the manager expanded inline.
    """
    from urllib.parse import quote
    url = f"{GRAPH_BASE}/users/{quote(email.strip())}"
    params = {"$select": USER_SELECT, "$expand": USER_EXPAND}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(_app_token()), params=params)
            resp.raise_for_status()
            data = resp.json()
        row = _normalize_user_row(data)
        if row is None:
            return _error(f"No user profile for '{email}'.")
        return {"success": True, "user": row}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return _error(f"User '{email}' not found in the directory.")
        return _error(f"User lookup error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to look up user: {e}")


async def fetch_user_photo(user: str) -> tuple[bytes, str] | None:
    """Fetch a user's profile photo bytes from Graph (app-only User.Read.All).

    `user` is an email/UPN or id. Returns (bytes, content_type) or None when the
    user has no photo or the call fails — the frontend then shows initials.

    Server-side cached so a directory full of avatars hits Graph at most once per
    user per TTL, with a concurrency cap so a render burst doesn't get throttled.
    A genuine 404 ("no photo") is cached as a negative; transient errors (429/5xx/
    timeout) are NOT cached, so a throttled face recovers on a later request.
    """
    from urllib.parse import quote

    key = user.strip().lower()
    now = time.time()

    cached = _photo_cache.get(key)
    if cached and cached[2] > now:
        bytes_, ctype, _ = cached
        return (bytes_, ctype) if bytes_ is not None else None

    url = f"{GRAPH_BASE}/users/{quote(user.strip())}/photo/$value"
    try:
        async with _photo_semaphore:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.get(
                    url, headers={"Authorization": f"Bearer {_app_token()}"}
                )
    except Exception:
        return None  # transient (timeout/network) — don't cache, let it retry

    if resp.status_code == 200 and resp.content:
        ctype = resp.headers.get("content-type", "image/jpeg")
        _photo_cache_put(key, (resp.content, ctype, now + _PHOTO_POS_TTL))
        return resp.content, ctype

    if resp.status_code == 404:
        # User genuinely has no photo — remember it so we stop asking Graph.
        _photo_cache_put(key, (None, "", now + _PHOTO_NEG_TTL))
        return None

    # 429 / 5xx / other — transient or throttled; don't poison the cache.
    return None


def _photo_cache_put(key: str, value: tuple[bytes | None, str, float]) -> None:
    if len(_photo_cache) >= _PHOTO_CACHE_MAX:
        _photo_cache.clear()  # cheap bounded-size guard
    _photo_cache[key] = value


async def fetch_user_manager(user: str) -> dict:
    """Fetch a user's manager (app-only User.Read.All). `user` is an email/UPN or id."""
    from urllib.parse import quote
    url = f"{GRAPH_BASE}/users/{quote(user.strip())}/manager"
    params = {"$select": "id,displayName,mail,jobTitle,department"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(_app_token()), params=params)
            resp.raise_for_status()
            m = resp.json()
        return {
            "success": True,
            "manager": {
                "name": m.get("displayName", ""),
                "email": (m.get("mail") or "").lower(),
                "job_title": m.get("jobTitle", ""),
                "department": m.get("department", ""),
            },
        }
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return {"success": True, "manager": None}  # top of the chain / no manager set
        return _error(f"Manager lookup error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch manager: {e}")


async def fetch_user_direct_reports(user: str) -> dict:
    """Fetch a user's direct reports (app-only User.Read.All). `user` is an email/UPN or id."""
    from urllib.parse import quote
    url = f"{GRAPH_BASE}/users/{quote(user.strip())}/directReports"
    params = {"$select": "id,displayName,mail,jobTitle,department"}
    try:
        reports = []
        token = _app_token()
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            while url:
                resp = await client.get(url, headers=_headers(token), params=params)
                resp.raise_for_status()
                data = resp.json()
                for r in data.get("value", []):
                    reports.append({
                        "name": r.get("displayName", ""),
                        "email": (r.get("mail") or "").lower(),
                        "job_title": r.get("jobTitle", ""),
                        "department": r.get("department", ""),
                    })
                url = data.get("@odata.nextLink")
                params = {}
        return {"success": True, "count": len(reports), "reports": reports}
    except httpx.HTTPStatusError as e:
        return _error(f"Direct reports error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch direct reports: {e}")


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


async def fetch_unread_since(token: str, since_iso: str, top: int = 10) -> dict:
    """Fetch unread inbox emails received at/after ``since_iso`` (UTC ISO datetime).

    Used by the proactive nudge scanner to surface "new mail" notifications without
    re-flagging mail the user has already seen in a prior scan window.
    """
    url = f"{GRAPH_BASE}/me/mailFolders/inbox/messages"
    params = {
        "$top": str(min(top, 25)),
        "$select": "id,subject,from,receivedDateTime",
        "$orderby": "receivedDateTime desc",
        "$filter": f"isRead eq false and receivedDateTime ge {since_iso}",
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
                "id": m.get("id"),
                "subject": m.get("subject", "(no subject)"),
                "from_name": sender.get("name", ""),
                "received": m.get("receivedDateTime", ""),
            })
        return {"success": True, "count": len(emails), "emails": emails}

    except httpx.HTTPStatusError as e:
        return _error(f"Graph API error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch unread mail: {e}")


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


async def create_group_chat(token: str, topic: str, member_emails: list[str]) -> dict:
    """Create a group chat in Microsoft Teams with the given members.

    The calling user is added as the owner automatically by Graph.
    member_emails: list of member UPNs / email addresses.
    """
    url = f"{GRAPH_BASE}/chats"
    # The caller is implicitly the owner via the delegated token; Graph still requires
    # the owner to appear in the members array with roles=["owner"].
    members: list[dict] = [
        {
            "@odata.type": "#microsoft.graph.aadUserConversationMember",
            "roles": ["owner"],
            "user@odata.bind": "https://graph.microsoft.com/v1.0/me",
        }
    ]
    for email in member_emails:
        members.append({
            "@odata.type": "#microsoft.graph.aadUserConversationMember",
            "roles": [],
            "user@odata.bind": f"https://graph.microsoft.com/v1.0/users/{email.strip()}",
        })

    payload = {"chatType": "group", "topic": topic, "members": members}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=_headers(token), json=payload)
            resp.raise_for_status()
            data = resp.json()
        return {
            "success": True,
            "chat_id": data.get("id"),
            "topic": topic,
            "member_count": len(member_emails),
        }
    except httpx.HTTPStatusError as e:
        return _error(f"Group chat creation failed: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to create group chat: {e}")


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


# Full profile field set, available with User.Read.All. $expand pulls the
# manager in the same request so no per-user round-trip is needed.
USER_SELECT = (
    "id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,"
    "employeeId,employeeType,companyName,mobilePhone,businessPhones,"
    "city,state,country,accountEnabled,employeeHireDate"
)
USER_EXPAND = "manager($select=displayName,mail)"
# For the org-user LIST query, the manager must be expanded with `$levels` — Graph
# requires it when $expand=manager is combined with the advanced query ($count +
# endsWith) that filters the directory to the company domain. $levels=1 keeps it to
# the direct manager (no transitive chain). This pulls managers inline, avoiding the
# per-user /manager lookups that Graph throttles hard at org scale.
USER_LIST_EXPAND = "manager($levels=1;$select=id,displayName,mail)"


def _parse_graph_dt(value: str | None):
    """Parse a Graph ISO-8601 timestamp (e.g. employeeHireDate) to a datetime, or None."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _normalize_user_row(u: dict) -> dict | None:
    """Map a Graph /users object (optionally with expanded manager) to an
    ms365_users row dict. Returns None for accounts that lack an id or look
    non-human. Does not set synced_at (caller stamps it)."""
    azure_id = u.get("id", "")
    if not azure_id:
        return None
    email = (u.get("mail") or u.get("userPrincipalName") or "").lower()
    name = u.get("displayName", "")
    if _is_non_human(name, email):
        return None
    phones = u.get("businessPhones") or []
    mgr = u.get("manager") or {}
    return {
        "azure_id": azure_id,
        "email": email,
        "name": name,
        "job_title": u.get("jobTitle") or "",
        "department": u.get("department") or "",
        "office_location": u.get("officeLocation") or "",
        "employee_id": u.get("employeeId") or "",
        "employee_type": u.get("employeeType") or "",
        "company_name": u.get("companyName") or "",
        "mobile_phone": u.get("mobilePhone") or "",
        "business_phone": (phones[0] if phones else "") or "",
        "city": u.get("city") or "",
        "state": u.get("state") or "",
        "country": u.get("country") or "",
        "account_enabled": u.get("accountEnabled"),
        "hire_date": _parse_graph_dt(u.get("employeeHireDate")),
        "manager_email": (mgr.get("mail") or "").lower(),
        "manager_name": mgr.get("displayName") or "",
    }


# Columns updated on conflict during upsert (everything except the PK/azure_id).
_MS365_UPSERT_COLS = (
    "email", "name", "job_title", "department", "office_location",
    "employee_id", "employee_type", "company_name", "mobile_phone",
    "business_phone", "city", "state", "country", "account_enabled",
    "hire_date", "manager_email", "manager_name", "synced_at",
)


async def fetch_org_users(top: int = 100) -> dict:
    """Fetch org users whose mail is on the company domain, filtered server-side.

    App-only (application User.Read.All). Uses Graph advanced query
    (`$filter=endsWith(...)` + `$count=true` + `ConsistencyLevel: eventual`) so the
    directory's tens of thousands of guest/resource objects are never paginated
    client-side.
    """
    token = _app_token()
    url = f"{GRAPH_BASE}/users"
    # Advanced domain filter with the manager expanded inline via $levels (see
    # sync_users_to_db) — managers come back with each user, no per-user lookups.
    params = {
        "$select": USER_SELECT,
        "$expand": USER_LIST_EXPAND,
        "$filter": f"accountEnabled eq true and endsWith(mail,'{_ORG_MAIL_DOMAIN}')",
        "$count": "true",
        "$top": str(min(top, 999)),
    }
    headers = _headers(token, {"ConsistencyLevel": "eventual"})
    try:
        users = []
        async with httpx.AsyncClient(timeout=60.0) as client:
            while url:
                resp = await client.get(url, headers=headers, params=params)
                resp.raise_for_status()
                data = resp.json()
                for u in data.get("value", []):
                    row = _normalize_user_row(u)
                    if row is None:
                        continue
                    users.append({
                        "name": row["name"],
                        "email": row["email"],
                        "job_title": row["job_title"],
                        "department": row["department"],
                        "office": row["office_location"],
                        "manager_email": row["manager_email"],
                        "manager_name": row["manager_name"],
                    })
                url = data.get("@odata.nextLink")
                params = {}  # nextLink already has params baked in
        return {"success": True, "count": len(users), "users": users}
    except httpx.HTTPStatusError as e:
        return _error(f"Users list error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch org users: {e}")


async def sync_users_to_db(limit: int = 0) -> dict:
    """Fetch company-domain users from Azure AD and upsert into ms365_users per page.

    Commits each page immediately so progress is never lost if Graph throttles or
    the process dies mid-way. Under heavy throttling a page retries up to 8 times
    then gives up and commits what it has (partial=True in the result).
    """
    import httpx as _httpx
    from app.database import SessionLocal
    from app.models import MS365User
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    import datetime as _dt
    import asyncio

    cap = limit if (limit and limit > 0) else 100_000
    token = _app_token()
    url = f"{GRAPH_BASE}/users"
    params = {
        "$select": USER_SELECT,
        "$expand": USER_LIST_EXPAND,
        "$filter": f"accountEnabled eq true and endsWith(mail,'{_ORG_MAIL_DOMAIN}')",
        "$count": "true",
        "$top": str(min(cap, 999)),
    }
    headers = _headers(token, {"ConsistencyLevel": "eventual"})

    total_synced = 0
    pages = 0
    throttled_out = False
    _MAX_429_PER_PAGE = 8

    db = SessionLocal()
    try:
        async with _httpx.AsyncClient(timeout=90.0) as client:
            while url and total_synced < cap:
                retries = 0
                resp = await client.get(url, headers=headers, params=params)
                while resp.status_code == 429:
                    retries += 1
                    if retries > _MAX_429_PER_PAGE:
                        throttled_out = True
                        break
                    await asyncio.sleep(min(int(resp.headers.get("Retry-After", 5)), 20))
                    resp = await client.get(url, headers=headers, params=params)
                if throttled_out:
                    break
                resp.raise_for_status()
                data = resp.json()
                pages += 1

                now = _dt.datetime.utcnow()
                batch: list[dict] = []
                for u in data.get("value", []):
                    row = _normalize_user_row(u)
                    if row is None:
                        continue
                    row["synced_at"] = now
                    batch.append(row)

                if batch:
                    stmt = pg_insert(MS365User).values(batch)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["azure_id"],
                        set_={col: getattr(stmt.excluded, col) for col in _MS365_UPSERT_COLS},
                    )
                    db.execute(stmt)
                    db.commit()
                    total_synced += len(batch)

                url = data.get("@odata.nextLink")
                params = {}
    except _httpx.HTTPStatusError as e:
        db.rollback()
        return _error(f"Sync error fetching users: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        db.rollback()
        return _error(f"Sync error: {e}")
    finally:
        db.close()

    return {
        "success": True,
        "synced": total_synced,
        "total_fetched": total_synced,
        "pages": pages,
        "partial": throttled_out,
    }


async def resolve_missing_managers() -> int:
    """Fetch manager rows referenced in ms365_users but not yet stored there.

    After a (possibly partial) sync, users have manager_email pointing to people
    not yet in the DB, breaking the tree into many false roots. This resolves each
    missing manager with a single lightweight /users/{email} Graph call (no
    pagination, no advanced query) so the org tree has no broken links.
    """
    from app.database import SessionLocal
    from app.models import MS365User
    from sqlalchemy import text
    import datetime as _dt
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    import asyncio

    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT DISTINCT manager_email
            FROM ms365_users
            WHERE manager_email != ''
              AND NOT EXISTS (
                SELECT 1 FROM ms365_users u WHERE u.email = manager_email
              )
        """))
        missing = [row[0] for row in result if row[0]]
    except Exception:
        missing = []
    finally:
        db.close()

    if not missing:
        return 0

    fetched = 0
    for email in missing:
        res = await fetch_user_by_email(email)
        if not res.get("success"):
            continue
        user_row = res.get("user")
        if not user_row:
            continue
        user_row["synced_at"] = _dt.datetime.utcnow()
        db = SessionLocal()
        try:
            stmt = pg_insert(MS365User).values([user_row])
            stmt = stmt.on_conflict_do_update(
                index_elements=["azure_id"],
                set_={col: getattr(stmt.excluded, col) for col in _MS365_UPSERT_COLS},
            )
            db.execute(stmt)
            db.commit()
            fetched += 1
        except Exception:
            db.rollback()
        finally:
            db.close()
        await asyncio.sleep(0.15)  # gentle pacing — single-user calls, but still app token

    return fetched


async def _cleanup_non_human_rows() -> int:
    """Delete ms365_users rows that the non-human heuristic flags.

    Old syncs ran before _is_non_human was wired into _normalize_user_row; this
    purge evicts conference rooms, shared mailboxes, and service accounts that
    snuck in.
    """
    from app.database import SessionLocal
    from app.models import MS365User

    db = SessionLocal()
    try:
        rows = db.query(MS365User.azure_id, MS365User.name, MS365User.email).all()
        to_delete = [r.azure_id for r in rows if _is_non_human(r.name or "", r.email or "")]
        if to_delete:
            db.query(MS365User).filter(
                MS365User.azure_id.in_(to_delete)
            ).delete(synchronize_session=False)
            db.commit()
        return len(to_delete)
    except Exception:
        db.rollback()
        return 0
    finally:
        db.close()


# ── Background sync orchestration ────────────────────────────────────────────
# A full org sync (~1.1k users) spends 1-2 min resolving managers because Graph
# throttles per-user /manager lookups; running it inline would time out the HTTP
# client. So the route launches run_sync_background() and the UI polls status.
_sync_status: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "synced": 0,
    "error": None,
}


def get_sync_status() -> dict:
    """Current background-sync state plus live directory totals from the DB."""
    from app.database import SessionLocal
    from app.models import MS365User
    from sqlalchemy import func

    db = SessionLocal()
    try:
        total = db.query(MS365User).count()
        with_mgr = db.query(MS365User).filter(MS365User.manager_email != "").count()
        latest = db.query(func.max(MS365User.synced_at)).scalar()
    finally:
        db.close()
    return {
        **_sync_status,
        "started_at": _sync_status["started_at"].isoformat() if _sync_status["started_at"] else None,
        "finished_at": _sync_status["finished_at"].isoformat() if _sync_status["finished_at"] else None,
        "db_count": total,
        "db_with_manager": with_mgr,
        "last_synced_at": latest.isoformat() if latest else None,
    }


async def run_sync_background(limit: int = 0) -> None:
    """Run the full sync pipeline: paginated user fetch → non-human cleanup → missing-manager resolution.
    Idempotent: a second call while one is running is a no-op."""
    import datetime as _dt

    if _sync_status["running"]:
        return
    _sync_status.update(
        running=True, error=None, synced=0,
        started_at=_dt.datetime.utcnow(), finished_at=None,
    )
    try:
        result = await sync_users_to_db(limit=limit)
        if result.get("success"):
            _sync_status["synced"] = result.get("synced", 0)
            # Remove conference rooms / service accounts that slipped in from old syncs.
            await _cleanup_non_human_rows()
            # Fetch referenced managers not yet in the DB so the tree has no broken links.
            extra = await resolve_missing_managers()
            if extra:
                _sync_status["synced"] += extra
            # Wire employees.manager_id from Zoho reporting hierarchy.
            try:
                from app.services.manager_service import rewire_manager_hierarchy
                wire_result = rewire_manager_hierarchy()
                _sync_status["manager_hierarchy_wired"] = (
                    wire_result.get("linked_from_zoho_email", 0)
                    + wire_result.get("linked_from_zoho_name", 0)
                )
            except Exception as _we:
                _sync_status["manager_hierarchy_error"] = str(_we)
        else:
            _sync_status["error"] = result.get("error", "sync failed")
    except Exception as e:
        _sync_status["error"] = str(e)
    finally:
        _sync_status["running"] = False
        _sync_status["finished_at"] = _dt.datetime.utcnow()


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
