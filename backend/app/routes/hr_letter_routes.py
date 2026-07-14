"""
HR Letters & Certificates directory routes (Documents page → "Letters & Certificates" +
HR's "Manage letters" tab). See app/services/hr_letter_service.py for the model rationale:
generation happens in Zoho People, this only controls the in-app directory.
"""

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import CurrentUser, get_current_user, require_hr
from app.database import SessionLocal
from app.services import hr_letter_service

router = APIRouter(prefix="/api/hr-letters", tags=["HR Letters"])


@router.get("")
def list_letters(user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        return {"letters": hr_letter_service.list_all(db)}
    finally:
        db.close()


@router.post("")
def create_letter(payload: dict = Body(...), user: CurrentUser = Depends(require_hr)):
    db = SessionLocal()
    try:
        try:
            return hr_letter_service.create(db, payload, created_by=user.email)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    finally:
        db.close()


@router.put("/{letter_id}")
def update_letter(letter_id: int, payload: dict = Body(...), user: CurrentUser = Depends(require_hr)):
    db = SessionLocal()
    try:
        row = hr_letter_service.update(db, letter_id, payload)
        if row is None:
            raise HTTPException(status_code=404, detail="Letter type not found.")
        return row
    finally:
        db.close()


@router.delete("/{letter_id}")
def delete_letter(letter_id: int, user: CurrentUser = Depends(require_hr)):
    db = SessionLocal()
    try:
        if not hr_letter_service.delete(db, letter_id):
            raise HTTPException(status_code=404, detail="Letter type not found.")
        return {"deleted": True}
    finally:
        db.close()
