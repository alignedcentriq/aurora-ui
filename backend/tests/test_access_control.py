"""Access-aware answers — answer-layer RBAC for personal HR data.

Exercises app.services.access_control.check_personal_data_access against a tiny
seeded org: a manager, their direct report, and an unrelated employee. Verifies
the relationship/role policy (self / direct-manager / HR / admin allowed; an
unrelated peer denied). Seeds DELETE-ME-tagged employees and removes them at the
end, so it's safe against the dev DB.

    python -m tests.test_access_control
"""

import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.database import SessionLocal
from app.models import Employee
from app.services.access_control import check_personal_data_access

_MARK = "DELETE-ME-access-test"
_MGR = f"mgr.{_MARK}@example.com"
_REP = f"rep.{_MARK}@example.com"
_PEER = f"peer.{_MARK}@example.com"
_EMAILS = (_MGR, _REP, _PEER)


def _cleanup():
    db = SessionLocal()
    try:
        db.query(Employee).filter(Employee.email.in_(_EMAILS)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _seed():
    db = SessionLocal()
    try:
        mgr = Employee(employee_id=f"E-MGR-{_MARK}", name="Mona Manager", email=_MGR, role="Manager")
        db.add(mgr)
        db.commit()
        db.refresh(mgr)
        db.add(Employee(employee_id=f"E-REP-{_MARK}", name="Riya Report", email=_REP,
                        role="Employee", manager_id=mgr.id))
        db.add(Employee(employee_id=f"E-PEER-{_MARK}", name="Pete Peer", email=_PEER,
                        role="Employee"))
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
        print("self-service (no target) is always allowed:")
        d = check_personal_data_access(_REP, "employee", "")
        ok(d.allowed and d.target_email == _REP, "blank target resolves to self, allowed")

        print("asking about oneself by name is allowed:")
        d = check_personal_data_access(_REP, "employee", "Riya Report")
        ok(d.allowed and d.target_email == _REP, "self by name allowed")

        print("a direct manager may view their report:")
        d = check_personal_data_access(_MGR, "manager", "Riya Report")
        ok(d.allowed and d.target_email == _REP, "manager -> direct report allowed")

        print("an unrelated peer is refused (the core security gap):")
        d = check_personal_data_access(_PEER, "employee", _REP)
        ok(not d.allowed and d.reason == "not_authorized", "peer -> someone else denied")
        ok(bool(d.message) and "Riya Report" in d.message, "refusal names the person and is human-readable")

        print("the report cannot view their own manager's data (no upward access):")
        d = check_personal_data_access(_REP, "employee", _MGR)
        ok(not d.allowed and d.reason == "not_authorized", "report -> manager denied")

        print("HR / admin role overrides the relationship check:")
        d = check_personal_data_access(_PEER, "hr", _REP)
        ok(d.allowed and d.target_email == _REP, "hr role may view anyone")
        d = check_personal_data_access(_PEER, "admin", _MGR)
        ok(d.allowed, "admin role may view anyone")

        print("unknown target is reported, not leaked:")
        d = check_personal_data_access(_MGR, "manager", "Nobody Here At All")
        ok(not d.allowed and d.reason == "target_not_found", "unknown target -> target_not_found")
    finally:
        _cleanup()

    print()
    if fails:
        print(f"FAILED: {len(fails)} check(s)")
        for f in fails:
            print(f"  - {f}")
        sys.exit(1)
    print("All access-control checks passed.")


if __name__ == "__main__":
    main()
