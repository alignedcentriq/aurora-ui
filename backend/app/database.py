
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.models import Base, Employee, Leave, Payroll, Attendance, Policy, SCHEMA
from app.config import settings
import datetime

import random

# Database engine initialization
DATABASE_URL = settings.DATABASE_URL


engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    # Ensure schema exists
    with engine.connect() as conn:
        conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        conn.commit()
        
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    # Check if we already have employees
    if db.query(Employee).count() > 0:
        db.close()
        return

    print("🌱 Seeding dummy HR data...")
    
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
    db.close()
    print("✅ Seeding complete.")
