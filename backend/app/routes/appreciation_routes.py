from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from typing import Optional
from sqlalchemy.orm import Session

from app.auth import get_current_user, CurrentUser
from app.database import SessionLocal, get_db
from app.models import Appreciation, Employee

router = APIRouter(prefix="/api/appreciations", tags=["Appreciations"])

_ALLOWED_ROLES = {"functional manager", "super admin"}


def _require_fm_or_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if user.role.lower() not in _ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="Only Functional Managers and Super Admins can manage appreciations.")
    return user


def _row_to_dict(a: Appreciation, include_screenshot: bool = False) -> dict:
    return {
        "id": a.id,
        "employee_email": a.employee_email,
        "employee_name": a.employee_name,
        "title": a.title,
        "description": a.description,
        "client_name": a.client_name,
        "has_screenshot": a.screenshot_data is not None,
        "screenshot_name": a.screenshot_name,
        "screenshot_content_type": a.screenshot_content_type,
        "added_by_email": a.added_by_email,
        "added_by_name": a.added_by_name,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.post("/")
async def add_appreciation(
    employee_email: str = Form(...),
    employee_name: str = Form(...),
    title: str = Form(...),
    description: Optional[str] = Form(None),
    client_name: Optional[str] = Form(None),
    screenshot: Optional[UploadFile] = File(None),
    user: CurrentUser = Depends(_require_fm_or_admin),
    db: Session = Depends(get_db),
):
    screenshot_data = screenshot_name = screenshot_ct = None
    if screenshot and screenshot.filename:
        content_type = screenshot.content_type or "application/octet-stream"
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Only image files are accepted for screenshots.")
        raw = await screenshot.read()
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Screenshot must be under 10 MB.")
        screenshot_data = raw
        screenshot_name = screenshot.filename
        screenshot_ct = content_type

    added_by = db.query(Employee).filter(Employee.email == user.email).first()

    row = Appreciation(
        employee_email=employee_email.lower().strip(),
        employee_name=employee_name.strip(),
        title=title.strip(),
        description=(description or "").strip() or None,
        client_name=(client_name or "").strip() or None,
        screenshot_data=screenshot_data,
        screenshot_name=screenshot_name,
        screenshot_content_type=screenshot_ct,
        added_by_email=user.email,
        added_by_name=added_by.name if added_by else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_dict(row)


@router.get("/")
def list_appreciations(
    user: CurrentUser = Depends(_require_fm_or_admin),
    db: Session = Depends(get_db),
):
    rows = db.query(Appreciation).order_by(Appreciation.created_at.desc()).all()
    return [_row_to_dict(r) for r in rows]


@router.get("/employee/{email}")
def get_appreciations_for_employee(
    email: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Appreciation)
        .filter(Appreciation.employee_email == email.lower())
        .order_by(Appreciation.created_at.desc())
        .all()
    )
    return [_row_to_dict(r) for r in rows]


@router.get("/count/{email}")
def get_appreciation_count(
    email: str,
    db: Session = Depends(get_db),
):
    count = db.query(Appreciation).filter(Appreciation.employee_email == email.lower()).count()
    return {"email": email, "count": count}


@router.get("/{appreciation_id}/screenshot")
def get_screenshot(
    appreciation_id: int,
    db: Session = Depends(get_db),
):
    row = db.query(Appreciation).filter(Appreciation.id == appreciation_id).first()
    if not row or not row.screenshot_data:
        raise HTTPException(status_code=404, detail="Screenshot not found.")
    return Response(
        content=row.screenshot_data,
        media_type=row.screenshot_content_type or "image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.delete("/{appreciation_id}")
def delete_appreciation(
    appreciation_id: int,
    user: CurrentUser = Depends(_require_fm_or_admin),
    db: Session = Depends(get_db),
):
    row = db.query(Appreciation).filter(Appreciation.id == appreciation_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Appreciation not found.")
    db.delete(row)
    db.commit()
    return {"deleted": True}
