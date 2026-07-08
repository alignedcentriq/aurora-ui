"""
eSSL Attendance DB Service
--------------------------
Connects to the eSSL biometric attendance SQL Server database and fetches punch records
from the configured view (default: dbo.vbUserTimeEntryLog).

View columns used:
  USERNAME      – employee full name (matched case-insensitively against our Employee.name)
  CHECKDATE     – date, but stored as a SQL datetime that CAN carry a time-of-day. Range
                  filters therefore use a HALF-OPEN [start, end+1day) window: a plain
                  `CHECKDATE <= end` bound converts `end` to midnight and silently drops
                  same-day punches (e.g. today's check-in), making the day read as Absent.
  CHECKINTIME   – check-in timestamp (datetime.datetime, nullable)
  CHECKOUTTIME  – check-out timestamp (datetime.datetime, nullable)
  TIMEINHOURS   – duration in hours (int/float)

Status derivation — eSSL records physical punches only (no WFH concept):
  TIMEINHOURS >= 4  → Present
  TIMEINHOURS >= 1  → Half-day
  record exists but duration unclear → Present
  no record for a weekday → Absent (caller's responsibility to compute)

Connection: pyodbc via "ODBC Driver 17 for SQL Server". Connection string is built once
and cached; the pyodbc connection itself is opened per-call (no connection pool needed for
the low-frequency attendance lookups).

Name matching — eSSL enrols employees under their FULL legal name (often including a
middle name), whereas our Employee.name is the short form (e.g. eSSL "Soniya Bhagwat
Kekan" vs our "Soniya Kekan"). A plain exact-equality join therefore silently drops
those people and reports them Absent every day despite real punches. So matching is:
  1. exact (case/whitespace-normalised) LOWER(USERNAME) == LOWER(name), else
  2. an UNAMBIGUOUS first-name + last-name fallback — accepted only when exactly one
     eSSL username AND exactly one requested employee share that (first, last) pair.
     The uniqueness guard is what makes it safe: it refuses to fuse distinct people who
     merely share a first+last (e.g. "Kumar Subham Singh" vs "Kumar Abhishek Singh").
eSSL exposes EMPLOYEEID/CARD_NO, but those are biometric-device IDs with no overlap with
our AA-###/AASPL codes — name is the only usable join key. See _resolve_usernames().

Batch API: fetch_team_records() fetches all named employees in a single SQL round-trip
(used by team_report to avoid N separate queries for large teams).

Simple in-process cache (TTL=5 min) avoids redundant eSSL round-trips when the same
employee's data is requested multiple times within one request cycle (e.g., team report
builds summary + calendar for the same person).
"""

import datetime
import re
import threading
import time

from app.config import settings

_lock = threading.Lock()
_conn_str: str | None = None
_conn_str_built = False

# Simple in-process result cache: key → (expires_at, data)
# The cache only de-dupes redundant round-trips for CLOSED (historical) date ranges, whose
# data never changes. Any window that includes today is pulled LIVE on every request:
# punches are still arriving through the day, so a cached "no punch yet" would wrongly read
# as Absent for someone who just checked in. See _is_live_range().
_cache: dict = {}
_CACHE_TTL = 300  # 5 minutes


def _is_live_range(end: datetime.date) -> bool:
    """True when the window includes today (data still changing) → bypass cache, pull live."""
    return end >= datetime.date.today()


def _parse_jdbc_url(raw: str) -> tuple[str, str]:
    server_m = re.search(r"serverName=([^;]+)", raw, re.I)
    db_m = re.search(r"databaseName=([^;]+)", raw, re.I)
    return (
        server_m.group(1).strip() if server_m else "",
        db_m.group(1).strip() if db_m else "",
    )


def _build_conn_str() -> str | None:
    raw = (settings.ATTENDANCE_DBURL or "").strip()
    if not raw:
        return None

    user = (settings.ATTENDANCE_USERNAME or "").strip()
    pwd = settings.ATTENDANCE_PASSWORD or ""

    if raw.lower().startswith("jdbc:"):
        raw_stripped = raw[raw.lower().index("sqlserver"):]
        server, database = _parse_jdbc_url(raw)
    elif "sqlserver" in raw.lower() or "mssql" in raw.lower():
        server, database = _parse_jdbc_url(raw)
        if not server:
            m = re.match(r"(?:jdbc:)?(?:sqlserver|mssql)://([^/;]+)(?:/([^;]+))?", raw, re.I)
            server = m.group(1).strip() if m else ""
            database = m.group(2).strip() if (m and m.group(2)) else database
    else:
        return None

    if not server:
        return None

    parts = [
        "DRIVER={ODBC Driver 17 for SQL Server}",
        f"SERVER={server}",
        "TrustServerCertificate=yes",
        "LoginTimeout=10",
    ]
    if database:
        parts.append(f"DATABASE={database}")
    if user:
        parts.append(f"UID={user}")
    if pwd:
        parts.append(f"PWD={pwd}")
    return ";".join(parts)


def _get_conn_str() -> str | None:
    global _conn_str, _conn_str_built
    if _conn_str_built:
        return _conn_str
    with _lock:
        if not _conn_str_built:
            _conn_str = _build_conn_str()
            _conn_str_built = True
    return _conn_str


def is_configured() -> bool:
    return bool((settings.ATTENDANCE_DBURL or "").strip())


def _open_conn():
    import pyodbc
    cs = _get_conn_str()
    if not cs:
        raise RuntimeError("Attendance DB not configured (ATTENDANCE_DBURL unset).")
    return pyodbc.connect(cs)


def _cache_get(key: str):
    entry = _cache.get(key)
    if entry and entry[0] > time.monotonic():
        return entry[1]
    return None


def _cache_set(key: str, data):
    _cache[key] = (time.monotonic() + _CACHE_TTL, data)


def _map_row(row: dict) -> dict:
    check_date = row.get("CHECKDATE")
    if isinstance(check_date, datetime.datetime):
        check_date = check_date.date()

    check_in = row.get("CHECKINTIME")
    check_out = row.get("CHECKOUTTIME")
    hours = row.get("TIMEINHOURS") or 0

    if hours >= 4:
        status = "Present"
    elif hours >= 1:
        status = "Half-day"
    else:
        # Record exists but duration is very short — treat as Present
        # (could be a forgotten punch-out; check-in is the authoritative signal)
        status = "Present"

    return {
        "date": check_date,
        "check_in": check_in,
        "check_out": check_out,
        "status": status,
        "hours": float(hours),
    }


def _norm(name: str) -> str:
    """Lowercase + collapse internal whitespace — the normalised join key."""
    return " ".join((name or "").split()).lower()


def _first_last(name_lower: str) -> tuple[str, str] | None:
    """(first token, last token) of an already-normalised name, or None if empty."""
    toks = name_lower.split()
    return (toks[0], toks[-1]) if toks else None


def _resolve_usernames(
    cur, view: str, requested_lower: list[str],
    start: datetime.date, end_exclusive: datetime.date,
    roster_lower: set[str] | None = None,
) -> dict[str, str]:
    """
    Map each requested (normalised) employee name to the eSSL USERNAME that actually
    punched in the window. Exact match first, then an UNAMBIGUOUS first+last fallback
    (see module docstring). Returns {requested_lower: essl_username_lower}; names that
    resolve to nothing are omitted (caller treats them as no-punch → Absent, as before).

    The fuzzy fallback is accepted for a requested name `n` only when ALL hold:
      • exactly one eSSL username in the window shares n's (first, last) pair, and
      • that eSSL candidate is NOT itself the exact name of some employee (the exact
        owner wins — this stops "Kumar Subham Singh" from stealing "Kumar Abhishek
        Singh"'s punches), and
      • exactly one employee in the org shares that (first, last) pair (so we never
        fuse two distinct same-first-last colleagues onto one eSSL record).
    The last two guards need the FULL org roster (`roster_lower`); when it is not
    supplied we fall back to the requested batch as the employee namespace — weaker,
    so callers should always pass the full roster.

    Uses the passed-in cursor so it shares the caller's single connection/round-trip budget.
    """
    cur.execute(
        f"SELECT DISTINCT LOWER(USERNAME) FROM {view} "
        f"WHERE CHECKDATE >= ? AND CHECKDATE < ?",
        (start.isoformat(), end_exclusive.isoformat()),
    )
    essl_names = [_norm(r[0]) for r in cur.fetchall() if r[0]]
    essl_set = set(essl_names)

    essl_fl: dict[tuple[str, str], list[str]] = {}
    for n in essl_names:
        k = _first_last(n)
        if k:
            essl_fl.setdefault(k, []).append(n)

    # Employee-side namespace for the ambiguity/owner guards: the full org roster when
    # available, else best-effort from the requested batch.
    emp_namespace = roster_lower if roster_lower is not None else set(requested_lower)
    emp_fl: dict[tuple[str, str], int] = {}
    for n in emp_namespace:
        k = _first_last(n)
        if k:
            emp_fl[k] = emp_fl.get(k, 0) + 1

    resolved: dict[str, str] = {}
    for n in requested_lower:
        if n in essl_set:
            resolved[n] = n
            continue
        k = _first_last(n)
        if not k:
            continue
        cands = essl_fl.get(k, [])
        if len(cands) != 1:
            continue
        cand = cands[0]
        if cand in emp_namespace:          # candidate is another employee's exact name
            continue
        if emp_fl.get(k, 0) != 1:          # >1 employee shares this first+last → ambiguous
            continue
        resolved[n] = cand
    return resolved


def fetch_employee_records(
    employee_name: str, start: datetime.date, end: datetime.date,
    roster: list[str] | None = None,
) -> list[dict]:
    """
    Fetch attendance records for one employee from eSSL.
    Returns [] on error or when not configured.
    Matched by name via _resolve_usernames (exact, then unambiguous first+last fallback).
    `roster` is the full org employee-name list — required for a safe fuzzy match; pass it.
    """
    if not is_configured():
        return []

    name_lower = _norm(employee_name)
    live = _is_live_range(end)
    cache_key = f"emp:{name_lower}:{start}:{end}"
    if not live:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    view = (settings.ATTENDANCE_VIEW or "dbo.vbUserTimeEntryLog").strip()
    try:
        conn = _open_conn()
        try:
            cur = conn.cursor()
            end_exclusive = end + datetime.timedelta(days=1)
            # Resolve to the actual eSSL username (handles middle-name mismatches).
            roster_lower = {_norm(n) for n in roster} if roster else None
            essl_name = _resolve_usernames(
                cur, view, [name_lower], start, end_exclusive, roster_lower
            ).get(name_lower)
            if not essl_name:
                rows = []
            else:
                cur.execute(
                    f"SELECT CHECKDATE, CHECKINTIME, CHECKOUTTIME, TIMEINHOURS "
                    f"FROM {view} "
                    f"WHERE LOWER(USERNAME) = ? AND CHECKDATE >= ? AND CHECKDATE < ? "
                    f"ORDER BY CHECKDATE",
                    (essl_name, start.isoformat(), end_exclusive.isoformat()),
                )
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        finally:
            conn.close()
    except Exception:
        return []

    result = [_map_row(r) for r in rows]
    if not live:
        _cache_set(cache_key, result)
    return result


def fetch_team_records(
    employee_names: list[str], start: datetime.date, end: datetime.date,
    roster: list[str] | None = None,
) -> dict[str, list[dict]]:
    """
    Fetch attendance records for multiple employees in a single SQL round-trip.
    Returns {name_lower: [records]} — empty list for employees with no records.
    Falls back to {} on any error.
    `roster` is the full org employee-name list — required for a safe fuzzy match; pass it.
    """
    if not is_configured() or not employee_names:
        return {}

    names_lower = [_norm(n) for n in employee_names]
    live = _is_live_range(end)
    cache_key = f"team:{','.join(sorted(names_lower))}:{start}:{end}"
    if not live:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    view = (settings.ATTENDANCE_VIEW or "dbo.vbUserTimeEntryLog").strip()
    result: dict[str, list[dict]] = {n: [] for n in names_lower}
    try:
        conn = _open_conn()
        try:
            cur = conn.cursor()
            end_exclusive = end + datetime.timedelta(days=1)
            # Resolve requested names → the eSSL usernames that actually punched, so
            # middle-name mismatches (e.g. "Soniya Kekan" → "Soniya Bhagwat Kekan")
            # don't read as all-Absent. Then query by the resolved usernames and map
            # each returned row back to the requested employee name.
            roster_lower = {_norm(n) for n in roster} if roster else None
            resolved = _resolve_usernames(
                cur, view, names_lower, start, end_exclusive, roster_lower
            )
            essl_to_req: dict[str, list[str]] = {}
            for req, essl in resolved.items():
                essl_to_req.setdefault(essl, []).append(req)

            query_names = list(essl_to_req.keys())
            if query_names:
                placeholders = ",".join("?" for _ in query_names)
                cur.execute(
                    f"SELECT LOWER(USERNAME) AS name_lower, CHECKDATE, CHECKINTIME, "
                    f"CHECKOUTTIME, TIMEINHOURS "
                    f"FROM {view} "
                    f"WHERE LOWER(USERNAME) IN ({placeholders}) "
                    f"AND CHECKDATE >= ? AND CHECKDATE < ? "
                    f"ORDER BY name_lower, CHECKDATE",
                    (*query_names, start.isoformat(), end_exclusive.isoformat()),
                )
                cols = [d[0] for d in cur.description]
                raw_rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            else:
                raw_rows = []
        finally:
            conn.close()
    except Exception:
        return {}

    for raw in raw_rows:
        essl_key = _norm(raw.get("name_lower"))
        r = {k: v for k, v in raw.items() if k != "name_lower"}
        mapped = _map_row(r)
        for req in essl_to_req.get(essl_key, []):
            result[req].append(mapped)

    if not live:
        _cache_set(cache_key, result)
    return result
