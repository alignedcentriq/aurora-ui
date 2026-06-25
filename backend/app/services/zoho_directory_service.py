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


def fetch_directory() -> list[dict]:
    """Return the active roster from the Zoho view in `DirEmployee` shape, sorted by name.

    Fail-soft: returns [] on any error or when the source isn't configured."""
    engine = _get_engine()
    if engine is None:
        return []

    view = (settings.ZOHO_VIEW or "vb_employees").strip()
    try:
        with engine.connect() as conn:
            result = conn.execute(text(f"SELECT * FROM {view}"))
            # Lower-case every column key once so mapping is casing-agnostic.
            raw_rows = [
                {str(k).lower(): v for k, v in m.items()}
                for m in result.mappings().all()
            ]
    except Exception:
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
