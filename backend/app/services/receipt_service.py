"""Action receipts + undo — the trust / compliance ledger (roadmap item 6).

Every executed *write* action emits one ActionReceipt: WHAT was done, in WHICH system,
WHEN, the downstream CONFIRMATION id, and — where the downstream still allows reversal —
a one-click UNDO. Receipts are surfaced two ways:
  • inline, as a compact line appended to the assistant's confirmation (format_receipt_line)
  • in the in-app receipts feed (list_for_user) and a branded undo page (main.py route)

This sits on top of the same Postgres durability the pending_action state machine uses, so
a receipt (and its undo capability) survives a restart. emit() is idempotent on
idempotency_key — an action that re-runs (a retry, or the "you already have a ticket" path)
never produces a second receipt.

Undo is deliberately conservative: an action is undoable ONLY if a handler is registered
here AND the downstream still permits it (e.g. the ticket is still 'Open'). The handler is
the single authority on whether reversal is allowed — it re-checks live state every time,
so a receipt that *looks* undoable still refuses once IT has picked the ticket up.
"""

from __future__ import annotations

import datetime
import logging
import secrets
from typing import Callable, Optional

from app.config import settings
from app.database import SessionLocal
from app.models import ActionReceipt

log = logging.getLogger("aurora-logger")


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


# ── Undo registry ────────────────────────────────────────────────────────────
# action_type -> handler(receipt_row) -> {"success": bool, "error"?: str, "message"?: str,
# "already"?: bool}. Only action_types present here are ever undoable. Handlers re-check
# live downstream state and own the "is reversal still allowed?" decision. Imports are lazy
# to avoid a circular import (services import this module).

def _undo_it_ticket(r: ActionReceipt) -> dict:
    from app.services.it_service import ITService
    return ITService.cancel_ticket(r.confirmation_id, r.user_email)


def _undo_hr_query(r: ActionReceipt) -> dict:
    from app.hr_service import HRService
    return HRService.withdraw_hr_query(r.confirmation_id, r.user_email)


_UNDO_HANDLERS: dict[str, Callable[[ActionReceipt], dict]] = {
    "it_ticket": _undo_it_ticket,
    "hr_query": _undo_hr_query,
}

# User-facing verb for the undo, per action_type (defaults to "undo").
_UNDO_VERB = {"it_ticket": "cancel ticket", "hr_query": "withdraw query"}


# ── Emit ─────────────────────────────────────────────────────────────────────

def emit(
    user_email: str,
    action_type: str,
    system: str,
    summary: str,
    *,
    confirmation_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    meta: Optional[dict] = None,
    undoable: Optional[bool] = None,
) -> dict:
    """Record an executed action and return a snapshot dict (incl. undo_url when undoable).

    Idempotent: if a receipt already exists for idempotency_key (or, failing that, for the
    same action_type+confirmation_id), the existing one is returned unchanged — so retries
    and dedupe paths never double-log. Never raises; on any failure it logs and returns a
    minimal snapshot so the calling action is never broken by receipt bookkeeping.
    """
    db = SessionLocal()
    try:
        existing = None
        if idempotency_key:
            existing = (db.query(ActionReceipt)
                        .filter(ActionReceipt.idempotency_key == idempotency_key)
                        .order_by(ActionReceipt.created_at.desc()).first())
        if existing is None and confirmation_id:
            existing = (db.query(ActionReceipt)
                        .filter(ActionReceipt.action_type == action_type,
                                ActionReceipt.confirmation_id == confirmation_id)
                        .order_by(ActionReceipt.created_at.desc()).first())
        if existing is not None:
            return _to_dict(existing)

        can_undo = (action_type in _UNDO_HANDLERS) if undoable is None else bool(undoable)
        token = secrets.token_urlsafe(24) if can_undo else None
        deadline = None
        if can_undo and settings.RECEIPT_UNDO_WINDOW_MIN > 0:
            deadline = _now() + datetime.timedelta(minutes=settings.RECEIPT_UNDO_WINDOW_MIN)

        row = ActionReceipt(
            user_email=user_email or "",
            action_type=action_type,
            system=system,
            summary=summary,
            confirmation_id=confirmation_id,
            entity_type=entity_type or action_type,
            entity_id=entity_id or confirmation_id,
            idempotency_key=idempotency_key,
            status="executed",
            undoable=can_undo,
            undo_token=token,
            undo_deadline=deadline,
            receipt_metadata=meta or None,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _to_dict(row)
    except Exception as exc:
        db.rollback()
        log.warning("[receipt] emit failed (%s/%s): %s", action_type, confirmation_id, exc)
        return {"action_type": action_type, "system": system, "summary": summary,
                "confirmation_id": confirmation_id, "undoable": False, "undo_url": None}
    finally:
        db.close()


# ── Undo ─────────────────────────────────────────────────────────────────────

def undo(token: str, user_email: Optional[str] = None) -> dict:
    """Execute the undo for the receipt behind `token`. Returns
    {"success": bool, "message": str, "summary"?: str, ...}.

    The token is the capability (like an approval link), but when the caller knows who is
    clicking (an authenticated feed request) we additionally enforce ownership. Re-clicking
    an already-undone receipt is a friendly success, not an error. The registered handler
    owns the live "is reversal still possible?" check; if it declines, the receipt stays
    'executed' and the handler's message is surfaced.
    """
    db = SessionLocal()
    try:
        r = db.query(ActionReceipt).filter(ActionReceipt.undo_token == token).first()
        if not r:
            return {"success": False, "error": "invalid",
                    "message": "This undo link is invalid or has already expired."}
        if user_email and r.user_email and user_email.lower() != r.user_email.lower():
            return {"success": False, "error": "not_owner",
                    "message": "This action belongs to a different user."}
        if r.status == "undone":
            return {"success": True, "already": True, "summary": r.summary,
                    "message": f"Already undone — {r.summary} was reversed."}
        if not r.undoable:
            return {"success": False, "error": "not_undoable",
                    "message": f"{r.summary} can't be undone automatically."}
        if r.undo_deadline and _now() > r.undo_deadline:
            return {"success": False, "error": "expired",
                    "message": "The window to undo this action has passed."}

        handler = _UNDO_HANDLERS.get(r.action_type)
        if not handler:
            return {"success": False, "error": "not_undoable",
                    "message": f"{r.summary} can't be undone automatically."}

        result = handler(r)
        if not result.get("success"):
            # Downstream refused (in progress / not found / not owner). Leave the receipt as-is.
            return {"success": False, "error": result.get("error", "undo_failed"),
                    "summary": r.summary,
                    "message": result.get("message")
                    or f"Couldn't undo {r.summary} — it may already be in progress."}

        r.status = "undone"
        r.undone_at = _now()
        db.commit()
        return {"success": True, "summary": r.summary, "system": r.system,
                "confirmation_id": r.confirmation_id,
                "message": f"Done — {r.summary} ({r.confirmation_id}) has been reversed in {r.system}."}
    except Exception as exc:
        db.rollback()
        log.warning("[receipt] undo failed for token=%s: %s", (token or "")[:8], exc)
        return {"success": False, "error": "error",
                "message": "Something went wrong reversing this action. Please try again."}
    finally:
        db.close()


# ── Queries / formatting ─────────────────────────────────────────────────────

def _undo_url(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    return f"{(settings.APP_BASE_URL or '').rstrip('/')}/api/receipts/undo/{token}"


def _to_dict(r: ActionReceipt) -> dict:
    live_undoable = bool(
        r.undoable and r.status == "executed"
        and (r.undo_deadline is None or r.undo_deadline > _now())
    )
    return {
        "id": r.id,
        "user_email": r.user_email,
        "action_type": r.action_type,
        "system": r.system,
        "summary": r.summary,
        "confirmation_id": r.confirmation_id,
        "status": r.status,
        "undoable": live_undoable,
        "undo_url": _undo_url(r.undo_token) if live_undoable else None,
        "undo_label": _UNDO_VERB.get(r.action_type, "undo"),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "undone_at": r.undone_at.isoformat() if r.undone_at else None,
    }


def peek(token: str) -> Optional[dict]:
    """Read-only snapshot of the receipt behind an undo token — NEVER mutates. Used to render
    the undo confirmation page so a bare GET (or a link prefetcher) can't reverse an action.
    Adds an ``expired`` flag for a token whose undo window has lapsed."""
    db = SessionLocal()
    try:
        r = db.query(ActionReceipt).filter(ActionReceipt.undo_token == token).first()
        if not r:
            return None
        d = _to_dict(r)
        d["expired"] = bool(r.undo_deadline and _now() > r.undo_deadline and r.status == "executed")
        return d
    finally:
        db.close()


def list_for_user(email: str, limit: int = 50) -> list[dict]:
    db = SessionLocal()
    try:
        rows = (db.query(ActionReceipt)
                .filter(ActionReceipt.user_email == email)
                .order_by(ActionReceipt.created_at.desc())
                .limit(limit).all())
        return [_to_dict(r) for r in rows]
    finally:
        db.close()


def format_receipt_line(snap: dict) -> str:
    """A compact markdown line for the assistant's confirmation message:

        🧾 Logged in IT Helpdesk (ManageEngine) · ref **IT-0620…** — [Cancel ticket](url)

    Returns "" if the snapshot is empty (so callers can append unconditionally).
    """
    if not snap or not snap.get("confirmation_id"):
        return ""
    system = snap.get("system") or "the system"
    ref = snap.get("confirmation_id")
    line = f"🧾 Logged in {system} · ref **{ref}**"
    if snap.get("undo_url"):
        verb = (snap.get("undo_label") or "undo").capitalize()
        line += f" — [{verb}]({snap['undo_url']})"
    return line
