"""
Udemy Business catalog & reporting API client.

Udemy Business exposes an Enterprise REST API rooted at
    https://{subdomain}.udemy.com/api-2.0/
authenticated with HTTP Basic auth using the org's API client id + secret
(``Authorization: Basic base64(client_id:client_secret)``). This is an
org-level *service* credential — there is no per-user OAuth flow, so unlike
TechElevate there is no connect/refresh-token dance: the credential lives in
``backend/.env`` and every call uses it.

Confirmed endpoints (Reporting API v2.0):
  GET /organizations/{org}/courses/list/            org content collection (search/browse)
  GET /organizations/{org}/courses/{id}/            single course detail
  GET /organizations/{org}/analytics/user-activity/ aggregated learner activity (admin)

This module is intentionally separate from ``udemy_service.py`` — that file
owns the PMO *license-request* workflow (request/approve/reject seats), which
is unrelated to the live catalog API here.
"""

import logging
import threading
import time

import httpx

from app.config import settings

log = logging.getLogger("aurora-logger")

# Trimmed course fields requested from the catalog — keep the payload small.
# NB: the *organization* courses/list endpoint uses different field names than
# the public affiliate API — `images` (dict), `instructors` (list of name
# strings), `level`, `num_lectures`, `estimated_content_length` (minutes). It
# does NOT expose rating / num_subscribers. (Verified against the live org API.)
_COURSE_FIELDS = (
    "title,url,headline,images,instructors,level,num_lectures,"
    "estimated_content_length,primary_category,primary_subcategory,"
    "locale,last_update_date"
)


def configured() -> bool:
    """True when an org credential is present and the feature is enabled."""
    return bool(
        settings.UDEMY_ENABLED
        and settings.UDEMY_CLIENT_ID
        and settings.UDEMY_CLIENT_SECRET
        and settings.UDEMY_ORG_ID
    )


def _auth() -> tuple[str, str]:
    # httpx encodes this as `Authorization: Basic base64(id:secret)`.
    return (settings.UDEMY_CLIENT_ID, settings.UDEMY_CLIENT_SECRET)


def _org_url(path: str) -> str:
    return f"{settings.UDEMY_API_BASE}/organizations/{settings.UDEMY_ORG_ID}{path}"


def _check(resp: httpx.Response, label: str) -> dict:
    if resp.status_code in (401, 403):
        # Bad/missing credential or the org lacks API access (Enterprise only).
        raise PermissionError("not_configured")
    if not resp.is_success:
        log.warning("[udemy] %s → %s %s", label, resp.status_code, resp.text[:200])
        resp.raise_for_status()
    return resp.json()


def _full_url(course: dict) -> str:
    """Build an absolute course URL from the relative `url` field."""
    rel = course.get("url") or ""
    if rel.startswith("http"):
        return rel
    return f"{settings.UDEMY_PORTAL_BASE}{rel}" if rel else settings.UDEMY_PORTAL_BASE


def _content_info(course: dict) -> str | None:
    """Render estimated_content_length (minutes) as e.g. '12.4 total hours'."""
    mins = course.get("estimated_content_length")
    if not mins:
        return None
    hours = mins / 60
    if hours >= 1:
        return f"{round(hours, 1)} total hours"
    return f"{int(mins)} min"


def _simplify(course: dict) -> dict:
    """Reduce a raw Udemy course object to the fields the UI/chat need.

    Field names match the *organization* courses/list endpoint (see _COURSE_FIELDS).
    `instructors` already comes back as a list of plain name strings.
    """
    images = course.get("images") or {}
    cat = (course.get("primary_category") or {}).get("title")
    sub = (course.get("primary_subcategory") or {}).get("title")
    return {
        "id": course.get("id"),
        "title": course.get("title"),
        "url": _full_url(course),
        "headline": course.get("headline"),
        "image": images.get("size_480x270") or images.get("size_240x135") or images.get("size_304x171"),
        "num_lectures": course.get("num_lectures"),
        "content_info": _content_info(course),
        "level": course.get("level"),
        "instructors": [i for i in (course.get("instructors") or []) if i],
        "category": cat,
        "subcategory": sub,
        "last_update_date": course.get("last_update_date"),
    }


# ── Catalog browse (live API) ────────────────────────────────────────────────

def _browse(page: int, page_size: int) -> dict:
    """Paginate the live course collection with full fields (incl. thumbnails)."""
    params = {
        "page": page,
        "page_size": max(1, min(page_size, 100)),
        "fields[course]": _COURSE_FIELDS,
    }
    with httpx.Client(timeout=25) as c:
        resp = c.get(_org_url("/courses/list/"), auth=_auth(), params=params)
    data = _check(resp, "courses/list")
    return {
        "count": data.get("count", 0),
        "page": page,
        "page_size": page_size,
        "results": [_simplify(r) for r in (data.get("results") or [])],
        "indexing": False,
    }


# ── Keyword search (client-side index) ───────────────────────────────────────
# The org courses/list endpoint ignores `search`/`category`/`ordering` — it only
# paginates the full collection (~28.7k courses). To support keyword search we
# build a lean in-memory index once and filter it. Lean = no `images`/`instructors`
# (those ~6x the payload), so search-result cards have no thumbnail; browse keeps
# full fields. Rebuilt in the background, daily.
_INDEX_FIELDS = (
    "title,url,headline,level,num_lectures,estimated_content_length,"
    "primary_category,primary_subcategory,last_update_date"
)
_INDEX_TTL = 24 * 3600          # rebuild at most once a day
_INDEX_MAX_PAGES = 400          # safety cap (~40k courses) — logged if hit

_index: list[dict] = []
_index_ready = False
_index_loading = False
_index_loaded_at = 0.0
_index_lock = threading.Lock()


def _build_index() -> None:
    global _index, _index_ready, _index_loading, _index_loaded_at
    try:
        items: list[dict] = []
        page = 1
        with httpx.Client(timeout=40) as c:
            while page <= _INDEX_MAX_PAGES:
                resp = c.get(_org_url("/courses/list/"), auth=_auth(),
                             params={"page": page, "page_size": 100, "fields[course]": _INDEX_FIELDS})
                data = _check(resp, f"index/list p{page}")
                results = data.get("results") or []
                if not results:
                    break
                items.extend(_simplify(r) for r in results)
                if not data.get("next"):
                    break
                page += 1
        with _index_lock:
            _index = items
            _index_ready = True
            _index_loaded_at = time.time()
        if page > _INDEX_MAX_PAGES:
            log.warning("[udemy] search index hit %d-page cap — catalog truncated at %d courses",
                        _INDEX_MAX_PAGES, len(items))
        else:
            log.info("[udemy] search index built: %d courses (%d pages)", len(items), page)
    except Exception as e:  # noqa: BLE001 — never let a background build crash the app
        log.warning("[udemy] search index build failed: %s", e)
    finally:
        with _index_lock:
            _index_loading = False


def _ensure_index() -> None:
    """Kick a background index (re)build if missing or stale. Non-blocking."""
    global _index_loading
    if not configured():
        return
    with _index_lock:
        fresh = _index_ready and (time.time() - _index_loaded_at) < _INDEX_TTL
        if fresh or _index_loading:
            return
        _index_loading = True
    threading.Thread(target=_build_index, name="udemy-index", daemon=True).start()


def index_status() -> dict:
    """Readiness + size of the search index (for /status and warm-up)."""
    _ensure_index()
    with _index_lock:
        return {"ready": _index_ready, "count": len(_index), "loading": _index_loading}


def _matches(course: dict, terms: list[str]) -> bool:
    hay = " ".join(filter(None, [
        course.get("title"), course.get("headline"),
        course.get("category"), course.get("subcategory"),
    ])).lower()
    return all(t in hay for t in terms)


def search_courses(query: str = "", *, page: int = 1, page_size: int = 12) -> dict:
    """Browse (blank query → live API w/ thumbnails) or keyword-search the catalog
    (non-blank query → filter the in-memory index). Returns
    {count, page, page_size, results, indexing}.
    """
    if not (query or "").strip():
        return _browse(page, page_size)

    _ensure_index()
    with _index_lock:
        idx = _index
        ready = _index_ready
    terms = [t for t in query.lower().split() if t]
    matches = [c for c in idx if _matches(c, terms)] if terms else []
    start = (page - 1) * page_size
    return {
        "count": len(matches),
        "page": page,
        "page_size": page_size,
        "results": matches[start:start + page_size],
        # True when the index isn't built yet — caller should say "still indexing".
        "indexing": not ready,
    }


def get_course(course_id: int) -> dict:
    """GET /organizations/{org}/courses/{id}/ — single course detail."""
    with httpx.Client(timeout=20) as c:
        resp = c.get(_org_url(f"/courses/{course_id}/"), auth=_auth(),
                     params={"fields[course]": _COURSE_FIELDS})
    return _simplify(_check(resp, f"courses/{course_id}"))


# ── Reporting (admin) ────────────────────────────────────────────────────────

def get_user_activity(*, page: int = 1, page_size: int = 100) -> dict:
    """GET /organizations/{org}/analytics/user-activity/ — aggregated learner
    activity (minutes consumed, courses started/completed). Admin-only view.
    """
    with httpx.Client(timeout=30) as c:
        resp = c.get(_org_url("/analytics/user-activity/"), auth=_auth(),
                     params={"page": page, "page_size": max(1, min(page_size, 100))})
    return _check(resp, "analytics/user-activity")


# ── Chat helper ──────────────────────────────────────────────────────────────

def format_courses_markdown(query: str, courses: list[dict], *, limit: int = 5) -> str:
    """Render a short, display-ready course list for the assistant (passthrough)."""
    if not courses:
        return (
            f"I couldn't find any Udemy Business courses matching **{query}**. "
            "Try a broader topic, or I can raise a Udemy license request to the PMO team."
        )
    lines = [f"Here are Udemy Business courses for **{query}**:\n"]
    for c in courses[:limit]:
        bits = []
        if c.get("level"):
            bits.append(c["level"])
        if c.get("content_info"):
            bits.append(c["content_info"])
        if c.get("rating"):
            bits.append(f"★ {round(float(c['rating']), 1)}")
        meta = " · ".join(bits)
        title = c.get("title") or "Untitled course"
        url = c.get("url")
        head = f"- **[{title}]({url})**" if url else f"- **{title}**"
        if meta:
            head += f" — {meta}"
        lines.append(head)
        if c.get("headline"):
            lines.append(f"  {c['headline']}")
    lines.append("\nWant a company-paid seat for any of these? Just ask and I'll raise a Udemy license request to the PMO team.")
    return "\n".join(lines)
