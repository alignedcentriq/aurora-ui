"""
seed_real_hierarchy.py
----------------------
Populates the employees table from the live Zoho DB (vb_employees view)
which is the authoritative HR roster. Also wires:

  - manager_id      from reporting_manager_email
  - employee_skills from Alchemy profile cache (keyed by AASPL code)
  - attendance      re-seeded year-to-date realistic patterns for all employees

Replaces any previously seeded (MS365 or sample) employees with real Zoho data.

Usage:
    cd backend
    python seed_real_hierarchy.py

Idempotent: safe to re-run — uses upsert-by-email for employees.
"""

import datetime
import random

from sqlalchemy import text

from app.database import SessionLocal, engine
from app.models import Base, Employee, EmployeeSkill, Attendance, SCHEMA
from app.services.zoho_directory_service import fetch_directory, is_configured


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _weekdays(start: datetime.date, end: datetime.date):
    d = start
    while d <= end:
        if d.weekday() < 5:
            yield d
        d += datetime.timedelta(days=1)


def _attendance_row(rng: random.Random, emp_id: int, day: datetime.date) -> Attendance:
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
    if rng.random() < 0.15:
        ci = datetime.datetime.combine(day, datetime.time(9, rng.randint(31, 59)))
    else:
        ci = datetime.datetime.combine(day, datetime.time(rng.choice([8, 9]), rng.randint(0, 25)))
    co = datetime.datetime.combine(day, datetime.time(18, rng.randint(0, 45)))
    return Attendance(employee_id=emp_id, date=day, check_in=ci, check_out=co, status="Present")


def _build_alchemy_map(conn) -> dict[str, list[dict]]:
    """Return {aaspl_code: [skill dicts]} from alchemy_profile_cache."""
    import json
    rows = conn.execute(text(
        f"SELECT employee_code, skills FROM {SCHEMA}.alchemy_profile_cache"
    )).fetchall()
    result: dict[str, list[dict]] = {}
    for code, skills in rows:
        if skills:
            if isinstance(skills, str):
                skills = json.loads(skills)
            if isinstance(skills, list) and skills:
                result[code] = skills
    print(f"[alchemy] Skill map: {len(result)} employees with skills")
    return result


# ---------------------------------------------------------------------------
# FK-safe employee deletion
# ---------------------------------------------------------------------------

def _delete_employees(conn, id_list_sql: str):
    """Delete employees (by id IN clause string) after clearing all FK dependents."""
    stmts = [
        f"UPDATE {SCHEMA}.employees SET manager_id = NULL WHERE manager_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.attendance WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.employee_skills WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.onboarding_step_progress WHERE journey_id IN "
        f"(SELECT id FROM {SCHEMA}.onboarding_journeys WHERE employee_id IN ({id_list_sql}))",
        f"DELETE FROM {SCHEMA}.onboarding_doc_submissions WHERE journey_id IN "
        f"(SELECT id FROM {SCHEMA}.onboarding_journeys WHERE employee_id IN ({id_list_sql}))",
        f"DELETE FROM {SCHEMA}.onboarding_journeys WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.leaves WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.leave_balances WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.it_tickets WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.hr_queries WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.reimbursements WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.installation_requests WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.parking_stickers WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.parking_payments WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.accommodations WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.facility_complaints WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.food_complaints WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.food_vendor_feedback WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.grievances WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.travel_requests WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.travel_expense_claims WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.form_submissions WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.book_requests WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.asset_requests WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.asset_assignments WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.desk_key_requests WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.software_requests WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.udemy_license_requests WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.udemy_licenses WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.course_assignments WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.visitor_passes WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.project_expertise WHERE employee_id IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.employee_zoho_profiles WHERE employee_id IN ({id_list_sql})",
        f"UPDATE {SCHEMA}.attendance_schedules SET manager_id = NULL WHERE manager_id IN ({id_list_sql})",
        f"UPDATE {SCHEMA}.installation_requests SET reviewed_by = NULL WHERE reviewed_by IN ({id_list_sql})",
        f"DELETE FROM {SCHEMA}.employees WHERE id IN ({id_list_sql})",
    ]
    for stmt in stmts:
        try:
            conn.execute(text(stmt))
            conn.commit()
        except Exception as ex:
            conn.rollback()
            print(f"  [warn] {ex}")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def seed():
    if not is_configured():
        print("[error] ZOHO_DBURL is not set — cannot sync from Zoho DB.")
        return

    # Ensure all tables exist
    Base.metadata.create_all(bind=engine)

    # ------------------------------------------------------------------
    # Fetch real roster from Zoho DB
    # ------------------------------------------------------------------
    print("[zoho] Fetching employee roster from Zoho DB ...")
    zoho_rows = fetch_directory()
    print(f"[zoho] {len(zoho_rows)} active employees")

    zoho_emails = {r["email"].lower() for r in zoho_rows if r["email"]}

    db = SessionLocal()
    try:
        with engine.connect() as conn:
            alchemy_map = _build_alchemy_map(conn)

        # ------------------------------------------------------------------
        # Remove employees NOT in the Zoho roster (stale / sample records)
        # ------------------------------------------------------------------
        existing = db.query(Employee).all()
        stale = [e for e in existing if (e.email or "").lower() not in zoho_emails]
        if stale:
            stale_ids = ",".join(str(e.id) for e in stale)
            with engine.connect() as conn:
                _delete_employees(conn, stale_ids)
            print(f"[clear] Removed {len(stale)} stale/sample employees")

        # ------------------------------------------------------------------
        # Upsert employees from Zoho (by email)
        # ------------------------------------------------------------------
        # Rebuild lookup after deletion
        existing_by_email = {
            e.email.lower(): e
            for e in db.query(Employee).all()
            if e.email
        }

        inserted = updated = 0
        for row in zoho_rows:
            email = (row["email"] or "").lower().strip()
            if not email:
                continue
            code = row["employee_code"] or None
            emp = existing_by_email.get(email)
            if emp:
                emp.name = row["name"] or emp.name
                emp.department = row["department"] or emp.department
                emp.designation = row["designation"] or emp.designation
                emp.location = row["location"] or emp.location
                emp.employee_id = code
                emp.alchemy_employee_id = code
                updated += 1
            else:
                emp = Employee(
                    employee_id=code,
                    alchemy_employee_id=code,
                    name=row["name"],
                    email=email,
                    department=row["department"] or None,
                    designation=row["designation"] or None,
                    location=row["location"] or None,
                )
                db.add(emp)
                inserted += 1

        db.commit()
        print(f"[employees] Inserted {inserted}, updated {updated}")

        # ------------------------------------------------------------------
        # Wire manager_id from reporting_manager_email
        # ------------------------------------------------------------------
        all_emps = db.query(Employee).all()
        email_to_id = {e.email.lower(): e.id for e in all_emps if e.email}

        mgr_map = {
            (row["email"] or "").lower(): (row["reporting_manager_email"] or "").lower()
            for row in zoho_rows
        }

        mgr_linked = 0
        for emp in all_emps:
            mgr_email = mgr_map.get((emp.email or "").lower(), "")
            if not mgr_email:
                emp.manager_id = None
                continue
            mgr_id = email_to_id.get(mgr_email)
            if mgr_id and mgr_id != emp.id:
                emp.manager_id = mgr_id
                mgr_linked += 1
            else:
                emp.manager_id = None

        db.commit()
        print(f"[hierarchy] Linked manager_id for {mgr_linked} employees")

        # ------------------------------------------------------------------
        # Populate employee_skills from Alchemy cache (clear + re-insert)
        # ------------------------------------------------------------------
        db.query(EmployeeSkill).delete()
        db.commit()

        skill_rows = []
        no_match = 0
        for emp in all_emps:
            code = emp.alchemy_employee_id or emp.employee_id
            if not code:
                no_match += 1
                continue
            skills = alchemy_map.get(code, [])
            for s in skills:
                skill_name = (s.get("skill") or "").strip()
                if not skill_name:
                    continue
                try:
                    yrs = float(s.get("years_experience") or 0) or None
                except (ValueError, TypeError):
                    yrs = None
                last_used_raw = s.get("last_used") or ""
                try:
                    last_used = datetime.date.fromisoformat(last_used_raw) if last_used_raw else None
                except ValueError:
                    last_used = None
                skill_rows.append(EmployeeSkill(
                    employee_id=emp.id,
                    skill=skill_name,
                    certification="Certified" if s.get("certified") else None,
                    is_primary=bool(s.get("primary_skill")),
                    years_experience=yrs,
                    last_used=last_used,
                ))

        BATCH = 2000
        for i in range(0, len(skill_rows), BATCH):
            db.bulk_save_objects(skill_rows[i:i + BATCH])
            db.commit()
        print(f"[skills] Inserted {len(skill_rows)} skill records "
              f"({no_match} employees had no Alchemy match)")

        # ------------------------------------------------------------------
        # Re-seed attendance year-to-date for all employees
        # ------------------------------------------------------------------
        today = datetime.date.today()
        start = datetime.date(today.year, 1, 1)
        weekdays = list(_weekdays(start, today))
        emp_ids = [e.id for e in all_emps]
        print(f"[attendance] Seeding {len(emp_ids)} employees x {len(weekdays)} weekdays")

        deleted = db.query(Attendance).delete()
        db.commit()
        print(f"[attendance] Cleared {deleted} existing rows")

        batch: list[Attendance] = []
        total = 0
        for emp_id in emp_ids:
            rng = random.Random(emp_id)
            for day in weekdays:
                batch.append(_attendance_row(rng, emp_id, day))
                if len(batch) >= BATCH:
                    db.bulk_save_objects(batch)
                    db.commit()
                    total += len(batch)
                    batch = []
        if batch:
            db.bulk_save_objects(batch)
            db.commit()
            total += len(batch)
        print(f"[attendance] Inserted {total} attendance rows")

        # ------------------------------------------------------------------
        # Summary
        # ------------------------------------------------------------------
        roots = db.query(Employee).filter(Employee.manager_id.is_(None)).count()
        print(f"\n=== Done ===")
        print(f"  Employees    : {len(emp_ids)}")
        print(f"  With manager : {mgr_linked}")
        print(f"  Root nodes   : {roots}")
        print(f"  Skills       : {len(skill_rows)}")
        print(f"  Attendance   : {total}")

    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
