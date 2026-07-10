"""Leadership Capability Command — read-only, deterministic SQL panels for leadership."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import CurrentUser, require_pmo
from app.database import get_db
from app.services import capability_command_service

router = APIRouter(prefix="/api/portal/leadership", tags=["Leadership"])


@router.get("/capability-command")
def capability_command(
    user: CurrentUser = Depends(require_pmo),
    db: Session = Depends(get_db),
):
    """Org-wide workforce intelligence: capability heat map, pipeline readiness,
    and single-point-of-failure risks — all SQL, no LLM."""
    return capability_command_service.overview(db)
