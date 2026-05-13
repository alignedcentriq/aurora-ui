from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Milestone, Project, Sprint, TeamCapacity


router = APIRouter(prefix="/api/pmo", tags=["PMO Data"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class ProjectSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: str
    completion_pct: float
    sprint_name: Optional[str]
    next_milestone: Optional[str]
    next_milestone_date: Optional[str]
    owner: Optional[str]


class SprintSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    team: str
    name: str
    start_date: Optional[str]
    end_date: Optional[str]
    velocity: int
    committed: int
    completed: int
    blockers_count: int


class TeamCapacitySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    team: str
    total_members: int
    available: int
    on_leave: int
    capacity_pct: float


class MilestoneSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_name: str
    name: str
    due_date: Optional[str]
    status: str


class PaginatedResponse(BaseModel):
    total: int
    page: int
    page_size: int
    total_pages: int
    items: list


@router.get("/projects", response_model=PaginatedResponse, summary="List all projects")
def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Project)
    if status:
        query = query.filter(Project.status.ilike(f"%{status}%"))
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": -(-total // page_size),
        "items": [ProjectSchema.model_validate(item) for item in items],
    }


@router.get("/projects/{project_id}", response_model=ProjectSchema, summary="Get project by ID")
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectSchema.model_validate(project)


@router.get("/sprints", response_model=PaginatedResponse, summary="List all sprints")
def list_sprints(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    team: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Sprint)
    if team:
        query = query.filter(Sprint.team.ilike(f"%{team}%"))
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": -(-total // page_size),
        "items": [SprintSchema.model_validate(item) for item in items],
    }


@router.get("/team-capacity", response_model=PaginatedResponse, summary="List team capacity")
def list_team_capacity(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    total = db.query(TeamCapacity).count()
    items = db.query(TeamCapacity).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": -(-total // page_size),
        "items": [TeamCapacitySchema.model_validate(item) for item in items],
    }


@router.get("/milestones", response_model=PaginatedResponse, summary="List all milestones")
def list_milestones(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    project: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Milestone)
    if project:
        query = query.filter(Milestone.project_name.ilike(f"%{project}%"))
    if status:
        query = query.filter(Milestone.status == status.upper())
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": -(-total // page_size),
        "items": [MilestoneSchema.model_validate(item) for item in items],
    }
