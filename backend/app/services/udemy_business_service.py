"""
Udemy Business catalog, reporting, and skill-sync API client.

Udemy Business exposes an Enterprise REST API rooted at
    https://{subdomain}.udemy.com/api-2.0/
authenticated with HTTP Basic auth using the org's API client id + secret
(``Authorization: Basic base64(client_id:client_secret)``). This is an
org-level *service* credential — there is no per-user OAuth flow, so unlike
TechElevate there is no connect/refresh-token dance: the credential lives in
``backend/.env`` and every call uses it.

Confirmed endpoints (Reporting API v2.0):
  GET /organizations/{org}/courses/list/                      org content collection (search/browse)
  GET /organizations/{org}/courses/{id}/                      single course detail
  GET /organizations/{org}/analytics/user-activity/           aggregated learner activity (admin)
  GET /organizations/{org}/analytics/user-course-activity/    per-user per-course breakdown (admin)
  GET /organizations/{org}/analytics/user-progress/           completion events; accepts from_date=YYYY-MM-DD

This module is intentionally separate from ``udemy_service.py`` — that file
owns the PMO *license-request* workflow (request/approve/reject seats), which
is unrelated to the live catalog API here.
"""

import datetime
import json
import logging
import os
import threading
import time

import httpx
from sqlalchemy.orm import Session

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

# Persist the index to disk so searches are instant after a server restart.
_INDEX_CACHE_PATH = os.path.join(os.path.dirname(__file__), "../data/udemy_index_cache.json")

_index: list[dict] = []
_index_ready = False
_index_loading = False
_index_loaded_at = 0.0
_index_lock = threading.Lock()


def _save_index_cache(items: list[dict], built_at: float) -> None:
    try:
        os.makedirs(os.path.dirname(_INDEX_CACHE_PATH), exist_ok=True)
        with open(_INDEX_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump({"built_at": built_at, "items": items}, f)
        log.info("[udemy] index cache saved: %d courses → %s", len(items), _INDEX_CACHE_PATH)
    except Exception as e:
        log.warning("[udemy] failed to save index cache: %s", e)


def _load_index_cache() -> tuple[list[dict], float] | None:
    """Load the on-disk cache if it exists and is not stale. Returns (items, built_at) or None."""
    try:
        if not os.path.exists(_INDEX_CACHE_PATH):
            return None
        with open(_INDEX_CACHE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        built_at = float(data.get("built_at", 0))
        if (time.time() - built_at) > _INDEX_TTL:
            return None  # stale — will be rebuilt in the background
        items = data.get("items") or []
        log.info("[udemy] index cache loaded: %d courses (age %.0fh)",
                 len(items), (time.time() - built_at) / 3600)
        return items, built_at
    except Exception as e:
        log.warning("[udemy] failed to load index cache: %s", e)
        return None


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
        now = time.time()
        with _index_lock:
            _index = items
            _index_ready = True
            _index_loaded_at = now
        _save_index_cache(items, now)
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
    """Load from disk cache if available (instant), then kick a background rebuild if stale."""
    global _index, _index_ready, _index_loading, _index_loaded_at
    if not configured():
        return
    with _index_lock:
        fresh = _index_ready and (time.time() - _index_loaded_at) < _INDEX_TTL
        if fresh or _index_loading:
            return
        # Try loading from disk before starting a network rebuild.
        cached = _load_index_cache()
        if cached:
            _index, _index_loaded_at = cached
            _index_ready = True
            return  # fresh enough — no rebuild needed
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


# ── Inactive-seat detection (read-only) ───────────────────────────────────────
# Paginate the user-activity report, derive each learner's idle days from
# `last_date_visit`, and surface anyone past a threshold so PMO/HR can manually
# deactivate the seat in Udemy admin. We do NOT revoke automatically — the actual
# deactivation lives in Udemy (and ultimately Entra/SCIM). Read-only throughout.
#
# The report is ~860 learners (~9 pages of 100), so the full pull is cached for
# _ACTIVITY_TTL; idle days are recomputed against "today" on every request from
# the cached `last_date_visit`, so the threshold can change without a refetch.

_activity_cache: list[dict] = []
_activity_built_at: float = 0.0
_activity_lock = threading.Lock()
_ACTIVITY_TTL = 3600  # 1 hour


def _parse_date(value) -> datetime.date | None:
    """Parse 'YYYY-MM-DD' (or an ISO timestamp) to a date; None on blank/garbage."""
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return datetime.date.fromisoformat(s[:10])
    except ValueError:
        return None


def _fetch_all_user_activity() -> list[dict]:
    """Paginate the full user-activity report into normalized per-learner rows."""
    rows: list[dict] = []
    page = 1
    with httpx.Client(timeout=40) as c:
        while True:
            resp = c.get(_org_url("/analytics/user-activity/"), auth=_auth(),
                         params={"page": page, "page_size": 100})
            data = _check(resp, f"user-activity p{page}")
            results = data.get("results") or []
            if not results:
                break
            for r in results:
                first = (r.get("user_name") or "").strip()
                last = (r.get("user_surname") or "").strip()
                rows.append({
                    "name": (f"{first} {last}").strip() or (r.get("user_email") or ""),
                    "email": (r.get("user_email") or "").strip(),
                    "role": r.get("user_role") or "",
                    "joined_date": r.get("user_joined_date") or "",
                    "last_date_visit": r.get("last_date_visit") or "",
                    "is_deactivated": bool(r.get("user_is_deactivated")),
                    "video_minutes": float(r.get("num_video_consumed_minutes") or 0),
                    "web_visited_days": int(r.get("num_web_visited_days") or 0),
                    "completed_courses": int(r.get("num_completed_courses") or 0),
                })
            if not data.get("next"):
                break
            page += 1
    return rows


def _ensure_activity_cache() -> list[dict]:
    global _activity_cache, _activity_built_at
    with _activity_lock:
        fresh = _activity_cache and (time.time() - _activity_built_at) < _ACTIVITY_TTL
        if fresh:
            return _activity_cache
    rows = _fetch_all_user_activity()
    with _activity_lock:
        _activity_cache = rows
        _activity_built_at = time.time()
    return rows


# Email → {id, role, groups} from /users/list/ (the user-activity report omits the
# numeric id and group membership). Cached alongside the activity pull so per-user
# admin deep-links resolve and groups/roles can be shown.
_user_dir_map: dict[str, dict] = {}
_user_dir_built_at: float = 0.0


def _fetch_user_directory() -> dict[str, dict]:
    """Paginate /organizations/{org}/users/list/ into email→{id, role, groups}."""
    mapping: dict[str, dict] = {}
    page = 1
    with httpx.Client(timeout=40) as c:
        while True:
            resp = c.get(_org_url("/users/list/"), auth=_auth(),
                         params={"page": page, "page_size": 100})
            data = _check(resp, f"users/list p{page}")
            results = data.get("results") or []
            if not results:
                break
            for r in results:
                email = (r.get("email") or "").strip().lower()
                uid = r.get("id")
                if email and uid:
                    mapping[email] = {
                        "id": int(uid),
                        "role": r.get("role") or "",
                        "groups": [g for g in (r.get("groups") or []) if g],
                    }
            if not data.get("next"):
                break
            page += 1
    return mapping


def _ensure_user_directory() -> dict[str, dict]:
    global _user_dir_map, _user_dir_built_at
    with _activity_lock:
        fresh = _user_dir_map and (time.time() - _user_dir_built_at) < _ACTIVITY_TTL
        if fresh:
            return _user_dir_map
    try:
        mapping = _fetch_user_directory()
    except Exception as exc:  # non-fatal: links fall back to the list page, no groups
        log.warning("[udemy] users/list directory fetch failed: %s", exc)
        return dict(_user_dir_map)
    with _activity_lock:
        _user_dir_map = mapping
        _user_dir_built_at = time.time()
    return mapping


# PMO-managed seat ledger, disk-persisted so it survives restarts and needs no env
# edit. Env (UDEMY_LICENSE_TOTAL / _AVAILABLE) is only the initial seed until PMO
# saves once; thereafter the file is authoritative.
_LICENSE_CFG_PATH = os.path.join(os.path.dirname(__file__), "../data/udemy_license_config.json")
_license_cfg_lock = threading.Lock()


def get_license_config() -> dict:
    """PMO-managed Udemy portal settings: {purchased, available, inactive_days,
    updated_by, updated_at}. Reads the PMO-saved file; falls back to env seeds until
    PMO sets them the first time."""
    seed = {
        "purchased": settings.UDEMY_LICENSE_TOTAL or None,
        "available": (settings.UDEMY_LICENSE_AVAILABLE
                      if settings.UDEMY_LICENSE_AVAILABLE is not None and settings.UDEMY_LICENSE_AVAILABLE >= 0
                      else None),
        "inactive_days": settings.UDEMY_INACTIVE_DEFAULT_DAYS,
        "updated_by": None,
        "updated_at": None,  # None signals "never set by PMO — still on env seed"
    }
    try:
        if os.path.exists(_LICENSE_CFG_PATH):
            with open(_LICENSE_CFG_PATH, encoding="utf-8") as f:
                data = json.load(f)
            return {
                "purchased": data.get("purchased"),
                "available": data.get("available"),
                # default threshold persists too; fall back to the env seed if absent
                "inactive_days": data.get("inactive_days") or seed["inactive_days"],
                "updated_by": data.get("updated_by"),
                "updated_at": data.get("updated_at"),
            }
    except Exception as e:
        log.warning("[udemy] license config read failed: %s", e)
    return seed


def get_inactive_default_days() -> int:
    """The PMO-set org-default idle threshold (falls back to the env seed = 30)."""
    try:
        d = int(get_license_config().get("inactive_days") or settings.UDEMY_INACTIVE_DEFAULT_DAYS)
        return d if d >= 1 else settings.UDEMY_INACTIVE_DEFAULT_DAYS
    except (TypeError, ValueError):
        return settings.UDEMY_INACTIVE_DEFAULT_DAYS


def set_license_config(*, purchased, available, inactive_days=None, updated_by: str) -> dict:
    """Persist PMO-set Udemy settings. None leaves seat counts cleared; inactive_days
    falls back to the current/seed default when not provided."""
    current = get_license_config()
    days = inactive_days if inactive_days not in (None, "") else current.get("inactive_days")
    cfg = {
        "purchased": int(purchased) if purchased not in (None, "") else None,
        "available": int(available) if available not in (None, "") else None,
        "inactive_days": int(days) if days not in (None, "") else settings.UDEMY_INACTIVE_DEFAULT_DAYS,
        "updated_by": updated_by or None,
        "updated_at": datetime.datetime.utcnow().isoformat(),
    }
    with _license_cfg_lock:
        os.makedirs(os.path.dirname(_LICENSE_CFG_PATH), exist_ok=True)
        with open(_LICENSE_CFG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f)
    log.info("[udemy] settings updated by %s: purchased=%s available=%s inactive_days=%s",
             updated_by, cfg["purchased"], cfg["available"], cfg["inactive_days"])
    return cfg


def get_license_summary() -> dict:
    """Seat ledger + activity context.

    The Reporting API can't reproduce Udemy's live seat count (pending invitations
    consume a seat but aren't readable, and the activity report's active flag isn't
    the billing figure), so ``purchased`` and ``available`` are PMO-set
    (``UDEMY_LICENSE_TOTAL`` / ``UDEMY_LICENSE_AVAILABLE``) from the Udemy dashboard
    and ``used`` is derived as purchased - available so the pills match Udemy. We
    still surface activity-report context (active/deactivated) for transparency.
    Read-only.
    """
    if not configured():
        return {"error": "not_configured"}

    rows = _ensure_activity_cache()
    deactivated = sum(1 for r in rows if r["is_deactivated"])
    active_in_report = len(rows) - deactivated

    cfg = get_license_config()
    purchased = cfg["purchased"]
    available = cfg["available"]
    used = (purchased - available) if (purchased is not None and available is not None) else None
    utilization = round(used / purchased * 100, 1) if (purchased and used is not None) else None

    return {
        "purchased": purchased,              # PMO-managed contracted total
        "available": available,              # PMO-managed from Udemy dashboard (incl. pending invites)
        "used": used,                        # purchased - available (Udemy-accurate)
        "utilization_pct": utilization,      # used / purchased %
        "active_in_report": active_in_report,  # context: active learners in the activity report
        "deactivated": deactivated,          # context: deactivated accounts in the report
        "provisioned": len(_ensure_user_directory()) or len(rows),  # full roster (/users/list)
        "inactive_days": cfg.get("inactive_days") or settings.UDEMY_INACTIVE_DEFAULT_DAYS,  # PMO default threshold
        "updated_by": cfg["updated_by"],     # who last set the ledger (None = still on env seed)
        "updated_at": cfg["updated_at"],
    }


def get_inactive_users(min_idle_days: int, *, include_deactivated: bool = False) -> dict:
    """Learners with no Udemy visit in >= ``min_idle_days`` days. Read-only.

    Returns {days, total_learners, count, results} where each result carries the
    learner's last-active date, idle days, a `never_visited` flag, and a
    `manage_url` deep-link to the Udemy admin Manage Users page so PMO can
    deactivate the seat manually. Sorted longest-idle first.
    """
    if not configured():
        return {"error": "not_configured"}

    rows = _ensure_activity_cache()
    directory = _ensure_user_directory()
    today = datetime.date.today()
    list_url = settings.UDEMY_ADMIN_USERS_URL  # ends with '/'
    out: list[dict] = []

    for r in rows:
        if r["is_deactivated"] and not include_deactivated:
            continue
        last = _parse_date(r["last_date_visit"])
        joined = _parse_date(r["joined_date"])
        never = last is None
        # Idle measured from the last visit; for a learner who never visited, from
        # their join date (so a freshly-joined never-visitor isn't flagged yet).
        ref = last or joined
        if ref is None:
            continue  # no dates at all → can't judge idleness, skip
        idle_days = (today - ref).days
        if idle_days < min_idle_days:
            continue
        dir_entry = directory.get((r["email"] or "").lower()) or {}
        uid = dir_entry.get("id")
        # Link straight to the learner's detail page (which has the Deactivate
        # control); fall back to the searchable list if we couldn't resolve the id.
        manage_url = f"{list_url}detail/{uid}/" if uid else list_url
        out.append({
            "name": r["name"],
            "email": r["email"],
            "role": dir_entry.get("role") or r["role"],
            "groups": dir_entry.get("groups") or [],
            "udemy_user_id": uid,
            "last_active": last.isoformat() if last else None,
            "joined_date": joined.isoformat() if joined else None,
            "idle_days": idle_days,
            "never_visited": never,
            "video_minutes": round(r["video_minutes"], 1),
            "completed_courses": r["completed_courses"],
            "is_deactivated": r["is_deactivated"],
            "manage_url": manage_url,
        })

    out.sort(key=lambda x: x["idle_days"], reverse=True)
    return {
        "days": min_idle_days,
        "total_learners": len(rows),
        "count": len(out),
        "results": out,
    }


def get_user_course_activity(*, page: int = 1, page_size: int = 100) -> dict:
    """GET /organizations/{org}/analytics/user-course-activity/ — per-user,
    per-course breakdown: completion %, minutes consumed, completion date.
    """
    with httpx.Client(timeout=30) as c:
        resp = c.get(_org_url("/analytics/user-course-activity/"), auth=_auth(),
                     params={"page": page, "page_size": max(1, min(page_size, 100))})
    return _check(resp, "analytics/user-course-activity")


def get_user_progress(*, from_date: str | None = None, page: int = 1, page_size: int = 100) -> dict:
    """GET /organizations/{org}/analytics/user-progress/ — completion events per
    user, optionally filtered by from_date (YYYY-MM-DD). Verified: the API accepts
    this parameter (3-0 adversarial vote from immuta tap source code).
    """
    params: dict = {"page": page, "page_size": max(1, min(page_size, 100))}
    if from_date:
        params["from_date"] = from_date
    with httpx.Client(timeout=30) as c:
        resp = c.get(_org_url("/analytics/user-progress/"), auth=_auth(), params=params)
    return _check(resp, "analytics/user-progress")


# ── Skill sync ────────────────────────────────────────────────────────────────
# Pulls Udemy course completions via user-course-activity and writes verified
# EmployeeSkill rows.  Idempotent: guarded by the certification string
# "Udemy Business: {title}" — a row is never written twice for the same
# employee + course.  Skill tag is derived from the in-memory catalog index
# (subcategory → category); falls back to a sanitised course title slice.

_sync_state: dict = {"at": None, "added": 0, "skipped": 0, "errors": 0}

# ── Per-course org stats (cached aggregate of user-course-activity) ───────────
# Aggregated once and cached for _ORG_STATS_TTL seconds so detail panels are fast.
_org_stats_cache: dict = {}        # {course_id: {enrolled, completed, avg_completion_pct}}
_insights_cache: dict = {}         # high-level org learning insights (same pagination pass)
_org_stats_lock = threading.Lock()
_org_stats_built_at: float = 0.0
_ORG_STATS_TTL = 3600  # 1 hour


def _build_org_stats() -> None:
    """Paginate all user-course-activity and aggregate per-course org stats.
    Runs in the calling thread (called lazily, max once per TTL)."""
    global _org_stats_cache, _insights_cache, _org_stats_built_at
    if not configured():
        return
    agg: dict[int, dict] = {}  # course_id → {enrolled, completions, total_pct, title, category, minutes}
    cat_agg: dict[str, dict] = {}  # category → {enrolled, completed, minutes}
    learners: set = set()
    total_enrollments = 0
    total_completions = 0
    total_minutes = 0.0
    page = 1
    try:
        while True:
            try:
                data = get_user_course_activity(page=page, page_size=100)
            except Exception as exc:
                log.warning("[udemy-stats] page %d failed: %s", page, exc)
                break
            results = data.get("results") or []
            if not results:
                break
            for row in results:
                cid = row.get("course_id") or (row.get("course") or {}).get("id")
                if not cid:
                    continue
                cid = int(cid)
                # completion_ratio is 0..1 on this endpoint; older variants use 0..100.
                ratio = row.get("completion_ratio")
                if ratio is not None:
                    pct = float(ratio) * 100 if float(ratio) <= 1 else float(ratio)
                else:
                    pct = float(row.get("completion_percentage")
                                or row.get("percent_completed")
                                or row.get("progress_percent") or 0)
                completed = pct >= 100 or bool(
                    row.get("course_completion_date") or row.get("completion_time")
                    or row.get("completion_date") or row.get("completed_at")
                )
                minutes = float(row.get("num_video_consumed_minutes") or 0)
                category = (row.get("course_category") or "Uncategorized").strip() or "Uncategorized"

                if cid not in agg:
                    agg[cid] = {"enrolled": 0, "completed": 0, "total_pct": 0.0,
                                "title": row.get("course_title") or f"Course {cid}",
                                "category": category, "minutes": 0.0}
                agg[cid]["enrolled"] += 1
                agg[cid]["total_pct"] += pct
                agg[cid]["minutes"] += minutes
                if completed:
                    agg[cid]["completed"] += 1

                c = cat_agg.setdefault(category, {"enrolled": 0, "completed": 0, "minutes": 0.0})
                c["enrolled"] += 1
                c["minutes"] += minutes
                if completed:
                    c["completed"] += 1

                email = (row.get("user_email") or "").strip().lower()
                if email:
                    learners.add(email)
                total_enrollments += 1
                total_minutes += minutes
                if completed:
                    total_completions += 1
            if not data.get("next"):
                break
            page += 1
    except Exception as exc:
        log.warning("[udemy-stats] build failed: %s", exc)

    result = {}
    for cid, v in agg.items():
        n = v["enrolled"]
        result[cid] = {
            "enrolled": n,
            "completed": v["completed"],
            "avg_completion_pct": round(v["total_pct"] / n, 1) if n else 0.0,
        }

    # High-level insights derived from the same pass.
    def _course_view(cid, v):
        n = v["enrolled"]
        return {
            "course_id": cid,
            "title": v["title"],
            "category": v["category"],
            "enrolled": n,
            "completed": v["completed"],
            "avg_completion_pct": round(v["total_pct"] / n, 1) if n else 0.0,
            "completion_rate": round(v["completed"] / n * 100, 1) if n else 0.0,
            "hours": round(v["minutes"] / 60, 1),
        }
    courses = [_course_view(cid, v) for cid, v in agg.items()]
    top_enrolled = sorted(courses, key=lambda c: c["enrolled"], reverse=True)[:10]
    top_completed = sorted(courses, key=lambda c: c["completed"], reverse=True)[:10]
    # Low engagement: meaningfully enrolled but barely touched.
    low_engagement = sorted(
        [c for c in courses if c["enrolled"] >= 5 and c["avg_completion_pct"] < 10],
        key=lambda c: c["enrolled"], reverse=True,
    )[:10]
    categories = sorted(
        [{"category": k, "enrolled": v["enrolled"], "completed": v["completed"],
          "hours": round(v["minutes"] / 60, 1),
          "completion_rate": round(v["completed"] / v["enrolled"] * 100, 1) if v["enrolled"] else 0.0}
         for k, v in cat_agg.items()],
        key=lambda c: c["enrolled"], reverse=True,
    )

    insights = {
        "totals": {
            "learners_engaged": len(learners),
            "courses_touched": len(agg),
            "enrollments": total_enrollments,
            "completions": total_completions,
            "completion_rate": round(total_completions / total_enrollments * 100, 1) if total_enrollments else 0.0,
            "hours_consumed": round(total_minutes / 60, 1),
        },
        "top_enrolled": top_enrolled,
        "top_completed": top_completed,
        "low_engagement": low_engagement,
        "categories": categories,
        "generated_at": datetime.datetime.utcnow().isoformat(),
    }

    with _org_stats_lock:
        _org_stats_cache = result
        _insights_cache = insights
        _org_stats_built_at = time.time()
    log.info("[udemy-stats] org stats built: %d courses, %d learners, %d enrollments",
             len(result), len(learners), total_enrollments)


def get_org_stats(course_id: int | None = None) -> dict:
    """Return cached org stats. Rebuilds synchronously if stale (< 1hr).
    With course_id: returns that course's stats dict (or empty).
    Without: returns the full {course_id: stats} mapping."""
    with _org_stats_lock:
        stale = (time.time() - _org_stats_built_at) > _ORG_STATS_TTL
        cache = _org_stats_cache
    if stale:
        _build_org_stats()
        with _org_stats_lock:
            cache = _org_stats_cache
    if course_id is not None:
        return cache.get(int(course_id), {})
    return cache


def get_course_insights() -> dict:
    """High-level org learning insights (totals, top/low courses, category mix).
    Built from the same cached user-course-activity pass as org stats (rebuilds
    synchronously if stale, max once/hr). Read-only."""
    if not configured():
        return {"error": "not_configured"}
    with _org_stats_lock:
        stale = (time.time() - _org_stats_built_at) > _ORG_STATS_TTL
        cache = _insights_cache
    if stale or not cache:
        _build_org_stats()
        with _org_stats_lock:
            cache = _insights_cache
    return cache or {}


def get_course_with_org_stats(course_id: int) -> dict:
    """Fetch full course detail (live API) and annotate with org enrollment stats."""
    course = get_course(course_id)
    stats = get_org_stats(course_id)
    course["org_enrolled"] = stats.get("enrolled", 0)
    course["org_completed"] = stats.get("completed", 0)
    course["org_avg_completion_pct"] = stats.get("avg_completion_pct", 0.0)
    return course


def _derive_skill_from_index(course_id: int | None) -> str | None:
    """Look up category/subcategory for a course_id from the in-memory index."""
    if course_id is None:
        return None
    with _index_lock:
        hit = next((c for c in _index if c.get("id") == course_id), None)
    if not hit:
        return None
    return hit.get("subcategory") or hit.get("category")


def sync_completions_to_skills(db: Session) -> dict:
    """Paginate user-course-activity, find 100% completions, and write verified
    EmployeeSkill rows.  Returns {added, skipped, errors}.
    """
    from app.models import Employee, EmployeeSkill  # local import avoids circular

    if not configured():
        return {"error": "not_configured"}

    added = skipped = errors = 0
    today = datetime.date.today()
    page = 1

    while True:
        try:
            data = get_user_course_activity(page=page, page_size=100)
        except Exception as exc:
            log.warning("[udemy-sync] page %d fetch failed: %s", page, exc)
            errors += 1
            break

        results = data.get("results") or []
        if not results:
            break

        for row in results:
            # Udemy field names are not officially confirmed — check common variants.
            pct = float(
                row.get("completion_percentage")
                or row.get("percent_completed")
                or row.get("progress_percent")
                or 0
            )
            completion_date = (
                row.get("completion_time")
                or row.get("completion_date")
                or row.get("completed_at")
            )
            if not (pct >= 100 or completion_date):
                skipped += 1
                continue

            email = (
                row.get("user_email")
                or row.get("email")
                or (row.get("user") or {}).get("email")
            )
            if not email:
                skipped += 1
                continue

            course_id = row.get("course_id") or (row.get("course") or {}).get("id")
            course_title = (
                row.get("course_title")
                or row.get("title")
                or (row.get("course") or {}).get("title")
                or "Unknown Course"
            )
            cert = f"Udemy Business: {course_title}"

            emp = db.query(Employee).filter(Employee.email.ilike(email.strip())).first()
            if not emp:
                skipped += 1
                continue

            # Idempotency check on cert string
            if db.query(EmployeeSkill).filter(
                EmployeeSkill.employee_id == emp.id,
                EmployeeSkill.certification == cert,
            ).first():
                skipped += 1
                continue

            skill = _derive_skill_from_index(course_id) or course_title[:80]

            # If the employee already has this skill, just tag the cert onto it
            existing = db.query(EmployeeSkill).filter(
                EmployeeSkill.employee_id == emp.id,
                EmployeeSkill.skill.ilike(skill),
            ).first()
            if existing:
                if not existing.certification:
                    existing.certification = cert
                skipped += 1
            else:
                db.add(EmployeeSkill(
                    employee_id=emp.id,
                    skill=skill,
                    certification=cert,
                    last_used=today,
                ))
                added += 1

        if not data.get("next"):
            break
        page += 1

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        log.error("[udemy-sync] commit failed: %s", exc)
        errors += 1

    _sync_state.update({"at": datetime.datetime.utcnow().isoformat(), "added": added,
                        "skipped": skipped, "errors": errors})
    log.info("[udemy-sync] done: added=%d skipped=%d errors=%d", added, skipped, errors)
    return {"added": added, "skipped": skipped, "errors": errors}


def last_sync_status() -> dict:
    return dict(_sync_state)


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
