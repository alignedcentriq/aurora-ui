"""Integration test for personal + team analytics (roadmap item 9).

NEEDS the database. Seeds a throwaway manager + 2 reports + their leaves (tagged with a
DELETE-ME marker) and removes them at the end. Verifies the person-scoping that the new
/me/* endpoints rely on: "me" sees only the caller's rows, "my-team" only their reports,
and the scope/metric whitelist is enforced.

    python -m tests.test_personal_analytics
"""

import sys
import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.database import SessionLocal
from app.models import Employee, Leave
from app.services import analytics_service as S

_MARK = "DELETE-ME-pa-test"
_MGR = f"mgr.{_MARK}@x.com"
_E1 = f"e1.{_MARK}@x.com"
_E2 = f"e2.{_MARK}@x.com"
_OUTSIDER = f"out.{_MARK}@x.com"


def _cleanup():
    db = SessionLocal()
    try:
        ids = [e.id for e in db.query(Employee).filter(Employee.email.like(f"%{_MARK}%")).all()]
        if ids:
            db.query(Leave).filter(Leave.employee_id.in_(ids)).delete(synchronize_session=False)
        db.query(Employee).filter(Employee.email.like(f"%{_MARK}%")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _seed():
    db = SessionLocal()
    try:
        mgr = Employee(employee_id=f"M-{_MARK}", name="PA Manager", email=_MGR, role="Functional Manager")
        db.add(mgr); db.flush()
        e1 = Employee(employee_id=f"E1-{_MARK}", name="Report One", email=_E1, role="Employee", manager_id=mgr.id)
        e2 = Employee(employee_id=f"E2-{_MARK}", name="Report Two", email=_E2, role="Employee", manager_id=mgr.id)
        out = Employee(employee_id=f"O-{_MARK}", name="Outsider", email=_OUTSIDER, role="Employee")
        db.add_all([e1, e2, out]); db.flush()

        today = datetime.date.today()
        recent = datetime.datetime.utcnow() - datetime.timedelta(days=2)

        def leave(emp_id, days, lt="Casual"):
            return Leave(employee_id=emp_id, leave_type=lt, status="Approved",
                         start_date=today, end_date=today + datetime.timedelta(days=days - 1),
                         reason="t", created_at=recent)

        # e1: 2 leave requests (1-day + 3-day = 4 days). e2: 1 request (2 days). outsider: 1 (5 days).
        db.add_all([leave(e1.id, 1), leave(e1.id, 3, "Sick"), leave(e2.id, 2), leave(out.id, 5)])
        db.commit()
        return {"mgr": _MGR, "e1": _E1, "e2": _E2, "e1_id": e1.id}
    finally:
        db.close()


def main():
    fails = []

    def ok(cond, msg):
        print(f"  [{'PASS' if cond else 'FAIL'}] {msg}")
        if not cond:
            fails.append(msg)

    def total(res):
        return sum(p["value"] for p in res["series"])

    _cleanup()
    _seed()
    db = SessionLocal()
    try:
        print("personal_catalog reflects whether the caller has a team:")
        mgr_cat = S.personal_catalog(db, _MGR)
        e1_cat = S.personal_catalog(db, _E1)
        ok(mgr_cat["has_team"] is True and "my-team" in mgr_cat["metrics"][0]["scopes"],
           "manager catalog offers my-team scope")
        ok(e1_cat["has_team"] is False and mgr_cat["metrics"][0]["scopes"] != e1_cat["metrics"][0]["scopes"]
           and "my-team" not in e1_cat["metrics"][0]["scopes"],
           "non-manager catalog offers only 'me'")

        print("scope=me sees only the caller's own rows:")
        e1_leaves = S.run_query(db, "leaves_taken", "leave_type", "90d",
                                person_scope="me", user_email=_E1)
        ok(total(e1_leaves) == 2, "e1 'me' → 2 leave requests")
        e1_days = S.run_query(db, "leave_days", "leave_type", "90d", person_scope="me", user_email=_E1)
        ok(total(e1_days) == 4, "e1 'me' → 4 leave days (1 + 3, inclusive)")

        print("scope=my-team aggregates the reports (not the outsider):")
        team_leaves = S.run_query(db, "leaves_taken", "month", "90d",
                                  person_scope="my-team", user_email=_MGR)
        ok(total(team_leaves) == 3, "manager 'my-team' → 3 requests (e1:2 + e2:1), outsider excluded")
        team_days = S.run_query(db, "leave_days", "leave_type", "90d",
                                person_scope="my-team", user_email=_MGR)
        ok(total(team_days) == 6, "manager 'my-team' → 6 days (4 + 2)")

        print("scope=my-team for a non-manager yields nothing (no reports):")
        empty = S.run_query(db, "leaves_taken", "month", "90d", person_scope="my-team", user_email=_E1)
        ok(total(empty) == 0, "e1 has no reports → empty series, never widened to all")

        print("whitelist enforcement:")
        try:
            S.run_query(db, "leaves_taken", "leave_type", "90d", person_scope="bogus", user_email=_E1)
            ok(False, "invalid scope should raise")
        except ValueError:
            ok(True, "invalid scope rejected")
        try:
            S.run_query(db, "leaves_taken", "served_from", "90d", person_scope="me", user_email=_E1)
            ok(False, "invalid dimension should raise")
        except ValueError:
            ok(True, "invalid dimension rejected")
    finally:
        db.close()
        _cleanup()

    print(f"\n{'=' * 50}")
    if fails:
        print(f"FAILED: {len(fails)} check(s).")
        raise SystemExit(1)
    print("ALL PASSED.")


if __name__ == "__main__":
    main()
