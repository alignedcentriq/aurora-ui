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
        from app.services import zoho_demo_data
        return {
            "success":   True,
            "balances":  zoho_demo_data.leave_balances(),
            "source":    "demo",
            "cached_at": datetime.datetime.utcnow().isoformat(),
        }

    cached = _read_cache(email)
    if cached and cached["age_seconds"] < CACHE_TTL and cached["sync_status"] == "ok":
        return {
            "success":   True,
            "balances":  cached["balances"],
            "source":    "cache",
            "cached_at": cached["last_synced_at"].isoformat() if cached["last_synced_at"] else None,
        }
    return _fetch_and_cache(email)


# ── Internal helpers ────────────────────────────────────────────────────────────

def _fetch_and_cache(email: str) -> dict:
    token = _get_zoho_token(email)
    if not token:
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
