"""
Seed demo data for Shivam's "My Team" portal.

1. Trims Shivam's hierarchy to a manageable size (~9 people total).
2. Creates project allocations for each team member.
3. Creates sample OnboardingRequest and PMOTeamRequest rows.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import datetime
from app.database import SessionLocal, engine
from app.models import (
    Base, Employee, EmployeeAllocation, OnboardingRequest, PMOTeamRequest, SCHEMA
)

SHIVAM_ID   = 871
SHIVAM_EMAIL = "shivam.sharma@alignedautomation.com"
AADITI_ID   = 2    # Shivam's manager — orphaned reports re-parent here

# ── 1. Trim hierarchy ─────────────────────────────────────────────────────────

def trim_hierarchy(db):
    directs = db.query(Employee).filter(Employee.manager_id == SHIVAM_ID).all()
    keep_ids = {directs[0].id, directs[1].id, directs[2].id}  # keep first 3
    reassign = [e for e in directs if e.id not in keep_ids]

    for emp in reassign:
        emp.manager_id = AADITI_ID
        print(f"  Reassigned {emp.name} -> Aaditi")

    # Each kept manager: keep only their first 2 sub-reports, reassign rest to Aaditi
    for kid in directs[:3]:
        subs = db.query(Employee).filter(Employee.manager_id == kid.id).all()
        for sub in subs[2:]:
            sub.manager_id = AADITI_ID
            print(f"    Reassigned {sub.name} (was under {kid.name}) -> Aaditi")

    db.commit()

    # Verify
    from app.services.attendance_service import descendants, resolve_employee
    mgr = resolve_employee(db, SHIVAM_EMAIL)
    team = descendants(db, mgr.id)
    print(f"\n  Hierarchy now: {len(team)} people")
    return [mgr] + team


# ── 2. Project allocations ────────────────────────────────────────────────────

PROJECTS = [
    ("Axis Bank Portal Revamp",   "UI/UX",       "Axis Bank",       "Active",    80, 100),
    ("HDFC Analytics Dashboard",  "Backend",      "HDFC",            "Active",    60,  80),
    ("SBI Mobile App",            "Mobile",       "SBI",             "Active",   100, 100),
    ("Infosys AI Platform",       "AI/ML",        "Infosys",         "Active",    50,  60),
    ("TCS HR Automation",         "Automation",   "TCS",             "Active",    70,  90),
    ("Wipro Cloud Migration",     "DevOps",       "Wipro",           "Active",    40,  50),
    ("Cognizant Data Lake",       "Data Eng",     "Cognizant",       "Active",   100, 100),
    ("HCL Compliance Suite",      "Backend",      "HCL",             "Active",    80,  80),
    ("Tech Mahindra ERP",         "Full Stack",   "Tech Mahindra",   "Active",    60,  70),
]

def seed_allocations(db, team_members):
    for i, emp in enumerate(team_members):
        proj = PROJECTS[i % len(PROJECTS)]
        existing = db.query(EmployeeAllocation).filter(
            EmployeeAllocation.employee_name == emp.name,
            EmployeeAllocation.project_name == proj[0],
        ).first()
        if existing:
            continue
        alloc = EmployeeAllocation(
            employee_id=emp.employee_id or f"AA-{emp.id:03d}",
            employee_name=emp.name,
            project_name=proj[0],
            sub_project=proj[1],
            client_master=proj[2],
            project_lead="Shivam Sharma",
            delivery_manager="Aaditi Ranaware",
            completion_status=proj[3],
            efforts_percent=proj[4],
            billability_percent=proj[5],
            allocation_date=datetime.date(2025, 1, 1),
            project_status="In Progress",
            billing="T&M",
            project_type="External",
            reporting_manager="Shivam Sharma",
            functional_manager="Shivam Sharma",
            function=emp.department or "Engineering",
            status="Active",
            expected_end_date=datetime.date(2026, 12, 31),
        )
        db.add(alloc)
        print(f"  Allocation: {emp.name} -> {proj[0]}")

    db.commit()


# ── 3. Onboarding requests ────────────────────────────────────────────────────

ONBOARDING_SEEDS = [
    {
        "employee_name": None,   # filled from team
        "steps": {"drug_test": True, "background_check": True, "client_onboarding": True},
        "client_name": "Axis Bank",
        "notes": "Client requires drug test certificate before engagement start.",
        "status": "Pending",
    },
    {
        "employee_name": None,
        "steps": {"drug_test": False, "background_check": True, "client_onboarding": True},
        "client_name": "HDFC",
        "notes": "Background check in progress. Client onboarding scheduled for next week.",
        "status": "In Progress",
    },
    {
        "employee_name": None,
        "steps": {"drug_test": True, "background_check": True, "client_onboarding": False},
        "client_name": None,
        "notes": "Pre-engagement checks for bench resource.",
        "status": "Completed",
    },
]

def seed_onboarding(db, team_members):
    for i, seed in enumerate(ONBOARDING_SEEDS):
        emp = team_members[i % len(team_members)]
        existing = db.query(OnboardingRequest).filter(
            OnboardingRequest.employee_name == emp.name,
            OnboardingRequest.created_by == SHIVAM_EMAIL,
        ).first()
        if existing:
            continue
        req = OnboardingRequest(
            employee_name=emp.name,
            employee_email=emp.email,
            steps=seed["steps"],
            client_name=seed["client_name"],
            notes=seed["notes"],
            status=seed["status"],
            created_by=SHIVAM_EMAIL,
            created_at=datetime.datetime.utcnow() - datetime.timedelta(days=10 - i * 3),
        )
        db.add(req)
        print(f"  Onboarding: {emp.name} | {seed['status']}")
    db.commit()


# ── 4. PMO requests ───────────────────────────────────────────────────────────

PMO_SEEDS = [
    {
        "request_type": "vdi_provision",
        "details": "VDI required for Axis Bank project. Employee needs access to client network environment. Specs: 8GB RAM, 4 core, Windows 11.",
        "status": "Pending",
    },
    {
        "request_type": "vdi_provision",
        "details": "VDI needed for HDFC analytics environment. Requires Python 3.11, Tableau, and database client tools.",
        "status": "In Progress",
    },
    {
        "request_type": "vdi_revoke",
        "details": "Employee completing TCS project. VDI access to TCS network should be revoked by end of month.",
        "status": "Completed",
    },
]

def seed_pmo_requests(db, team_members):
    for i, seed in enumerate(PMO_SEEDS):
        emp = team_members[i % len(team_members)]
        existing = db.query(PMOTeamRequest).filter(
            PMOTeamRequest.employee_name == emp.name,
            PMOTeamRequest.request_type == seed["request_type"],
            PMOTeamRequest.created_by == SHIVAM_EMAIL,
        ).first()
        if existing:
            continue
        req = PMOTeamRequest(
            request_type=seed["request_type"],
            employee_name=emp.name,
            employee_email=emp.email,
            details=seed["details"],
            status=seed["status"],
            created_by=SHIVAM_EMAIL,
            created_at=datetime.datetime.utcnow() - datetime.timedelta(days=7 - i * 2),
        )
        db.add(req)
        print(f"  PMO request: {seed['request_type']} for {emp.name} | {seed['status']}")
    db.commit()


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    db = SessionLocal()
    try:
        print("=== 1. Trimming hierarchy ===")
        team = trim_hierarchy(db)

        team_members = [e for e in team if e.id != SHIVAM_ID]
        print(f"\n=== 2. Seeding allocations for {len(team_members)} members ===")
        seed_allocations(db, team_members)

        print("\n=== 3. Seeding onboarding requests ===")
        seed_onboarding(db, team_members)

        print("\n=== 4. Seeding PMO requests ===")
        seed_pmo_requests(db, team_members)

        print("\nDone.")
    finally:
        db.close()
