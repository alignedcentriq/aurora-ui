"""
Automation Hub routes — CRUD for recurring email automations.

All endpoints require a non-employee role (HR / Admin / PMO / IT /
Functional Manager / Super Admin).  Super Admins can see and manage all
rules; everyone else sees only their own.
"""

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, require_non_employee
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
    email_subject: str
    email_body: str                             # plain text — wrapped in branded shell at send
    recipients_json: Optional[List[Any]] = []   # [{type, email?, name?, id?, emails?}]


# ── Rules CRUD ─────────────────────────────────────────────────────────────────

@router.get("/rules")
def list_rules(user: CurrentUser = Depends(require_non_employee)):
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


# ── Immediate send (test / on-demand) ─────────────────────────────────────────

@router.post("/rules/{rule_id}/send-now")
def send_now(rule_id: int, user: CurrentUser = Depends(require_non_employee)):
    """Send the automation email immediately — useful for testing a rule."""
    result = automation_service.send_now(rule_id, user.email)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "send_failed"))
    return result


# ── MS365 group lookup (recipient picker) ─────────────────────────────────────

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
