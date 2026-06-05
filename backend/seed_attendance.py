"""
Seed the internal `attendance` table with realistic daily records for ALL employees,
year-to-date (Jan 1 of the current year through today).

Deterministic: each employee's pattern is seeded from their id, so re-running produces the
same data. Idempotent: wipes existing attendance rows first, then bulk-inserts.

Distribution per weekday (Mon–Fri only):
  ~78% Present, ~14% WFH, ~5% Absent, ~3% Half-day. ~15% of Present days are "late"
  (check-in after 09:30). Weekends are skipped entirely.

Usage:
    cd backend
    python seed_attendance.py
"""

import datetime
import random

from app.database import SessionLocal, engine
from app.models import Attendance, Employee

BATCH = 5000


def _weekdays(start: datetime.date, end: datetime.date):
    d = start
    while d <= end:
        if d.weekday() < 5:  # Mon–Fri
            yield d
        d += datetime.timedelta(days=1)


def _row_for(rng: random.Random, emp_id: int, day: datetime.date) -> Attendance:
    r = rng.random()
    if r < 0.05:
        return Attendance(employee_id=emp_id, date=day, check_in=None, check_out=None, status="Absent")
    if r < 0.08:
        ci = datetime.datetime.combine(day, datetime.time(9, rng.randint(0, 29)))
        co = datetime.datetime.combine(day, datetime.time(13, rng.randint(0, 59)))
        return Attendance(employee_id=emp_id, date=day, check_in=ci, check_out=co, status="Half-day")
    if r < 0.22:
        ci = datetime.datetime.combine(day, datetime.time(9, rng.randint(0, 40)))
        co = datetime.datetime.combine(day, datetime.time(18, rng.randint(0, 59)))
        return Attendance(employee_id=emp_id, date=day, check_in=ci, check_out=co, status="WFH")
    # Present (some late)
    if rng.random() < 0.15:
        ci = datetime.datetime.combine(day, datetime.time(9, rng.randint(31, 59)))
    else:
        ci = datetime.datetime.combine(day, datetime.time(rng.choice([8, 9]), rng.randint(0, 25)))
    co = datetime.datetime.combine(day, datetime.time(18, rng.randint(0, 45)))
    return Attendance(employee_id=emp_id, date=day, check_in=ci, check_out=co, status="Present")


def seed():
    # Ensure the table exists without triggering init_db()'s background sync loops.
    Attendance.__table__.create(bind=engine, checkfirst=True)

    db = SessionLocal()
    try:
        today = datetime.date.today()
        start = datetime.date(today.year, 1, 1)
        weekdays = list(_weekdays(start, today))

        emp_ids = [e.id for e in db.query(Employee.id).all()]
        print(f"[seed_attendance] {len(emp_ids)} employees x {len(weekdays)} weekdays "
              f"({start} -> {today})")

        deleted = db.query(Attendance).delete()
        db.commit()
        print(f"[seed_attendance] cleared {deleted} existing rows")

        batch = []
        total = 0
        for emp_id in emp_ids:
            rng = random.Random(emp_id)  # deterministic per employee
            for day in weekdays:
                batch.append(_row_for(rng, emp_id, day))
                if len(batch) >= BATCH:
                    db.bulk_save_objects(batch)
                    db.commit()
                    total += len(batch)
                    batch = []
        if batch:
            db.bulk_save_objects(batch)
            db.commit()
            total += len(batch)

        print(f"[seed_attendance] inserted {total} attendance rows")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
