"""Integration test for PendingActionService (the action-safety durable store).

Unlike the routing harness, this NEEDS the database — it is the durable store. It uses a
unique throwaway session_key and deletes its own rows at the end, so it's safe to run
against the dev DB. Verifies the lifecycle and the two safety properties that matter:
idempotent confirm (no double-execute) and durable supersede.

    python -m tests.test_pending_action_service
"""

import sys
import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.database import SessionLocal, engine
from app.models import PendingAction
from app.services.pending_action_service import PendingActionService as P

_SK = "test-session::pending-action::DELETE-ME"


def _ensure_table():
    PendingAction.__table__.create(bind=engine, checkfirst=True)


def _cleanup():
    db = SessionLocal()
    try:
        db.query(PendingAction).filter(PendingAction.session_key == _SK).delete()
        db.commit()
    finally:
        db.close()


def _checks():
    fails = []

    def ok(cond, msg):
        print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
        if not cond:
            fails.append(msg)

    # 1. create -> pending visible with payload
    P.create(_SK, "software_install", {"software_name": "Slack"}, user_email="u@x.com")
    pend = P.get_pending(_SK, "software_install")
    ok(pend is not None and pend["payload"].get("software_name") == "Slack",
       "create() then get_pending() returns the payload")
    ok(P.has_pending(_SK, "software_install"), "has_pending() True while pending")

    # 2. confirm() claims it once and returns the snapshot
    claimed = P.confirm(_SK, "software_install")
    ok(claimed is not None and claimed["payload"].get("software_name") == "Slack",
       "confirm() returns the claimed action")

    # 3. IDEMPOTENCY: a second confirm finds nothing -> caller won't double-send
    again = P.confirm(_SK, "software_install")
    ok(again is None, "second confirm() returns None (no double-execute)")
    ok(not P.has_pending(_SK, "software_install"), "no pending remains after confirm")

    # 4. supersede: two creates of the same type leave only the latest pending
    P.create(_SK, "software_install", {"software_name": "Zoom"}, user_email="u@x.com")
    P.create(_SK, "software_install", {"software_name": "Figma"}, user_email="u@x.com")
    pend = P.get_pending(_SK, "software_install")
    ok(pend is not None and pend["payload"].get("software_name") == "Figma",
       "second create() supersedes the first (latest wins)")

    # 5. cancel() clears it
    ok(P.cancel(_SK, "software_install") is True, "cancel() reports it cancelled something")
    ok(not P.has_pending(_SK, "software_install"), "no pending remains after cancel")

    # 6. expiry: a past expires_at is treated as not-pending
    P.create(_SK, "software_install", {"software_name": "Notion"}, ttl_minutes=30)
    db = SessionLocal()
    try:
        row = (db.query(PendingAction)
               .filter(PendingAction.session_key == _SK, PendingAction.status == "pending")
               .order_by(PendingAction.created_at.desc()).first())
        row.expires_at = datetime.datetime.utcnow() - datetime.timedelta(minutes=1)
        db.commit()
    finally:
        db.close()
    ok(P.get_pending(_SK, "software_install") is None, "expired action is not returned as pending")

    return fails


def main():
    _ensure_table()
    _cleanup()
    try:
        print("PendingActionService integration:")
        fails = _checks()
    finally:
        _cleanup()
    print(f"\n{'=' * 50}")
    if fails:
        print(f"FAILED: {len(fails)} check(s).")
        raise SystemExit(1)
    print("ALL PASSED.")


if __name__ == "__main__":
    main()
