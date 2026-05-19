from fastapi import APIRouter
from typing import Optional
from app.services.employee_service import EmployeeService
from app.database import SessionLocal
from app.models import Employee
from sqlalchemy import or_

router = APIRouter(prefix="/api/employees", tags=["employees"])


@router.get("/autocomplete")
def autocomplete_employees(q: str = "", limit: int = 8):
    db = SessionLocal()
    try:
        query = db.query(Employee)
        if q:
            term = f"%{q}%"
            query = query.filter(
                or_(Employee.name.ilike(term), Employee.email.ilike(term))
            )
        results = query.limit(limit).all()
        return [
            {
                "id": e.id,
                "name": e.name,
                "email": e.email,
                "department": e.department or "",
                "designation": e.designation or "",
            }
            for e in results
        ]
    finally:
        db.close()


@router.get("/search")
def search_employees(
    q: str = "",
    function: Optional[str] = None,
    designation: Optional[str] = None,
    limit: int = 20,
):
    result = EmployeeService.search_directory(
        query=q,
        function=function,
        designation=designation,
        limit=limit,
    )
    return {"result": result}


@router.get("/profile")
def get_profile(identifier: str):
    return {"result": EmployeeService.get_profile(identifier)}


@router.get("/org-chart")
def get_org_chart(name_or_email: str):
    return {"result": EmployeeService.get_org_chart(name_or_email)}


@router.get("/team")
def get_team(manager: str):
    return {"result": EmployeeService.get_team_roster(manager)}


@router.get("/skills")
def find_by_skill(skill: str):
    return {"result": EmployeeService.find_skills_expert(skill)}


@router.get("/headcount")
def headcount(function: Optional[str] = None):
    return {"result": EmployeeService.get_department_headcount(function)}
