"""
Remove dummy/randomly-seeded data from the employee tables.

What this cleans:
  1. employee_skills — all rows were randomly assigned (2-4 generic skills per person)
     by rebuild_employees.py. Deletes the whole table so profiles show "None on file"
     until employees self-declare skills or training completions write them back.

  2. employees.location — set to a random choice of Pune/Indore/Dubai/US for every
     employee by rebuild_employees.py. NULLed out here; real office location comes
     from MS365User.office_location (Azure AD) which the profile and analytics now use.

  3. employees.designation — NULLed only for rows where the value is one of the generic
     placeholder strings injected by rebuild_employees.py. Rows whose designation came
     from Zoho CSV or a real MS365 job_title are left untouched.

Run:
    python -u backend/cleanup_dummy_data.py
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from sqlalchemy import text, update
from app.database import engine, SessionLocal
from app.models import Employee, EmployeeSkill, SCHEMA

FAKE_DESIGNATIONS = {
    "Associate", "Senior Associate", "Engineer", "Senior Engineer",
    "Lead", "Manager", "Senior Manager", "Director", "Analyst", "Consultant",
}


def main():
    db = SessionLocal()
    try:
        # ── 1. Delete all randomly-seeded skills ─────────────────────────────
        before_skills = db.query(EmployeeSkill).count()
        db.execute(text(f'DELETE FROM "{SCHEMA}".employee_skills'))
        db.commit()
        after_skills = db.query(EmployeeSkill).count()
        print(f"[1] employee_skills: deleted {before_skills - after_skills} rows  "
              f"(was {before_skills}, now {after_skills})")

        # ── 2. NULL out randomly-assigned locations ───────────────────────────
        before_loc = db.query(Employee).filter(Employee.location.isnot(None)).count()
        db.query(Employee).update({"location": None}, synchronize_session=False)
        db.commit()
        after_loc = db.query(Employee).filter(Employee.location.isnot(None)).count()
        print(f"[2] employees.location: cleared {before_loc - after_loc} rows  "
              f"(all were random Pune/Indore/Dubai/US assignments)")

        # ── 3. NULL out placeholder designations ─────────────────────────────
        before_desig = db.query(Employee).filter(Employee.designation.isnot(None)).count()
        for placeholder in FAKE_DESIGNATIONS:
            db.query(Employee).filter(Employee.designation == placeholder).update(
                {"designation": None}, synchronize_session=False
            )
        db.commit()
        after_desig = db.query(Employee).filter(Employee.designation.isnot(None)).count()
        print(f"[3] employees.designation: cleared {before_desig - after_desig} placeholder rows  "
              f"({after_desig} retained as real designations)")

        # ── Summary ──────────────────────────────────────────────────────────
        total_emps = db.query(Employee).count()
        print(f"\nDone. {total_emps} employees in DB. "
              f"Skills table is now empty — will repopulate from TechElevate training completions "
              f"and Alchemy Skills Portal sync.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
