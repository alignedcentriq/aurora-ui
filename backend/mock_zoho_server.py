"""
Mock Zoho People API Server
----------------------------
A lightweight FastAPI app that mimics Zoho People API endpoints.
Reads from the same PostgreSQL database as the main Centriq app,
so it returns real data matching the internal leave system.

Usage:
    cd backend
    uvicorn mock_zoho_server:app --port 8090

Then set in .env:
    ZOHO_BASE_URL=http://localhost:8090
    ZOHO_ACCOUNTS_URL=http://localhost:8090
    ZOHO_REFRESH_TOKEN=mock-refresh-token
"""

import datetime
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="Mock Zoho People API", version="1.0")


# ── OAuth2 Token Endpoint ────────────────────────────────────────────────────

@app.post("/oauth/v2/token")
async def mock_token(request: Request):
    """Always returns a valid mock token."""
    return JSONResponse({
        "access_token": "mock-zoho-access-token",
        "token_type": "Bearer",
        "expires_in": 3600,
        "api_domain": "http://localhost:8090",
    })


# ── Leave Balance Report ─────────────────────────────────────────────────────

@app.get("/people/api/v2/leavetracker/reports/bookedAndBalance")
async def mock_leave_balance(request: Request):
    """Returns leave balances from the internal LeaveBalance table.

    Mimics the Zoho response shape:
    {
        "leavetypes": { "<ltId>": {"name": "Casual Leave", "unit": "Day"} },
        "report": { "<empRecNo>": { "<ltId>": {"booked": 3, "balance": 9}, "total": {...} } },
        "employees": ["<empRecNo>"]
    }
    """
    from app.database import SessionLocal
    from app.models import LeaveBalance, LeaveType, Employee

    year = datetime.date.today().year
    db = SessionLocal()
    try:
        # Build leave types map
        leave_types = db.query(LeaveType).filter(LeaveType.is_active == True).all()
        leavetypes_map = {}
        for lt in leave_types:
            leavetypes_map[str(lt.id)] = {"name": lt.name, "unit": "Day"}

        # Get all employees with balances
        employees = db.query(Employee).all()
        report = {}
        emp_ids = []

        for emp in employees:
            balances = (
                db.query(LeaveBalance)
                .filter(LeaveBalance.employee_id == emp.id, LeaveBalance.year == year)
                .all()
            )
            if not balances:
                continue

            emp_key = str(emp.id)
            emp_ids.append(emp_key)
            emp_data = {}
            total_booked = 0
            total_balance = 0

            for lb in balances:
                emp_data[str(lb.leave_type_id)] = {
                    "booked": lb.used,
                    "balance": lb.balance,
                }
                total_booked += lb.used
                total_balance += lb.balance

            emp_data["total"] = {"booked": total_booked, "balance": total_balance}
            report[emp_key] = emp_data

        return JSONResponse({
            "leavetypes": leavetypes_map,
            "report": report,
            "employees": emp_ids,
        })
    finally:
        db.close()


# ── Leave Types ──────────────────────────────────────────────────────────────

@app.get("/people/api/leave/v2/leaveTypes")
async def mock_leave_types(request: Request):
    """Returns leave types from the internal LeaveType table."""
    from app.database import SessionLocal
    from app.models import LeaveType

    db = SessionLocal()
    try:
        leave_types = db.query(LeaveType).filter(LeaveType.is_active == True).all()
        data = [
            {
                "leaveTypeId": str(lt.id),
                "leaveType": lt.name,
                "leavename": lt.name,
                "id": str(lt.id),
                "unit": "Day",
            }
            for lt in leave_types
        ]
        return JSONResponse({"response": {"result": data}})
    finally:
        db.close()


# ── Health Check ─────────────────────────────────────────────────────────────

@app.get("/")
async def health():
    return {"status": "ok", "service": "Mock Zoho People API", "port": 8090}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8090)
