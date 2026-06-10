"""
IT Skill APIs — clean endpoints consumed by the IT agent as tools
and callable by any external client.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user
from app.database import get_db, SessionLocal
from app.models import ITTicket, AssetAssignment, Employee
from app.services.it_service import ITService
from app.services.policy_service import PolicyService

router = APIRouter(prefix="/api/skills/it", tags=["Skills - IT"])


# ── Request bodies ─────────────────────────────────────────────────────────────

class RaiseTicketRequest(BaseModel):
    category: str        # Software Install | Hardware | Network | Access | Security
    subject: str
    description: str
    priority: str = "Medium"   # Low | Medium | High | Critical


class SoftwareRequestBody(BaseModel):
    software_name: str
    justification: str = ""


class AssetRequestBody(BaseModel):
    asset_name: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_employee_id(db, email: str) -> int | None:
    emp = db.query(Employee).filter(Employee.email == email).first()
    return emp.id if emp else None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/raise-ticket")
def raise_ticket(
    body: RaiseTicketRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create an IT support ticket and notify the helpdesk."""
    result = ITService.create_ticket(
        email=current_user.email,
        category=body.category,
        subject=body.subject,
        description=body.description,
        priority=body.priority,
    )
    return {"status": "success", "message": result}


@router.get("/my-tickets")
def my_tickets(current_user: CurrentUser = Depends(get_current_user)):
    """List all IT tickets raised by the current user."""
    with SessionLocal() as db:
        emp_id = _get_employee_id(db, current_user.email)
        if not emp_id:
            return {"tickets": []}
        rows = (
            db.query(ITTicket)
            .filter(ITTicket.employee_id == emp_id)
            .order_by(ITTicket.created_at.desc())
            .limit(20)
            .all()
        )
        tickets = [
            {
                "ticket_id": t.ticket_id,
                "category": t.category,
                "subject": t.subject,
                "status": t.status,
                "priority": t.priority,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in rows
        ]
    return {"tickets": tickets}


@router.get("/my-assets")
def my_assets(current_user: CurrentUser = Depends(get_current_user)):
    """List hardware assets currently assigned to the current user."""
    with SessionLocal() as db:
        emp_id = _get_employee_id(db, current_user.email)
        if not emp_id:
            return {"assets": []}
        rows = (
            db.query(AssetAssignment)
            .filter(
                AssetAssignment.employee_id == emp_id,
                AssetAssignment.status == "Assigned",
            )
            .all()
        )
        assets = [
            {
                "asset_type": a.asset_type,
                "asset_name": a.asset_name,
                "serial_number": a.serial_number,
                "assigned_date": a.assigned_date.isoformat() if a.assigned_date else None,
            }
            for a in rows
        ]
    return {"assets": assets}


@router.post("/software-request")
def software_request(
    body: SoftwareRequestBody,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Request installation of software. Creates an IT ticket for helpdesk approval."""
    result = ITService.create_ticket(
        email=current_user.email,
        category="Software Install",
        subject=f"Software Request: {body.software_name}",
        description=body.justification or f"Please install {body.software_name}.",
        priority="Medium",
    )
    return {"status": "success", "message": result}


@router.get("/policy-search")
def it_policy_search(
    query: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Search IT policies, guidelines and procedures."""
    results = PolicyService.search_policies(query, limit=3)
    found = bool(results and "No policies found" not in results)
    return {"query": query, "found": found, "results": results}
