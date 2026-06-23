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
