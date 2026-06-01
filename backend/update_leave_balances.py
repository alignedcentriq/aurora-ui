"""
Run this script to update leave types and fix employee leave balances.

Usage:
    cd backend
    python update_leave_balances.py

Edit the LEAVE_TYPES and EMPLOYEE_OVERRIDES sections below to match your
company's actual entitlements before running.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models import LeaveType, LeaveBalance, Employee
import datetime

# ── 1. CONFIGURE YOUR ACTUAL LEAVE TYPES HERE ────────────────────────────────
# Edit these to match your company's actual leave policy.
# Set annual_entitlement=None for unlimited (e.g. LWP).

LEAVE_TYPES = [
    {"name": "Casual Leave",      "code": "CL",  "annual_entitlement": 12,   "carry_forward": False},
    {"name": "Privileged Leave",  "code": "PL",  "annual_entitlement": 15,   "carry_forward": True},
    {"name": "Sick Leave",        "code": "SL",  "annual_entitlement": 7,    "carry_forward": False},
    {"name": "Leave Without Pay", "code": "LWP", "annual_entitlement": None, "carry_forward": False},
    {"name": "Compensatory Off",  "code": "CO",  "annual_entitlement": None, "is_earned": True, "carry_forward": False},
]

# ── 2. OPTIONAL: OVERRIDE SPECIFIC EMPLOYEES ─────────────────────────────────
# If a specific employee has different entitlements, add them here.
# Leave empty {} if everyone gets the same entitlements as above.
# Format: { "email": { "leave_type_code": entitled_days } }

EMPLOYEE_OVERRIDES = {
    # "shivani.patel@alignedautomation.com": {
    #     "CL": 15,
    #     "PL": 18,
    # },
}

# ─────────────────────────────────────────────────────────────────────────────

def run():
    db = SessionLocal()
    year = datetime.date.today().year

    try:
        print(f"\nUpdating leave types for year {year}...\n")

        # Update or create leave types
        for lt_data in LEAVE_TYPES:
            lt = db.query(LeaveType).filter(LeaveType.code == lt_data["code"]).first()
            if lt:
                lt.name = lt_data["name"]
                lt.annual_entitlement = lt_data["annual_entitlement"]
                lt.carry_forward = lt_data.get("carry_forward", False)
                lt.is_earned = lt_data.get("is_earned", False)
                lt.is_active = True
                print(f"  Updated: {lt.name} ({lt.code}) → {lt.annual_entitlement} days")
            else:
                lt = LeaveType(
                    name=lt_data["name"],
                    code=lt_data["code"],
                    annual_entitlement=lt_data["annual_entitlement"],
                    carry_forward=lt_data.get("carry_forward", False),
                    is_earned=lt_data.get("is_earned", False),
                    is_active=True,
                )
                db.add(lt)
                print(f"  Created: {lt.name} ({lt.code}) → {lt.annual_entitlement} days")

        db.commit()

        # Refresh all active leave types
        leave_types = db.query(LeaveType).filter(LeaveType.is_active == True).all()
        lt_by_code = {lt.code: lt for lt in leave_types}

        # Update leave balances for all employees
        employees = db.query(Employee).all()
        print(f"\nUpdating balances for {len(employees)} employee(s)...\n")

        for emp in employees:
            overrides = EMPLOYEE_OVERRIDES.get(emp.email, {})

            for lt in leave_types:
                if lt.annual_entitlement is None and not lt.is_earned:
                    continue  # Skip unlimited types (LWP)

                entitled = overrides.get(lt.code, lt.annual_entitlement) or 0

                lb = db.query(LeaveBalance).filter(
                    LeaveBalance.employee_id == emp.id,
                    LeaveBalance.leave_type_id == lt.id,
                    LeaveBalance.year == year,
                ).first()

                if lb:
                    # Preserve used days, recalculate balance
                    lb.entitled = entitled
                    lb.balance = max(0, entitled - lb.used)
                    print(f"  {emp.email} | {lt.name}: entitled={entitled}, used={lb.used}, balance={lb.balance}")
                else:
                    lb = LeaveBalance(
                        employee_id=emp.id,
                        leave_type_id=lt.id,
                        year=year,
                        entitled=entitled,
                        used=0,
                        balance=entitled,
                        earned=0,
                    )
                    db.add(lb)
                    print(f"  {emp.email} | {lt.name}: created with {entitled} days")

        db.commit()
        print("\nDone. Leave balances updated successfully.")

    except Exception as e:
        db.rollback()
        print(f"\nError: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run()
