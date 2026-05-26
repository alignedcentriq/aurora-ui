"""
Software Catalog Routes
------------------------
CRUD for the software catalog (ManageEngine package registry).
IT admins only for write operations; all authenticated users can read.
"""

import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, get_current_user, require_it
from app.database import get_db
from app.models import SoftwareCatalog

router = APIRouter(prefix="/api/software-catalog", tags=["Software Catalog"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class SoftwareCatalogCreate(BaseModel):
    name: str
    version: Optional[str] = None
    category: Optional[str] = None
    endpoint_central_package_id: Optional[str] = None
    installer_hash: Optional[str] = None
    auto_approve: bool = False
    requires_license: bool = False


class SoftwareCatalogUpdate(BaseModel):
    name: Optional[str] = None
    version: Optional[str] = None
    category: Optional[str] = None
    endpoint_central_package_id: Optional[str] = None
    installer_hash: Optional[str] = None
    auto_approve: Optional[bool] = None
    requires_license: Optional[bool] = None
    is_active: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_dict(row: SoftwareCatalog) -> dict:
    return {
        "id": str(row.id),
        "name": row.name,
        "version": row.version,
        "category": row.category,
        "endpoint_central_package_id": row.endpoint_central_package_id,
        "installer_hash": row.installer_hash,
        "auto_approve": row.auto_approve,
        "requires_license": row.requires_license,
        "is_active": row.is_active,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_software(
    category: Optional[str] = None,
    active_only: bool = True,
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all software in the catalog. Readable by all authenticated users."""
    query = db.query(SoftwareCatalog)
    if active_only:
        query = query.filter(SoftwareCatalog.is_active == True)
    if category:
        query = query.filter(SoftwareCatalog.category == category)
    rows = query.order_by(SoftwareCatalog.name).all()
    return [_row_to_dict(r) for r in rows]


@router.post("", status_code=201)
def add_software(
    body: SoftwareCatalogCreate,
    _: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    """Add a new software entry to the catalog. IT admins only."""
    existing = db.query(SoftwareCatalog).filter(
        SoftwareCatalog.name == body.name,
        SoftwareCatalog.is_active == True,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Active catalog entry for '{body.name}' already exists.")

    entry = SoftwareCatalog(**body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _row_to_dict(entry)


@router.patch("/{catalog_id}")
def update_software(
    catalog_id: str,
    body: SoftwareCatalogUpdate,
    _: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    """Update a catalog entry. IT admins only."""
    entry = db.query(SoftwareCatalog).filter(SoftwareCatalog.id == catalog_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Software entry not found.")

    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(entry, field, value)
    entry.updated_at = datetime.datetime.utcnow()

    db.commit()
    db.refresh(entry)
    return _row_to_dict(entry)


@router.delete("/{catalog_id}")
def deactivate_software(
    catalog_id: str,
    _: CurrentUser = Depends(require_it),
    db: Session = Depends(get_db),
):
    """Soft-delete (deactivate) a catalog entry. IT admins only."""
    entry = db.query(SoftwareCatalog).filter(SoftwareCatalog.id == catalog_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Software entry not found.")
    entry.is_active = False
    entry.updated_at = datetime.datetime.utcnow()
    db.commit()
    return {"status": "deactivated", "id": catalog_id}
