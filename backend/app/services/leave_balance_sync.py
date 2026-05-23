"""
Leave Balance Sync Service
--------------------------
On-demand, per-user leave balance via Zoho People REST API.

Design:
  - NO background threads, NO headless browser, NO file system sessions.
  - get_or_refresh(email) → check DB cache → if stale, call Zoho API → persist → return.
  - One admin-level OAuth2 refresh_token in .env serves all employees
    (Zoho respects hierarchy: admin token + userId param returns that employee's balance).
  - Load = O(active queries), not O(total users).

Cache TTL: LEAVE_BALANCE_CACHE_TTL_SECONDS (default 900s = 15 min).
"""

import datetime
import os

import requests

from app.database import SessionLocal
from app.models import LeaveBalanceCache

CACHE_TTL = int(os.getenv("LEAVE_BALANCE_CACHE_TTL_SECONDS", "900"))


# ── Token management ────────────────────────────────────────────────────────────

def _get_access_token() -> str:
    """Exchange the stored refresh_token for a fresh access_token."""
    from app.config import settings
    resp = requests.post(
        f"{settings.ZOHO_ACCOUNTS_URL}/oauth/v2/token",
        data={
            "refresh_token": settings.ZOHO_REFRESH_TOKEN,
            "client_id":     settings.ZOHO_CLIENT_ID,
            "client_secret": settings.ZOHO_CLIENT_SECRET,
            "grant_type":    "refresh_token",
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if "access_token" not in data:
        raise RuntimeError(f"Token refresh failed: {data}")
    return data["access_token"]


# ── Zoho People API call ────────────────────────────────────────────────────────

def _fetch_from_api(email: str) -> list[dict]:
    """Call Zoho People leave balance API and return a normalised balances list."""
    from app.config import settings
    token = _get_access_token()

    year = datetime.datetime.utcnow().year
    url  = f"{settings.ZOHO_BASE_URL}/people/api/v2/leavetracker/reports/bookedAndBalance"
    print(f"[leave_balance] GET {url} email={email} year={year}")

    resp = requests.get(
        url,
        params={"from": f"{year}-01-01", "to": f"{year}-12-31", "unit": "Day"},
        headers={"Authorization": f"Zoho-oauthtoken {token}"},
        timeout=15,
    )
    print(f"[leave_balance] status={resp.status_code} body={resp.text[:800]}")
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
    from app.config import settings

    if not settings.ZOHO_REFRESH_TOKEN:
        return {"success": False, "error": "Zoho API not configured — add ZOHO_REFRESH_TOKEN to .env"}

    try:
        balances = _fetch_from_api(email)
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
            return {"success": False, "error": "Zoho API authentication failed — refresh token may need to be regenerated."}
        _persist(email, None, "error", str(exc))
        return {"success": False, "error": f"Zoho API error {code} — please try again."}
    except Exception as exc:
        _persist(email, None, "error", str(exc))
        return {"success": False, "error": str(exc)}


# ── Zoho Leave Application API ─────────────────────────────────────────────────

def _get_leave_type_id(leave_type_name: str, token: str) -> str | None:
    """Fetch leave types from Zoho and return the ID matching leave_type_name."""
    from app.config import settings
    resp = requests.get(
        f"{settings.ZOHO_BASE_URL}/people/api/leave/v2/leaveTypes",
        headers={"Authorization": f"Zoho-oauthtoken {token}"},
        timeout=10,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    items = data.get("response", {}).get("result", data.get("data", []))
    name_lower = leave_type_name.lower()
    for item in items:
        lt_name = (item.get("leaveType") or item.get("leavename") or "").lower()
        if name_lower in lt_name or lt_name in name_lower:
            return str(item.get("leaveTypeId") or item.get("id") or "")
    return None


def apply_leave(email: str, start_date: str, end_date: str, leave_type: str, reason: str = "") -> dict:
    """
    Apply leave via Zoho People API.

    Returns:
        {"success": True,  "request_id": "...", "message": "Leave applied successfully"}
        {"success": False, "error": "..."}
    """
    from app.config import settings
    try:
        token   = _get_access_token()
        lt_id   = _get_leave_type_id(leave_type, token)
        if not lt_id:
            return {"success": False, "error": f"Could not find leave type '{leave_type}' in Zoho."}

        resp = requests.post(
            f"{settings.ZOHO_BASE_URL}/people/api/leave/v2/leave/apply",
            headers={"Authorization": f"Zoho-oauthtoken {token}"},
            json={
                "leaveTypeId": lt_id,
                "from":        start_date,
                "to":          end_date,
                "reason":      reason or "",
                "userId":      email,
                "unit":        "Day",
            },
            timeout=15,
        )
        print(f"[apply_leave] status={resp.status_code} body={resp.text[:400]}")
        resp.raise_for_status()
        data       = resp.json()
        request_id = (
            data.get("response", {}).get("result", {}).get("requestId")
            or data.get("requestId")
            or ""
        )
        return {"success": True, "request_id": request_id, "message": "Leave applied successfully."}
    except requests.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else 0
        return {"success": False, "error": f"Zoho API error {code} while applying leave."}
    except Exception as exc:
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
        print(f"[leave_balance_sync] DB persist error: {exc}")
        db.rollback()
    finally:
        db.close()
