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


def fetch_employee_records(
    employee_name: str, start: datetime.date, end: datetime.date
) -> list[dict]:
    """
    Fetch attendance records for one employee from eSSL.
    Returns [] on error or when not configured.
    Matched by exact lowercase name against USERNAME.
    """
    if not is_configured():
        return []

    name_lower = employee_name.strip().lower()
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
            cur.execute(
                f"SELECT CHECKDATE, CHECKINTIME, CHECKOUTTIME, TIMEINHOURS "
                f"FROM {view} "
                f"WHERE LOWER(USERNAME) = ? AND CHECKDATE >= ? AND CHECKDATE < ? "
                f"ORDER BY CHECKDATE",
                (name_lower, start.isoformat(), end_exclusive.isoformat()),
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
    employee_names: list[str], start: datetime.date, end: datetime.date
) -> dict[str, list[dict]]:
    """
    Fetch attendance records for multiple employees in a single SQL round-trip.
    Returns {name_lower: [records]} — empty list for employees with no records.
    Falls back to {} on any error.
    """
    if not is_configured() or not employee_names:
        return {}

    names_lower = [n.strip().lower() for n in employee_names]
    live = _is_live_range(end)
    cache_key = f"team:{','.join(sorted(names_lower))}:{start}:{end}"
    if not live:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    view = (settings.ATTENDANCE_VIEW or "dbo.vbUserTimeEntryLog").strip()
    placeholders = ",".join("?" for _ in names_lower)
    try:
        conn = _open_conn()
        try:
            cur = conn.cursor()
            end_exclusive = end + datetime.timedelta(days=1)
            cur.execute(
                f"SELECT LOWER(USERNAME) AS name_lower, CHECKDATE, CHECKINTIME, "
                f"CHECKOUTTIME, TIMEINHOURS "
                f"FROM {view} "
                f"WHERE LOWER(USERNAME) IN ({placeholders}) "
                f"AND CHECKDATE >= ? AND CHECKDATE < ? "
                f"ORDER BY name_lower, CHECKDATE",
                (*names_lower, start.isoformat(), end_exclusive.isoformat()),
            )
            cols = [d[0] for d in cur.description]
            raw_rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        finally:
            conn.close()
    except Exception:
        return {}

    result: dict[str, list[dict]] = {n: [] for n in names_lower}
    for raw in raw_rows:
        name_key = (raw.get("name_lower") or "").strip().lower()
        if name_key in result:
            r = {k: v for k, v in raw.items() if k != "name_lower"}
            result[name_key].append(_map_row(r))

    if not live:
        _cache_set(cache_key, result)
    return result
