"""One-click offboarding — revoke a user's access, reversibly.

Scope (in-app, reversible — no external Entra admin rights required):
  • Block the account in the app's auth gate (OffboardedUser row, status='offboarded').
  • Clear their role override + extra capabilities (drops any elevated access to base).
  • Delete stored Microsoft/Zoho connections (revokes the app's saved delegated tokens).

Reinstating flips the block off. Roles/connections are NOT auto-restored on reinstate — HR
re-grants a role and the user reconnects their mailbox — but the account can sign in again.
What was cleared is captured in revoked_summary for audit.
"""

from __future__ import annotations

import datetime
import logging

from app.database import SessionLocal
from app.models import OffboardedUser, UserRoleOverride, ConnectedAccount

logger = logging.getLogger("aurora-logger")


def is_offboarded(email: str) -> bool:
    """True if this email is currently offboarded (used by the auth gate). Fail-open on error."""
    if not email:
        return False
    db = SessionLocal()
    try:
        row = db.query(OffboardedUser).filter(
            OffboardedUser.email == email.lower(),
            OffboardedUser.status == "offboarded",
        ).first()
        return row is not None
    except Exception:
        return False
    finally:
        db.close()


def offboard(email: str, actor_email: str) -> dict:
    """Revoke access for `email`. Returns {ok, summary} or {ok: False, error}."""
    email = (email or "").strip().lower()
    if not email:
        return {"ok": False, "error": "An email is required."}
    if email == (actor_email or "").strip().lower():
        return {"ok": False, "error": "You can't offboard your own account."}

    db = SessionLocal()
    try:
        summary: dict = {"cleared_role": None, "cleared_capabilities": 0, "connections_removed": []}

        # 1. Clear any role override (capture it first for the audit trail).
        override = db.query(UserRoleOverride).filter(UserRoleOverride.email == email).first()
        if override:
            summary["cleared_role"] = override.role
            summary["cleared_capabilities"] = len(override.extra_capabilities or [])
            db.delete(override)

        # 2. Delete stored MS/Zoho connections (revoke the app's saved tokens).
        conns = db.query(ConnectedAccount).filter(ConnectedAccount.user_email == email).all()
        for c in conns:
            summary["connections_removed"].append(c.provider)
            db.delete(c)

        # 3. Record / flip the offboarding block (idempotent on email).
        row = db.query(OffboardedUser).filter(OffboardedUser.email == email).first()
        now = datetime.datetime.utcnow()
        if row is None:
            row = OffboardedUser(email=email)
            db.add(row)
        row.status = "offboarded"
        row.offboarded_by = actor_email
        row.offboarded_at = now
        row.reinstated_by = None
        row.reinstated_at = None
        row.revoked_summary = summary

        db.commit()
        logger.info("[offboard] %s offboarded by %s — %s", email, actor_email, summary)
        return {"ok": True, "email": email, "summary": summary}
    except Exception as e:
        db.rollback()
        logger.error("[offboard] failed for %s: %s", email, e)
        return {"ok": False, "error": "Offboarding failed. Please try again."}
    finally:
        db.close()


def reinstate(email: str, actor_email: str) -> dict:
    """Lift the access block so the user can sign in again (roles/connections not auto-restored)."""
    email = (email or "").strip().lower()
    db = SessionLocal()
    try:
        row = db.query(OffboardedUser).filter(OffboardedUser.email == email).first()
        if row is None or row.status != "offboarded":
            return {"ok": False, "error": "That user isn't currently offboarded."}
        row.status = "reinstated"
        row.reinstated_by = actor_email
        row.reinstated_at = datetime.datetime.utcnow()
        db.commit()
        logger.info("[offboard] %s reinstated by %s", email, actor_email)
        return {"ok": True, "email": email}
    finally:
        db.close()


def list_offboarded() -> list[dict]:
    """All offboarding records (offboarded + reinstated), newest first."""
    db = SessionLocal()
    try:
        rows = db.query(OffboardedUser).order_by(OffboardedUser.offboarded_at.desc()).all()
        return [
            {
                "email": r.email,
                "status": r.status,
                "offboarded_by": r.offboarded_by,
                "offboarded_at": r.offboarded_at.isoformat() if r.offboarded_at else None,
                "reinstated_by": r.reinstated_by,
                "reinstated_at": r.reinstated_at.isoformat() if r.reinstated_at else None,
                "revoked_summary": r.revoked_summary,
            }
            for r in rows
        ]
    finally:
        db.close()


def status_for(email: str) -> dict:
    """Offboarding status for one email (for the tracker drawer): {offboarded: bool, ...}."""
    email = (email or "").strip().lower()
    db = SessionLocal()
    try:
        row = db.query(OffboardedUser).filter(OffboardedUser.email == email).first()
        if row is None:
            return {"offboarded": False, "status": "active"}
        return {
            "offboarded": row.status == "offboarded",
            "status": row.status,
            "offboarded_at": row.offboarded_at.isoformat() if row.offboarded_at else None,
            "revoked_summary": row.revoked_summary,
        }
    finally:
        db.close()
