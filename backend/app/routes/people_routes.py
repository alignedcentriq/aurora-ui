from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from typing import Optional
from pydantic import BaseModel

from app.auth import CurrentUser, require_domain_manager, get_current_user
from app.services.people_service import PeopleService

router = APIRouter(prefix="/api/people", tags=["People"])

SEARCH_ROLES = {"hr", "pmo", "admin", "manager", "functional manager", "super admin"}


def require_search_access(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role not in SEARCH_ROLES:
        raise HTTPException(status_code=403, detail="Search access is available for HR, PMO, Admin, Functional Manager, and Super Admin roles.")
    return user


@router.get("/search")
def search_people(
    q: Optional[str] = Query(None, description="Free-text search across name, skills, designation"),
    skill: Optional[str] = Query(None),
    designation: Optional[str] = Query(None),
    function: Optional[str] = Query(None),
    reporting_manager: Optional[str] = Query(None),
    min_exp: Optional[float] = Query(None),
    max_exp: Optional[float] = Query(None),
    status: Optional[str] = Query(None, description="Active or Inactive"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(require_search_access),
):
    return PeopleService.search_people(
        query=q,
        skill=skill,
        designation=designation,
        function=function,
        reporting_manager=reporting_manager,
        min_exp=min_exp,
        max_exp=max_exp,
        status=status,
        limit=limit,
        offset=offset,
    )


class AddEmployeeBody(BaseModel):
    name: str
    email: str
    department: Optional[str] = None
    designation: Optional[str] = None
    location: Optional[str] = None
    joining_date: Optional[str] = None  # "YYYY-MM-DD"
    employment_type: Optional[str] = "Full-time"
    employee_id: Optional[str] = None


@router.post("/employees")
def add_employee(
    body: AddEmployeeBody,
    user: CurrentUser = Depends(require_domain_manager),
):
    """HR "Add Employee" action — creates the employee record and automatically triggers
    the welcome email + manager intro-call invite (see PeopleService.add_employee)."""
    try:
        return PeopleService.add_employee(body.model_dump(), actor_email=user.email)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/onboarding-audit")
def get_onboarding_audit(
    q: Optional[str] = Query(None, description="Search by employee name or email"),
    limit: int = Query(20, le=200),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(require_domain_manager),
):
    return PeopleService.get_onboarding_audit(search=q or "", limit=limit, offset=offset)


@router.post("/employees/{employee_id}/trigger-onboarding")
def trigger_onboarding(
    employee_id: int,
    user: CurrentUser = Depends(require_domain_manager),
):
    """HR's one-click 'Trigger Onboarding' — kicks off welcome email + manager-call
    invite for an employee who never had it triggered, or retries a failed welcome send."""
    try:
        return PeopleService.trigger_onboarding(employee_id, actor_email=user.email)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/import/employees")
async def import_employees(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_domain_manager),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx / .xls files are accepted.")
    content = await file.read()
    try:
        result = PeopleService.import_employees(content, actor_email=user.email)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/projects")
async def import_projects(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_domain_manager),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx / .xls files are accepted.")
    content = await file.read()
    try:
        result = PeopleService.import_projects(content)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
