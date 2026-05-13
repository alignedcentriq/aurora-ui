
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

def init_db():
    # Ensure schema exists
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
            conn.commit()
        
    Base.metadata.create_all(bind=engine)
    
    # Simple migration: ensure achievements column exists in projects table
    if _base_engine.dialect.name != "sqlite":
        with engine.connect() as conn:
            try:
                conn.execute(text(f'ALTER TABLE "{SCHEMA}".projects ADD COLUMN IF NOT EXISTS achievements TEXT'))
                conn.commit()
            except Exception as e:
                print(f"Migration notice (achievements column): {e}")

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
