
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.models import (
    Base,
    Employee,
    Leave,
    Attendance,
    Policy,
    PolicyChunk,
    Project,
    Reimbursement,
    ITTicket,
    PromptConfig,
    PromptDraft,
    HITLRequest,
    ParkingSticker,
    Accommodation,
    FacilityComplaint,
    FoodVendorFeedback,
    EmployeeZohoProfile,
    EmployeeAllocation,
    Announcement,
    FoodComplaint,
    ChatFeedback,
    ApprovalToken,
    Grievance,
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

def _background_embed_policies():
    """Runs in a daemon thread — chunks + embeds all un-chunked policies."""
    try:
        from app.services.policy_service import PolicyService
        PolicyService.embed_all_policies()
    except Exception as e:
        print(f"[background] Policy embedding failed: {e}")


def init_db():
    # Ensure schema exists
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
            conn.commit()
        
    Base.metadata.create_all(bind=engine)

    # Drop removed tables
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            try:
                conn.execute(text(f'DROP TABLE IF EXISTS "{SCHEMA}".payroll CASCADE'))
                conn.commit()
            except Exception:
                pass

    # Migrations: add columns that may not exist in older deployments
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            for stmt in [
                f'ALTER TABLE "{SCHEMA}".projects ADD COLUMN IF NOT EXISTS achievements TEXT',
                f'ALTER TABLE "{SCHEMA}".parking_stickers ADD COLUMN IF NOT EXISTS vehicle_make VARCHAR',
                f'ALTER TABLE "{SCHEMA}".parking_stickers ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR',
                f'ALTER TABLE "{SCHEMA}".announcements ADD COLUMN IF NOT EXISTS image_url VARCHAR',
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
        else:
            _migrate_employee_names(db)
        
        # Check if we need to re-seed PMO data
        project_count = db.query(Project).count()
        needs_pmo_seed = project_count == 0
        if project_count > 0:
            first_project = db.query(Project).first()
            if first_project and first_project.achievements is None:
                print("Detected missing achievements. Clearing PMO tables for clean re-seed...")
                needs_pmo_seed = True

        if needs_pmo_seed:
            db.query(Project).delete()
            db.commit()
            _seed_pmo_data(db)

        if db.query(Reimbursement).count() == 0:
            _seed_admin_data(db)
        if db.query(ITTicket).count() == 0:
            _seed_it_data(db)
        if db.query(PromptConfig).count() == 0:
            _seed_prompt_configs(db)
        else:
            _migrate_prompt_configs(db)
        if db.query(EmployeeZohoProfile).count() == 0:
            _seed_zoho_profiles(db)
        if db.query(Announcement).count() == 0:
            _seed_announcements(db)
        _ = db.query(ChatFeedback).count()

        # Ingest real policy documents from OneDrive folder (if not already done)
        policy_count = db.query(Policy).count()
        if policy_count < 10:  # only 4 dummy seed policies
            try:
                from app.services.policy_service import PolicyService
                print("Ingesting policy documents from OneDrive folder...")
                PolicyService.ingest_policies_from_folder()
            except Exception as e:
                print(f"Policy ingestion notice: {e}")

        # Chunk + embed all policies that don't have chunks yet (runs in background)
        try:
            import threading
            print("Starting policy chunking + embedding in background...")
            threading.Thread(
                target=_background_embed_policies,
                daemon=True,
            ).start()
        except Exception as e:
            print(f"Policy chunking notice: {e}")

    except Exception as e:
        print(f"Error during init_db: {e}")
        db.rollback()
        raise e
    finally:
        db.close()



def _migrate_employee_names(db):
    """One-time rename: replace 'Employee N' generic names with realistic names."""
    import re
    generic = [
        e for e in db.query(Employee).filter(Employee.name.like("Employee %")).all()
        if re.match(r"^Employee \d+$", e.name)
    ]
    if not generic:
        return
    print(f"Migrating {len(generic)} generic employee names to realistic names...")
    used: set = set(
        e.name for e in db.query(Employee).all()
        if not re.match(r"^Employee \d+$", e.name)
    )

    def _pick():
        for _ in range(200):
            n = f"{random.choice(_FIRST_NAMES)} {random.choice(_LAST_NAMES)}"
            if n not in used:
                used.add(n)
                return n
        return f"{random.choice(_FIRST_NAMES)} {random.choice(_LAST_NAMES)}"

    for emp in generic:
        new_name = _pick()
        emp.name = new_name
        slug = new_name.lower().replace(" ", ".")
        # Keep email unique — only update if it still looks generic
        if re.match(r"^employee\d+@", emp.email):
            # extract numeric suffix to preserve uniqueness
            m = re.search(r"(\d+)@", emp.email)
            suffix = m.group(1) if m else emp.id
            emp.email = f"{slug}{suffix}@centriq.ai"

        # Update linked zoho profile names
        profile = db.query(EmployeeZohoProfile).filter(
            EmployeeZohoProfile.employee_id == emp.id
        ).first()
        if profile:
            parts = new_name.split(" ", 1)
            profile.first_name = parts[0]
            profile.last_name = parts[1] if len(parts) > 1 else ""
            profile.official_email = emp.email

    db.commit()
    print("Employee name migration complete.")


_FIRST_NAMES = [
    "Aarav", "Aditi", "Aditya", "Akash", "Anil", "Anjali", "Arjun", "Ayesha",
    "Bhavna", "Chetan", "Deepak", "Dhruv", "Divya", "Ekta", "Farhan", "Gaurav",
    "Girish", "Harini", "Hemant", "Isha", "Ishaan", "Kavita", "Kiran", "Lakshmi",
    "Manish", "Meera", "Mohan", "Naman", "Neha", "Nikhil", "Pallavi", "Pooja",
    "Priya", "Rahul", "Rajesh", "Ravi", "Rekha", "Riya", "Rohit", "Sanjay",
    "Shalini", "Shreya", "Suresh", "Tanvi", "Usha", "Varun", "Vikram", "Vijay",
    "Vishal", "Yash",
]
_LAST_NAMES = [
    "Agarwal", "Bhatt", "Chakraborty", "Desai", "Dubey", "Ghosh", "Gupta",
    "Iyer", "Jain", "Joshi", "Kapoor", "Khanna", "Kumar", "Mehta", "Mishra",
    "Nair", "Patel", "Pillai", "Raj", "Rao", "Reddy", "Sharma", "Singh", "Verma",
]


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

    used_names: set = set()

    def _unique_name() -> str:
        for _ in range(200):
            name = f"{random.choice(_FIRST_NAMES)} {random.choice(_LAST_NAMES)}"
            if name not in used_names:
                used_names.add(name)
                return name
        return f"{random.choice(_FIRST_NAMES)} {random.choice(_LAST_NAMES)}"

    # Create 50 employees
    employees = []
    for i in range(1, 51):
        dept = random.choice(departments)
        desig = random.choice(designations.get(dept, ["Associate"]))
        name = _unique_name()
        slug = name.lower().replace(" ", ".")

        emp = Employee(
            employee_id=f"EMP{1000+i}",
            name=name,
            email=f"{slug}{i}@centriq.ai",
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
    print("Seeding PMO project data...")

    db.add_all([
        Project(name="Centriq AI", status="In Progress", completion_pct=65.0,
                next_milestone="UAT", next_milestone_date="2026-05-20", owner="Suraj G.",
                achievements="Successfully integrated multi-agent LangGraph; Implemented real-time HR data sync."),
        Project(name="Aurora UI", status="In Progress", completion_pct=72.0,
                next_milestone="Frontend Integration", next_milestone_date="2026-05-19", owner="Suraj G.",
                achievements="Migrated to TanStack Start; Implemented responsive glassmorphic chat interface."),
        Project(name="HR Integration", status="In Progress", completion_pct=45.0,
                next_milestone="API Finalization", next_milestone_date="2026-05-22", owner="Shivam K.",
                achievements="Secured payroll API endpoints; Completed employee document extraction pipeline."),
        Project(name="Admin Dashboard", status="In Progress", completion_pct=55.0,
                next_milestone="Grafana Setup", next_milestone_date="2026-05-21", owner="Priyanka M.",
                achievements="Configured real-time system monitoring; Visualized agent routing latency."),
        Project(name="IT Support Agent", status="Planning", completion_pct=20.0,
                next_milestone="DB Schema", next_milestone_date="2026-05-18", owner="Kajal S.",
                achievements="Finalized IT ticketing workflow; Defined asset management integration."),
        Project(name="LangGraph Routing Engine", status="In Progress", completion_pct=60.0,
                next_milestone="Intent Classifier v1", next_milestone_date="2026-05-19", owner="Shivani R.",
                achievements="Achieved 95% classification accuracy on test sets; Optimized routing path latency."),
        Project(name="Vector Search Pipeline", status="In Progress", completion_pct=50.0,
                next_milestone="Embedding Indexing", next_milestone_date="2026-05-20", owner="Shivani R.",
                achievements="Successfully indexed 500+ HR policy documents; Integrated Nomic-embed-text."),
        Project(name="Document Generation Service", status="In Progress", completion_pct=70.0,
                next_milestone="PDF Template Polish", next_milestone_date="2026-05-18", owner="Suraj G.",
                achievements="Implemented dynamic PDF generation from DB state; Standardized project status report templates."),
        Project(name="Redis Cache Layer", status="In Progress", completion_pct=40.0,
                next_milestone="Session Store Integration", next_milestone_date="2026-05-22", owner="Suraj G.",
                achievements="Reduced session load time by 40%; Implemented RedisJSON for complex state storage."),
        Project(name="Feedback Analytics", status="Planning", completion_pct=15.0,
                next_milestone="Schema Design", next_milestone_date="2026-05-23", owner="Suraj G.",
                achievements="Designed feedback collection loop; Integrated sentiment analysis placeholder."),
        Project(name="Power Automate Integration", status="In Progress", completion_pct=35.0,
                next_milestone="Approval Flow Trigger", next_milestone_date="2026-05-24", owner="Shivam K.",
                achievements="Mapped SharePoint triggers to backend webhooks; Optimized approval notification latency."),
        Project(name="Grafana Monitoring", status="Planning", completion_pct=25.0,
                next_milestone="Loki Log Ingestion", next_milestone_date="2026-05-21", owner="Priyanka M.",
                achievements="Successfully deployed Loki instance; Configured centralized logging for backend services."),
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
    # Prompts are configured by domain managers via the Config page — no defaults seeded.
    pass
