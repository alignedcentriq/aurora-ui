"""Employee-facing routes for the biweekly project-update form."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, get_current_user
from app.services import project_update_service

router = APIRouter(prefix="/api/project-update", tags=["Project Update"])


class SubmitBody(BaseModel):
    activity_type: str
    project_name: Optional[str] = None
    expected_end_date: Optional[str] = None   # YYYY-MM-DD
    duration_text: Optional[str] = None
    details: Optional[str] = None


@router.get("/config")
def form_config(_: CurrentUser = Depends(get_current_user)):
    """Activity options + the current fortnight label for the form."""
    _, _, label = project_update_service.current_period()
    return {
        "activity_options": project_update_service.activity_options(),
        "period": label,
    }


@router.post("/submit")
def submit(body: SubmitBody, user: CurrentUser = Depends(get_current_user)):
    res = project_update_service.submit(user.email, body.model_dump())
    if not res.get("success"):
        msg = {
            "invalid_activity": "Please pick a valid activity.",
            "project_name_required": "Project name is required for a project.",
            "employee_not_found": "We couldn't find your employee record.",
        }.get(res.get("error"), "Could not submit your update.")
        raise HTTPException(status_code=400, detail=msg)
    return {
        "message": "Your update was submitted. Your reporting manager has been notified for approval.",
        "submission_id": res["submission_id"],
    }


@router.get("/me")
def my_submissions(user: CurrentUser = Depends(get_current_user)):
    return project_update_service.list_for_employee(user.email)
