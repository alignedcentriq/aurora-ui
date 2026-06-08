"""
Seed script: add dummy project allocations (Eli Lilly, Dell, Worley)
and certifications to EmployeeZohoProfile.tags for the people directory.

Run from backend/:
  venv/Scripts/python.exe -m app.scripts.seed_dummy_allocations
"""

import datetime
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.database import SessionLocal
from app.models import Employee, EmployeeZohoProfile, EmployeeAllocation


# ── Allocations to seed ───────────────────────────────────────────────────────

ALLOCATIONS = [
    # Eli Lilly
    {
        "zoho_record_id": "DUMMY-EL-001",
        "employee_id": "AA-101",
        "employee_name": "Arjun Mehta",
        "project_name": "Eli Lilly – Pharmacovigilance AI",
        "sub_project": "Signal Detection Module",
        "project_lead": "Rohan Kapoor",
        "delivery_manager": "Priya Nair",
        "completion_status": "Active",
        "efforts_percent": 80.0,
        "billability_percent": 100.0,
        "allocation_date": datetime.date(2025, 9, 1),
        "project_status": "In Progress",
        "client_master": "Eli Lilly",
        "billing": "T&M",
        "project_type": "Client Project",
        "reporting_manager": "Rohan Kapoor",
        "functional_manager": "Priya Nair",
        "function": "Data & AI",
        "status": "Active",
        "expected_end_date": datetime.date(2026, 9, 30),
    },
    {
        "zoho_record_id": "DUMMY-EL-002",
        "employee_id": "AA-102",
        "employee_name": "Sneha Joshi",
        "project_name": "Eli Lilly – Pharmacovigilance AI",
        "sub_project": "Dashboard & Reporting",
        "project_lead": "Rohan Kapoor",
        "delivery_manager": "Priya Nair",
        "completion_status": "Active",
        "efforts_percent": 100.0,
        "billability_percent": 100.0,
        "allocation_date": datetime.date(2025, 10, 1),
        "project_status": "In Progress",
        "client_master": "Eli Lilly",
        "billing": "T&M",
        "project_type": "Client Project",
        "reporting_manager": "Rohan Kapoor",
        "functional_manager": "Priya Nair",
        "function": "Engineering",
        "status": "Active",
        "expected_end_date": datetime.date(2026, 9, 30),
    },
    {
        "zoho_record_id": "DUMMY-EL-003",
        "employee_id": "AA-103",
        "employee_name": "Vikram Sharma",
        "project_name": "Eli Lilly – Clinical Data Ops",
        "sub_project": "ETL Pipeline",
        "project_lead": "Sneha Joshi",
        "delivery_manager": "Priya Nair",
        "completion_status": "Active",
        "efforts_percent": 60.0,
        "billability_percent": 60.0,
        "allocation_date": datetime.date(2026, 1, 15),
        "project_status": "In Progress",
        "client_master": "Eli Lilly",
        "billing": "Fixed Price",
        "project_type": "Client Project",
        "reporting_manager": "Sneha Joshi",
        "functional_manager": "Priya Nair",
        "function": "Data Engineering",
        "status": "Active",
        "expected_end_date": datetime.date(2026, 12, 31),
    },
    # Dell
    {
        "zoho_record_id": "DUMMY-DL-001",
        "employee_id": "AA-201",
        "employee_name": "Riya Patel",
        "project_name": "Dell – Supply Chain Optimisation",
        "sub_project": "Demand Forecasting",
        "project_lead": "Amit Desai",
        "delivery_manager": "Sanjay Verma",
        "completion_status": "Active",
        "efforts_percent": 100.0,
        "billability_percent": 100.0,
        "allocation_date": datetime.date(2025, 7, 1),
        "project_status": "In Progress",
        "client_master": "Dell",
        "billing": "T&M",
        "project_type": "Client Project",
        "reporting_manager": "Amit Desai",
        "functional_manager": "Sanjay Verma",
        "function": "Data & AI",
        "status": "Active",
        "expected_end_date": datetime.date(2026, 6, 30),
    },
    {
        "zoho_record_id": "DUMMY-DL-002",
        "employee_id": "AA-202",
        "employee_name": "Karan Singh",
        "project_name": "Dell – Supply Chain Optimisation",
        "sub_project": "Inventory Analytics",
        "project_lead": "Amit Desai",
        "delivery_manager": "Sanjay Verma",
        "completion_status": "Active",
        "efforts_percent": 80.0,
        "billability_percent": 80.0,
        "allocation_date": datetime.date(2025, 8, 1),
        "project_status": "In Progress",
        "client_master": "Dell",
        "billing": "T&M",
        "project_type": "Client Project",
        "reporting_manager": "Amit Desai",
        "functional_manager": "Sanjay Verma",
        "function": "Engineering",
        "status": "Active",
        "expected_end_date": datetime.date(2026, 6, 30),
    },
    {
        "zoho_record_id": "DUMMY-DL-003",
        "employee_id": "AA-203",
        "employee_name": "Neha Kulkarni",
        "project_name": "Dell – Workplace AI Assistant",
        "sub_project": "LLM Integration",
        "project_lead": "Karan Singh",
        "delivery_manager": "Sanjay Verma",
        "completion_status": "Active",
        "efforts_percent": 100.0,
        "billability_percent": 100.0,
        "allocation_date": datetime.date(2025, 11, 1),
        "project_status": "In Progress",
        "client_master": "Dell",
        "billing": "Fixed Price",
        "project_type": "Client Project",
        "reporting_manager": "Karan Singh",
        "functional_manager": "Sanjay Verma",
        "function": "AI/ML",
        "status": "Active",
        "expected_end_date": datetime.date(2026, 8, 31),
    },
    # Worley
    {
        "zoho_record_id": "DUMMY-WL-001",
        "employee_id": "AA-301",
        "employee_name": "Ananya Reddy",
        "project_name": "Worley – Asset Integrity Platform",
        "sub_project": "Inspection Analytics",
        "project_lead": "Deepak Gupta",
        "delivery_manager": "Meera Iyer",
        "completion_status": "Active",
        "efforts_percent": 100.0,
        "billability_percent": 100.0,
        "allocation_date": datetime.date(2025, 6, 1),
        "project_status": "In Progress",
        "client_master": "Worley",
        "billing": "T&M",
        "project_type": "Client Project",
        "reporting_manager": "Deepak Gupta",
        "functional_manager": "Meera Iyer",
        "function": "Engineering",
        "status": "Active",
        "expected_end_date": datetime.date(2026, 5, 31),
    },
    {
        "zoho_record_id": "DUMMY-WL-002",
        "employee_id": "AA-302",
        "employee_name": "Rahul Bose",
        "project_name": "Worley – Asset Integrity Platform",
        "sub_project": "Mobile Inspection App",
        "project_lead": "Deepak Gupta",
        "delivery_manager": "Meera Iyer",
        "completion_status": "Active",
        "efforts_percent": 80.0,
        "billability_percent": 80.0,
        "allocation_date": datetime.date(2025, 6, 15),
        "project_status": "In Progress",
        "client_master": "Worley",
        "billing": "T&M",
        "project_type": "Client Project",
        "reporting_manager": "Deepak Gupta",
        "functional_manager": "Meera Iyer",
        "function": "Engineering",
        "status": "Active",
        "expected_end_date": datetime.date(2026, 5, 31),
    },
    {
        "zoho_record_id": "DUMMY-WL-003",
        "employee_id": "AA-303",
        "employee_name": "Pooja Menon",
        "project_name": "Worley – Digital Twin Initiative",
        "sub_project": "3D Model Integration",
        "project_lead": "Rahul Bose",
        "delivery_manager": "Meera Iyer",
        "completion_status": "Active",
        "efforts_percent": 100.0,
        "billability_percent": 100.0,
        "allocation_date": datetime.date(2026, 1, 1),
        "project_status": "In Progress",
        "client_master": "Worley",
        "billing": "Fixed Price",
        "project_type": "Client Project",
        "reporting_manager": "Rahul Bose",
        "functional_manager": "Meera Iyer",
        "function": "Engineering",
        "status": "Active",
        "expected_end_date": datetime.date(2026, 12, 31),
    },
    {
        "zoho_record_id": "DUMMY-WL-004",
        "employee_id": "AA-304",
        "employee_name": "Suresh Pillai",
        "project_name": "Worley – Digital Twin Initiative",
        "sub_project": "Sensor Data Pipeline",
        "project_lead": "Rahul Bose",
        "delivery_manager": "Meera Iyer",
        "completion_status": "Completed",
        "efforts_percent": 100.0,
        "billability_percent": 100.0,
        "allocation_date": datetime.date(2025, 4, 1),
        "project_status": "Completed",
        "client_master": "Worley",
        "billing": "T&M",
        "project_type": "Client Project",
        "reporting_manager": "Rahul Bose",
        "functional_manager": "Meera Iyer",
        "function": "Data Engineering",
        "status": "Inactive",
        "expected_end_date": datetime.date(2025, 12, 31),
    },
]


# ── Certifications to seed into EmployeeZohoProfile.tags ─────────────────────
# These attach to employees found by name match; if no match exists a stub
# Employee + ZohoProfile row is created so the directory isn't empty.

CERT_PROFILES = [
    {
        "name": "Arjun Mehta",
        "email": "arjun.mehta@alignedautomation.com",
        "designation": "Senior Data Scientist",
        "function": "Data & AI",
        "skill_set": "Python, Machine Learning, TensorFlow, SQL",
        "expertise": "NLP, Time-Series Forecasting, MLOps",
        "total_experience": "6",
        "reporting_manager": "Priya Nair",
        "certifications": "AWS Certified Machine Learning – Specialty, Google Professional Data Engineer",
    },
    {
        "name": "Sneha Joshi",
        "email": "sneha.joshi@alignedautomation.com",
        "designation": "Data Engineer",
        "function": "Engineering",
        "skill_set": "Python, Spark, dbt, Airflow",
        "expertise": "Data Pipelines, Cloud Data Warehousing",
        "total_experience": "4",
        "reporting_manager": "Priya Nair",
        "certifications": "Databricks Certified Associate Developer, Azure Data Engineer Associate (DP-203)",
    },
    {
        "name": "Vikram Sharma",
        "email": "vikram.sharma@alignedautomation.com",
        "designation": "Data Engineer",
        "function": "Data Engineering",
        "skill_set": "Python, SQL, Kafka, Spark",
        "expertise": "ETL Design, Real-time Streaming",
        "total_experience": "3",
        "reporting_manager": "Sneha Joshi",
        "certifications": "AWS Certified Data Analytics – Specialty",
    },
    {
        "name": "Riya Patel",
        "email": "riya.patel@alignedautomation.com",
        "designation": "AI/ML Engineer",
        "function": "Data & AI",
        "skill_set": "Python, PyTorch, Scikit-learn, SQL",
        "expertise": "Demand Forecasting, Computer Vision",
        "total_experience": "5",
        "reporting_manager": "Sanjay Verma",
        "certifications": "Google Professional Machine Learning Engineer, TensorFlow Developer Certificate",
    },
    {
        "name": "Karan Singh",
        "email": "karan.singh@alignedautomation.com",
        "designation": "Full Stack Engineer",
        "function": "Engineering",
        "skill_set": "React, Node.js, Python, PostgreSQL",
        "expertise": "REST API Design, Cloud-native Applications",
        "total_experience": "5",
        "reporting_manager": "Sanjay Verma",
        "certifications": "AWS Certified Developer – Associate, Certified Kubernetes Application Developer (CKAD)",
    },
    {
        "name": "Neha Kulkarni",
        "email": "neha.kulkarni@alignedautomation.com",
        "designation": "AI Engineer",
        "function": "AI/ML",
        "skill_set": "Python, LangChain, OpenAI API, RAG",
        "expertise": "LLM Applications, Prompt Engineering, Vector Databases",
        "total_experience": "4",
        "reporting_manager": "Karan Singh",
        "certifications": "Microsoft Certified: Azure AI Engineer Associate (AI-102), DeepLearning.AI LLMOps Certificate",
    },
    {
        "name": "Ananya Reddy",
        "email": "ananya.reddy@alignedautomation.com",
        "designation": "Solutions Architect",
        "function": "Engineering",
        "skill_set": "Python, Azure, Power BI, SQL",
        "expertise": "Asset Management Systems, Industrial IoT",
        "total_experience": "8",
        "reporting_manager": "Meera Iyer",
        "certifications": "AWS Solutions Architect – Professional, PMP (Project Management Professional)",
    },
    {
        "name": "Rahul Bose",
        "email": "rahul.bose@alignedautomation.com",
        "designation": "Mobile & Backend Engineer",
        "function": "Engineering",
        "skill_set": "Flutter, Dart, Python, REST APIs",
        "expertise": "Cross-platform Mobile Apps, Offline-first Architecture",
        "total_experience": "6",
        "reporting_manager": "Meera Iyer",
        "certifications": "Google Associate Android Developer, AWS Certified Developer – Associate",
    },
    {
        "name": "Pooja Menon",
        "email": "pooja.menon@alignedautomation.com",
        "designation": "3D Visualisation Engineer",
        "function": "Engineering",
        "skill_set": "Unity, Three.js, Python, BIM",
        "expertise": "Digital Twins, AR/VR, 3D Modelling",
        "total_experience": "5",
        "reporting_manager": "Rahul Bose",
        "certifications": "Autodesk Certified Professional: Revit for Structural Design",
    },
    {
        "name": "Suresh Pillai",
        "email": "suresh.pillai@alignedautomation.com",
        "designation": "Data Engineer",
        "function": "Data Engineering",
        "skill_set": "Python, Kafka, TimescaleDB, Grafana",
        "expertise": "Sensor Data Ingestion, Time-series Analytics",
        "total_experience": "7",
        "reporting_manager": "Rahul Bose",
        "certifications": "AWS Certified Data Analytics – Specialty, Confluent Certified Developer for Apache Kafka",
    },
]


def _get_or_create_employee(db, name: str, email: str, designation: str, function: str) -> Employee:
    emp = db.query(Employee).filter(Employee.email == email.lower()).first()
    if not emp:
        parts = name.split(" ", 1)
        emp_id = "AA-DUMMY-" + email.split("@")[0]
        emp = Employee(
            employee_id=emp_id,
            name=name,
            email=email.lower(),
            department=function,
            designation=designation,
        )
        db.add(emp)
        db.flush()
    return emp


def seed(dry_run: bool = False):
    db = SessionLocal()
    try:
        added_alloc = 0
        skipped_alloc = 0

        # ── Allocations ───────────────────────────────────────────────────────
        for a in ALLOCATIONS:
            existing = db.query(EmployeeAllocation).filter(
                EmployeeAllocation.zoho_record_id == a["zoho_record_id"]
            ).first()
            if existing:
                skipped_alloc += 1
                continue

            row = EmployeeAllocation(**a)
            db.add(row)
            added_alloc += 1

        # ── Certifications (ZohoProfile tags) ────────────────────────────────
        added_cert = 0
        for spec in CERT_PROFILES:
            emp = _get_or_create_employee(
                db, spec["name"], spec["email"], spec["designation"], spec["function"]
            )

            profile = db.query(EmployeeZohoProfile).filter(
                EmployeeZohoProfile.employee_id == emp.id
            ).first()

            parts = spec["name"].split(" ", 1)
            first = parts[0]
            last = parts[1] if len(parts) > 1 else ""

            if not profile:
                profile = EmployeeZohoProfile(
                    employee_id=emp.id,
                    zoho_link_id=emp.employee_id,
                    first_name=first,
                    last_name=last,
                    official_email=spec["email"].lower(),
                    designation=spec["designation"],
                    function=spec["function"],
                    skill_set=spec["skill_set"],
                    expertise=spec["expertise"],
                    total_experience=spec["total_experience"],
                    reporting_manager=spec["reporting_manager"],
                    employee_status="Active",
                    tags=spec["certifications"],
                )
                db.add(profile)
                added_cert += 1
            else:
                # Only set tags if not already populated
                if not profile.tags:
                    profile.tags = spec["certifications"]
                    added_cert += 1
                # Backfill missing fields
                profile.first_name = profile.first_name or first
                profile.last_name = profile.last_name or last
                profile.official_email = profile.official_email or spec["email"].lower()
                profile.designation = profile.designation or spec["designation"]
                profile.function = profile.function or spec["function"]
                profile.skill_set = profile.skill_set or spec["skill_set"]
                profile.expertise = profile.expertise or spec["expertise"]
                profile.total_experience = profile.total_experience or spec["total_experience"]
                profile.reporting_manager = profile.reporting_manager or spec["reporting_manager"]

        if not dry_run:
            db.commit()
        else:
            db.rollback()

    except Exception as e:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    seed(dry_run=dry)
