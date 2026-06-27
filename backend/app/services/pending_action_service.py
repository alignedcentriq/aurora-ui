r"""Durable pending-action store — the core of the action-safety layer (Phase 2).

A state-changing ("write") action is never executed on the turn the user asks for it.
Instead the agent records a PendingAction here, shows a confirmation, and the action
executes ONLY when the user explicitly confirms — at which point execution is idempotent.

This replaces the in-memory PENDING_IT_EMAIL_DRAFTS dict (which was lost on restart). The
contract is deliberately small so every write path (IT install, leave, MS365 sends, …) can
migrate onto the same gate. See docs/action-safety-audit.md.

Lifecycle:  create() -> [pending] -> confirm() -> [executed]
                                  \-> cancel()  -> [cancelled]
                                  \-> (ttl)     -> [expired]
"""

import datetime
import logging

from app.database import SessionLocal
from app.models import PendingAction

log = logging.getLogger("aurora-logger")

_DEFAULT_TTL_MINUTES = 30


def _now() -> datetime.datetime:
    return datetime.datetime.utcnow()


class PendingActionService:

    @staticmethod
    def create(
        session_key: str,
        action_type: str,
        payload: dict,
        user_email: str = "",
        ttl_minutes: int = _DEFAULT_TTL_MINUTES,
        idempotency_key: str | None = None,
    ) -> int:
        """Record a new pending action and return its id.

        Supersedes any earlier still-pending action of the SAME type for this session
        (matches the old dict's overwrite semantics — a fresh request replaces a stale draft).
        """
        db = SessionLocal()
        try:
            # Supersede prior pending of the same type for this session.
            (db.query(PendingAction)
             .filter(PendingAction.session_key == session_key,
                     PendingAction.action_type == action_type,
                     PendingAction.status == "pending")
             .update({"status": "cancelled", "updated_at": _now()}, synchronize_session=False))

            row = PendingAction(
                session_key=session_key,
                user_email=user_email or "",
                action_type=action_type,
                payload=payload or {},
                idempotency_key=idempotency_key,
                status="pending",
                created_at=_now(),
                expires_at=_now() + datetime.timedelta(minutes=ttl_minutes),
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return row.id
        finally:
            db.close()

    @staticmethod
    def get_pending(session_key: str, action_type: str | None = None) -> dict | None:
        """Return the most-recent live (pending, non-expired) action for the session, or None.

        Returns a plain dict snapshot so callers never touch a detached ORM object.
        Expired rows are lazily marked 'expired' and skipped.
        """
        db = SessionLocal()
        try:
            q = (db.query(PendingAction)
                 .filter(PendingAction.session_key == session_key,
                         PendingAction.status == "pending"))
            if action_type:
                q = q.filter(PendingAction.action_type == action_type)
            row = q.order_by(PendingAction.created_at.desc()).first()
            if not row:
                return None
            if row.expires_at and row.expires_at < _now():
                row.status = "expired"
                row.updated_at = _now()
                db.commit()
                return None
            return {
                "id": row.id, "session_key": row.session_key, "user_email": row.user_email,
                "action_type": row.action_type, "payload": row.payload or {},
                "idempotency_key": row.idempotency_key, "status": row.status,
            }
        finally:
            db.close()

    @staticmethod
    def has_pending(session_key: str, action_type: str | None = None) -> bool:
        return PendingActionService.get_pending(session_key, action_type) is not None

    @staticmethod
    def find_executed_by_key(
        idempotency_key: str, within_minutes: int | None = None
    ) -> dict | None:
        """Find the most-recent ALREADY-EXECUTED action for this idempotency_key, across sessions.

        Unlike get_pending (session-scoped), this is keyed only by idempotency_key, so it
        catches a request the user already submitted in a DIFFERENT chat — e.g. re-asking to
        "install Slack" in a new conversation when the request was already emailed to IT. Use
        it to refuse a re-draft instead of silently sending a second identical request.

        within_minutes bounds how long the prior request is still considered open (None = no
        bound). Email-only actions have no completion callback, so the window is the only
        signal we have for "probably still being worked on".
        """
        if not idempotency_key:
            return None
        db = SessionLocal()
        try:
            row = (db.query(PendingAction)
                   .filter(PendingAction.idempotency_key == idempotency_key,
                           PendingAction.status == "executed")
                   .order_by(PendingAction.created_at.desc())
                   .first())
            if not row:
                return None
            if (within_minutes is not None and row.created_at
                    and row.created_at < _now() - datetime.timedelta(minutes=within_minutes)):
                return None
            return {
                "id": row.id, "session_key": row.session_key, "user_email": row.user_email,
                "action_type": row.action_type, "payload": row.payload or {},
                "idempotency_key": row.idempotency_key, "status": row.status,
                "created_at": row.created_at,
            }
        finally:
            db.close()

    @staticmethod
    def confirm(session_key: str, action_type: str | None = None) -> dict | None:
        """Atomically claim the live pending action for execution.

        Flips status pending->executed and returns its snapshot, or None if there was
        nothing to confirm. The status flip is the idempotency guard: a duplicate confirm
        (double-click, retry, refresh) finds no 'pending' row and returns None, so the
        caller never executes the side effect twice.
        """
        db = SessionLocal()
        try:
            q = (db.query(PendingAction)
                 .filter(PendingAction.session_key == session_key,
                         PendingAction.status == "pending"))
            if action_type:
                q = q.filter(PendingAction.action_type == action_type)
            row = q.order_by(PendingAction.created_at.desc()).first()
            if not row:
                return None
            if row.expires_at and row.expires_at < _now():
                row.status = "expired"
                row.updated_at = _now()
                db.commit()
                return None
            snap = {
                "id": row.id, "session_key": row.session_key, "user_email": row.user_email,
                "action_type": row.action_type, "payload": row.payload or {},
                "idempotency_key": row.idempotency_key,
            }
            row.status = "executed"
            row.updated_at = _now()
            db.commit()
            return snap
        finally:
            db.close()

    @staticmethod
    def attach_external_ref(idempotency_key: str, request_id: str) -> bool:
        """Stash the helpdesk's real request id (e.g. 'RE-7735') on the executed action.

        Best-effort: lets a later lookup show/filter by the real ticket id instead of guessing.
        Writes into payload['helpdesk_request_id'] of the most-recent executed row for this key.
        """
        if not idempotency_key or not request_id:
            return False
        db = SessionLocal()
        try:
            row = (db.query(PendingAction)
                   .filter(PendingAction.idempotency_key == idempotency_key,
                           PendingAction.status == "executed")
                   .order_by(PendingAction.created_at.desc())
                   .first())
            if not row:
                return False
            payload = dict(row.payload or {})
            if payload.get("helpdesk_request_id") == request_id:
                return True
            payload["helpdesk_request_id"] = request_id
            row.payload = payload
            row.updated_at = _now()
            db.commit()
            return True
        finally:
            db.close()

    @staticmethod
    def cancel(session_key: str, action_type: str | None = None) -> bool:
        """Cancel the live pending action(s) for the session. Returns True if any cancelled."""
        db = SessionLocal()
        try:
            q = (db.query(PendingAction)
                 .filter(PendingAction.session_key == session_key,
                         PendingAction.status == "pending"))
            if action_type:
                q = q.filter(PendingAction.action_type == action_type)
            n = q.update({"status": "cancelled", "updated_at": _now()}, synchronize_session=False)
            db.commit()
            return bool(n)
        finally:
            db.close()

    @staticmethod
    def list_pending(session_key: str) -> list[dict]:
        """Return ALL live (non-expired) pending actions for the session.

        Lazily expires any rows that have passed their TTL.  Used by the
        orchestration pipeline pre-hook to surface pending action types in state.
        """
        db = SessionLocal()
        try:
            rows = (db.query(PendingAction)
                    .filter(PendingAction.session_key == session_key,
                            PendingAction.status == "pending")
                    .order_by(PendingAction.created_at.desc())
                    .all())
            result = []
            now = _now()
            for row in rows:
                if row.expires_at and row.expires_at < now:
                    row.status = "expired"
                    row.updated_at = now
                else:
                    result.append({
                        "id": row.id,
                        "action_type": row.action_type,
                        "payload": row.payload or {},
                        "idempotency_key": row.idempotency_key,
                        "expires_at": row.expires_at,
                    })
            db.commit()
            return result
        finally:
            db.close()

    @staticmethod
    def expire_session(session_key: str) -> int:
        """Mark all pending actions for a session as expired.

        Call when a session is closed or a user logs out to eagerly clean up
        stale confirmations rather than waiting for TTL.
        Returns the count of rows expired.
        """
        db = SessionLocal()
        try:
            n = (db.query(PendingAction)
                 .filter(PendingAction.session_key == session_key,
                         PendingAction.status == "pending")
                 .update({"status": "expired", "updated_at": _now()},
                         synchronize_session=False))
            db.commit()
            return n
        finally:
            db.close()

    @staticmethod
    def purge_expired(older_than_hours: int = 48) -> int:
        """Hard-delete terminal (expired/cancelled/executed) rows older than `older_than_hours`.

        Keeps the pending_action table lean.  Run periodically from the background
        scheduler in main.py.  Returns the number of rows deleted.
        """
        db = SessionLocal()
        try:
            cutoff = _now() - datetime.timedelta(hours=older_than_hours)
            n = (db.query(PendingAction)
                 .filter(PendingAction.status.in_(["expired", "cancelled", "executed"]),
                         PendingAction.updated_at <= cutoff)
                 .delete(synchronize_session=False))
            db.commit()
            log.debug("pending_action purge: deleted %d stale rows (older than %dh)", n, older_than_hours)
            return n
        except Exception:
            log.exception("pending_action purge failed")
            return 0
        finally:
            db.close()

    @staticmethod
    def expire_stale(batch_size: int = 500) -> int:
        """Proactively flip past-TTL 'pending' rows to 'expired' in bulk.

        The lazy approach (flipping on read) is correct for correctness but leaves
        stale rows visible in DB queries.  This batch job cleans them up.
        Run from the background scheduler in main.py alongside purge_expired().
        """
        db = SessionLocal()
        try:
            ids = (db.query(PendingAction.id)
                   .filter(PendingAction.status == "pending",
                           PendingAction.expires_at <= _now())
                   .limit(batch_size)
                   .all())
            if not ids:
                return 0
            id_list = [row.id for row in ids]
            n = (db.query(PendingAction)
                 .filter(PendingAction.id.in_(id_list))
                 .update({"status": "expired", "updated_at": _now()},
                         synchronize_session=False))
            db.commit()
            if n:
                log.debug("pending_action expiry: flipped %d stale rows to 'expired'", n)
            return n
        except Exception:
            log.exception("pending_action expire_stale failed")
            return 0
        finally:
            db.close()
