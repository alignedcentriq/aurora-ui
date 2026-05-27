"""
Mock Zoho People API Server
----------------------------
A lightweight FastAPI app that mimics Zoho People API endpoints.
Reads from the same PostgreSQL database as the main Centriq app,
so it returns real data matching the internal leave system.

Swagger UI: http://localhost:8090/docs
ReDoc:       http://localhost:8090/redoc

Usage:
    cd backend
    uvicorn mock_zoho_server:app --port 8090

Then set in .env:
    ZOHO_BASE_URL=http://localhost:8090
    ZOHO_ACCOUNTS_URL=http://localhost:8090
    ZOHO_REFRESH_TOKEN=mock-refresh-token
"""

import datetime
from fastapi import FastAPI, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Any

app = FastAPI(
    title="Mock Zoho People API",
    version="1.0",
    description=(
        "Mimics the Zoho People API for local development. "
        "Reads from the internal PostgreSQL database.\n\n"
        "**OAuth token**: Any value works — the mock always returns `mock-zoho-access-token`."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)


# ── Response Models ──────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    api_domain: str

    model_config = {
        "json_schema_extra": {
            "example": {
                "access_token": "mock-zoho-access-token",
                "token_type": "Bearer",
                "expires_in": 3600,
                "api_domain": "http://localhost:8090",
            }
        }
    }


class HealthResponse(BaseModel):
    status: str
    service: str
    port: int


# ── OAuth2 Token Endpoint ────────────────────────────────────────────────────

@app.post(
    "/oauth/v2/token",
    response_model=TokenResponse,
    summary="Get OAuth2 access token",
    tags=["Auth"],
)
async def mock_token(
    grant_type: str = Form(default="refresh_token", description="OAuth2 grant type"),
    client_id: str = Form(default="mock-client-id"),
    client_secret: str = Form(default="mock-client-secret"),
    refresh_token: str = Form(default="mock-refresh-token"),
    code: str = Form(default="", description="Used for authorization_code grant"),
    redirect_uri: str = Form(default=""),
):
    """Always returns a valid mock token regardless of credentials."""
    return TokenResponse(
        access_token="mock-zoho-access-token",
        token_type="Bearer",
        expires_in=3600,
        api_domain="http://localhost:8090",
    )


# ── Leave Balance Report ─────────────────────────────────────────────────────

@app.get(
    "/people/api/v2/leavetracker/reports/bookedAndBalance",
    summary="Leave booked & balance report",
    tags=["Leave Tracker"],
    response_description="Leave balances for all employees grouped by leave type",
)
async def mock_leave_balance():
    """
    Returns leave balances from the internal `LeaveBalance` table.

    **Response shape** (mimics real Zoho):
    ```json
    {
      "leavetypes": { "<ltId>": { "name": "Casual Leave", "unit": "Day" } },
      "report": {
        "<empId>": {
          "<ltId>": { "booked": 3, "balance": 9 },
          "total": { "booked": 5, "balance": 15 }
        }
      },
      "employees": ["<empId>"]
    }
    ```
    """
    from app.database import SessionLocal
    from app.models import LeaveBalance, LeaveType, Employee

    year = datetime.date.today().year
    db = SessionLocal()
    try:
        leave_types = db.query(LeaveType).filter(LeaveType.is_active == True).all()
        leavetypes_map: dict[str, Any] = {}
        for lt in leave_types:
            leavetypes_map[str(lt.id)] = {"name": lt.name, "unit": "Day"}

        employees = db.query(Employee).all()
        report: dict[str, Any] = {}
        emp_ids: list[str] = []

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
            emp_data: dict[str, Any] = {}
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

@app.get(
    "/people/api/leave/v2/leaveTypes",
    summary="List active leave types",
    tags=["Leave Tracker"],
    response_description="All active leave types defined in the system",
)
async def mock_leave_types():
    """
    Returns active leave types from the internal `LeaveType` table.

    **Response shape**:
    ```json
    {
      "response": {
        "result": [
          { "leaveTypeId": "1", "leaveType": "Casual Leave", "unit": "Day" }
        ]
      }
    }
    ```
    """
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

@app.get("/", response_model=HealthResponse, summary="Health check", tags=["System"])
async def health():
    """Returns server status."""
    return HealthResponse(status="ok", service="Mock Zoho People API", port=8090)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8090)
