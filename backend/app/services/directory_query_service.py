"""Free-text employee-directory search via LLM-generated SQL.

The `/api/employees/directory` payload is a single flattened list of employee dicts
composed server-side from three different sources (Zoho/MS365 roster, cached Alchemy
skills/projects, allocation snapshots) — see `employee_routes._attach_enrichment` /
`_attach_allocations`. By the time it reaches this service it's one known shape, so
rather than guess at a fixed set of filter fields with regex (fragile for combinations
like "python, react" or "3-5 years"), we load it into an in-memory SQLite database
(stdlib — no new dependency) and have a small LLM write a real SQL query against a
fixed 3-table schema. Real SQL handles arbitrary skill/project lists and ranges
correctly; the LLM only has to translate English into a WHERE clause, not decide
matches row-by-row.

Used as the fallback when the deterministic regex parser in the frontend
(`parseDirectoryFilter`) can't find any filterable dimension in the query.
"""
from __future__ import annotations

import logging
import re
import sqlite3

logger = logging.getLogger(__name__)

_SCHEMA_SQL = """
CREATE TABLE employees (
    employee_code TEXT PRIMARY KEY,
    name TEXT,
    department TEXT,
    designation TEXT,
    location TEXT,
    available INTEGER,
    availability_percent REAL
);
CREATE TABLE employee_skills (
    employee_code TEXT,
    skill TEXT,
    years_experience REAL,
    certified INTEGER,
    last_used TEXT
);
CREATE TABLE employee_projects (
    employee_code TEXT,
    project_name TEXT
);
"""

_ALLOWED_TABLES = {"employees", "employee_skills", "employee_projects"}

_FORBIDDEN_RE = re.compile(
    r"\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|"
    r"exec|execute|reindex|analyze)\b",
    re.IGNORECASE,
)

_SYSTEM_PROMPT = """You translate a recruiter's free-text search over a company directory into a single read-only SQLite SELECT query.

Schema (exactly these 3 tables, no others exist):
  employees(employee_code TEXT, name TEXT, department TEXT, designation TEXT, location TEXT, available INTEGER, availability_percent REAL)
    -- available: 1 = has free capacity right now, 0 = fully allocated
  employee_skills(employee_code TEXT, skill TEXT, years_experience REAL, certified INTEGER, last_used TEXT)
    -- one row per employee per skill; certified: 1/0; last_used is an ISO date string (may be NULL)
  employee_projects(employee_code TEXT, project_name TEXT)
    -- one row per employee per project they've worked on

Respond with ONLY a JSON object (no markdown fences, no commentary) of this exact shape:
{"is_filter": true|false, "sql": "SELECT DISTINCT employee_code FROM ...", "summary": "short human-readable description of the filter", "skills_mentioned": ["Python", "React"], "projects_mentioned": ["Alpha"]}

skills_mentioned/projects_mentioned are the plain lists of skill/technology and project/client names named in the request (empty list if none) — used to refresh that data live before the query runs, so results aren't limited by sync lag.

Rules:
- Set is_filter=false (and omit sql) if the text is not a directory search/filter request (e.g. a plain question, greeting, or unrelated request). Do not guess a query in that case.
- The query MUST start with "SELECT DISTINCT employee_code" and select nothing else.
- Only reference the 3 tables above, joined on employee_code as needed.
- Multiple skills/projects mentioned together (e.g. "React and Node", "python, react") mean the person should match ANY of them (OR), unless the text says "both"/"all of" — then use AND (a subquery counting distinct matches, or a JOIN per skill).
- A year range ("3 to 5 years", "3-5 years", "between 3 and 5") means years_experience BETWEEN the two numbers on the SAME employee_skills row as the matched skill.
- A minimum ("5+ years", "at least 3 years", "more than 5 years") means years_experience >= that number.
- "certified" filters employee_skills.certified = 1.
- "available"/"on the bench"/"free capacity" filters employees.available = 1.
- "used in the last N months" filters employee_skills.last_used >= date('now', '-N months').
- Exactly ONE statement. No semicolons except an optional single trailing one. No comments.
- summary should read naturally, e.g. "React or Node developers with 3-5 years' experience"."""


def _live_skill_rows(skill_names: list[str], known_codes: set[str]) -> list[tuple]:
    """Live-refresh the named skill(s) from Alchemy so the query isn't limited by the
    bulk cache's sync lag (a background fill converges it, but that can take a while for
    ~1.3k people). Bounded to a handful of skills per query — cheap (one skill-details
    call each, cached token/catalog) vs. the alternative of live-fetching every employee.
    Fail-soft: any error/missing token just means that skill falls back to cached data."""
    from app.services import alchemy_service

    names = [n.strip() for n in (skill_names or []) if (n or "").strip()][:5]
    if not names:
        return []
    tok = alchemy_service.get_service_token()
    if not tok:
        return []

    rows: list[tuple] = []
    for name in names:
        try:
            sid, canonical = alchemy_service.resolve_skill_id(tok, name)
            if not sid:
                continue
            det = alchemy_service.get_skill_details(tok, sid)
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(det, dict):
            continue
        skill_label = det.get("skill_name") or canonical or name

        def _cert_id(c):
            return (c.get("employee_id") if isinstance(c, dict) else c)

        certified_ids = {_cert_id(c) for c in (det.get("certified") or [])}
        for peer in det.get("employees") or []:
            code = str(peer.get("employee_id") or "").strip()
            if not code or code not in known_codes:
                continue
            try:
                years = float(peer.get("experience") or 0)
            except (TypeError, ValueError):
                years = 0.0
            rows.append((
                code, skill_label, years,
                1 if peer.get("employee_id") in certified_ids else 0,
                peer.get("last_used") or None,
            ))
    return rows


def _live_project_rows(project_names: list[str], known_codes: set[str]) -> list[tuple]:
    """Live-query `employee_allocations` directly for the named project(s)/client(s).

    Unlike skills, Alchemy has no "who worked on project X" endpoint (only a per-employee
    `/users/{id}/projects` call, useless without already knowing who to check) — so there's
    no equivalent live Alchemy refresh to do here. But `employee_allocations` is already
    queried fresh on every directory load (no cache/convergence lag) and covers far more
    people (~1.3k) than the Alchemy-sourced project history bundled into `projects` (~200,
    see employee_routes._attach_allocations) — it's already the authoritative live source.
    A targeted ILIKE query here catches partial/fuzzy project names precisely, rather than
    depending on Python-side substring matching against the pre-aggregated per-employee
    array. Fail-soft: any DB error just means the query relies on the already-bundled data.
    """
    from app.database import SessionLocal
    from app.models import SCHEMA
    from sqlalchemy import text as sql_text

    names = [n.strip() for n in (project_names or []) if (n or "").strip()][:5]
    if not names or not known_codes:
        return []

    patterns = [f"%{n}%" for n in names]
    db = SessionLocal()
    try:
        rows = db.execute(
            sql_text(
                f'SELECT DISTINCT employee_id, project_name FROM "{SCHEMA}".employee_allocations '
                f"WHERE employee_id = ANY(:codes) AND project_name IS NOT NULL AND project_name <> '' "
                f"AND (project_name ILIKE ANY(:patterns) OR client_master ILIKE ANY(:patterns))"
            ),
            {"codes": list(known_codes), "patterns": patterns},
        ).all()
    except Exception as e:  # noqa: BLE001
        logger.warning("[directory_query] live project refresh failed: %s", e)
        return []
    finally:
        db.close()
    return [(r[0], r[1]) for r in rows if r[0] and r[1]]


def _build_db(
    employees: list[dict],
    live_skill_rows: list[tuple] | None = None,
    live_project_rows: list[tuple] | None = None,
) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    emp_rows = []
    skill_rows = []
    project_rows = []
    # Live rows take precedence over the bulk cache for the same (employee, skill) —
    # skip the cached row wherever a fresher live one exists.
    live_keys = {(code, skill.lower()) for code, skill, *_ in (live_skill_rows or [])}
    for e in employees:
        code = (e.get("employee_code") or "").strip()
        if not code:
            continue
        emp_rows.append((
            code,
            e.get("name") or "",
            e.get("department") or "",
            e.get("designation") or "",
            e.get("location") or "",
            1 if e.get("available") else 0,
            float(e.get("availability_percent") or 0),
        ))
        for s in e.get("skills") or []:
            skill_name = (s.get("skill") or "").strip()
            if not skill_name or (code, skill_name.lower()) in live_keys:
                continue
            try:
                years = float(s.get("years_experience") or 0)
            except (TypeError, ValueError):
                years = 0.0
            skill_rows.append((
                code, skill_name, years,
                1 if s.get("certified") else 0,
                s.get("last_used") or None,
            ))
        project_names = {(p or "").strip() for p in (e.get("allocation_projects") or [])}
        project_names |= {(p.get("name") or "").strip() for p in (e.get("projects") or [])}
        for name in project_names:
            if name:
                project_rows.append((code, name))
    skill_rows.extend(live_skill_rows or [])
    # Additive, not overriding — a person can be on several projects, and duplicate
    # (employee, project) pairs are harmless under the generated query's SELECT DISTINCT.
    project_rows.extend(live_project_rows or [])

    conn.executemany("INSERT INTO employees VALUES (?,?,?,?,?,?,?)", emp_rows)
    conn.executemany("INSERT INTO employee_skills VALUES (?,?,?,?,?)", skill_rows)
    conn.executemany("INSERT INTO employee_projects VALUES (?,?)", project_rows)
    conn.commit()
    return conn


def _validate_sql(sql: str) -> str | None:
    """Return a cleaned single-statement SQL string, or None if it fails the guardrails."""
    s = sql.strip().rstrip(";").strip()
    if not s or ";" in s:
        return None
    if not re.match(r"(?is)^select\s+distinct\s+employee_code\b", s):
        return None
    if _FORBIDDEN_RE.search(s):
        return None
    tables = set(re.findall(r"(?i)\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)", s))
    if not tables or not tables.issubset(_ALLOWED_TABLES):
        return None
    return s


def run_query(employees: list[dict], query_text: str) -> dict:
    """Parse `query_text` into SQL via the LLM and execute it against the composed
    directory. Returns {"matched": False} if the text isn't a filter request, the
    model's SQL fails validation, or execution errors — callers should fall back to
    the normal chat pipeline in that case."""
    from app.services.llm_json import invoke_json

    text = (query_text or "").strip()
    if not text:
        return {"matched": False}

    prompt = f"{_SYSTEM_PROMPT}\n\nRequest: {text}"
    draft = invoke_json("general", prompt, attempts=2, default_timeout=30)
    if not draft or not draft.get("is_filter"):
        return {"matched": False}

    sql = _validate_sql(draft.get("sql") or "")
    if not sql:
        logger.warning("[directory_query] rejected SQL from model: %r", draft.get("sql"))
        return {"matched": False}

    known_codes = {(e.get("employee_code") or "").strip() for e in employees} - {""}
    try:
        live_skills = _live_skill_rows(draft.get("skills_mentioned") or [], known_codes)
    except Exception as e:  # noqa: BLE001
        logger.warning("[directory_query] live skill refresh failed: %s", e)
        live_skills = []
    try:
        live_projects = _live_project_rows(draft.get("projects_mentioned") or [], known_codes)
    except Exception as e:  # noqa: BLE001
        logger.warning("[directory_query] live project refresh failed: %s", e)
        live_projects = []

    conn = _build_db(employees, live_skills, live_projects)
    try:
        rows = conn.execute(sql).fetchall()
    except sqlite3.Error as e:
        logger.warning("[directory_query] SQL execution failed: %s — sql=%r", e, sql)
        return {"matched": False}
    finally:
        conn.close()

    codes = [r[0] for r in rows]
    return {
        "matched": True,
        "employee_codes": codes,
        "summary": (draft.get("summary") or "").strip() or "Matching your search",
        "sql": sql,
    }
