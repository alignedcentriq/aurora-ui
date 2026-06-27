"""
Leave Balance Sync Service
--------------------------
On-demand, per-user leave balance via Zoho People REST API.

Design:
  - NO background threads, NO headless browser, NO file system sessions.
  - get_or_refresh(email) → check DB cache → if stale, call Zoho API → persist → return.
  - Per-user delegated OAuth2 token from ConnectedAccount table (provider="zoho").
  - Load = O(active queries), not O(total users).

Cache TTL: LEAVE_BALANCE_CACHE_TTL_SECONDS (default 900s = 15 min).
"""

import datetime
import os

import requests

from app.database import SessionLocal
from app.models import LeaveBalanceCache

CACHE_TTL = int(os.getenv("LEAVE_BALANCE_CACHE_TTL_SECONDS", "900"))


def _get_zoho_token(email: str) -> str | None:
    """Get a valid per-user Zoho token from ConnectedAccount, refreshing if needed."""
    from app.services.email_service import _run_coro
    from app.services.oauth_service import get_valid_token
    return _run_coro(get_valid_token(email, "zoho"))


# ── Zoho People API call ────────────────────────────────────────────────────────

def _fetch_from_api(email: str, token: str) -> list[dict]:
    """Call Zoho People leave balance API and return a normalised balances list."""
    from app.config import settings

    year = datetime.datetime.utcnow().year
    url  = f"{settings.ZOHO_BASE_URL}/people/api/v2/leavetracker/reports/bookedAndBalance"

    resp = requests.get(
        url,
        params={"from": f"{year}-01-01", "to": f"{year}-12-31", "unit": "Day"},
        headers={"Authorization": f"Zoho-oauthtoken {token}"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    # Response shape:
    # {
    #   "leavetypes": { "<ltId>": {"name": "Casual Leave", "unit": "Day"} },
    #   "report":     { "<empRecNo>": { "<ltId>": {"booked": 3, "balance": 9}, "total": {...} } },
    #   "employees":  ["<empRecNo>", ...]
    # }
    leavetypes_map = data.get("leavetypes", {})
    report         = data.get("report", {})

    if not report:
        return []

    # Pick the first (or only) employee record — works for self-service single user.
    # For multi-user, a separate employee lookup maps email → record number.
    emp_data = next(iter(report.values()))

    balances = []
    for lt_id, lt_data in emp_data.items():
        if lt_id == "total" or not isinstance(lt_data, dict):
            continue
        leave_name = leavetypes_map.get(lt_id, {}).get("name", lt_id)
        balance    = float(lt_data.get("balance") or 0)
        booked     = float(lt_data.get("booked")  or 0)
        balances.append({
            "type":    leave_name,
            "total":   round(balance + booked, 1),
            "used":    booked,
            "balance": balance,
        })
    return balances


# ── Public API ──────────────────────────────────────────────────────────────────

def get_or_refresh(email: str) -> dict:
    """
    Return leave balance for *email*.

    1. Check DB cache — if fresh (< CACHE_TTL seconds), return immediately.
    2. Otherwise call Zoho People API, persist result, return.

    Return shapes:
        {"success": True,  "balances": [...], "source": "cache"|"live", "cached_at": "..."}
        {"success": False, "error": "..."}
    """
    from app.config import settings
    if settings.ZOHO_DEMO_MODE:
        return _demo_result(email)

    cached = _read_cache(email)
    if cached and cached["age_seconds"] < CACHE_TTL and cached["sync_status"] == "ok":
        return {
            "success":   True,
            "balances":  cached["balances"],
            "source":    "cache",
            "cached_at": cached["last_synced_at"].isoformat() if cached["last_synced_at"] else None,
        }
    return _fetch_and_cache(email)


# ── Demo source (real CSV, per-user) ──────────────────────────────────────────────

def _resolve_employee(email: str) -> tuple[str, str]:
    """Map an email to (employee_code, name) via the Employee directory. ('','') if unknown."""
    if not email:
        return "", ""
    db = SessionLocal()
    try:
        from app.models import Employee
        emp = db.query(Employee).filter(Employee.email == email).first()
        if emp:
            return (emp.employee_id or ""), (emp.name or "")
    except Exception:
        pass
    finally:
        db.close()
    return "", ""


def _have_csv() -> bool:
    """True if the leave-balance CSV roster is present (used as offline fallback)."""
    from app.services import leave_balance_data
    return leave_balance_data.has_data()


def _demo_result(email: str) -> dict:
    """Standard success envelope around the CSV-backed per-user balances."""
    return {
        "success":   True,
        "balances":  _demo_balances(email),
        "source":    "demo",
        "cached_at": datetime.datetime.utcnow().isoformat(),
    }


def _demo_balances(email: str) -> list[dict]:
    """
    Per-user leave balances for demo mode.

    Prefer the real CSV (app/data/leave_balances.csv) matched to the signed-in user;
    fall back to a configured demo employee, then to the generic static fixture.
    """
    from app.config import settings
    from app.services import leave_balance_data, zoho_demo_data

    if leave_balance_data.has_data():
        code, name = _resolve_employee(email)
        balances = leave_balance_data.balances_for(code, name)
        if balances is None and settings.LEAVE_BALANCE_DEMO_EMPLOYEE:
            balances = leave_balance_data.balances_for(settings.LEAVE_BALANCE_DEMO_EMPLOYEE)
        if balances:
            return balances

    return zoho_demo_data.leave_balances()


# ── Internal helpers ────────────────────────────────────────────────────────────

def _fetch_and_cache(email: str) -> dict:
    token = _get_zoho_token(email)
    if not token:
        # No live Zoho connection — serve the real CSV roster instead of an error,
        # so leave balances work even before per-user OAuth is wired up.
        if _have_csv():
            return _demo_result(email)
        return {"success": False, "error": "not_connected"}

    try:
        balances = _fetch_from_api(email, token)
        _persist(email, balances, "ok", None)
        return {
            "success":   True,
            "balances":  balances,
            "source":    "live",
            "cached_at": datetime.datetime.utcnow().isoformat(),
        }
    except requests.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else 0
        if code in (401, 403):
            _persist(email, None, "auth_error", str(exc))
            if _have_csv():
                return _demo_result(email)
            return {"success": False, "error": "not_connected"}
        _persist(email, None, "error", str(exc))
        return {"success": False, "error": f"Zoho API error {code} — please try again."}
    except Exception as exc:
        _persist(email, None, "error", str(exc))
        return {"success": False, "error": str(exc)}


def _read_cache(email: str) -> dict | None:
    db = SessionLocal()
    try:
        row = db.query(LeaveBalanceCache).filter(LeaveBalanceCache.email == email).first()
        if row is None:
            return None
        age = (
            (datetime.datetime.utcnow() - row.last_synced_at).total_seconds()
            if row.last_synced_at else float("inf")
        )
        return {
            "balances":      row.balances_json or [],
            "sync_status":   row.sync_status,
            "last_synced_at": row.last_synced_at,
            "age_seconds":   int(age),
        }
    finally:
        db.close()


def _persist(email: str, balances, status: str, error):
    db = SessionLocal()
    try:
        row = db.query(LeaveBalanceCache).filter(LeaveBalanceCache.email == email).first()
        if row is None:
            row = LeaveBalanceCache(email=email)
            db.add(row)
        row.balances_json  = balances
        row.raw_text       = None
        row.sync_status    = status
        row.sync_error     = error
        row.last_synced_at = datetime.datetime.utcnow()
        db.commit()
    except Exception as exc:
        db.rollback()
    finally:
        db.close()
