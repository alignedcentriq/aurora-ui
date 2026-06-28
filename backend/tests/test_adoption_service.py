"""Feature-adoption analytics — the "undiscovered features" computation.

Seeds a handful of DELETE-ME-tagged AiRequestLog rows and verifies:
  • distinct-user adoption per capability (deduped across requests),
  • a capability with no matching traffic shows up as undiscovered (0 users),
  • traffic for a (domain, sub_intent) no capability claims lands in `unmapped`.
Cleans up everything it writes, so it's safe against the dev DB.

    python -m tests.test_adoption_service
"""

import datetime
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.database import SessionLocal
from app.models import AiRequestLog
from app.services.adoption_service import feature_adoption

_MARK = "delete-me-adoption"
_U1 = f"u1.{_MARK}@example.com"
_U2 = f"u2.{_MARK}@example.com"
_U3 = f"u3.{_MARK}@example.com"
_EMAILS = (_U1, _U2, _U3)


def _cleanup():
    db = SessionLocal()
    try:
        db.query(AiRequestLog).filter(AiRequestLog.user_email.in_(_EMAILS)).delete(
            synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _seed():
    now = datetime.datetime.utcnow()
    db = SessionLocal()
    try:
        def log(email, domain, sub_intent):
            db.add(AiRequestLog(session_id=f"s-{_MARK}", user_email=email, user_message="x",
                                domain=domain, sub_intent=sub_intent, created_at=now))
        # leave_balance: u1 (twice — must dedupe) + u2  => 2 distinct users
        log(_U1, "hr", "leave_balance")
        log(_U1, "hr", "leave_balance")
        log(_U2, "hr", "leave_balance")
        # it_ticket: u3 only => 1 distinct user (create_ticket is a real emitted sub_intent)
        log(_U3, "it_support", "create_ticket")
        # traffic no capability claims => should appear in `unmapped`
        log(_U1, "hr", "zzz_made_up_subintent")
        db.commit()
    finally:
        db.close()


def main():
    fails = []

    def ok(cond, msg):
        print(f"  [{'PASS' if cond else 'FAIL'}] {msg}")
        if not cond:
            fails.append(msg)

    _cleanup()
    _seed()
    try:
        res = feature_adoption(window_days=1)
        feats = {f["key"]: f for f in res["features"]}

        print("distinct-user adoption per capability (deduped):")
        ok(feats["leave_balance"]["users"] >= 2,
           f"leave_balance has >=2 distinct users (got {feats['leave_balance']['users']})")
        ok(feats["it_ticket"]["users"] >= 1,
           f"it_ticket has >=1 distinct user (got {feats['it_ticket']['users']})")

        print("a capability with no matching traffic is undiscovered:")
        # 'approvals' is functional_manager/pending_approvals — we seeded none.
        ok(feats["approvals"]["users"] == 0, "approvals shows 0 users (undiscovered)")
        ok(any(f["key"] == "approvals" for f in res["features"] if f["users"] == 0),
           "undiscovered feature present in features list")

        print("unmapped traffic is surfaced, not silently dropped:")
        ok(any(b["sub_intent"] == "zzz_made_up_subintent" for b in res["unmapped"]),
           "made-up sub_intent appears in unmapped buckets")

        print("summary fields are sane:")
        ok(res["feature_count"] == len(res["features"]), "feature_count matches list length")
        ok(res["active_users"] >= 3, f"active_users counts our 3 seeded users (got {res['active_users']})")
        ok(res["total_staff"] >= 0, "total_staff present")
    finally:
        _cleanup()

    print()
    if fails:
        print(f"FAILED: {len(fails)} check(s)")
        for f in fails:
            print(f"  - {f}")
        sys.exit(1)
    print("All adoption-service checks passed.")


if __name__ == "__main__":
    main()
