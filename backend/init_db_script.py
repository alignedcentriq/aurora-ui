"""
Post-schema initialization: seeds required lookup data (leave types, etc.)
Called by run-backend.js after create_db.py.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models import LeaveType

DEFAULT_LEAVE_TYPES = [
    {"name": "Annual Leave",     "code": "AL",  "annual_entitlement": 18.0, "carry_forward": True},
    {"name": "Sick Leave",       "code": "SL",  "annual_entitlement": 12.0, "carry_forward": False},
    {"name": "Casual Leave",     "code": "CL",  "annual_entitlement": 6.0,  "carry_forward": False},
    {"name": "Maternity Leave",  "code": "ML",  "annual_entitlement": None, "carry_forward": False},
    {"name": "Paternity Leave",  "code": "PL",  "annual_entitlement": None, "carry_forward": False},
    {"name": "Compensatory Off", "code": "CO",  "annual_entitlement": None, "carry_forward": False, "is_earned": True},
    {"name": "Loss of Pay",      "code": "LWP", "annual_entitlement": None, "carry_forward": False},
]

if __name__ == "__main__":
    db = SessionLocal()
    try:
        existing_names = {lt.name for lt in db.query(LeaveType).all()}
        existing_codes = {lt.code for lt in db.query(LeaveType).all()}
        added = 0
        for lt in DEFAULT_LEAVE_TYPES:
            if lt["name"] not in existing_names and lt["code"] not in existing_codes:
                db.add(LeaveType(
                    name=lt["name"],
                    code=lt["code"],
                    annual_entitlement=lt.get("annual_entitlement"),
                    carry_forward=lt.get("carry_forward", False),
                    is_earned=lt.get("is_earned", False),
                    is_active=True,
                ))
                added += 1
        if added:
            db.commit()
            print(f"Seeded {added} leave type(s).")
        else:
            print("Leave types already present — no seeding needed.")
    except Exception as e:
        print(f"Init script warning (non-fatal): {e}")
    finally:
        db.close()
