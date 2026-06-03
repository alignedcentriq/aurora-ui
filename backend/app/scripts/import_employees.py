"""
CSV / Excel Employee Import Script
-----------------------------------
Imports employee data from a Zoho People export into:
  - employees table
  - employee_zoho_profiles table
  - leave_balances table (initialised for current year)

Usage:
    python -m app.scripts.import_employees path/to/employees.csv
    python -m app.scripts.import_employees path/to/employees.xlsx

Upserts by official email — safe to re-run.
"""

import argparse
import datetime
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy.orm import Session

# Allow running from backend/ directory
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.database import SessionLocal, init_db
from app.models import Employee, EmployeeZohoProfile, LeaveType, LeaveBalance


# ── Column mapping: CSV header → DB field ─────────────────────────────────────

_PROFILE_COL_MAP = {
    "ZOHO_LINK_ID":               "zoho_link_id",
    "First Name":                 "first_name",
    "Last Name":                  "last_name",
    "Official Email address":     "official_email",
    "Photo":                      None,  # skip
    "Function":                   "function",
    "Designation":                "designation",
    "Zoho Role":                  "zoho_role",
    "Employment Type":            "employment_type",
    "Employee Status":            "employee_status",
    "Source of Hire":             "source_of_hire",
    "Date of Joining":           "date_of_joining",
    "Date of Confirmation":      "date_of_confirmation",
    "Tenure in AA":              "tenure_in_aa",
    "Total Experience(System)":  "total_experience",
    "Reporting Manager":         "reporting_manager",
    "Date of Birth":             None,  # skip — sensitive
    "Age":                       "age",
    "Gender":                    "gender",
    "Marital Status":            None,  # skip — sensitive
    "About Me":                  "about_me",
    "Blood Group":               "blood_group",
    "Ask me about/Expertise":    "expertise",
    "Passport Number":           None,  # skip — sensitive
    "Passport Expiry Date":      None,  # skip
    "Bank Account Number":       None,  # skip — sensitive
    "Work Phone Number":         "work_phone",
    "Extension":                 "extension",
    "Sub Location":              "sub_location",
    "Tags":                      "tags",
    "Personal Mobile Number":    None,  # skip — sensitive
    "Personal Email Address":    None,  # skip
    "Date of Exit":              None,  # skip
    "Added By":                  None,
    "Modified By":               None,
    "Added Time":                None,
    "Modified Time":             None,
    "Onboarding Status":         "onboarding_status",
    "Present Address":           None,  # skip — sensitive
    "Permanent Address":         None,  # skip — sensitive
    "Company":                   None,
    "Aadhaar":                   None,  # skip — sensitive
    "PAN":                       None,  # skip — sensitive
    "UAN":                       None,  # skip — sensitive
    "Region":                    None,
    "Skill Set":                 "skill_set",
    "Fixed CTC":                 None,  # skip — sensitive
    "Variable":                  None,  # skip
    "Total CTC":                 None,  # skip — sensitive
    "Functional Manager":        "functional_manager",
    "Grade":                     "grade",
    "Drill Down Source":         None,
    "Upload PAN":                None,
    "Upload Aadhar Card":        None,
    "Bank Name":                 None,  # skip — sensitive
    "Bank Branch Name":          None,
    "IFSE Code":                 None,
    "Bank Passbook":             None,
    "Nationality":               "nationality",
    "Recruiterwise":             None,
    "Accounts":                  None,
    "Project":                   None,
    "Current Active Visa (Country)": None,
    "Technical/Functional":      None,
    "Policy Notice Period (In Days)": None,
    "Confirmation Status":       None,
    "Resignation Request Date":  None,
    "Organization Structure":    "organization_structure",
    "Backend Field":             None,
    "Vendor Name":               None,
    "Monthly Pricing":           None,  # skip — sensitive
    "Contract  End Date":        None,
    "Is He/She  Functional manager": None,
    "Level":                     "level",
    "Date for 360 Feedback form": "date_for_360_feedback",
    "Date of Marriage":          None,  # skip — sensitive
    "Name as per passport":      None,
    "Language Known":            "language_known",
    "Total Experience":          "total_experience",
    "Probation Created":         None,
    "Comments/ Remark":          None,
    "Previous Experience before AA(New)": None,
    "IS Photo Upload":           None,
    "Is Photo Available":        None,
    "Resource Management Function": "resource_management_function",
    "Approved Last Working Date": None,
    "Active Details":            "active_details",
    "Photo Upload":              None,
    "Project Manager":           "project_manager",
    "Project Manager 2":         "project_manager_2",
    "Role":                      "role",
}


def _safe_str(val) -> str | None:
    if pd.isna(val):
        return None
    return str(val).strip() or None


def _safe_int(val) -> int | None:
    if pd.isna(val):
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def _parse_date(val) -> datetime.date | None:
    if pd.isna(val):
        return None
    if isinstance(val, datetime.date):
        return val
    s = str(val).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _find_manager(db: Session, manager_name: str | None) -> int | None:
    """Look up a manager Employee record by name. Returns employee.id or None."""
    if not manager_name:
        return None
    # Try exact match first
    emp = db.query(Employee).filter(Employee.name.ilike(manager_name.strip())).first()
    if emp:
        return emp.id
    # Try first-name match
    first = manager_name.strip().split()[0]
    emp = db.query(Employee).filter(Employee.name.ilike(f"{first}%")).first()
    return emp.id if emp else None


def _init_leave_balances(db: Session, employee_id: int, joining_date: datetime.date | None):
    """Create LeaveBalance records for the current year for all active leave types."""
    year = datetime.date.today().year
    leave_types = db.query(LeaveType).filter(LeaveType.is_active == True).all()

    for lt in leave_types:
        existing = (
            db.query(LeaveBalance)
            .filter(
                LeaveBalance.employee_id == employee_id,
                LeaveBalance.leave_type_id == lt.id,
                LeaveBalance.year == year,
            )
            .first()
        )
        if existing:
            continue

        if lt.is_earned:
            # Comp Off — starts at 0, earned via credits
            entitled = 0
        elif lt.annual_entitlement is None:
            # LWP — unlimited, no entitlement tracked
            entitled = 0
        else:
            # Pro-rate if joined mid-year
            if joining_date and joining_date.year == year:
                months_remaining = 12 - joining_date.month + 1
                entitled = round(lt.annual_entitlement * months_remaining / 12, 1)
            else:
                entitled = lt.annual_entitlement

        db.add(LeaveBalance(
            employee_id=employee_id,
            leave_type_id=lt.id,
            year=year,
            entitled=entitled,
            used=0,
            balance=entitled,
            earned=0,
        ))


def import_from_dataframe(df: pd.DataFrame, db: Session) -> dict:
    """Import employees from a pandas DataFrame. Returns stats dict."""
    stats = {"created": 0, "updated": 0, "skipped": 0, "errors": []}

    for idx, row in df.iterrows():
        email = _safe_str(row.get("Official Email address"))
        if not email:
            stats["skipped"] += 1
            stats["errors"].append(f"Row {idx + 2}: missing Official Email address — skipped")
            continue

        email = email.lower().strip()
        first_name = _safe_str(row.get("First Name")) or ""
        last_name = _safe_str(row.get("Last Name")) or ""
        full_name = f"{first_name} {last_name}".strip() or email.split("@")[0].replace(".", " ").title()

        try:
            # ── Upsert Employee ──
            emp = db.query(Employee).filter(Employee.email == email).first()
            joining = _parse_date(row.get("Date of Joining"))
            emp_id_str = _safe_str(row.get("Employee ID")) or f"EMP{abs(hash(email)) % 9000 + 1000}"

            if emp:
                emp.name = full_name
                emp.department = _safe_str(row.get("Function")) or emp.department
                emp.designation = _safe_str(row.get("Designation")) or emp.designation
                emp.joining_date = joining or emp.joining_date
                emp.employment_type = _safe_str(row.get("Employment Type")) or emp.employment_type
                emp.employee_id = emp_id_str
                is_new = False
            else:
                emp = Employee(
                    employee_id=emp_id_str,
                    name=full_name,
                    email=email,
                    department=_safe_str(row.get("Function")) or "General",
                    designation=_safe_str(row.get("Designation")) or "Employee",
                    joining_date=joining or datetime.date.today(),
                    employment_type=_safe_str(row.get("Employment Type")) or "Full-time",
                    shift_type="Day",
                )
                db.add(emp)
                is_new = True

            db.flush()  # get emp.id

            # ── Upsert EmployeeZohoProfile ──
            profile = db.query(EmployeeZohoProfile).filter(
                EmployeeZohoProfile.employee_id == emp.id
            ).first()

            if not profile:
                profile = EmployeeZohoProfile(employee_id=emp.id)
                db.add(profile)

            for csv_col, db_field in _PROFILE_COL_MAP.items():
                if db_field is None:
                    continue
                val = row.get(csv_col)
                if val is not None and not pd.isna(val):
                    if db_field in ("date_of_joining", "date_of_confirmation", "date_for_360_feedback"):
                        setattr(profile, db_field, _parse_date(val))
                    elif db_field == "age":
                        setattr(profile, db_field, _safe_int(val))
                    else:
                        setattr(profile, db_field, _safe_str(val))

            profile.official_email = email
            profile.updated_at = datetime.datetime.utcnow()

            # ── Init leave balances ──
            _init_leave_balances(db, emp.id, joining)

            if is_new:
                stats["created"] += 1
            else:
                stats["updated"] += 1

        except Exception as e:
            stats["errors"].append(f"Row {idx + 2} ({email}): {e}")
            db.rollback()
            continue

    db.commit()

    # ── Second pass: resolve manager_id references ──
    print("Resolving manager relationships...")
    profiles = db.query(EmployeeZohoProfile).filter(
        EmployeeZohoProfile.reporting_manager.isnot(None)
    ).all()
    for profile in profiles:
        emp = db.query(Employee).filter(Employee.id == profile.employee_id).first()
        if emp and not emp.manager_id:
            mgr_id = _find_manager(db, profile.reporting_manager)
            if mgr_id and mgr_id != emp.id:
                emp.manager_id = mgr_id
    db.commit()

    return stats


def main():
    parser = argparse.ArgumentParser(description="Import employees from CSV/Excel")
    parser.add_argument("file", help="Path to CSV or Excel file")
    args = parser.parse_args()

    filepath = Path(args.file)
    if not filepath.exists():
        print(f"Error: File not found: {filepath}")
        sys.exit(1)

    # Read file
    if filepath.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(filepath)
    elif filepath.suffix.lower() == ".csv":
        df = pd.read_csv(filepath)
    else:
        print(f"Error: Unsupported file format: {filepath.suffix}")
        sys.exit(1)

    print(f"Read {len(df)} rows from {filepath.name}")
    print(f"Columns: {list(df.columns)}")

    # Init DB and import
    init_db()
    db = SessionLocal()
    try:
        stats = import_from_dataframe(df, db)
        print(f"\nImport complete:")
        print(f"  Created: {stats['created']}")
        print(f"  Updated: {stats['updated']}")
        print(f"  Skipped: {stats['skipped']}")
        if stats["errors"]:
            print(f"  Errors ({len(stats['errors'])}):")
            for err in stats["errors"][:20]:
                print(f"    - {err}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
