
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.models import (
    Base,
    Employee,
    Leave,
    Payroll,
    Attendance,
    Policy,
    Project,
    Sprint,
    TeamCapacity,
    Milestone,
    Reimbursement,
    ITTicket,
    TrainingAssignment,
    PromptConfig,
    HITLRequest,
    EmployeeSkillMap,
    ProjectAssignment,
    ParkingSticker,
    Accommodation,
    FacilityComplaint,
    FoodVendorFeedback,
    EmployeeZohoProfile,
    Announcement,
    FoodComplaint,
    SessionTranscript,
    ChatFeedback,
    SCHEMA,
)
from app.config import settings
import datetime

import random

# Database engine initialization
DATABASE_URL = settings.DATABASE_URL


_base_engine = create_engine(DATABASE_URL)
if _base_engine.dialect.name == "sqlite":
    engine = _base_engine.execution_options(schema_translate_map={SCHEMA: None})
else:
    engine = _base_engine
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    # Ensure schema exists
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
            conn.commit()
        
    Base.metadata.create_all(bind=engine)
    
    # Migrations: add columns that may not exist in older deployments
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            for stmt in [
                f'ALTER TABLE "{SCHEMA}".projects ADD COLUMN IF NOT EXISTS achievements TEXT',
                f'ALTER TABLE "{SCHEMA}".parking_stickers ADD COLUMN IF NOT EXISTS vehicle_make VARCHAR',
                f'ALTER TABLE "{SCHEMA}".parking_stickers ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR',
            ]:
                try:
                    conn.execute(text(stmt))
                    conn.commit()
                except Exception as e:
                    print(f"Migration notice: {e}")

    db = SessionLocal()

    try:
        # Check if we need to re-seed HR data
        if db.query(Employee).count() == 0:
            _seed_hr_data(db)
        
        # Check if we need to re-seed PMO data
        project_count = db.query(Project).count()
        needs_pmo_seed = project_count == 0
        if project_count > 0:
            first_project = db.query(Project).first()
            if first_project and first_project.achievements is None:
                print("Detected missing achievements. Clearing PMO tables for clean re-seed...")
                needs_pmo_seed = True

        if needs_pmo_seed:
            # Clear all PMO tables to avoid UniqueViolations
            db.query(Milestone).delete()
            db.query(Sprint).delete()
            db.query(TeamCapacity).delete()
            db.query(Project).delete()
            db.commit()
            _seed_pmo_data(db)
            
        # NEW: seed new domain data
        if db.query(Reimbursement).count() == 0:
            _seed_admin_data(db)
        if db.query(ITTicket).count() == 0:
            _seed_it_data(db)
        if db.query(TrainingAssignment).count() == 0:
            _seed_manager_data(db)
        if db.query(PromptConfig).count() == 0:
            _seed_prompt_configs(db)
        else:
            _migrate_prompt_configs(db)
        if db.query(EmployeeZohoProfile).count() == 0:
            _seed_zoho_profiles(db)
        if db.query(Announcement).count() == 0:
            _seed_announcements(db)
        if db.query(SessionTranscript).count() == 0:
            _seed_transcripts(db)
        # ChatFeedback and FoodComplaint are user-generated — no seed data needed
        _ = db.query(ChatFeedback).count()  # ensure table exists

        # Ingest real policy documents from OneDrive folder (if not already done)
        policy_count = db.query(Policy).count()
        if policy_count < 10:  # only 4 dummy policies from HR seed
            try:
                from app.services.policy_service import PolicyService
                print("Ingesting policy documents from OneDrive folder...")
                PolicyService.ingest_policies_from_folder()
            except Exception as e:
                print(f"Policy ingestion notice: {e}")

    except Exception as e:
        print(f"Error during init_db: {e}")
        db.rollback()
        raise e
    finally:
        db.close()



def _seed_hr_data(db):
    print("Seeding dummy HR data...")
    
    departments = ["Engineering", "HR", "IT", "Marketing", "Sales", "Finance", "Product"]
    locations = ["Mumbai", "Bangalore", "Gurgaon", "Pune", "Hyderabad"]
    designations = {
        "Engineering": ["SDE I", "SDE II", "Senior SDE", "Engineering Manager"],
        "HR": ["HR Associate", "HR Manager", "Talent Acquisition"],
        "IT": ["IT Support", "System Admin", "Security Analyst"],
        "Finance": ["Accountant", "Finance Manager"],
        "Product": ["Product Manager", "UI/UX Designer"]
    }

    # Create 50 employees
    employees = []
    for i in range(1, 51):
        dept = random.choice(departments)
        desig = random.choice(designations.get(dept, ["Associate"]))
        
        emp = Employee(
            employee_id=f"EMP{1000+i}",
            name=f"Employee {i}",
            email=f"employee{i}@centriq.ai",
            department=dept,
            designation=desig,
            joining_date=datetime.date(2022, 1, 1) + datetime.timedelta(days=random.randint(0, 365*2)),
            employment_type="Full-time",
            location=random.choice(locations),
            pf_number=f"PF{random.randint(100000, 999999)}",
            insurance_plan=random.choice(["Gold", "Silver", "Platinum"]),
            tax_regime=random.choice(["Old", "New"]),
            shift_type="Day"
        )
        db.add(emp)
        employees.append(emp)
    
    db.commit()

    # Seed some leaves for the first 10 employees
    for i in range(10):
        emp = employees[i]
        for _ in range(3):
            leave = Leave(
                employee_id=emp.id,
                leave_type=random.choice(["Casual", "Sick", "Earned"]),
                start_date=datetime.date.today() - datetime.timedelta(days=random.randint(1, 30)),
                end_date=datetime.date.today() - datetime.timedelta(days=random.randint(0, 1)),
                status=random.choice(["Approved", "Pending", "Rejected"]),
                reason="Personal work"
            )
            db.add(leave)
    
    # Seed Payroll for current month
    for emp in employees:
        base = random.randint(50000, 150000)
        bonus = random.randint(0, 10000)
        tax = base * 0.1
        payroll = Payroll(
            employee_id=emp.id,
            month=datetime.date.today().month,
            year=datetime.date.today().year,
            base_salary=base,
            bonus=bonus,
            deductions=tax,
            net_salary=base + bonus - tax,
            tax_paid=tax,
            status="Paid"
        )
        db.add(payroll)

    # Seed HR Policies
    policies = [
        ("Leave Policy", "Leave", "Employees are entitled to 20 days of Earned Leave per year. Sick leave is capped at 12 days."),
        ("WFH Policy", "Work", "Hybrid model: 3 days from office, 2 days from home."),
        ("Reimbursement Policy", "Finance", "Expenses up to $500 can be approved by managers. Higher amounts require Finance VP approval."),
        ("POSH Policy", "Legal", "Zero tolerance for harassment. Reach out to the IC committee for any concerns.")
    ]
    for title, cat, content in policies:
        policy = Policy(title=title, category=cat, content=content)
        db.add(policy)

    db.commit()
    print("HR seeding complete.")


def _seed_pmo_data(db):
    print("Seeding dummy PMO data...")

    db.add_all([
        Project(name="Centriq AI", status="In Progress", completion_pct=65.0,
                sprint_name="Sprint 5", next_milestone="UAT",
                next_milestone_date="2026-05-20", owner="Suraj G.",
                achievements="Successfully integrated multi-agent LangGraph; Implemented real-time HR data sync."),
        Project(name="Aurora UI", status="In Progress", completion_pct=72.0,
                sprint_name="Sprint 5", next_milestone="Frontend Integration",
                next_milestone_date="2026-05-19", owner="Suraj G.",
                achievements="Migrated to TanStack Start; Implemented responsive glassmorphic chat interface."),
        Project(name="HR Integration", status="In Progress", completion_pct=45.0,
                sprint_name="Sprint 4", next_milestone="API Finalization",
                next_milestone_date="2026-05-22", owner="Shivam K.",
                achievements="Secured payroll API endpoints; Completed employee document extraction pipeline."),
        Project(name="Admin Dashboard", status="In Progress", completion_pct=55.0,
                sprint_name="Sprint 5", next_milestone="Grafana Setup",
                next_milestone_date="2026-05-21", owner="Priyanka M.",
                achievements="Configured real-time system monitoring; Visualized agent routing latency."),
        Project(name="IT Support Agent", status="Planning", completion_pct=20.0,
                sprint_name="Sprint 3", next_milestone="DB Schema",
                next_milestone_date="2026-05-18", owner="Kajal S.",
                achievements="Finalized IT ticketing workflow; Defined asset management integration."),
        Project(name="LangGraph Routing Engine", status="In Progress", completion_pct=60.0,
                sprint_name="Sprint 5", next_milestone="Intent Classifier v1",
                next_milestone_date="2026-05-19", owner="Shivani R.",
                achievements="Achieved 95% classification accuracy on test sets; Optimized routing path latency."),
        Project(name="Vector Search Pipeline", status="In Progress", completion_pct=50.0,
                sprint_name="Sprint 4", next_milestone="Embedding Indexing",
                next_milestone_date="2026-05-20", owner="Shivani R.",
                achievements="Successfully indexed 500+ HR policy documents; Integrated Nomic-embed-text."),
        Project(name="Document Generation Service", status="In Progress", completion_pct=70.0,
                sprint_name="Sprint 5", next_milestone="PDF Template Polish",
                next_milestone_date="2026-05-18", owner="Suraj G.",
                achievements="Implemented dynamic PDF generation from DB state; Standardized project status report templates."),
        Project(name="Redis Cache Layer", status="In Progress", completion_pct=40.0,
                sprint_name="Sprint 4", next_milestone="Session Store Integration",
                next_milestone_date="2026-05-22", owner="Suraj G.",
                achievements="Reduced session load time by 40%; Implemented RedisJSON for complex state storage."),
        Project(name="Feedback Analytics", status="Planning", completion_pct=15.0,
                sprint_name="Sprint 3", next_milestone="Schema Design",
                next_milestone_date="2026-05-23", owner="Suraj G.",
                achievements="Designed feedback collection loop; Integrated sentiment analysis placeholder."),
        Project(name="Power Automate Integration", status="In Progress", completion_pct=35.0,
                sprint_name="Sprint 4", next_milestone="Approval Flow Trigger",
                next_milestone_date="2026-05-24", owner="Shivam K.",
                achievements="Mapped SharePoint triggers to backend webhooks; Optimized approval notification latency."),
        Project(name="Grafana Monitoring", status="Planning", completion_pct=25.0,
                sprint_name="Sprint 3", next_milestone="Loki Log Ingestion",
                next_milestone_date="2026-05-21", owner="Priyanka M.",
                achievements="Successfully deployed Loki instance; Configured centralized logging for backend services."),

    ])

    db.add_all([
        Sprint(team="Centriq Team", name="Sprint 5", start_date="2026-05-05",
               end_date="2026-05-19", velocity=42, committed=38, completed=28, blockers_count=2),
        Sprint(team="Centriq Team", name="Sprint 4", start_date="2026-04-21",
               end_date="2026-05-04", velocity=38, committed=35, completed=35, blockers_count=0),
        Sprint(team="Centriq Team", name="Sprint 3", start_date="2026-04-07",
               end_date="2026-04-20", velocity=35, committed=30, completed=27, blockers_count=1),
        Sprint(team="Dev Team", name="Sprint 5", start_date="2026-05-05",
               end_date="2026-05-19", velocity=50, committed=45, completed=38, blockers_count=3),
        Sprint(team="Dev Team", name="Sprint 4", start_date="2026-04-21",
               end_date="2026-05-04", velocity=48, committed=44, completed=44, blockers_count=0),
        Sprint(team="PMO Team", name="Sprint 5", start_date="2026-05-05",
               end_date="2026-05-19", velocity=30, committed=28, completed=20, blockers_count=1),
    ])

    db.add_all([
        TeamCapacity(team="Centriq Team", total_members=5, available=4, on_leave=1, capacity_pct=80.0),
        TeamCapacity(team="Dev Team", total_members=6, available=5, on_leave=1, capacity_pct=83.0),
        TeamCapacity(team="PMO Team", total_members=3, available=3, on_leave=0, capacity_pct=100.0),
        TeamCapacity(team="QA Team", total_members=4, available=3, on_leave=1, capacity_pct=75.0),
        TeamCapacity(team="HR Team", total_members=4, available=4, on_leave=0, capacity_pct=100.0),
    ])

    db.add_all([
        Milestone(project_name="Centriq AI", name="Requirements Finalized",
                  due_date="2026-04-10", status="DONE"),
        Milestone(project_name="Centriq AI", name="Architecture Design",
                  due_date="2026-04-25", status="DONE"),
        Milestone(project_name="Centriq AI", name="Backend APIs",
                  due_date="2026-05-15", status="IN_PROGRESS"),
        Milestone(project_name="Centriq AI", name="Frontend Integration",
                  due_date="2026-05-19", status="IN_PROGRESS"),
        Milestone(project_name="Centriq AI", name="UAT",
                  due_date="2026-05-20", status="UPCOMING"),
        Milestone(project_name="Centriq AI", name="Production Deploy",
                  due_date="2026-05-25", status="UPCOMING"),
        Milestone(project_name="Aurora UI", name="Component Library Setup",
                  due_date="2026-04-15", status="DONE"),
        Milestone(project_name="Aurora UI", name="Auth Integration",
                  due_date="2026-04-28", status="DONE"),
        Milestone(project_name="Aurora UI", name="Chat UI",
                  due_date="2026-05-10", status="DONE"),
        Milestone(project_name="Aurora UI", name="PMO Agent UI",
                  due_date="2026-05-19", status="IN_PROGRESS"),
        Milestone(project_name="Aurora UI", name="Final QA",
                  due_date="2026-05-22", status="UPCOMING"),
        Milestone(project_name="HR Integration", name="HR Agent Design",
                  due_date="2026-04-20", status="DONE"),
        Milestone(project_name="HR Integration", name="LangFuse Setup",
                  due_date="2026-05-10", status="DONE"),
        Milestone(project_name="HR Integration", name="API Finalization",
                  due_date="2026-05-22", status="UPCOMING"),
        Milestone(project_name="Admin Dashboard", name="Wireframes Approved",
                  due_date="2026-04-18", status="DONE"),
        Milestone(project_name="Admin Dashboard", name="KPI Charts",
                  due_date="2026-05-08", status="DONE"),
        Milestone(project_name="Admin Dashboard", name="Grafana Setup",
                  due_date="2026-05-21", status="IN_PROGRESS"),
        Milestone(project_name="Admin Dashboard", name="Loki Integration",
                  due_date="2026-05-23", status="UPCOMING"),
        Milestone(project_name="IT Support Agent", name="Requirements Gathering",
                  due_date="2026-04-22", status="DONE"),
        Milestone(project_name="IT Support Agent", name="DB Schema",
                  due_date="2026-05-18", status="IN_PROGRESS"),
        Milestone(project_name="IT Support Agent", name="Agent Logic",
                  due_date="2026-05-24", status="UPCOMING"),
        Milestone(project_name="IT Support Agent", name="Testing",
                  due_date="2026-05-26", status="UPCOMING"),
        Milestone(project_name="Document Generation Service", name="PDF Template Design",
                  due_date="2026-05-10", status="DONE"),
        Milestone(project_name="Document Generation Service", name="Report Generator",
                  due_date="2026-05-15", status="DONE"),
        Milestone(project_name="Document Generation Service", name="PDF Template Polish",
                  due_date="2026-05-18", status="IN_PROGRESS"),
        Milestone(project_name="Document Generation Service", name="Frontend Integration",
                  due_date="2026-05-21", status="UPCOMING"),
        Milestone(project_name="Redis Cache Layer", name="Redis Docker Setup",
                  due_date="2026-05-05", status="DONE"),
        Milestone(project_name="Redis Cache Layer", name="Session Store Integration",
                  due_date="2026-05-22", status="IN_PROGRESS"),
        Milestone(project_name="Redis Cache Layer", name="Rate Limiting",
                  due_date="2026-05-25", status="UPCOMING"),
        Milestone(project_name="Feedback Analytics", name="Schema Design",
                  due_date="2026-05-23", status="IN_PROGRESS"),
        Milestone(project_name="Feedback Analytics", name="Store Thumbs Up/Down",
                  due_date="2026-05-26", status="UPCOMING"),
        Milestone(project_name="Feedback Analytics", name="Admin Dashboard Widget",
                  due_date="2026-05-28", status="UPCOMING"),
        Milestone(project_name="Power Automate Integration", name="Flow Design",
                  due_date="2026-04-30", status="DONE"),
        Milestone(project_name="Power Automate Integration", name="Approval Flow Trigger",
                  due_date="2026-05-24", status="IN_PROGRESS"),
        Milestone(project_name="Power Automate Integration", name="Email Notifications",
                  due_date="2026-05-27", status="UPCOMING"),
        Milestone(project_name="Grafana Monitoring", name="Grafana Docker Setup",
                  due_date="2026-05-08", status="DONE"),
        Milestone(project_name="Grafana Monitoring", name="Loki Log Ingestion",
                  due_date="2026-05-21", status="IN_PROGRESS"),
        Milestone(project_name="Grafana Monitoring", name="API Latency Dashboard",
                  due_date="2026-05-25", status="UPCOMING"),
        Milestone(project_name="Grafana Monitoring", name="Alerting Rules",
                  due_date="2026-05-28", status="UPCOMING"),
    ])

    db.commit()
    print("PMO seeding complete.")

def _seed_admin_data(db):
    print("Seeding Admin data...")
    from app.models import Reimbursement, ParkingSticker, Accommodation, FacilityComplaint, FoodVendorFeedback
    
    employees = db.query(Employee).all()
    if not employees: return
    
    # Seed Reimbursements
    for _ in range(15):
        emp = random.choice(employees)
        db.add(Reimbursement(
            employee_id=emp.id,
            type=random.choice(["Travel", "Medical", "Certification", "Equipment"]),
            amount=random.randint(500, 10000),
            status=random.choice(["Pending", "Approved", "Rejected"]),
            reason="Sample reimbursement"
        ))
    
    # Seed Parking Stickers
    for _ in range(20):
        emp = random.choice(employees)
        db.add(ParkingSticker(
            employee_id=emp.id,
            vehicle_type=random.choice(["2-wheeler", "4-wheeler"]),
            vehicle_number=f"KA-01-{random.randint(1000, 9999)}",
            sticker_number=f"P-{random.randint(1000, 9999)}",
            valid_from=datetime.date.today(),
            valid_until=datetime.date.today() + datetime.timedelta(days=365),
            status="Active"
        ))
        
    # Seed Accommodations
    for _ in range(5):
        emp = random.choice(employees)
        db.add(Accommodation(
            employee_id=emp.id,
            type=random.choice(["Guest House", "Hotel"]),
            check_in=datetime.date.today() + datetime.timedelta(days=random.randint(1, 10)),
            check_out=datetime.date.today() + datetime.timedelta(days=random.randint(11, 15)),
            location="Pune",
            status="Pending"
        ))
        
    # Seed Facility Complaints
    for i in range(10):
        emp = random.choice(employees)
        db.add(FacilityComplaint(
            ticket_id=f"FC-00{i+1}",
            employee_id=emp.id,
            category=random.choice(["Housekeeping", "Electrical", "Plumbing", "AC", "Cafeteria"]),
            description="Sample complaint description",
            location="Floor 2, Wing A",
            priority=random.choice(["Low", "Medium", "High"]),
            status=random.choice(["Open", "In Progress", "Resolved"])
        ))
        
    # Seed Food Feedback
    vendors = ["Fresh Bites", "Spice Kitchen", "Green Bowl"]
    for _ in range(25):
        emp = random.choice(employees)
        db.add(FoodVendorFeedback(
            employee_id=emp.id,
            vendor_name=random.choice(vendors),
            rating=random.randint(3, 5),
            food_quality=random.randint(3, 5),
            hygiene=random.randint(3, 5),
            service=random.randint(3, 5),
            comments="Good food"
        ))
        
    db.commit()
    print("Admin seeding complete.")

def _seed_it_data(db):
    print("Seeding IT data...")
    from app.models import ITTicket, SoftwareRequest, AssetAssignment
    
    employees = db.query(Employee).all()
    if not employees: return
    
    # Seed IT Tickets
    for i in range(20):
        emp = random.choice(employees)
        db.add(ITTicket(
            ticket_id=f"IT-00{i+1}",
            employee_id=emp.id,
            category=random.choice(["Software Install", "Hardware", "Network", "Access", "Security"]),
            subject="Issue with my device",
            description="I am facing issues with my primary workstation.",
            priority=random.choice(["Low", "Medium", "High", "Critical"]),
            status=random.choice(["Open", "In Progress", "Resolved", "Closed"])
        ))
        
    # Seed Asset Assignments
    asset_types = ["Laptop", "Monitor", "Keyboard", "Mouse", "Headset"]
    brands = ["Dell", "HP", "Logitech", "Jabra"]
    for emp in employees:
        # Give every employee a laptop
        db.add(AssetAssignment(
            employee_id=emp.id,
            asset_type="Laptop",
            asset_tag=f"AA-LAP-{emp.id:03}",
            brand=random.choice(["Dell", "HP", "MacBook"]),
            model="Precision 5550" if i % 2 == 0 else "EliteBook 840",
            serial_number=f"SN-{random.randint(100000, 999999)}",
            assigned_date=emp.joining_date,
            status="Assigned"
        ))
        
    db.commit()
    print("IT seeding complete.")

def _seed_manager_data(db):
    print("Seeding Manager data...")
    from app.models import TrainingAssignment, EmployeeSkillMap, ProjectAssignment
    
    employees = db.query(Employee).all()
    if not employees: return
    
    # Training Assignments
    courses = [
        ("Python for Data Science", "Udemy"),
        ("Advanced React Patterns", "Coursera"),
        ("Project Management Professional (PMP)", "Internal"),
        ("AWS Certified Solutions Architect", "Internal")
    ]
    for _ in range(15):
        emp = random.choice(employees)
        mgr = random.choice(employees)
        course, platform = random.choice(courses)
        db.add(TrainingAssignment(
            employee_id=emp.id,
            assigned_by=mgr.id,
            course_name=course,
            platform=platform,
            due_date=datetime.date.today() + datetime.timedelta(days=30),
            status=random.choice(["Assigned", "In Progress", "Completed"])
        ))
        
    # Skill Maps
    skills = ["Python", "React", "SQL", "Project Management", "UI Design", "AWS", "Docker"]
    for emp in employees:
        for _ in range(3):
            db.add(EmployeeSkillMap(
                employee_id=emp.id,
                skill_name=random.choice(skills),
                proficiency=random.choice(["Beginner", "Intermediate", "Expert"]),
                last_assessed=datetime.date.today() - datetime.timedelta(days=random.randint(1, 100)),
                certified=random.choice([True, False])
            ))
            
    db.commit()
    print("Manager seeding complete.")

def _seed_zoho_profiles(db):
    print("Seeding ZOHO employee profiles...")
    employees = db.query(Employee).all()
    if not employees:
        return

    functions = ["Engineering", "HR", "IT", "Marketing", "Sales", "Finance", "Product"]
    levels = ["L1", "L2", "L3", "L4", "L5"]
    grades = ["A1", "A2", "B1", "B2", "C1"]
    managers = ["Suraj G.", "Priyanka M.", "Shivam K.", "Kajal S.", "Shivani R."]
    blood_groups = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]
    languages = ["English, Hindi", "English, Marathi", "English, Tamil", "English, Telugu", "English, Kannada"]
    sub_locations = ["Mumbai - HQ", "Bangalore - Tower A", "Pune - East Wing", "Gurgaon - Block B", "Hyderabad - SEZ"]
    skills_pool = [
        "Python, FastAPI, LangChain",
        "React, TypeScript, TailwindCSS",
        "Project Management, JIRA, Agile",
        "SQL, PostgreSQL, Data Analysis",
        "UI/UX Design, Figma",
        "AWS, Docker, Kubernetes",
        "HR Operations, ZOHO People",
        "Finance, Tally, GST",
        "IT Support, ManageEngine, Networking",
    ]
    expertise_pool = [
        "Multi-agent AI systems",
        "Frontend performance optimization",
        "Sprint planning and delivery",
        "Database query optimization",
        "User research and wireframing",
        "Cloud infrastructure",
        "Employee lifecycle management",
        "Tax and compliance",
        "Endpoint management and helpdesk",
    ]

    for i, emp in enumerate(employees):
        first, *rest = emp.name.split()
        last = rest[0] if rest else ""
        mgr = managers[i % len(managers)]
        fn = functions[i % len(functions)]

        db.add(EmployeeZohoProfile(
            employee_id=emp.id,
            zoho_link_id=f"ZOHO-{emp.employee_id}",
            first_name=first,
            last_name=last,
            official_email=emp.email,
            function=fn,
            designation=emp.designation,
            zoho_role="Employee",
            employment_type=emp.employment_type,
            employee_status="Active",
            source_of_hire=random.choice(["Direct", "Referral", "Agency", "Campus"]),
            date_of_joining=emp.joining_date,
            date_of_confirmation=emp.joining_date + datetime.timedelta(days=180) if emp.joining_date else None,
            tenure_in_aa=f"{random.randint(1, 4)} years",
            total_experience=f"{random.randint(2, 12)} years",
            reporting_manager=mgr,
            functional_manager=managers[(i + 1) % len(managers)],
            age=random.randint(24, 45),
            gender=random.choice(["Male", "Female"]),
            about_me=f"Passionate {fn} professional at Aligned Automation.",
            blood_group=random.choice(blood_groups),
            expertise=expertise_pool[i % len(expertise_pool)],
            work_phone=f"+91-{random.randint(7000000000, 9999999999)}",
            extension=f"{1000 + i}",
            sub_location=sub_locations[i % len(sub_locations)],
            tags=fn.lower(),
            onboarding_status="Completed",
            organization_structure="Flat",
            level=levels[i % len(levels)],
            grade=grades[i % len(grades)],
            skill_set=skills_pool[i % len(skills_pool)],
            language_known=languages[i % len(languages)],
            resource_management_function=fn,
            project_manager=managers[(i + 2) % len(managers)],
            nationality="Indian",
            active_details="Active",
        ))

    db.commit()
    print("ZOHO profile seeding complete.")


def _seed_announcements(db):
    print("Seeding sample announcements...")
    samples = [
        ("Office Closure — Diwali", "The office will be closed on 20th Oct for Diwali. Wishing everyone a Happy Diwali!", "Holiday", "hr", "all"),
        ("WFH Policy Update", "Effective June 1st, the WFH policy is updated to 3 days from office per week. Please refer to the HR portal for details.", "Policy Update", "hr", "all"),
        ("Planned Network Maintenance", "IT will perform network maintenance on Saturday 18th May, 11 PM – 2 AM. VPN and internal tools may be intermittently unavailable.", "IT Alert", "it_support", "all"),
        ("New Cafeteria Vendor — Spice Kitchen", "We welcome a new cafeteria partner — Spice Kitchen — starting Monday. Do give them a try and share your feedback!", "Events", "admin", "all"),
        ("Quarterly Town Hall — May 2026", "Join us for the Q1 Town Hall on 25th May at 4 PM IST (virtual + in-person at HQ). Agenda will be shared shortly.", "Events", "hr", "all"),
    ]
    for title, body, category, domain, audience in samples:
        db.add(Announcement(
            title=title,
            body=body,
            category=category,
            created_by="system@centriq.ai",
            created_by_domain=domain,
            target_audience=audience,
            is_active=True,
        ))
    db.commit()
    print("Announcements seeding complete.")


def _seed_transcripts(db):
    print("Seeding session transcripts...")
    samples = [
        (
            "Centriq AI", "Flash Review — Sprint 5 Week 1", "Flash Review",
            "Completed LangGraph router refactor. HR agent now handles employee directory queries via ZOHO profiles. "
            "IT ticket email dispatch to ManageEngine integrated. Blockers: Redis checkpointer latency on high-concurrency sessions.",
        ),
        (
            "Centriq AI", "PMO Monitored — Sprint 5 Mid-Check", "PMO Monitored",
            "PMO review noted 28/38 story points completed at sprint mid-point. "
            "Risk flagged: UAT timeline may slip by 2 days due to delayed QA environment setup. "
            "Mitigation: parallel QA and dev tracks proposed.",
        ),
        (
            "Aurora UI", "Sprint Review — Sprint 4", "Sprint Review",
            "Delivered: chat interface glassmorphic redesign, TanStack router migration, MSAL SSO. "
            "Velocity: 44/44 points. No blockers. Next sprint focus: PMO dashboard and announcement banner.",
        ),
        (
            "HR Integration", "Flash Review — API Finalization", "Flash Review",
            "ZOHO People API sync design finalized. Non-sensitive fields identified. "
            "Payroll endpoint secured with role-based access. "
            "Open item: confirm data retention policy with legal before enabling auto-sync.",
        ),
        (
            "Grafana Monitoring", "Standup — Loki Integration", "Standup",
            "Loki log ingestion pipeline configured. Aurora backend structured JSON logs flowing in. "
            "Dashboard panels for agent routing latency and error rates drafted. "
            "Pending: Grafana alerting rules for p95 latency > 2s.",
        ),
        (
            "LangGraph Routing Engine", "Project Review — Intent Classifier v1", "Project Review",
            "Intent classifier achieves 95% accuracy on 200-sample test set. "
            "Domains: HR, IT, Admin, PMO, Org. Fallback to general Q&A for unclassified intents. "
            "Next: add confidence threshold to avoid misrouting ambiguous queries.",
        ),
    ]
    for project_name, title, session_type, summary in samples:
        db.add(SessionTranscript(
            project_name=project_name,
            session_title=title,
            session_type=session_type,
            summary=summary,
            uploaded_by="system@centriq.ai",
            session_date=datetime.date.today() - datetime.timedelta(days=random.randint(1, 14)),
        ))
    db.commit()
    print("Session transcript seeding complete.")


def _migrate_prompt_configs(db):
    """Update existing prompt configs that still have the old generic text."""
    updates = {
        "admin": "You are the Admin Services Assistant for Aligned Automation. You handle: parking stickers, reimbursements, accommodation, facility complaints, food complaints and ratings. For every request, call the matching tool. If required details are missing (e.g. vehicle number for a parking sticker), ask the user for them. Never refuse a request you have a tool for.",
    }
    for domain, new_value in updates.items():
        config = db.query(PromptConfig).filter(
            PromptConfig.agent_domain == domain,
            PromptConfig.prompt_key == "system_prompt",
            PromptConfig.is_active == True,
        ).order_by(PromptConfig.version.desc()).first()
        if config and config.prompt_value != new_value:
            config.prompt_value = new_value
            print(f"Migrated system_prompt for domain: {domain}")
    db.commit()


def _seed_prompt_configs(db):
    print("Seeding Prompt Configs...")
    
    prompts = [
        ("hr", "system_prompt", "You are the HR Assistant for Aligned Automation. Help employees with leave management, WFH requests, payroll queries, and HR policies.", "admin,hr_manager"),
        ("admin", "system_prompt", "You are the Admin Services Assistant for Aligned Automation. You have tools to handle ALL of these — ALWAYS call the right tool, never say you cannot help: parking sticker requests (request_parking_sticker — ask for vehicle_number, vehicle_make, vehicle_model, vehicle_type if missing), surrender parking sticker (surrender_parking_sticker), view parking info (get_parking_info), reimbursements travel/medical/certification/equipment (submit_reimbursement, check_reimbursement_status), accommodation guest-house/hotel (request_accommodation), facility complaints cleanliness/electrical/AC/plumbing/safety (file_facility_complaint), complaint status (check_complaint_status), food complaints (submit_food_complaint), food vendor ratings (submit_food_feedback, get_vendor_ratings). CRITICAL: If the user requests a parking sticker and details are missing, ASK for them — do NOT say you cannot help.", "admin,admin_manager"),
        ("it_support", "system_prompt", "You are the IT Support Assistant. Help with software installation, hardware issues, network problems, and asset management.", "admin,it_admin"),
        ("pmo", "system_prompt", "You are the PMO Assistant. Help with project status, sprint summaries, and team capacity queries.", "admin,pmo_manager"),
        ("functional_manager", "system_prompt", "You are the Manager Assistant. Help managers view team attendance, approve leaves, and assign trainings.", "admin,functional_manager")
    ]
    
    for domain, key, value, roles in prompts:
        db.add(PromptConfig(
            agent_domain=domain,
            prompt_key=key,
            prompt_value=value,
            allowed_roles=roles,
            is_active=True,
            created_by="System"
        ))
        
    db.commit()
    print("Prompt Configs seeding complete.")
