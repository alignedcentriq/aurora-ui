from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.auth import CurrentUser, require_pmo
from app.database import SessionLocal
from app.models import Project
from app.services import allocation_snapshot_service


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
    next_milestone: Optional[str]
    next_milestone_date: Optional[str]
    owner: Optional[str]


def _manual_to_dict(p: Project) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "status": p.status,
        "completion_pct": p.completion_pct,
        "next_milestone": p.next_milestone,
        "next_milestone_date": p.next_milestone_date,
        "owner": p.owner,
        "team_size": None,
    }


class ProjectCreate(BaseModel):
    name: str
    status: str = "In Progress"
    owner: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    owner: Optional[str] = None


class PaginatedResponse(BaseModel):
    total: int
    page: int
    page_size: int
    total_pages: int
    items: list


@router.get("/projects", response_model=PaginatedResponse, summary="List all active projects")
def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Real project roster, sourced from live allocations (one row per project
    currently staffed) — always active-only. Manually-created projects (via the
    PMO 'New Project' form) are merged in on top, skipped once they also show up
    with allocation data under the same name so a project isn't listed twice."""
    live_raw = allocation_snapshot_service.list_active_projects(db)
    live = [
        {
            "id": -(i + 1),  # synthetic — negative so it never collides with a manual Project.id
            "name": p["name"],
            "status": p["status"],
            "completion_pct": None,
            "next_milestone": None,
            "next_milestone_date": None,
            "owner": p["owner"],
            "team_size": p["team_size"],
        }
        for i, p in enumerate(live_raw)
    ]
    live_names = {p["name"].strip().lower() for p in live}

    manual_active = [
        p for p in db.query(Project).all()
        if p.name.strip().lower() not in live_names
        and (p.status or "").strip().lower() != "completed"
    ]

    items = live + [_manual_to_dict(p) for p in manual_active]
    if status:
        items = [i for i in items if status.lower() in (i["status"] or "").lower()]

    total = len(items)
    start = (page - 1) * page_size
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": -(-total // page_size) if total else 0,
        "items": items[start:start + page_size],
    }


@router.get("/projects/detail", summary="Project detail: real start date + current members")
def project_detail(name: str = Query(...), db: Session = Depends(get_db)):
    detail = allocation_snapshot_service.project_detail(db, name)
    if detail:
        return {
            "name": detail["name"],
            "start_date": detail["start_date"].isoformat() if detail["start_date"] else None,
            "owner": detail["owner"],
            "members": detail["members"],
            "source": "allocation",
        }
    project = db.query(Project).filter(Project.name == name).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"name": project.name, "start_date": None, "owner": project.owner, "members": [], "source": "manual"}


@router.get("/projects/{project_id}", response_model=ProjectSchema, summary="Get project by ID")
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectSchema.model_validate(project)


@router.post("/projects", response_model=ProjectSchema, status_code=201, summary="Create a project")
def create_project(
    body: ProjectCreate,
    user: CurrentUser = Depends(require_pmo),
    db: Session = Depends(get_db),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required.")
    if db.query(Project).filter(Project.name == name).first():
        raise HTTPException(status_code=409, detail="A project with this name already exists.")

    project = Project(name=name, status=body.status, owner=body.owner)
    db.add(project)
    db.commit()
    db.refresh(project)
    return ProjectSchema.model_validate(project)


@router.put("/projects/{project_id}", response_model=ProjectSchema, summary="Update a project")
def update_project(
    project_id: int,
    body: ProjectUpdate,
    user: CurrentUser = Depends(require_pmo),
    db: Session = Depends(get_db),
):
    """Manually-created projects only — the live allocation-derived roster (synthetic
    negative ids from list_projects) has no backing row here and can't be edited."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Project name is required.")
        existing = db.query(Project).filter(Project.name == name, Project.id != project_id).first()
        if existing:
            raise HTTPException(status_code=409, detail="A project with this name already exists.")
        project.name = name
    if body.status is not None:
        project.status = body.status
    if body.owner is not None:
        project.owner = body.owner

    db.commit()
    db.refresh(project)
    return ProjectSchema.model_validate(project)


@router.delete("/projects/{project_id}", summary="Delete a project")
def delete_project(
    project_id: int,
    user: CurrentUser = Depends(require_pmo),
    db: Session = Depends(get_db),
):
    """Manually-created projects only — see update_project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"message": f"Project '{project.name}' deleted successfully"}
