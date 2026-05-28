import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.auth import CurrentUser, require_admin
from app.database import get_db
from app.models import Reimbursement, ParkingSticker, FacilityComplaint, FoodComplaint, Employee, Book, BookRequest
from app.services.email_service import send_facility_complaint_status_email, send_food_complaint_status_email

router = APIRouter(prefix="/api/portal/admin", tags=["Admin Portal"])


# ── Reimbursements ────────────────────────────────────────────────────────────

@router.get("/reimbursements")
def list_reimbursements(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(Reimbursement, Employee).join(Employee, Reimbursement.employee_id == Employee.id)
    if status:
        q = q.filter(Reimbursement.status == status)
    rows = q.order_by(Reimbursement.created_at.desc()).all()
    return [
        {
            "id": r.id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "type": r.type,
            "amount": r.amount,
            "reason": r.reason,
            "status": r.status,
            "approved_by": r.approved_by,
            "created_at": r.created_at.isoformat(),
        }
        for r, emp in rows
    ]


@router.put("/reimbursements/{id}/approve")
def approve_reimbursement(
    id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    r = db.query(Reimbursement).filter(Reimbursement.id == id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reimbursement not found.")
    r.status = "Approved"
    r.approved_by = user.email
    r.updated_at = datetime.datetime.utcnow()
    db.commit()
    emp = db.query(Employee).filter(Employee.id == r.employee_id).first()
    if emp:
        from app.services.admin_service import AdminService
        from app.config import settings
        from app.services.email_service import send_notification_event
        _payload = {
            "reimbursement_id": r.id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "type": r.type,
            "amount": float(r.amount),
            "decision": "Approved",
            "decided_by": user.email,
        }
        AdminService._fire_webhook(settings.PA_WEBHOOK_REIMBURSEMENT_DECISION, {"event": "reimbursement_decision", "decided_at": datetime.datetime.utcnow().isoformat() + "Z", **_payload})
        try:
            send_notification_event("reimbursement_decision", f"Approved: {emp.name} — INR {r.amount:,.0f}", _payload)
        except Exception:
            pass
    return {"message": "Reimbursement approved."}


@router.put("/reimbursements/{id}/reject")
def reject_reimbursement(
    id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    r = db.query(Reimbursement).filter(Reimbursement.id == id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Reimbursement not found.")
    r.status = "Rejected"
    r.updated_at = datetime.datetime.utcnow()
    db.commit()
    emp = db.query(Employee).filter(Employee.id == r.employee_id).first()
    if emp:
        from app.services.admin_service import AdminService
        from app.config import settings
        from app.services.email_service import send_notification_event
        _payload = {
            "reimbursement_id": r.id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "type": r.type,
            "amount": float(r.amount),
            "decision": "Rejected",
            "decided_by": user.email,
        }
        AdminService._fire_webhook(settings.PA_WEBHOOK_REIMBURSEMENT_DECISION, {"event": "reimbursement_decision", "decided_at": datetime.datetime.utcnow().isoformat() + "Z", **_payload})
        try:
            send_notification_event("reimbursement_decision", f"Rejected: {emp.name} — INR {r.amount:,.0f}", _payload)
        except Exception:
            pass
    return {"message": "Reimbursement rejected."}


# ── Parking Stickers ──────────────────────────────────────────────────────────

@router.get("/parking")
def list_parking(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(ParkingSticker, Employee).join(Employee, ParkingSticker.employee_id == Employee.id)
    if status:
        q = q.filter(ParkingSticker.status == status)
    rows = q.order_by(ParkingSticker.valid_from.desc()).all()
    return [
        {
            "id": s.id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "vehicle_type": s.vehicle_type,
            "vehicle_number": s.vehicle_number,
            "vehicle_make": s.vehicle_make,
            "vehicle_model": s.vehicle_model,
            "sticker_number": s.sticker_number,
            "status": s.status,
            "valid_from": s.valid_from.isoformat() if s.valid_from else None,
            "valid_until": s.valid_until.isoformat() if s.valid_until else None,
        }
        for s, emp in rows
    ]


class ApproveParkingBody(BaseModel):
    sticker_number: str


@router.put("/parking/{id}/approve")
def approve_parking(
    id: int,
    body: ApproveParkingBody,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(ParkingSticker).filter(ParkingSticker.id == id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Parking sticker not found.")
    s.status = "Active"
    s.sticker_number = body.sticker_number
    db.commit()
    emp = db.query(Employee).filter(Employee.id == s.employee_id).first()
    if emp:
        from app.services.admin_service import AdminService
        from app.config import settings
        from app.services.email_service import send_notification_event
        AdminService._fire_webhook(settings.PA_WEBHOOK_PARKING_ACTIVATED, {
            "event": "parking_sticker_activated",
            "sticker_number": body.sticker_number,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "vehicle_type": s.vehicle_type,
            "vehicle_number": s.vehicle_number,
            "vehicle_make": s.vehicle_make or "",
            "vehicle_model": s.vehicle_model or "",
            "valid_from": s.valid_from.isoformat() if s.valid_from else "",
            "valid_until": s.valid_until.isoformat() if s.valid_until else "",
        })
        try:
            send_notification_event(
                "parking_activated",
                f"Sticker issued to {emp.name}",
                {
                    "employee_name": emp.name,
                    "employee_email": emp.email,
                    "vehicle_number": s.vehicle_number,
                    "vehicle_type": s.vehicle_type,
                    "sticker_number": body.sticker_number,
                    "valid_until": s.valid_until.isoformat() if s.valid_until else "",
                }
            )
        except Exception:
            pass
    return {"message": "Parking sticker approved and issued."}


@router.put("/parking/{id}/revoke")
def revoke_parking(
    id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(ParkingSticker).filter(ParkingSticker.id == id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Parking sticker not found.")
    s.status = "Surrendered"
    db.commit()
    emp = db.query(Employee).filter(Employee.id == s.employee_id).first()
    if emp:
        from app.services.admin_service import AdminService
        from app.config import settings
        from app.services.email_service import send_notification_event
        AdminService._fire_webhook(settings.PA_WEBHOOK_PARKING_REVOKED, {
            "event": "parking_sticker_revoked",
            "sticker_id": s.id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "vehicle_number": s.vehicle_number,
            "revoked_by": user.email,
            "revoked_at": datetime.datetime.utcnow().isoformat() + "Z",
        })
        try:
            send_notification_event(
                "parking_revoked",
                f"Sticker revoked for {emp.name}",
                {
                    "employee_name": emp.name,
                    "employee_email": emp.email,
                    "vehicle_number": s.vehicle_number,
                    "revoked_by": user.email,
                }
            )
        except Exception:
            pass
    return {"message": "Parking sticker revoked."}


# ── Facility Complaints ───────────────────────────────────────────────────────

@router.get("/complaints")
def list_complaints(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(FacilityComplaint, Employee).join(Employee, FacilityComplaint.employee_id == Employee.id)
    if status:
        q = q.filter(FacilityComplaint.status == status)
    rows = q.order_by(FacilityComplaint.created_at.desc()).all()
    return [
        {
            "id": c.id,
            "ticket_id": c.ticket_id,
            "employee_name": emp.name,
            "employee_email": emp.email,
            "category": c.category,
            "description": c.description,
            "location": c.location,
            "priority": c.priority,
            "status": c.status,
            "assigned_to": c.assigned_to,
            "closure_comment": c.resolution_notes,
            "created_at": c.created_at.isoformat(),
        }
        for c, emp in rows
    ]


class UpdateComplaintBody(BaseModel):
    status: str
    closure_comment: Optional[str] = None


@router.put("/complaints/{ticket_id}/status")
def update_complaint_status(
    ticket_id: str,
    body: UpdateComplaintBody,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    valid_statuses = {"In Progress", "Closed"}
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use: {', '.join(valid_statuses)}")
    row = db.query(FacilityComplaint, Employee).join(Employee, FacilityComplaint.employee_id == Employee.id).filter(FacilityComplaint.ticket_id == ticket_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Complaint not found.")
    c, emp = row
    c.status = body.status
    if body.closure_comment:
        c.resolution_notes = body.closure_comment
    if body.status == "Closed":
        c.resolved_at = datetime.datetime.utcnow()
    db.commit()
    send_facility_complaint_status_email(
        employee_name=emp.name,
        employee_email=emp.email,
        ticket_id=c.ticket_id,
        category=c.category,
        new_status=body.status,
        closure_comment=body.closure_comment if body.status == "Closed" else None,
    )
    return {"message": f"Complaint {ticket_id} updated to {body.status}."}


# ── Food Complaints ───────────────────────────────────────────────────────────

@router.get("/food-complaints")
def list_food_complaints(
    status: Optional[str] = None,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(FoodComplaint, Employee).join(Employee, FoodComplaint.employee_id == Employee.id)
    if status:
        q = q.filter(FoodComplaint.status == status)
    rows = q.order_by(FoodComplaint.submitted_at.desc()).all()
    return [
        {
            "id": c.id,
            "ticket_id": c.ticket_id or f"FD-{c.id:06d}",
            "employee_name": emp.name,
            "employee_email": emp.email,
            "vendor_name": c.vendor_name,
            "complaint_type": c.complaint_type,
            "description": c.description,
            "status": c.status,
            "closure_comment": c.closure_comment,
            "submitted_at": c.submitted_at.isoformat(),
        }
        for c, emp in rows
    ]


class UpdateFoodComplaintBody(BaseModel):
    status: str
    closure_comment: Optional[str] = None


@router.put("/food-complaints/{ticket_id}/status")
def update_food_complaint_status(
    ticket_id: str,
    body: UpdateFoodComplaintBody,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    valid_statuses = {"In Progress", "Closed"}
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use: {', '.join(valid_statuses)}")
    row = (
        db.query(FoodComplaint, Employee)
        .join(Employee, FoodComplaint.employee_id == Employee.id)
        .filter(FoodComplaint.ticket_id == ticket_id)
        .first()
    )
    if not row and ticket_id.startswith("FD-"):
        try:
            fallback_id = int(ticket_id[3:])
            row = (
                db.query(FoodComplaint, Employee)
                .join(Employee, FoodComplaint.employee_id == Employee.id)
                .filter(FoodComplaint.id == fallback_id)
                .first()
            )
        except ValueError:
            pass
    if not row:
        raise HTTPException(status_code=404, detail="Food complaint not found.")
    c, emp = row
    c.status = body.status
    if body.closure_comment:
        c.closure_comment = body.closure_comment
    if body.status == "Closed":
        c.resolved_at = datetime.datetime.utcnow()
    db.commit()
    send_food_complaint_status_email(
        employee_name=emp.name,
        employee_email=emp.email,
        ticket_id=c.ticket_id or f"FD-{c.id:06d}",
        vendor_name=c.vendor_name,
        new_status=body.status,
        closure_comment=body.closure_comment if body.status == "Closed" else None,
    )
    return {"message": f"Food complaint {ticket_id} updated to {body.status}."}


# ── Bookshelf Buddy (proxies to Nexus Library mock server) ───────────────────

from app.services.bookshelf_service import BookshelfService


class BookBody(BaseModel):
    title: str
    author: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    total_copies: int = 1


class AddCopiesBody(BaseModel):
    count: int = 1


class BookRequestActionBody(BaseModel):
    admin_remarks: Optional[str] = None
    due_date: Optional[str] = None


def _nexus_error(e: Exception):
    raise HTTPException(status_code=502, detail=f"Nexus Library error: {e}")


@router.get("/library/dashboard")
def library_dashboard(_: CurrentUser = Depends(require_admin)):
    data = BookshelfService.get_dashboard()
    if data is None:
        raise HTTPException(502, "Could not reach Nexus Library server")
    return data


@router.get("/books")
def list_books(_: CurrentUser = Depends(require_admin)):
    return BookshelfService.list_all_books()


@router.get("/books/{book_id}")
def get_book(book_id: int, _: CurrentUser = Depends(require_admin)):
    data = BookshelfService.get_book(book_id)
    if not data:
        raise HTTPException(404, "Book not found")
    return data


@router.post("/books", status_code=201)
def add_book(body: BookBody, _: CurrentUser = Depends(require_admin)):
    try:
        return BookshelfService.add_book(
            body.title, body.author or "", body.category or "",
            body.description or "", body.total_copies,
        )
    except Exception as e:
        _nexus_error(e)


@router.put("/books/{book_id}")
def update_book(book_id: int, body: BookBody, _: CurrentUser = Depends(require_admin)):
    try:
        return BookshelfService.update_book(book_id, body.title, body.author, body.category, body.description)
    except Exception as e:
        _nexus_error(e)


@router.post("/books/{book_id}/copies")
def add_copies(book_id: int, body: AddCopiesBody, _: CurrentUser = Depends(require_admin)):
    try:
        return BookshelfService.add_copies(book_id, body.count)
    except Exception as e:
        _nexus_error(e)


@router.put("/library/copies/{copy_id}/lost")
def mark_copy_lost(copy_id: int, _: CurrentUser = Depends(require_admin)):
    try:
        return BookshelfService.mark_copy_lost(copy_id)
    except Exception as e:
        _nexus_error(e)


@router.put("/library/copies/{copy_id}/damaged")
def mark_copy_damaged(copy_id: int, _: CurrentUser = Depends(require_admin)):
    try:
        return BookshelfService.mark_copy_damaged(copy_id)
    except Exception as e:
        _nexus_error(e)


@router.put("/library/copies/{copy_id}/restore")
def restore_copy(copy_id: int, _: CurrentUser = Depends(require_admin)):
    try:
        return BookshelfService.restore_copy(copy_id)
    except Exception as e:
        _nexus_error(e)


@router.get("/book-requests")
def list_book_requests(status: Optional[str] = None, _: CurrentUser = Depends(require_admin)):
    return BookshelfService.list_requests(status)


@router.put("/book-requests/{id}/approve")
def approve_book_request(id: int, body: BookRequestActionBody, _: CurrentUser = Depends(require_admin)):
    try:
        return BookshelfService.approve_request(id, body.admin_remarks or "", body.due_date or "")
    except Exception as e:
        _nexus_error(e)


@router.put("/book-requests/{id}/reject")
def reject_book_request(id: int, body: BookRequestActionBody, _: CurrentUser = Depends(require_admin)):
    try:
        return BookshelfService.reject_request(id, body.admin_remarks or "")
    except Exception as e:
        _nexus_error(e)


@router.put("/book-requests/{id}/return")
def return_book(id: int, body: BookRequestActionBody, _: CurrentUser = Depends(require_admin)):
    try:
        return BookshelfService.return_book(id, body.admin_remarks or "")
    except Exception as e:
        _nexus_error(e)
