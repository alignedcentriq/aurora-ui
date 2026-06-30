"""
Automation Hub routes — CRUD for recurring email automations.

Access model:
  - Creator + Super Admin: full CRUD, co-owner management, send-now
  - Non-employee staff with email_automation scope: create their own rules
  - Co-owners (any role, including employees): GET /rules only (read-only view)
"""

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user, require_non_employee
from app.services import automation_service

router = APIRouter(prefix="/api/automation", tags=["Automation Hub"])


# ── Request models ─────────────────────────────────────────────────────────────

class RuleBody(BaseModel):
    name: str
    description: Optional[str] = ""
    frequency: str                              # daily | weekly | monthly | custom
    day_of_week: Optional[int] = None           # 0=Mon..6=Sun  (weekly / custom)
    day_of_month: Optional[int] = None          # 1..28          (monthly / custom)
    hour: Optional[int] = 9                     # 0..23
    minute: Optional[int] = 0                   # 0..59
    automation_kind: Optional[str] = "custom_email"  # catalog item id
    extra_config: Optional[dict] = None         # type-specific params from catalog
    email_subject: Optional[str] = ""           # required only for custom_email kind
    email_body: Optional[str] = ""              # required only for custom_email kind
    recipients_json: Optional[List[Any]] = []   # [{type, email?, name?, id?, emails?}]


class CoOwnerBody(BaseModel):
    action: str        # "add" | "remove"
    email: str


# ── Rules CRUD ─────────────────────────────────────────────────────────────────

@router.get("/rules")
def list_rules(user: CurrentUser = Depends(get_current_user)):
    """Any authenticated user may call this — co-owners (including employees) see
    shared rules; non-employees see their own; Super Admins see all."""
    return automation_service.list_rules(user.email, user.role)


@router.post("/rules")
def create_rule(body: RuleBody, user: CurrentUser = Depends(require_non_employee)):
    result = automation_service.create(user.email, user.role, body.model_dump())
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "create_failed"))
    return result["rule"]


@router.patch("/rules/{rule_id}")
def update_rule(
    rule_id: int,
    body: dict,
    user: CurrentUser = Depends(require_non_employee),
):
    result = automation_service.update(user.email, user.role, rule_id, body)
    if not result.get("success"):
        error = result.get("error", "error")
        status = 404 if error == "not_found" else 403 if error == "forbidden" else 400
        raise HTTPException(status_code=status, detail=error)
    return result["rule"]


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, user: CurrentUser = Depends(require_non_employee)):
    result = automation_service.delete(user.email, user.role, rule_id)
    if not result.get("success"):
        error = result.get("error", "error")
        raise HTTPException(status_code=404 if error == "not_found" else 403, detail=error)
    return {"success": True}


# ── Co-owner management ────────────────────────────────────────────────────────

@router.patch("/rules/{rule_id}/co-owners")
def manage_co_owners(
    rule_id: int,
    body: CoOwnerBody,
    user: CurrentUser = Depends(require_non_employee),
):
    """Add or remove a co-owner. Only the rule's creator or a Super Admin may call this."""
    result = automation_service.update_co_owners(
        user.email, user.role, rule_id, body.action, body.email
    )
    if not result.get("success"):
        error = result.get("error", "error")
        status = 404 if error == "not_found" else 403 if error == "forbidden" else 400
        raise HTTPException(status_code=status, detail=error)
    return result["rule"]


# ── Immediate send (test / on-demand) ─────────────────────────────────────────

@router.post("/rules/{rule_id}/send-now")
def send_now(rule_id: int, user: CurrentUser = Depends(require_non_employee)):
    """Send the automation email immediately — only creator or Super Admin."""
    result = automation_service.send_now(rule_id, user.email, user.role)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "send_failed"))
    return result


# ── MS365 group lookup (recipient picker) ─────────────────────────────────────

@router.get("/ms365/users/search")
def search_ms365_users(
    q: str = "",
    user: CurrentUser = Depends(get_current_user),
):
    """Search employees/MS365 users by name or email for the recipient picker."""
    from app.database import SessionLocal
    from app.models import Employee
    from sqlalchemy import or_, func
    q = (q or "").strip()
    if len(q) < 2:
        return []
    db = SessionLocal()
    try:
        rows = (
            db.query(Employee.name, Employee.email)
            .filter(
                Employee.email.isnot(None),
                or_(
                    Employee.name.ilike(f"%{q}%"),
                    Employee.email.ilike(f"%{q}%"),
                ),
            )
            .order_by(Employee.name)
            .limit(15)
            .all()
        )
        return [{"name": r.name or r.email, "email": r.email} for r in rows if r.email]
    finally:
        db.close()


@router.get("/ms365/groups")
async def list_ms365_groups(user: CurrentUser = Depends(require_non_employee)):
    """Return the user's joined Microsoft Teams for the recipient picker."""
    try:
        from app.services.oauth_service import get_valid_token
        from app.services.ms365_service import fetch_joined_teams
        token = await get_valid_token(user.email.lower().strip(), "microsoft")
        if not token:
            return {"groups": [], "error": "Microsoft account not connected"}
        result = await fetch_joined_teams(token)
        return {"groups": result.get("teams", [])}
    except Exception as exc:
        return {"groups": [], "error": str(exc)}


@router.get("/ms365/groups/{team_id}/members")
async def list_team_members(team_id: str, user: CurrentUser = Depends(require_non_employee)):
    """Return member emails for a Teams group — called when the user selects a group."""
    try:
        from app.services.oauth_service import get_valid_token
        from app.services.ms365_service import fetch_team_members
        token = await get_valid_token(user.email.lower().strip(), "microsoft")
        if not token:
            raise HTTPException(status_code=401, detail="Microsoft account not connected")
        result = await fetch_team_members(token, team_id)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ── AI-assisted automation composer ───────────────────────────────────────────

class AiComposeBody(BaseModel):
    description: str
    portal_id: Optional[str] = None


@router.post("/ai-compose")
def ai_compose_automation(body: AiComposeBody, user: CurrentUser = Depends(require_non_employee)):
    """Given a natural-language description, return a pre-filled automation config."""
    from app.services.automation_ai import compose_automation
    result = compose_automation(body.description, body.portal_id)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "compose_failed"))
    return result
