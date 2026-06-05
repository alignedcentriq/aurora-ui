"""Rebuild employees from ms365_users WITHOUT destroying FK-linked demo data.

- Overwrites the existing employee rows (keeps their ids -> leaves/tickets/etc. stay valid)
  with real MS365 names/emails.
- Inserts the remaining MS365 users as new employee rows.
- Sets every employee's location to a random one of Pune / Indore / Dubai / US.
- Rebuilds the employee_skills child table: 2-4 random (skill, certification) pairs each.

Run with `python -u`.
"""
import sys, os, random, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.database import engine, SessionLocal
from app.models import Base, Employee, EmployeeSkill, MS365User

SCHEMA = "enterprise_ai"
LOCATIONS = ["Pune", "Indore", "Dubai", "US"]
DEPARTMENTS = ["Engineering", "Sales", "Finance", "HR", "Operations",
               "Marketing", "IT Support", "Admin", "PMO", "Data & Analytics"]
DESIGNATIONS = ["Associate", "Senior Associate", "Engineer", "Senior Engineer",
                "Lead", "Manager", "Senior Manager", "Director", "Analyst", "Consultant"]

# skill -> plausible certification
SKILL_CATALOG = {
    "Python": "PCEP – Certified Entry-Level Python Programmer",
    "AWS": "AWS Certified Solutions Architect – Associate",
    "Azure": "Microsoft Certified: Azure Fundamentals",
    "Project Management": "PMP – Project Management Professional",
    "Scrum": "Certified ScrumMaster (CSM)",
    "Kubernetes": "CKA: Certified Kubernetes Administrator",
    "Data Analysis": "Microsoft Certified: Data Analyst Associate",
    "Machine Learning": "TensorFlow Developer Certificate",
    "Java": "Oracle Certified Professional: Java SE",
    "React": "Meta Front-End Developer Certificate",
    "SQL": "Microsoft Certified: Azure Data Fundamentals",
    "DevOps": "AWS Certified DevOps Engineer – Professional",
    "Cybersecurity": "CompTIA Security+",
    "Salesforce": "Salesforce Certified Administrator",
    "Networking": "Cisco CCNA",
}
SKILLS = list(SKILL_CATALOG.keys())


def main():
    # 1) schema: ensure location column + employee_skills table exist
    with engine.connect() as conn:
        conn.execute(text(f'ALTER TABLE {SCHEMA}.employees ADD COLUMN IF NOT EXISTS location VARCHAR'))
        conn.commit()
    Base.metadata.create_all(bind=engine, tables=[EmployeeSkill.__table__])
    print("[1] schema ready (location column + employee_skills table)", flush=True)

    db = SessionLocal()
    try:
        msusers = db.query(MS365User).order_by(MS365User.name).all()
        existing = db.query(Employee).order_by(Employee.id).all()
        print(f"[2] {len(msusers)} MS365 users -> rebuild over {len(existing)} existing employees", flush=True)

        existing_emp_ids = {e.employee_id for e in existing}
        updated = inserted = 0
        for i, m in enumerate(msusers):
            if i < len(existing):
                e = existing[i]
                e.name = m.name
                e.email = m.email
                e.location = random.choice(LOCATIONS)
                if not e.department:
                    e.department = m.department or random.choice(DEPARTMENTS)
                updated += 1
            else:
                # unique employee_id that won't collide with existing EMP10xx
                seq = i + 1
                emp_id = f"AAU{seq:05d}"
                while emp_id in existing_emp_ids:
                    seq += 1
                    emp_id = f"AAU{seq:05d}"
                existing_emp_ids.add(emp_id)
                db.add(Employee(
                    employee_id=emp_id,
                    name=m.name,
                    email=m.email,
                    department=m.department or random.choice(DEPARTMENTS),
                    designation=random.choice(DESIGNATIONS),
                    location=random.choice(LOCATIONS),
                ))
                inserted += 1
        db.commit()
        print(f"[3] employees: updated={updated} inserted={inserted}", flush=True)

        # 3) rebuild employee_skills
        db.execute(text(f'DELETE FROM {SCHEMA}.employee_skills'))
        db.commit()
        all_emps = db.query(Employee.id).all()
        skill_rows = []
        for (eid,) in all_emps:
            for sk in random.sample(SKILLS, random.randint(2, 4)):
                skill_rows.append(EmployeeSkill(employee_id=eid, skill=sk, certification=SKILL_CATALOG[sk]))
        db.bulk_save_objects(skill_rows)
        db.commit()
        print(f"[4] employee_skills: inserted {len(skill_rows)} rows for {len(all_emps)} employees", flush=True)

        # 4) verify
        emp_total = db.query(Employee).count()
        sk_total = db.query(EmployeeSkill).count()
        aligned = db.query(Employee).filter(Employee.email.like("%@alignedautomation.com")).count()
        print(f"\n[5] VERIFY employees={emp_total} aligned_email={aligned} skills={sk_total}", flush=True)
        print("Sample employees + skills:", flush=True)
        for e in db.query(Employee).order_by(Employee.id).limit(6).all():
            sks = db.query(EmployeeSkill).filter_by(employee_id=e.id).all()
            tag = ", ".join(f"{s.skill}({s.certification.split(':')[0].split('–')[0].strip()[:14]})" for s in sks)
            print(f"  id={e.id} {e.name:<28} {e.email:<40} {e.location:<7} | {tag}", flush=True)
    finally:
        db.close()
    print("DONE", flush=True)


main()
