"""
Yammer / Viva Engage REST API service.

Uses the delegated user_impersonation token to call Yammer on behalf of the user.
Base URL: https://www.yammer.com/api/v1/
"""

import logging

import httpx

log = logging.getLogger("aurora-logger")

YAMMER_BASE = "https://www.yammer.com/api/v1"
_TIMEOUT = 15.0


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _error(msg: str, status: int | None = None) -> dict:
    log.warning("[yammer] %s (status=%s)", msg, status)
    if status == 401:
        return {
            "success": False,
            "error": "Your Yammer session has expired. Please reconnect your Microsoft account in Settings > Connected Accounts.",
        }
    return {"success": False, "error": msg}


def _parse_message(m: dict) -> dict:
    """Extract key fields from a Yammer message object."""
    sender = m.get("sender", {})
    body = m.get("body", {})
    return {
        "id": m.get("id"),
        "text": (body.get("plain") or body.get("parsed") or "")[:500],
        "sender_name": sender.get("full_name", ""),
        "sender_email": sender.get("email", ""),
        "created_at": m.get("created_at", ""),
        "likes": m.get("liked_by", {}).get("count", 0),
        "group_name": m.get("group", {}).get("full_name", ""),
        "thread_id": m.get("thread_id"),
        "web_url": m.get("web_url", ""),
    }


# -- Feed ---------------------------------------------------------------------

async def fetch_my_feed(token: str, top: int = 20) -> dict:
    """Fetch the user's Yammer home feed."""
    url = f"{YAMMER_BASE}/messages/my_feed.json"
    params = {"limit": str(min(top, 50))}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        messages = [_parse_message(m) for m in data.get("messages", [])]
        return {"success": True, "count": len(messages), "messages": messages}

    except httpx.HTTPStatusError as e:
        return _error(f"Yammer feed error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch Yammer feed: {e}")


# -- Communities (Groups) -----------------------------------------------------

async def fetch_my_communities(token: str) -> dict:
    """Fetch communities the user belongs to."""
    url = f"{YAMMER_BASE}/groups.json"
    params = {"mine": "1"}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            groups = resp.json()

        communities = []
        for g in groups:
            communities.append({
                "id": g.get("id"),
                "name": g.get("full_name", ""),
                "description": (g.get("description") or "")[:200],
                "member_count": g.get("stats", {}).get("members", 0),
                "web_url": g.get("web_url", ""),
            })
        return {"success": True, "count": len(communities), "communities": communities}

    except httpx.HTTPStatusError as e:
        return _error(f"Yammer communities error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch communities: {e}")


# -- Community Messages -------------------------------------------------------

async def fetch_community_messages(token: str, group_id: int, top: int = 20) -> dict:
    """Fetch recent messages from a specific community."""
    url = f"{YAMMER_BASE}/messages/in_group/{group_id}.json"
    params = {"limit": str(min(top, 50))}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        messages = [_parse_message(m) for m in data.get("messages", [])]
        return {"success": True, "count": len(messages), "messages": messages}

    except httpx.HTTPStatusError as e:
        return _error(f"Yammer group messages error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch community messages: {e}")


async def search_messages(token: str, query: str, top: int = 15) -> dict:
    """Search across all Viva Engage (Yammer) communities for posts matching a query.

    Unlike my_feed, the search endpoint nests messages under data["messages"]["messages"].
    """
    url = f"{YAMMER_BASE}/search.json"
    params = {"search": query, "num_perpage": str(min(top, 20))}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        raw = (data.get("messages") or {}).get("messages", [])
        messages = [_parse_message(m) for m in raw]
        return {"success": True, "query": query, "count": len(messages), "messages": messages}

    except httpx.HTTPStatusError as e:
        return _error(f"Yammer search error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to search communities: {e}")


async def fetch_thread(token: str, thread_id: int, top: int = 20) -> dict:
    """Fetch all messages in a thread — the original post AND every reply/comment.

    On Viva Engage the answer to a question is usually in the replies, not the
    starter post, so callers should pull the whole thread to capture responses.
    """
    url = f"{YAMMER_BASE}/messages/in_thread/{thread_id}.json"
    params = {"limit": str(min(top, 50))}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers(token), params=params)
            resp.raise_for_status()
            data = resp.json()

        messages = [_parse_message(m) for m in data.get("messages", [])]
        # Yammer returns newest-first; show oldest-first so the question leads.
        messages.reverse()
        return {"success": True, "thread_id": thread_id, "count": len(messages), "messages": messages}

    except httpx.HTTPStatusError as e:
        return _error(f"Yammer thread error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to fetch thread: {e}")


async def search_with_replies(token: str, query: str, max_threads: int = 3, replies_per_thread: int = 20) -> dict:
    """Search communities, then expand the top matching threads to include replies/comments.

    Returns threads (question + responses) so the answer in a reply isn't missed.
    """
    base = await search_messages(token, query, top=20)
    if not base.get("success"):
        return base

    # Distinct thread IDs in match order (a post and its reply can both match).
    seen: list = []
    for m in base["messages"]:
        tid = m.get("thread_id")
        if tid and tid not in seen:
            seen.append(tid)
        if len(seen) >= max_threads:
            break

    threads = []
    for tid in seen:
        t = await fetch_thread(token, tid, top=replies_per_thread)
        posts = t.get("messages", []) if t.get("success") else []
        threads.append({"thread_id": tid, "post_count": len(posts), "posts": posts})

    return {
        "success": True,
        "query": query,
        "matches": base.get("count", 0),
        "thread_count": len(threads),
        "threads": threads,
    }


async def resolve_community_id(token: str, name: str) -> int | None:
    """Find a community ID by name (case-insensitive partial match)."""
    result = await fetch_my_communities(token)
    if not result.get("success"):
        return None
    name_lower = name.lower()
    for c in result["communities"]:
        if name_lower in (c.get("name") or "").lower():
            return c["id"]
    return None


# -- Post to Community --------------------------------------------------------

async def post_to_community(token: str, group_id: int, body: str) -> dict:
    """Post a message to a Yammer community."""
    url = f"{YAMMER_BASE}/messages.json"
    payload = {"group_id": group_id, "body": body}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, headers=_headers(token), json=payload)
            resp.raise_for_status()
            data = resp.json()

        msg = data.get("message", data)
        return {
            "success": True,
            "message": "Posted to community successfully.",
            "web_url": msg.get("web_url", ""),
        }

    except httpx.HTTPStatusError as e:
        return _error(f"Yammer post error: {e.response.text[:300]}", e.response.status_code)
    except Exception as e:
        return _error(f"Failed to post to community: {e}")
