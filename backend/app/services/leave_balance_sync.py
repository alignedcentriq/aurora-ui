"""
Leave Balance Sync Service
--------------------------
On-demand, per-user caching of Zoho People leave balance data.

Design (production-safe):
  - NO background threads or global polling.
  - When a user asks for their balance, the tool calls get_or_refresh(email).
  - If a cached row exists and is younger than CACHE_TTL_SECONDS, it is returned
    immediately from the DB — zero browser activity.
  - If the cache is stale or absent, the headless scraper runs once for that
    specific user, the result is stored, and the response is returned.

This means:
  - Load is strictly proportional to actual user queries.
  - 1000 idle users = 0 background processes.
  - 1000 users each asking once within a 15-minute window = at most 1 scrape
    per user (subsequent asks within TTL are DB hits).

Configuration (via .env.local or environment):
  LEAVE_BALANCE_CACHE_TTL_SECONDS   How long a cached result is considered fresh.
                                    Default: 900 (15 minutes).
"""

import os
import sys
import json
import subprocess
import datetime
from pathlib import Path

from app.database import SessionLocal
from app.models import LeaveBalanceCache

_MCP_SERVER_DIR = Path(__file__).resolve().parent.parent.parent / "mcp_server"
_SESSIONS_DIR   = _MCP_SERVER_DIR / "sessions"
_SCRAPE_SCRIPT  = _MCP_SERVER_DIR / "_zoho_balance.py"

# Each user gets their own result file to avoid collisions under concurrent queries.
def _result_file(email: str) -> Path:
    safe = email.replace("@", "_at_").replace(".", "_")
    return _SESSIONS_DIR / f"zoho_balance_{safe}.json"

CACHE_TTL = int(os.getenv("LEAVE_BALANCE_CACHE_TTL_SECONDS", "900"))


def _zoho_base_url() -> str:
    from app.config import settings
    return (settings.ZOHO_PEOPLE_URL or "").rstrip("/")


def _session_exists() -> bool:
    return (_SESSIONS_DIR / "zoho.bin").exists()


# ── Public API ─────────────────────────────────────────────────────────────────

def get_or_refresh(email: str) -> dict:
    """
    Return leave balance for *email*.

    1. Hit DB cache. If row is fresh (< CACHE_TTL seconds old), return it.
    2. Otherwise run the headless scraper, persist result, return it.

    Return shape:
        {"success": True, "balances": [...], "raw_text": "...",
         "source": "cache"|"live", "cached_at": "<iso>"}
      or
        {"success": False, "error": "...", "action": "run_setup"}  # session expired
      or
        {"success": False, "error": "..."}                         # other failure
    """
    cached = _read_cache(email)
    if cached and cached["age_seconds"] < CACHE_TTL and cached["sync_status"] == "ok":
        return {
            "success": True,
            "balances": cached["balances"],
            "raw_text": cached["raw_text"],
            "source": "cache",
            "cached_at": cached["last_synced_at"].isoformat() if cached["last_synced_at"] else None,
        }

    # Cache is stale, missing, or previously errored — scrape now
    return _scrape_and_cache(email)


def get_cached_balance(email: str) -> dict | None:
    """
    Return the raw cache row for *email* (including age_seconds), or None.
    Used by the tool to decide whether to call get_or_refresh.
    """
    return _read_cache(email)


# ── Internal helpers ───────────────────────────────────────────────────────────

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
            "success": row.sync_status == "ok",
            "balances": row.balances_json or [],
            "raw_text": row.raw_text or "",
            "sync_status": row.sync_status,
            "sync_error": row.sync_error,
            "last_synced_at": row.last_synced_at,
            "age_seconds": int(age),
        }
    finally:
        db.close()


def _scrape_and_cache(email: str) -> dict:
    zoho_base = _zoho_base_url()
    if not zoho_base:
        _persist(email, None, None, "error", "ZOHO_PEOPLE_URL not configured")
        return {"success": False, "error": "ZOHO_PEOPLE_URL not configured"}

    if not _session_exists():
        _persist(email, None, None, "session_expired", "No Zoho session saved")
        return {
            "success": False,
            "error": "Zoho session not set up",
            "action": "run_setup",
        }

    balance_page = zoho_base + "#leavetracker/mydata/summary"
    result_file  = _result_file(email)

    if result_file.exists():
        try:
            result_file.unlink()
        except OSError:
            pass

    try:
        subprocess.run(
            [
                sys.executable, str(_SCRAPE_SCRIPT),
                str(_SESSIONS_DIR),
                balance_page,
                str(result_file),
            ],
            timeout=60,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        _persist(email, None, None, "error", "Scraper timed out")
        return {"success": False, "error": "Zoho portal timed out — please try again."}
    except Exception as exc:
        _persist(email, None, None, "error", str(exc))
        return {"success": False, "error": str(exc)}

    if not result_file.exists():
        _persist(email, None, None, "error", "Scraper produced no output")
        return {"success": False, "error": "No result from Zoho portal — see zoho_balance.log."}

    try:
        data = json.loads(result_file.read_text(encoding="utf-8"))
    except Exception as exc:
        _persist(email, None, None, "error", f"Bad result JSON: {exc}")
        return {"success": False, "error": f"Result parse error: {exc}"}

    if not data.get("success"):
        action = data.get("action", "")
        status = "session_expired" if action == "run_setup" else "error"
        _persist(email, None, None, status, data.get("error", "Unknown"))
        return data

    balances = data.get("balances") or []
    raw_text = data.get("raw_text", "")
    _persist(email, balances, raw_text, "ok", None)
    return {
        "success": True,
        "balances": balances,
        "raw_text": raw_text,
        "source": "live",
        "cached_at": datetime.datetime.utcnow().isoformat(),
    }


def _persist(email: str, balances, raw_text, status: str, error):
    db = SessionLocal()
    try:
        row = db.query(LeaveBalanceCache).filter(LeaveBalanceCache.email == email).first()
        if row is None:
            row = LeaveBalanceCache(email=email)
            db.add(row)
        row.balances_json  = balances
        row.raw_text       = raw_text
        row.sync_status    = status
        row.sync_error     = error
        row.last_synced_at = datetime.datetime.utcnow()
        db.commit()
    except Exception as exc:
        print(f"[leave_balance_sync] DB persist error: {exc}")
        db.rollback()
    finally:
        db.close()
