"""
Seed a realistic reporting hierarchy into employees.manager_id.

The MS365 sync never populated manager data, so this builds a believable org tree for the
demo (needed for manager-gated features like per-employee attendance):

  - One company head (lowest employee id) reports to nobody.
  - Within each department, employees form a tree with span-of-control ~8 (so there are
    multiple management levels, not one flat layer). Each department lead reports to the head.
  - The tree is acyclic by construction (every manager has a smaller in-group index).
  - The demo user (Shivam) is guaranteed a direct team so manager-gated demos work.

Deterministic (ordered by id) and idempotent (resets manager_id first, then rebuilds).

Usage:
    cd backend
    python seed_org_hierarchy.py
"""

from collections import defaultdict

from app.database import SessionLocal
from app.models import Employee

SPAN = 8
DEMO_USER_EMAIL = "shivam.sharma@alignedautomation.com"
DEMO_TEAM_SIZE = 8


def seed():
    db = SessionLocal()
    try:
        emps = db.query(Employee).order_by(Employee.id).all()
        if not emps:
            print("[seed_org_hierarchy] no employees")
            return

        for e in emps:
            e.manager_id = None

        ceo = emps[0]  # lowest id = company head

        groups = defaultdict(list)
        for e in emps:
            groups[e.department or "General"].append(e)

        for members in groups.values():
            members.sort(key=lambda x: x.id)
            lead = members[0]
            lead.manager_id = None if lead.id == ceo.id else ceo.id
            for i in range(1, len(members)):
                members[i].manager_id = members[(i - 1) // SPAN].id

        ceo.manager_id = None

        # Guarantee the demo user has a direct team.
        demo = db.query(Employee).filter(Employee.email == DEMO_USER_EMAIL).first()
        if demo:
            dept_members = groups[demo.department or "General"]
            lead = dept_members[0]
            demo.manager_id = None if demo.id == ceo.id else (ceo.id if lead.id == demo.id else lead.id)
            # Reportees: lowest-id dept members, never the head/lead/self (avoids cycles).
            picks = [e for e in dept_members if e.id not in (ceo.id, lead.id, demo.id)][:DEMO_TEAM_SIZE]
            if len(picks) < DEMO_TEAM_SIZE:
                seen = {ceo.id, demo.id} | {p.id for p in picks}
                picks += [e for e in emps if e.id not in seen][: DEMO_TEAM_SIZE - len(picks)]
            for e in picks:
                e.manager_id = demo.id

        db.commit()

        # Stats
        managers = {e.manager_id for e in emps if e.manager_id is not None}
        roots = [e for e in emps if e.manager_id is None]
        demo_reports = db.query(Employee).filter(Employee.manager_id == (demo.id if demo else -1)).all()
        print(f"[seed_org_hierarchy] {len(emps)} employees, {len(managers)} are managers, "
              f"{len(roots)} root(s) (head={ceo.name})")
        if demo:
            print(f"[seed_org_hierarchy] {demo.name} (id={demo.id}) manager_id={demo.manager_id}, "
                  f"direct reportees={[e.name for e in demo_reports]}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
