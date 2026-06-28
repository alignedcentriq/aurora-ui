"""Integration test for the proactive nudge service (detectors + feed + actions).

Like test_pending_action_service, this NEEDS the database. It seeds throwaway rows
(all tagged with a DELETE-ME marker) and removes them at the end, so it's safe to
run against the dev DB.

    python -m tests.test_nudge_service

Covers the properties that matter:
  • detect_expiring_leaves fires for a non-carry-forward balance near year-end
  • upsert is idempotent (no duplicate on re-scan) and respects dismissals
  • detect_stale_approvals fires for an old Pending leave and resolves the manager
  • act(): apply_leave returns a deeplink; nudge_manager sends once then cooldowns
"""

import sys
import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.database import SessionLocal, engine
from app.models import ProactiveNudge, Employee, Leave, LeaveType, LeaveBalance, ApprovalToken
from app.services import nudge_service as N

_MARK = "DELETE-ME-nudge-test"
_EMP_EMAIL = f"emp.{_MARK}@example.com"
_MGR_EMAIL = f"mgr.{_MARK}@example.com"
_LT_CODE = "ZZTEST"


def _ensure_tables():
    ProactiveNudge.__table__.create(bind=engine, checkfirst=True)


def _cleanup():
    db = SessionLocal()
    try:
        emp_ids = [e.id for e in db.query(Employee).filter(Employee.email.in_([_EMP_EMAIL, _MGR_EMAIL])).all()]
        db.query(ProactiveNudge).filter(ProactiveNudge.user_email == _EMP_EMAIL).delete(synchronize_session=False)
        db.query(ApprovalToken).filter(ApprovalToken.employee_email == _EMP_EMAIL).delete(synchronize_session=False)
        if emp_ids:
            db.query(Leave).filter(Leave.employee_id.in_(emp_ids)).delete(synchronize_session=False)
            db.query(LeaveBalance).filter(LeaveBalance.employee_id.in_(emp_ids)).delete(synchronize_session=False)
        db.query(LeaveType).filter(LeaveType.code == _LT_CODE).delete(synchronize_session=False)
        db.query(Employee).filter(Employee.email.in_([_EMP_EMAIL, _MGR_EMAIL])).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _seed():
    """Create manager, employee, an expiring leave type+balance, and a stale pending leave."""
    db = SessionLocal()
    try:
        mgr = Employee(employee_id=f"M-{_MARK}", name="Test Manager", email=_MGR_EMAIL, role="Functional Manager")
        db.add(mgr)
        db.flush()
        emp = Employee(employee_id=f"E-{_MARK}", name="Test Employee", email=_EMP_EMAIL,
                       role="Employee", manager_id=mgr.id)
        db.add(emp)
        db.flush()

        lt = LeaveType(name=f"Test Comp Off {_MARK}", code=_LT_CODE,
                       annual_entitlement=5, is_earned=True, is_active=True, carry_forward=False)
        db.add(lt)
        db.flush()

        year = datetime.date.today().year
        db.add(LeaveBalance(employee_id=emp.id, leave_type_id=lt.id, year=year,
                            entitled=5, used=2, balance=3, earned=0))

        # Stale pending leave (created well before the staleness cutoff).
        old = datetime.datetime.utcnow() - datetime.timedelta(days=10)
        lv = Leave(employee_id=emp.id, leave_type="Casual", status="Pending",
                   start_date=datetime.date(year, 7, 1), end_date=datetime.date(year, 7, 2),
                   reason="test", created_at=old)
        db.add(lv)
        db.commit()
        return emp.id, lv.id, year
    finally:
        db.close()


def _checks():
    fails = []

    def ok(cond, msg):
        print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
        if not cond:
            fails.append(msg)

    emp_id, leave_id, year = _seed()

    # ── Expiring-leaves detector ────────────────────────────────────────────
    # Financial year ends 31 Mar; pick a date inside the 45-day window before it,
    # in the same calendar year as the seeded balance.
    near_year_end = datetime.date(year, 3, 1)  # inside the 45-day window before 31 Mar
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.id == emp_id).first()
        specs = N.detect_expiring_leaves(db, emp, today=near_year_end)
        ok(len(specs) == 1, "detect_expiring_leaves returns exactly one spec")
        ok(specs and specs[0]["action_type"] == "apply_leave", "expiring spec action is apply_leave")
        ok(specs and specs[0]["dedup_key"].endswith(f":{year}:{_LT_CODE}"), "expiring dedup_key encodes year+code")

        # Idempotency: upsert the same spec twice → created then updated (no dup row).
        r1 = N.upsert(db, specs[0]); db.commit()
        r2 = N.upsert(db, specs[0]); db.commit()
        ok(r1 == "created" and r2 == "updated", "upsert is idempotent (created then updated)")
        cnt = db.query(ProactiveNudge).filter(ProactiveNudge.user_email == _EMP_EMAIL,
                                              ProactiveNudge.nudge_type == "leave_expiring").count()
        ok(cnt == 1, "only one expiring-leave nudge row exists after two upserts")

        # Far from year-end → no nudge.
        mid_year = datetime.date(year, 8, 1)
        ok(N.detect_expiring_leaves(db, emp, today=mid_year) == [], "no expiring nudge outside the window")
    finally:
        db.close()

    # ── Stale-approval detector ─────────────────────────────────────────────
    db = SessionLocal()
    try:
        specs = N.detect_stale_approvals(db)
        mine = [s for s in specs if s["user_email"] == _EMP_EMAIL]
        ok(len(mine) == 1, "detect_stale_approvals returns one spec for the stale leave")
        ok(mine and mine[0]["action_type"] == "nudge_manager", "stale spec action is nudge_manager")
        ok(mine and mine[0]["action_payload"].get("manager_email") == _MGR_EMAIL,
           "stale spec resolved the manager email")
        N.upsert(db, mine[0]); db.commit()
    finally:
        db.close()

    # feed shows both nudges; both are unread
    feed = N.list_for_user(_EMP_EMAIL)
    ok(len(feed) == 2, "feed lists both nudges")
    ok(N.count_unread(_EMP_EMAIL) == 2, "both nudges unread initially")
    N.mark_seen(_EMP_EMAIL)
    ok(N.count_unread(_EMP_EMAIL) == 0, "mark_seen clears unread count")

    # ── Dismissal sticks (re-scan does not resurrect) ───────────────────────
    expiring = next(n for n in N.list_for_user(_EMP_EMAIL) if n["nudge_type"] == "leave_expiring")
    ok(N.dismiss(_EMP_EMAIL, expiring["id"]) is True, "dismiss() succeeds")
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.id == emp_id).first()
        spec = N.detect_expiring_leaves(db, emp, today=near_year_end)[0]
        ok(N.upsert(db, spec) == "skipped", "dismissed nudge is not recreated on re-scan")
        db.commit()
    finally:
        db.close()
    ok(all(n["nudge_type"] != "leave_expiring" for n in N.list_for_user(_EMP_EMAIL)),
       "dismissed nudge no longer in feed")

    # ── Actions ─────────────────────────────────────────────────────────────
    # apply_leave: re-create an expiring nudge under a fresh dedup_key to act on.
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.id == emp_id).first()
        # Use a different "today" year offset to dodge the dismissed dedup_key.
        spec = N.detect_expiring_leaves(db, emp, today=near_year_end)[0]
        spec["dedup_key"] = spec["dedup_key"] + ":retry"
        N.upsert(db, spec); db.commit()
    finally:
        db.close()
    apply_nudge = next(n for n in N.list_for_user(_EMP_EMAIL) if n["action_type"] == "apply_leave")
    res = N.act(_EMP_EMAIL, apply_nudge["id"])
    ok(res.get("success") and res.get("action") == "open_apply_form" and res.get("link"),
       "act(apply_leave) returns an open_apply_form deeplink")

    # nudge_manager: patch the email send so the test does not hit MS Graph.
    import app.services.email_service as _es
    sent = {"n": 0}
    _orig = _es.send_leave_approval_request
    _es.send_leave_approval_request = lambda **kw: (sent.__setitem__("n", sent["n"] + 1) or True)
    try:
        stale_nudge = next(n for n in N.list_for_user(_EMP_EMAIL) if n["action_type"] == "nudge_manager")
        r = N.act(_EMP_EMAIL, stale_nudge["id"])
        ok(r.get("success") and sent["n"] == 1, "act(nudge_manager) sends the approval reminder once")
        r2 = N.act(_EMP_EMAIL, stale_nudge["id"])
        ok(r2.get("success") is False and r2.get("error") == "cooldown" and sent["n"] == 1,
           "second nudge_manager within cooldown is a no-op (no second send)")
    finally:
        _es.send_leave_approval_request = _orig

    return fails


def main():
    _ensure_tables()
    _cleanup()
    try:
        print("ProactiveNudge service integration:")
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
