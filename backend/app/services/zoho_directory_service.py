"""
Zoho employee-profile directory source.

A separate Postgres server holds a read-only SQL VIEW (vb_employees) of Zoho People
profiles — the authoritative HR roster. This service connects to that server on its own
SQLAlchemy engine (kept apart from the app's primary DB) and maps the view's columns into
the flat shape the Employee Directory page expects (see GET /api/employees/directory and
the `DirEmployee` interface in src/pages/EmployeeDirectory.tsx).

Design notes:
  * The engine is built lazily from ZOHO_DBURL / ZOHO_USERNAME / ZOHO_PASSWORD and cached.
  * ZOHO_DBURL may be a full SQLAlchemy/Postgres URL or a bare host[:port][/db]; creds are
    injected from the separate env vars. postgres:// is normalised to postgresql+psycopg2.
  * Columns are read case-insensitively (SELECT *), so the precise stored casing of the
    view's identifiers ("EmployeeId", "FirstName", …) doesn't have to be quoted in SQL.
  * Fail-soft: any connection/query error returns [] so the route can fall back gracefully.
"""

import datetime
import re
import threading

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url, URL

from app.config import settings

_engine = None
_engine_lock = threading.Lock()
# Sentinel so a failed build isn't retried on every request within the same process boot
# while still allowing a config fix + restart to recover.
_engine_failed = False


def _build_url() -> URL | None:
    raw = (settings.ZOHO_DBURL or "").strip()
    if not raw:
        return None
    # JDBC-style URLs (jdbc:postgresql://…) are common in HR/BI configs — drop the prefix.
    if raw.lower().startswith("jdbc:"):
        raw = raw[len("jdbc:"):]
    user = (settings.ZOHO_USERNAME or "").strip()
    pwd = settings.ZOHO_PASSWORD or ""

    if "://" in raw:
        url = make_url(raw)
        if url.drivername in ("postgres", "postgresql"):
            url = url.set(drivername="postgresql+psycopg2")
        if user:
            url = url.set(username=user)
        if pwd:
            url = url.set(password=pwd)
        return url

    # Bare host[:port][/database]
    host, database = raw, None
    if "/" in host:
        host, database = host.split("/", 1)
    port = None
    if ":" in host:
        host, port_s = host.split(":", 1)
        port = int(port_s) if port_s.isdigit() else None
    return URL.create(
        "postgresql+psycopg2",
        username=user or None,
        password=pwd or None,
        host=host or None,
        port=port,
        database=database or None,
    )


def _get_engine():
    global _engine, _engine_failed
    if _engine is not None or _engine_failed:
        return _engine
    with _engine_lock:
        if _engine is not None or _engine_failed:
            return _engine
        url = _build_url()
        if url is None:
            _engine_failed = True
            return None
        try:
            _engine = create_engine(
                url,
                pool_size=5,
                max_overflow=5,
                pool_pre_ping=True,
                pool_recycle=1800,
                connect_args={"connect_timeout": 10},
            )
        except Exception:
            _engine_failed = True
            _engine = None
        return _engine


def is_configured() -> bool:
    return bool((settings.ZOHO_DBURL or "").strip())


def _g(row: dict, *names: str) -> str:
    """Case-insensitive lookup across candidate column names; first non-empty wins."""
    for n in names:
        v = row.get(n)
        if v not in (None, ""):
            return str(v).strip()
    return ""


# Manager fields in the view are stored as "Full Name AASPL-1538" — strip the trailing
# employee-code token so the directory shows a clean name.
_MGR_CODE_RE = re.compile(r"\s+[A-Z]{2,}-?\d+\s*$")


def _clean_manager(value: str) -> str:
    return _MGR_CODE_RE.sub("", value).strip()


def _fmt_birthday(row: dict) -> str:
    """Day + month only (no year) so the directory mirrors the portal without exposing age."""
    v = row.get("dateofbirth")
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.strftime("%d %b")
    s = (str(v).strip() if v else "")
    if not s:
        return ""
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.datetime.strptime(s[:19], fmt).strftime("%d %b")
        except ValueError:
            continue
    return s


def _is_active(row: dict) -> bool:
    """Keep current staff; drop clearly-separated profiles (exited/resigned/terminated)."""
    status = _g(row, "employeestatus").lower()
    if status and any(t in status for t in ("exit", "resign", "terminat", "inactive", "left", "relieved")):
        return False
    if _g(row, "dateofexit"):
        return False
    return True


def fetch_raw_rows() -> list[dict]:
    """Return every column of every row in the Zoho view, lower-cased keys, no shaping/filtering.

    Fail-soft: returns [] on any error or when the source isn't configured. Used both by
    fetch_directory() (shaped for the Directory page) and by analytics aggregations that need
    live headcount-by-X counts straight off the authoritative HR roster rather than a stale
    local copy."""
    engine = _get_engine()
    if engine is None:
        return []

    view = (settings.ZOHO_VIEW or "vb_employees").strip()
    try:
        with engine.connect() as conn:
            result = conn.execute(text(f"SELECT * FROM {view}"))
            # Lower-case every column key once so mapping is casing-agnostic.
            return [
                {str(k).lower(): v for k, v in m.items()}
                for m in result.mappings().all()
            ]
    except Exception:
        return []


def fetch_directory() -> list[dict]:
    """Return the active roster from the Zoho view in `DirEmployee` shape, sorted by name.

    Fail-soft: returns [] on any error or when the source isn't configured."""
    raw_rows = fetch_raw_rows()
    if not raw_rows:
        return []

    out: list[dict] = []
    for row in raw_rows:
        email = _g(row, "emailid", "official_email", "email")
        first = _g(row, "firstname")
        last = _g(row, "lastname")
        name = (f"{first} {last}").strip() or _g(row, "name") or email
        if not name:
            continue
        if not _is_active(row):
            continue
        out.append({
            "name": name,
            "email": email,
            "employee_code": _g(row, "employeeid", "employee_code"),
            "designation": _g(row, "designation"),
            "department": _g(row, "department", "parentdepartment"),
            "location": _g(row, "worklocation", "locationname"),
            "city": _g(row, "presentaddresscity", "permanentaddresscity", "locationname"),
            "reporting_manager": _clean_manager(_g(row, "reportingmanager")),
            "reporting_manager_email": _g(row, "reportingmanageremail").lower(),
            "functional_manager": _clean_manager(_g(row, "functionalmanager")),
            "phone": _g(row, "workphone", "mobilenumber"),
            "extension": "",
            "nick_name": "",
            "birthday": _fmt_birthday(row),
        })

    out.sort(key=lambda x: x["name"].lower())
    return out


def _parse_any_date(v) -> datetime.date | None:
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    s = (str(v).strip() if v else "")
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.datetime.strptime(s[:19], fmt).date()
        except ValueError:
            continue
    return None


def aggregate_field_counts(*field_candidates: str, active_only: bool = True) -> list[tuple[str, int]]:
    """Live headcount-by-<field> straight off the Zoho view — no local copy to go stale.

    field_candidates are tried in order per row (first non-empty wins), same convention as
    _g(). Returns [(label, count), ...] sorted by count descending. Fail-soft: [] when the
    view isn't configured/reachable, so callers can fall back to a local source."""
    rows = fetch_raw_rows()
    counts: dict[str, int] = {}
    for row in rows:
        if active_only and not _is_active(row):
            continue
        val = _g(row, *field_candidates)
        if not val:
            continue
        counts[val] = counts.get(val, 0) + 1
    return sorted(counts.items(), key=lambda kv: kv[1], reverse=True)


def _next_occurrence(today: datetime.date, month: int, day: int) -> datetime.date:
    """Next calendar date this month/day falls on, today or later."""
    for year in (today.year, today.year + 1):
        try:
            candidate = datetime.date(year, month, day)
        except ValueError:
            candidate = datetime.date(year, month, 28)  # Feb 29 in a non-leap year
        if candidate >= today:
            return candidate
    return datetime.date(today.year + 1, month, day)


def fetch_upcoming_celebrations(days: int = 14) -> dict:
    """Upcoming birthdays and work anniversaries within the next `days` days.

    Sourced live from the Zoho view, same as the Directory page. Birthdays surface
    day+month only (never year — see _fmt_birthday) so age is never exposed; a join
    date isn't sensitive so anniversaries show the actual milestone year count.
    Fail-soft: {"birthdays": [], "anniversaries": []} when the view is unreachable.
    """
    today = datetime.date.today()
    birthdays: list[dict] = []
    anniversaries: list[dict] = []

    for row in fetch_raw_rows():
        if not _is_active(row):
            continue
        first = _g(row, "firstname")
        last = _g(row, "lastname")
        name = (f"{first} {last}").strip() or _g(row, "name")
        if not name:
            continue
        email = _g(row, "emailid", "official_email", "email")

        dob = _parse_any_date(row.get("dateofbirth"))
        if dob:
            occurs = _next_occurrence(today, dob.month, dob.day)
            days_away = (occurs - today).days
            if days_away <= days:
                birthdays.append({
                    "name": name, "email": email, "date": occurs.isoformat(), "days_away": days_away,
                })

        doj = _parse_any_date(row.get("dateofjoining"))
        if doj:
            occurs = _next_occurrence(today, doj.month, doj.day)
            days_away = (occurs - today).days
            years = occurs.year - doj.year
            if days_away <= days and years > 0:
                anniversaries.append({
                    "name": name, "date": occurs.isoformat(), "days_away": days_away, "years": years,
                })

    birthdays.sort(key=lambda b: b["days_away"])
    anniversaries.sort(key=lambda a: a["days_away"])
    return {"birthdays": birthdays, "anniversaries": anniversaries}


def aggregate_joining_trend(cutoff: datetime.date) -> list[tuple[datetime.date, int]]:
    """Live new-joiner count per month since `cutoff`, off the Zoho view's dateofjoining.

    Matches all joiners in the window regardless of current employment status (mirrors the
    original 'joining_trend' query, which never filtered on active/inactive). Returns
    [(month_start_date, count), ...] sorted chronologically. Fail-soft: [] when unavailable."""
    rows = fetch_raw_rows()
    counts: dict[datetime.date, int] = {}
    for row in rows:
        d = _parse_any_date(row.get("dateofjoining"))
        if not d or d < cutoff:
            continue
        month_key = d.replace(day=1)
        counts[month_key] = counts.get(month_key, 0) + 1
    return sorted(counts.items(), key=lambda kv: kv[0])
