"""Integration test for find_recent_duplicate (the write-dedupe guard).

Needs the DB. Inserts a throwaway ITTicket (negative employee_id so it can't collide with
real data), exercises the helper, and deletes its own row. Proves: exact-field match within
the window is caught, an out-of-window row is not, and a different request is not.

    python -m tests.test_idempotency
"""

import sys
import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from app.database import SessionLocal
from app.models import ITTicket, Employee
from app.services.idempotency import find_recent_duplicate

# A real employee_id is required (FK); rows are isolated/cleaned by the unique description.
_DESC = "idempotency-test::DELETE-ME"


def _emp_id() -> int:
    db = SessionLocal()
    try:
        e = db.query(Employee.id).first()
        if not e:
            raise SystemExit("no employees in DB to anchor the FK; cannot run this test")
        return e[0]
    finally:
        db.close()


_EMP = _emp_id()


def _cleanup():
    db = SessionLocal()
    try:
        db.query(ITTicket).filter(ITTicket.description == _DESC).delete()
        db.commit()
    finally:
        db.close()


def _insert(minutes_ago: int) -> None:
    db = SessionLocal()
    try:
        db.add(ITTicket(
            ticket_id=f"IT-TEST-{minutes_ago}",
            employee_id=_EMP, category="Hardware", subject="t",
            description=_DESC, priority="Medium", status="Open",
            created_at=datetime.datetime.utcnow() - datetime.timedelta(minutes=minutes_ago),
        ))
        db.commit()
    finally:
        db.close()


def _checks():
    fails = []

    def ok(cond, msg):
        print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
        if not cond:
            fails.append(msg)

    db = SessionLocal()
    try:
        # fresh row (0 min ago) is caught within a 120s window
        _insert(0)
        dup = find_recent_duplicate(db, ITTicket, window_seconds=120,
                                    employee_id=_EMP, category="Hardware",
                                    description=_DESC, status="Open")
        ok(dup is not None, "recent identical row IS flagged as duplicate")

        # a different description is NOT a duplicate
        nodup = find_recent_duplicate(db, ITTicket, window_seconds=120,
                                      employee_id=_EMP, category="Hardware",
                                      description="something else", status="Open")
        ok(nodup is None, "different request is NOT flagged")
    finally:
        db.close()

    # an out-of-window row (10 min ago) is NOT a duplicate for a 120s window
    _cleanup()
    _insert(10)
    db = SessionLocal()
    try:
        old = find_recent_duplicate(db, ITTicket, window_seconds=120,
                                    employee_id=_EMP, category="Hardware",
                                    description=_DESC, status="Open")
        ok(old is None, "row outside the window is NOT flagged (window respected)")
    finally:
        db.close()

    return fails


def main():
    _cleanup()
    try:
        print("idempotency guard:")
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
