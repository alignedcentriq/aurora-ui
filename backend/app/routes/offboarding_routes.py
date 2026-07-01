"""One-click offboarding — HR/Admin revoke a user's access (reversible).

  POST /api/offboarding/offboard    {email}   — revoke access + roles + connections
  POST /api/offboarding/reinstate   {email}   — lift the block
  GET  /api/offboarding/list                   — audit list
  GET  /api/offboarding/status/{email}         — one user's offboarding status
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, require_hr
from app.services import offboarding_service as svc

router = APIRouter(prefix="/api/offboarding", tags=["Offboarding"])


class OffboardBody(BaseModel):
    email: str


@router.post("/offboard")
def offboard(body: OffboardBody, user: CurrentUser = Depends(require_hr)):
    """HR/Admin: one-click revoke all in-app access for a user (reversible)."""
    result = svc.offboard(body.email, actor_email=user.email)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Offboarding failed."))
    return result


@router.post("/reinstate")
def reinstate(body: OffboardBody, user: CurrentUser = Depends(require_hr)):
    """HR/Admin: lift a user's offboarding block so they can sign in again."""
    result = svc.reinstate(body.email, actor_email=user.email)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Reinstate failed."))
    return result


@router.get("/list")
def list_offboarded(_: CurrentUser = Depends(require_hr)):
    """HR/Admin: full offboarding audit list."""
    return svc.list_offboarded()


@router.get("/status/{email}")
def status_for(email: str, _: CurrentUser = Depends(require_hr)):
    """HR/Admin: offboarding status for one user."""
    return svc.status_for(email)
