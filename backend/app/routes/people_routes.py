from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from typing import Optional

from app.auth import CurrentUser, require_domain_manager, get_current_user
from app.services.people_service import PeopleService

router = APIRouter(prefix="/api/people", tags=["People"])

SEARCH_ROLES = {"hr", "pmo", "admin", "manager"}


def require_search_access(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role not in SEARCH_ROLES:
        raise HTTPException(status_code=403, detail="Search access is available for HR, PMO, Admin, and Manager roles.")
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
    )


@router.post("/import/employees")
async def import_employees(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_domain_manager),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx / .xls files are accepted.")
    content = await file.read()
    try:
        result = PeopleService.import_employees(content)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import/allocations")
async def import_allocations(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_domain_manager),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx / .xls files are accepted.")
    content = await file.read()
    try:
        result = PeopleService.import_allocations(content)
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
