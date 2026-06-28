"""
Alchemy Skills Portal API service.

Alchemy is secured with Azure AD (App ID: 4a7dad8b-1372-499d-ade0-a91fe84ae4d6).
Tokens are obtained by exchanging the user's stored Microsoft refresh token via
oauth_service.get_alchemy_token(). No separate connect flow needed — users who
have connected Microsoft automatically get Alchemy access.

API base: https://apps.alignedautomation.com/alchemyapi/api/v1
"""

import logging
import time

import httpx

from app.config import settings

log = logging.getLogger("aurora-logger")

_BASE = settings.ALCHEMY_BASE_URL.rstrip("/")

# Process-level cache for the skills catalog. The /skills/ endpoint always returns
# the entire (effectively static) catalog regardless of query params, so re-fetching
# it on every skill search is pure waste. Cache is org-wide (not per-user); the token
# is only needed for the live fetch.
_SKILLS_CACHE: dict = {"data": None, "ts": 0.0}
_SKILLS_TTL = 12 * 3600  # 12h


def clear_skills_cache() -> None:
    """Drop the cached skills catalog so the next list_skills() re-fetches it."""
    _SKILLS_CACHE.update({"data": None, "ts": 0.0})

_CONNECT_MSG = (
    "Please connect your Microsoft account first. "
    "Go to **Settings > Connected Accounts** and click **Connect Microsoft**."
)


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _check(resp: httpx.Response, label: str) -> dict:
    if resp.status_code in (401, 403):
        raise PermissionError("not_connected")
    if not resp.is_success:
        log.warning("[alchemy] %s → %s %s", label, resp.status_code, resp.text[:200])
        resp.raise_for_status()
    return resp.json()


def get_employee_id(user_email: str) -> str | None:
    """Look up the Alchemy employee ID (e.g. AASPL-1540) from the employees table.

    Prefers the dedicated `alchemy_employee_id` column (a stable mapping no sync
    overwrites) and falls back to `employee_id`. The latter is volatile — Zoho CSV
    re-imports rewrite it — so it's only a best-effort fallback.

    DB may store either the full ID ("AASPL-1540") or just the numeric part ("1540").
    ALCHEMY_EMPLOYEE_PREFIX is prepended if the stored value doesn't already have it.
    """
    from app.database import SessionLocal
    from app.models import Employee
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == user_email).first()
        if not emp:
            return None
        raw = emp.alchemy_employee_id or emp.employee_id
        if not raw:
            return None
        prefix = settings.ALCHEMY_EMPLOYEE_PREFIX
        if prefix and not raw.startswith(prefix):
            return f"{prefix}{raw}"
        return raw
    finally:
        db.close()


def search_employees(token: str, name: str) -> list[dict]:
    """GET /employees/search?name=<name> — fuzzy name search.

    NOTE: only the `name` query param filters; q/search/query/email are ignored
    by the API and return the full directory. Matching is by display name, so
    results can contain multiple people (disambiguate via get_user_roles email).
    Returns the list under the response's "data" key (or [] ).
    """
    with httpx.Client(timeout=15) as client:
        resp = client.get(
            f"{_BASE}/employees/search",
            headers=_headers(token),
            params={"name": name},
        )
    data = _check(resp, f"employees/search?name={name}")
    if isinstance(data, dict):
        return data.get("data", []) or []
    return data if isinstance(data, list) else []


def resolve_employee_id(token: str, user_email: str, display_name: str | None = None) -> str | None:
    """Resolve a user's Alchemy employee ID (e.g. AASPL-1540), self-healing.

    1. Use the cached `employees.alchemy_employee_id` if present (fast path).
    2. Otherwise search Alchemy by display name and disambiguate by matching the
       logged-in email against each candidate's get_user_roles() email — names are
       not unique, the email is. On a confident match, cache it back to the DB so
       future calls take the fast path.

    Returns the prefixed ID, or None if it can't be resolved.
    """
    from app.database import SessionLocal
    from app.models import Employee

    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == user_email).first()
        if emp is None:
            return None

        # 1) cached mapping wins
        if emp.alchemy_employee_id:
            raw = emp.alchemy_employee_id
            prefix = settings.ALCHEMY_EMPLOYEE_PREFIX
            return raw if (not prefix or raw.startswith(prefix)) else f"{prefix}{raw}"

        # 2) live search by name, disambiguate by email
        name = display_name or emp.name
        if not name:
            return None
        try:
            candidates = search_employees(token, name)
        except Exception as exc:  # noqa: BLE001 - network/permission, fall through
            log.warning("[alchemy] search for %r failed: %s", name, exc)
            return None

        target = (user_email or "").strip().lower()
        for cand in candidates:
            cand_id = cand.get("employeeId")
            if not cand_id:
                continue
            try:
                roles = get_user_roles(token, cand_id)
            except Exception:
                continue
            cand_email = (roles.get("email") or "").strip().lower()
            if cand_email and cand_email == target:
                emp.alchemy_employee_id = cand_id  # cache (already prefixed)
                db.commit()
                log.info("[alchemy] resolved %s -> %s (cached)", user_email, cand_id)
                return cand_id

        log.warning("[alchemy] no email match for %s among %d name candidates",
                    user_email, len(candidates))
        return None
    finally:
        db.close()


def get_my_skills(token: str, employee_id: str) -> dict:
    """GET /users/{employee_id}/skills — returns the user's skill list."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/users/{employee_id}/skills", headers=_headers(token))
    return _check(resp, f"skills/{employee_id}")


def _skill_form(skill_id, competency, certified, last_used, yoe,
                primary_skill, secondary_skill, primary_interest, instructor_flag) -> dict:
    """Build the form-urlencoded body shared by add/update.

    Field formats mirror GET .../skills: competency Beginner|Intermediate|Advanced|
    Expert, certified "Yes"|"No", last_used "YYYY-MM-DD", yoe numeric-as-string.
    Booleans must be lowercase "true"/"false" strings.
    """
    form = {
        "skill_id": str(skill_id),
        "instructor_flag": str(instructor_flag).lower(),
        "primary_interest": str(primary_interest).lower(),
        "primary_skill": str(primary_skill).lower(),
        "secondary_skill": str(secondary_skill).lower(),
        "competency": competency,
        "certified": certified,
        "yoe": str(yoe),
    }
    if last_used:
        form["last_used"] = last_used
    return form


def add_user_skill(
    token: str,
    employee_id: str,
    skill_id: int,
    *,
    competency: str = "Beginner",
    certified: str = "No",
    last_used: str | None = None,
    yoe: float | str = "0.00",
    primary_skill: bool = False,
    secondary_skill: bool = False,
    primary_interest: bool = False,
    instructor_flag: bool = False,
) -> dict:
    """POST /users/{employee_id}/skills/ — add a skill to the user's own profile.

    IMPORTANT API quirks (verified 2026-06-06):
    - Body is **form-urlencoded**, NOT JSON (the popup supports a certificate
      file upload, so it's a Form endpoint). Sending JSON yields 422 skill_id=null.
    - Trailing slash required.
    - The new skill lands with approval_status="Draft" (enters an approval queue).
    - Create-only: re-adding an existing skill → 400 "already declared". Use
      update_user_skill() to change an existing one.
    - POST /skills/ is a different, ADMIN-only endpoint (creates a catalog skill).
    """
    form = _skill_form(skill_id, competency, certified, last_used, yoe,
                       primary_skill, secondary_skill, primary_interest, instructor_flag)
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        resp = client.post(
            f"{_BASE}/users/{employee_id}/skills/",
            headers=_headers(token),
            data=form,
        )
    return _check(resp, f"POST users/{employee_id}/skills (skill_id={skill_id})")


def update_user_skill(
    token: str,
    employee_id: str,
    skill_id: int,
    *,
    competency: str = "Beginner",
    certified: str = "No",
    last_used: str | None = None,
    yoe: float | str = "0.00",
    primary_skill: bool = False,
    secondary_skill: bool = False,
    primary_interest: bool = False,
    instructor_flag: bool = False,
) -> dict:
    """PUT /users/{employee_id}/skills/{skill_id}/ — update an EXISTING own skill.

    Same form-urlencoded body and field formats as add_user_skill. Trailing slash
    required. Returns the updated skill object (200).
    """
    form = _skill_form(skill_id, competency, certified, last_used, yoe,
                       primary_skill, secondary_skill, primary_interest, instructor_flag)
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        resp = client.put(
            f"{_BASE}/users/{employee_id}/skills/{skill_id}/",
            headers=_headers(token),
            data=form,
        )
    return _check(resp, f"PUT users/{employee_id}/skills/{skill_id}")


def delete_user_skill(token: str, employee_id: str, skill_id: int) -> bool:
    """DELETE /users/{employee_id}/skills/{skill_id}/ — remove an own skill.

    Returns True on success (204 No Content). Trailing slash required.
    """
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        resp = client.delete(
            f"{_BASE}/users/{employee_id}/skills/{skill_id}/",
            headers=_headers(token),
        )
    if resp.status_code in (401, 403):
        raise PermissionError("not_connected")
    if not resp.is_success:
        log.warning("[alchemy] DELETE skills/%s → %s %s", skill_id, resp.status_code, resp.text[:200])
        resp.raise_for_status()
    return True


def get_user_roles(token: str, employee_id: str) -> dict:
    """GET /user-roles/{employee_id} — returns the user's roles/designations."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/user-roles/{employee_id}", headers=_headers(token))
    return _check(resp, f"user-roles/{employee_id}")


def get_user_projects(token: str, employee_id: str) -> list[dict]:
    """GET /users/{employee_id}/projects — the employee's project history.

    Each entry: {ProjectName, Role, ClientName, ProjectManagerName, StartDate,
    EndDate, ProjectStatus, SkillsUsed, ApprovalStatus, ...}.
    """
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        resp = client.get(f"{_BASE}/users/{employee_id}/projects", headers=_headers(token))
    data = _check(resp, f"projects/{employee_id}")
    if isinstance(data, dict):
        return data.get("data", []) or []
    return data if isinstance(data, list) else []


# ── Directory profile enrichment (shared service token, cross-user reads) ─────
# The Employee Directory shows any of ~800 people, but only a couple of users have
# connected Microsoft. Alchemy permits reading another employee's skills/projects
# with one valid token, so we mint a single SERVICE token (from a designated
# connected account) and fetch on-demand when a profile is opened, cached per person.

_svc_token_cache: dict = {"token": None, "exp": 0.0}
_svc_lock = __import__("threading").Lock()
# How stale a cached row may get before the background sync refreshes it.
_ENRICH_MAX_AGE_HOURS = 24
# Background sync cadence.
_ENRICH_SYNC_INTERVAL_SEC = 6 * 3600


def _service_email() -> str | None:
    em = (settings.ALCHEMY_SERVICE_EMAIL or "").strip().lower()
    if em:
        return em
    from app.database import SessionLocal
    from app.models import ConnectedAccount
    db = SessionLocal()
    try:
        acc = (
            db.query(ConnectedAccount)
            .filter(ConnectedAccount.provider == "microsoft", ConnectedAccount.status == "active")
            .order_by(ConnectedAccount.id)
            .first()
        )
        return acc.user_email if acc else None
    finally:
        db.close()


def get_service_token() -> str | None:
    """Mint/cache an Alchemy access token from a designated service account's stored
    Microsoft refresh token (sync, so callers can run in FastAPI's threadpool)."""
    now = time.time()
    if _svc_token_cache["token"] and _svc_token_cache["exp"] > now:
        return _svc_token_cache["token"]
    with _svc_lock:
        if _svc_token_cache["token"] and _svc_token_cache["exp"] > now:
            return _svc_token_cache["token"]
        email = _service_email()
        if not email:
            return None
        from app.database import SessionLocal
        from app.models import ConnectedAccount
        from app.services.oauth_service import decrypt_token, MICROSOFT_AUTHORITY
        db = SessionLocal()
        try:
            acc = (
                db.query(ConnectedAccount)
                .filter(
                    ConnectedAccount.user_email == email,
                    ConnectedAccount.provider == "microsoft",
                    ConnectedAccount.status == "active",
                )
                .first()
            )
            if not acc or not acc.refresh_token_enc:
                return None
            refresh = decrypt_token(acc.refresh_token_enc)
        finally:
            db.close()

        tenant = settings.MICROSOFT_OAUTH_TENANT_ID or "common"
        token_url = f"{MICROSOFT_AUTHORITY}/{tenant}/oauth2/v2.0/token"
        try:
            with httpx.Client(timeout=15) as client:
                resp = client.post(token_url, data={
                    "client_id": settings.MICROSOFT_OAUTH_CLIENT_ID,
                    "client_secret": settings.MICROSOFT_OAUTH_CLIENT_SECRET,
                    "refresh_token": refresh,
                    "grant_type": "refresh_token",
                    "scope": "api://4a7dad8b-1372-499d-ade0-a91fe84ae4d6/access_as_user",
                })
            if resp.status_code != 200:
                log.warning("[alchemy] service token exchange failed: %s", resp.text[:200])
                return None
            tok = resp.json().get("access_token")
        except Exception as e:  # noqa: BLE001
            log.warning("[alchemy] service token error: %s", e)
            return None
        if not tok:
            return None
        _svc_token_cache.update({"token": tok, "exp": now + 50 * 60})
        return tok


def _norm_skill(s: dict) -> dict:
    return {
        "skill": s.get("skill_name") or "",
        "category": s.get("skill_category_name") or "",
        "competency": s.get("competency") or "",
        "certified": str(s.get("certified") or "").strip().lower() == "yes",
        "certificate_url": s.get("certificate_url") or s.get("certificate_link") or "",
        "primary_skill": bool(s.get("primary_skill")),
        "secondary_skill": bool(s.get("secondary_skill")),
        "primary_interest": bool(s.get("primary_interest")),
        "instructor": bool(s.get("instructor_flag")),
        "years_experience": str(s.get("yoe") or "").strip(),
        "last_used": s.get("last_used") or "",
    }


def _norm_project(p: dict) -> dict:
    return {
        "name": p.get("ProjectName") or "",
        "role": p.get("Role") or "",
        "client": p.get("ClientName") or "",
        "manager": p.get("ProjectManagerName") or "",
        "status": p.get("ProjectStatus") or "",
        "start_date": p.get("StartDate") or "",
        "end_date": p.get("EndDate") or "",
        "skills_used": p.get("SkillsUsed") or "",
    }


def _fetch_enrichment_live(tok: str, code: str) -> dict | None:
    """Pull one employee's skills+projects straight from Alchemy. None on total failure."""
    skills: list[dict] = []
    projects: list[dict] = []
    ok = False
    try:
        raw = get_my_skills(tok, code)
        if isinstance(raw, list):
            skills = sorted(
                (_norm_skill(s) for s in raw),
                key=lambda x: (not x["primary_skill"], not x["certified"], x["skill"].lower()),
            )
            ok = True
    except Exception as e:  # noqa: BLE001
        log.warning("[alchemy] skills for %s failed: %s", code, e)
    try:
        raw = get_user_projects(tok, code)
        projects = sorted(
            (_norm_project(p) for p in raw),
            key=lambda x: (x["end_date"] or x["start_date"] or ""),
            reverse=True,
        )
        ok = True
    except Exception as e:  # noqa: BLE001
        log.warning("[alchemy] projects for %s failed: %s", code, e)
    if not ok:
        return None
    return {"skills": skills, "projects": projects}


def _cache_upsert(code: str, skills: list, projects: list) -> None:
    import json
    from app.database import SessionLocal
    from app.models import SCHEMA
    from sqlalchemy import text
    db = SessionLocal()
    try:
        db.execute(
            text(
                f'INSERT INTO "{SCHEMA}".alchemy_profile_cache '
                f"(employee_code, skills, projects, available, fetched_at) "
                f"VALUES (:c, CAST(:s AS JSONB), CAST(:p AS JSONB), TRUE, NOW()) "
                f"ON CONFLICT (employee_code) DO UPDATE SET "
                f"skills = EXCLUDED.skills, projects = EXCLUDED.projects, "
                f"available = TRUE, fetched_at = NOW()"
            ),
            {"c": code, "s": json.dumps(skills), "p": json.dumps(projects)},
        )
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.warning("[alchemy] cache upsert for %s failed: %s", code, e)
    finally:
        db.close()


def get_cached_enrichment_map(codes) -> dict[str, dict]:
    """Bulk-read cached skills/projects for many employee codes (for the directory
    join). Returns {code: {skills, projects}} only for codes present in the cache.
    Fail-soft → {}."""
    codes = [c for c in {(c or "").strip() for c in codes} if c]
    if not codes:
        return {}
    from app.database import SessionLocal
    from app.models import SCHEMA
    from sqlalchemy import text
    db = SessionLocal()
    try:
        rows = db.execute(
            text(
                f'SELECT employee_code, skills, projects '
                f'FROM "{SCHEMA}".alchemy_profile_cache WHERE employee_code = ANY(:codes)'
            ),
            {"codes": codes},
        ).all()
        return {
            r[0]: {"skills": r[1] or [], "projects": r[2] or []}
            for r in rows
        }
    except Exception as e:  # noqa: BLE001
        log.warning("[alchemy] bulk cache read failed: %s", e)
        return {}
    finally:
        db.close()


def get_profile_enrichment(employee_code: str) -> dict:
    """Skills + projects for one employee (by AASPL code).

    Serves the DB cache when present (instant); on a cache miss falls back to a live
    Alchemy fetch and writes the result through to the cache. Fail-soft."""
    code = (employee_code or "").strip()
    if not code:
        return {"available": False, "skills": [], "projects": []}

    cached = get_cached_enrichment_map([code]).get(code)
    if cached is not None:
        return {"available": True, "skills": cached["skills"], "projects": cached["projects"]}

    tok = get_service_token()
    if not tok:
        return {"available": False, "skills": [], "projects": []}
    live = _fetch_enrichment_live(tok, code)
    if live is None:
        return {"available": False, "skills": [], "projects": []}
    _cache_upsert(code, live["skills"], live["projects"])
    return {"available": True, "skills": live["skills"], "projects": live["projects"]}


def sync_directory_enrichment(max_age_hours: int = _ENRICH_MAX_AGE_HOURS) -> int:
    """Refresh the Alchemy enrichment cache for every directory employee whose row is
    missing or older than max_age_hours. Runs in the background; returns rows updated."""
    from app.services import zoho_directory_service
    from app.database import SessionLocal
    from app.models import SCHEMA
    from sqlalchemy import text

    tok = get_service_token()
    if not tok:
        return 0  # no service identity connected → nothing to sync

    try:
        codes = [
            (e.get("employee_code") or "").strip()
            for e in zoho_directory_service.fetch_directory()
        ]
        codes = [c for c in codes if c]
    except Exception as e:  # noqa: BLE001
        log.warning("[alchemy] sync: directory fetch failed: %s", e)
        return 0

    # Which codes are already fresh (skip them)?
    fresh: set[str] = set()
    db = SessionLocal()
    try:
        rows = db.execute(
            text(
                f"SELECT employee_code FROM \"{SCHEMA}\".alchemy_profile_cache "
                f"WHERE fetched_at > NOW() - (:h || ' hours')::interval"
            ),
            {"h": str(max_age_hours)},
        ).all()
        fresh = {r[0] for r in rows}
    except Exception as e:  # noqa: BLE001
        log.warning("[alchemy] sync: freshness query failed: %s", e)
    finally:
        db.close()

    updated = 0
    for code in codes:
        if code in fresh:
            continue
        live = _fetch_enrichment_live(tok, code)
        if live is not None:
            _cache_upsert(code, live["skills"], live["projects"])
            updated += 1
        time.sleep(0.05)  # be gentle on the Alchemy API
    if updated:
        log.info("[alchemy] enrichment sync refreshed %d profiles", updated)
    return updated


def alchemy_enrichment_sync_loop() -> None:
    """Daemon loop: keep the directory enrichment cache warm."""
    while True:
        try:
            sync_directory_enrichment()
        except Exception as e:  # noqa: BLE001
            log.warning("[alchemy] enrichment sync loop error: %s", e)
        time.sleep(_ENRICH_SYNC_INTERVAL_SEC)


# Guards an on-demand enrichment fill so concurrent directory loads don't each
# spawn their own full sync — only one runs at a time.
import threading as _threading  # noqa: E402

_enrich_fill_lock = _threading.Lock()
_enrich_fill_running = False


def kick_enrichment_fill_async() -> bool:
    """Fire-and-forget a full directory enrichment sync in the background, deduped.

    Called when a directory load finds rows with no cached skills/projects, so coverage
    converges to the full roster on actual usage instead of waiting for the 6-hour timer.
    Returns True if a fill was started, False if one was already running or Alchemy is off.
    Never blocks the caller and never raises."""
    global _enrich_fill_running
    if not getattr(settings, "ALCHEMY_SKILL_SEARCH_ENABLED", False):
        return False
    with _enrich_fill_lock:
        if _enrich_fill_running:
            return False
        _enrich_fill_running = True

    def _run() -> None:
        global _enrich_fill_running
        try:
            sync_directory_enrichment()
        except Exception as e:  # noqa: BLE001
            log.warning("[alchemy] on-demand enrichment fill failed: %s", e)
        finally:
            with _enrich_fill_lock:
                _enrich_fill_running = False

    try:
        _threading.Thread(target=_run, daemon=True).start()
        return True
    except Exception:  # noqa: BLE001
        with _enrich_fill_lock:
            _enrich_fill_running = False
        return False


def get_skills_stats_summary(token: str) -> dict:
    """GET /skills/stats-summary — org-wide skills stats summary."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/skills/stats-summary", headers=_headers(token))
    return _check(resp, "skills/stats-summary")


def get_top_skills_by_interest(token: str) -> dict:
    """GET /skills/top-by-interest — top skills employees want to learn."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/skills/top-by-interest", headers=_headers(token))
    return _check(resp, "skills/top-by-interest")


def get_skill_categories(token: str) -> dict:
    """GET /skills/stats/categories — available skill categories."""
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{_BASE}/skills/stats/categories", headers=_headers(token))
    return _check(resp, "skills/stats/categories")


def list_skills(token: str) -> list[dict]:
    """GET /skills/ — the full skills catalog (315 entries).

    Each entry is {skillId, skillName, skillDescription, skillImageUrl, ...}.
    NOTE (verified 2026-06-06): query params (search/name/category) are IGNORED —
    the endpoint always returns the entire catalog. Filter client-side.
    The trailing slash matters: GET /skills 307-redirects to /skills/.

    Cached for _SKILLS_TTL (12h) since the catalog is effectively static; on a fetch
    error we fall back to any stale cached copy rather than raising.
    """
    now = time.monotonic()
    if _SKILLS_CACHE["data"] is not None and now - _SKILLS_CACHE["ts"] < _SKILLS_TTL:
        return _SKILLS_CACHE["data"]

    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            resp = client.get(f"{_BASE}/skills/", headers=_headers(token))
        data = _check(resp, "skills/")
        if isinstance(data, dict):
            skills = data.get("data", []) or []
        else:
            skills = data if isinstance(data, list) else []
    except Exception:
        # Transient Alchemy blip — serve the stale catalog if we have one.
        if _SKILLS_CACHE["data"] is not None:
            log.warning("[alchemy] skills/ fetch failed; serving stale cached catalog")
            return _SKILLS_CACHE["data"]
        raise

    if skills:  # don't poison the cache with an empty/failed response
        _SKILLS_CACHE.update({"data": skills, "ts": now})
    return skills


# Common developer abbreviations / aliases the catalog spells out in full. Applied
# before string/fuzzy matching so "js", "k8s", "py" resolve without guesswork.
_SKILL_ALIASES = {
    "js": "javascript", "ts": "typescript", "py": "python", "node": "node.js",
    "nodejs": "node.js", "node js": "node.js", "k8s": "kubernetes", "k8": "kubernetes",
    "gcp": "google cloud", "ml": "machine learning", "ai": "artificial intelligence",
    "dl": "deep learning", "nlp": "natural language processing", "cv": "computer vision",
    "golang": "go", "cpp": "c++", "c plus plus": "c++", "cs": "c#", "c sharp": "c#",
    "dotnet": ".net", "dot net": ".net", "reactjs": "react", "react js": "react",
    "rest": "rest api", "tf": "terraform", "pg": "postgresql", "postgres": "postgresql",
    "k8s cluster": "kubernetes",
}


def resolve_skill_id(token: str, skill_name: str) -> tuple[int | None, str | None]:
    """Map a free-text skill name (e.g. "python", "js", "pyhton") to its Alchemy skillId.

    Tiered, cheap-first (no GPU/network beyond the cached catalog):
      1. alias normalisation ("js" -> "javascript")
      2. exact (case-insensitive) -> startswith -> substring
      3. difflib fuzzy close-match (handles typos like "pyhton" -> "Python")
    Returns (skillId, canonicalSkillName) or (None, None) if nothing matches confidently.
    """
    raw = (skill_name or "").strip().lower()
    if not raw:
        return None, None
    target = _SKILL_ALIASES.get(raw, raw)

    skills = list_skills(token)

    def _name(s: dict) -> str:
        return (s.get("skillName") or s.get("name") or "").strip()

    def _ret(s: dict):
        sid = s.get("skillId") or s.get("id")
        return (int(sid) if sid is not None else None), _name(s)

    # Tier 2 — exact always; prefix/substring only for targets long enough that they
    # won't grab an unrelated skill (e.g. "go" must NOT startswith-match "Google BigQuery").
    exact = [s for s in skills if _name(s).lower() == target]
    if exact:
        return _ret(exact[0])
    if len(target) >= 4:
        starts = [s for s in skills if _name(s).lower().startswith(target)]
        subs = [s for s in skills if target in _name(s).lower()]
        for bucket in (starts, subs):
            if bucket:
                return _ret(bucket[0])

    # Tier 3 — fuzzy (typo-tolerant, e.g. "pyhton" -> "Python"). Skip very short targets.
    if len(target) >= 4:
        import difflib
        by_lower = {_name(s).lower(): s for s in skills if _name(s)}
        close = difflib.get_close_matches(target, list(by_lower.keys()), n=1, cutoff=0.8)
        if close:
            return _ret(by_lower[close[0]])

    return None, None


def get_skill_details(token: str, skill_id: int) -> dict:
    """GET /skills/{skill_id}/details — skill metadata + the employees who have it.

    Returns {skill_id, skill_name, skill_category, total_employees, certified_count,
    instructor_count, expert_count, employees:[{employee_id, name, competency,
    experience, ...}], certified:[...], instructors:[...], experts:[...]}.
    """
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        resp = client.get(f"{_BASE}/skills/{skill_id}/details", headers=_headers(token))
    return _check(resp, f"skills/{skill_id}/details")


# ── Skill-Gap Analysis (the /alchemy/skill-gap dashboard) ─────────────────────
# Alchemy benchmarks internal coverage against EXTERNAL job-market demand
# (demand_jobs × demand_companies scraped from postings) → gap = demand − coverage.
# Demand here is the hiring market, NOT our internal project pipeline; the hub adds
# that second half by crossing these gaps with EmployeeAllocation (see
# skill_gap_overlay_service).

def get_skill_gap_stats(token: str) -> dict:
    """GET /skills/skill-gap-analysis/stats — headline gap counts.

    Returns {stats:{critical_gaps, moderate_gaps, adequate_coverage, exceeding_demand},
    total_internal_skills, total_market_skills}.
    """
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        resp = client.get(f"{_BASE}/skills/skill-gap-analysis/stats", headers=_headers(token))
    return _check(resp, "skills/skill-gap-analysis/stats")


def get_skill_gap_training_priorities(token: str) -> dict:
    """GET /skills/skill-gap-analysis/training-priorities — Critical/Moderate/Growth
    buckets with skill lists, headcount targets, and recommendation text."""
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        resp = client.get(f"{_BASE}/skills/skill-gap-analysis/training-priorities",
                          headers=_headers(token))
    return _check(resp, "skills/skill-gap-analysis/training-priorities")


def get_skill_gap_table(
    token: str,
    *,
    page: int = 1,
    page_size: int = 50,
    sort_by: str = "gap",
    sort_order: str = "desc",
    search: str = "",
) -> dict:
    """POST /skills/skill-gap-analysis/table — paginated, sortable gap rows.

    Each row: {skill_id, skill_name, coverage (% of workforce), coverage_count,
    demand (0-100 market score), demand_jobs, demand_companies, gap, status,
    employee_names_preview:[{name, photo_url}], is_external}. The preview lists the
    people who HAVE the skill (verified full-length at observed sizes, not truncated).
    Returns {skill_gaps:[...], total_count, total_pages, page, page_size, ...}.
    """
    body = {
        "page": page, "page_size": page_size,
        "sort_by": sort_by, "sort_order": sort_order, "search": search or "",
    }
    with httpx.Client(timeout=25, follow_redirects=True) as client:
        resp = client.post(f"{_BASE}/skills/skill-gap-analysis/table",
                           headers=_headers(token), json=body)
    return _check(resp, "skills/skill-gap-analysis/table")
