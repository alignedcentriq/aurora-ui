import datetime
import threading
from app.database import SessionLocal
from app.config import settings
from app.models import (
    Employee, Reimbursement, ParkingSticker,
    Accommodation, FacilityComplaint, FoodVendorFeedback, FoodComplaint
)


class AdminService:

    @staticmethod
    def _fire_webhook(url: str, payload: dict) -> None:
        """Fire-and-forget POST to a Power Automate webhook. Errors are swallowed silently."""
        if not url:
            return

        def _post():
            try:
                import requests as _requests
                _requests.post(url, json=payload, timeout=10)
            except Exception:
                pass

        threading.Thread(target=_post, daemon=True).start()

    @staticmethod
    def _get_or_create_employee(db, email: str) -> Employee:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            name = email.split("@")[0].replace(".", " ").replace("_", " ").title()
            emp = Employee(
                employee_id=f"EMP{abs(hash(email)) % 9000 + 1000}",
                name=name,
                email=email,
                department="General",
                designation="Employee",
                joining_date=datetime.date.today(),
                employment_type="Full-time",
                shift_type="Day",
            )
            db.add(emp)
            db.commit()
            db.refresh(emp)
        return emp

    # ── Reimbursement ─────────────────────────────────────────────────────────

    @staticmethod
    def submit_reimbursement(email: str, type: str, amount: float, reason: str = "") -> str:
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            new_r = Reimbursement(
                employee_id=emp.id,
                type=type,
                amount=amount,
                reason=reason,
                status="Pending",
            )
            db.add(new_r)
            db.commit()
            db.refresh(new_r)

            # Notify admin via email (non-blocking — ignore failure)
            try:
                from app.services.email_service import send_reimbursement_email
                send_reimbursement_email(
                    user_email=email,
                    employee_name=emp.name,
                    employee_email=emp.email,
                    reimbursement_type=type,
                    amount=amount,
                    reason=reason,
                    reimbursement_id=new_r.id,
                )
            except Exception:
                pass

            # Notify PA monitoring mailbox
            try:
                from app.services.email_service import send_notification_event
                send_notification_event(
                    email,
                    "reimbursement_submitted",
                    f"{emp.name} — INR {amount:,.0f} ({type})",
                    {
                        "reimbursement_id": new_r.id,
                        "employee_name": emp.name,
                        "employee_email": emp.email,
                        "type": type,
                        "amount": float(amount),
                        "reason": reason,
                    }
                )
            except Exception:
                pass

            # Notify PA — triggers Teams approval card for admin
            AdminService._fire_webhook(settings.PA_WEBHOOK_REIMBURSEMENT_SUBMITTED, {
                "event": "reimbursement_submitted",
                "reimbursement_id": new_r.id,
                "employee_name": emp.name,
                "employee_email": emp.email,
                "type": type,
                "amount": float(amount),
                "reason": reason,
                "submitted_at": datetime.datetime.utcnow().isoformat() + "Z",
                "approve_callback_url": f"{settings.APP_BASE_URL}/api/pa/callback/reimbursement/{new_r.id}/approve",
                "reject_callback_url": f"{settings.APP_BASE_URL}/api/pa/callback/reimbursement/{new_r.id}/reject",
            })

            return (
                f"Reimbursement request of INR {amount:,.2f} for {type} submitted successfully "
                f"(Request #{new_r.id}). The admin team has been notified."
            )
        finally:
            db.close()

    @staticmethod
    def get_reimbursements(email: str) -> str:
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            items = db.query(Reimbursement).filter(Reimbursement.employee_id == emp.id).all()
            if not items:
                return "No reimbursement requests found."

            lines = [
                f"- #{r.id} | {r.type}: INR {r.amount:,.2f} ({r.status}) on {r.created_at.date()}"
                for r in items
            ]
            return "Your reimbursement requests:\n" + "\n".join(lines)
        finally:
            db.close()

    # ── Parking ───────────────────────────────────────────────────────────────

    @staticmethod
    def request_parking_sticker(
        email: str,
        vehicle_type: str,
        vehicle_number: str,
        vehicle_make: str = "",
        vehicle_model: str = "",
    ) -> str:
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            # Check if employee already has an active sticker
            existing = db.query(ParkingSticker).filter(
                ParkingSticker.employee_id == emp.id,
                ParkingSticker.status.in_(["Active", "Pending"]),
            ).first()
            if existing:
                return (
                    f"You already have a {'pending' if existing.status == 'Pending' else 'active'} "
                    f"parking sticker for vehicle {existing.vehicle_number}. "
                    f"Please surrender it before requesting a new one."
                )

            new_s = ParkingSticker(
                employee_id=emp.id,
                vehicle_type=vehicle_type,
                vehicle_number=vehicle_number.upper(),
                vehicle_make=vehicle_make,
                vehicle_model=vehicle_model,
                valid_from=datetime.date.today(),
                valid_until=datetime.date.today() + datetime.timedelta(days=365),
                status="Pending",
            )
            db.add(new_s)
            db.commit()

            try:
                from app.services.email_service import send_parking_request_email
                send_parking_request_email(
                    user_email=email,
                    employee_name=emp.name,
                    employee_email=emp.email,
                    vehicle_type=vehicle_type,
                    vehicle_number=vehicle_number.upper(),
                    vehicle_make=vehicle_make,
                    vehicle_model=vehicle_model,
                    action="request",
                )
            except Exception:
                pass

            return (
                f"Parking sticker request submitted for your {vehicle_type} "
                f"({vehicle_make} {vehicle_model}, {vehicle_number.upper()}). "
                f"The admin team has been notified and will issue your sticker shortly."
            )
        finally:
            db.close()

    @staticmethod
    def surrender_parking_sticker(email: str, vehicle_number: str = "") -> str:
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            q = db.query(ParkingSticker).filter(
                ParkingSticker.employee_id == emp.id,
                ParkingSticker.status.in_(["Active", "Pending"]),
            )
            if vehicle_number:
                q = q.filter(ParkingSticker.vehicle_number.ilike(vehicle_number))
            sticker = q.first()

            if not sticker:
                return "No active parking sticker found to surrender."

            vnum = sticker.vehicle_number
            vtype = sticker.vehicle_type
            sticker.status = "Surrendered"
            db.commit()

            try:
                from app.services.email_service import send_parking_request_email
                send_parking_request_email(
                    user_email=email,
                    employee_name=emp.name,
                    employee_email=emp.email,
                    vehicle_type=vtype,
                    vehicle_number=vnum,
                    vehicle_make=sticker.vehicle_make or "",
                    vehicle_model=sticker.vehicle_model or "",
                    action="surrender",
                )
            except Exception:
                pass

            return (
                f"Parking sticker for vehicle {vnum} has been surrendered. "
                f"The admin team has been notified. Your sticker will be deactivated shortly."
            )
        finally:
            db.close()

    @staticmethod
    def get_parking_info(email: str) -> str:
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            stickers = db.query(ParkingSticker).filter(ParkingSticker.employee_id == emp.id).all()
            if not stickers:
                return "No parking sticker records found."

            lines = []
            for s in stickers:
                make_model = f" ({s.vehicle_make} {s.vehicle_model})".strip() if (s.vehicle_make or s.vehicle_model) else ""
                lines.append(
                    f"• {s.vehicle_type}: {s.vehicle_number}{make_model} | "
                    f"Status: {s.status} | Valid until: {s.valid_until} | "
                    f"Sticker #: {s.sticker_number or 'Pending'}"
                )
            return "Your parking sticker(s):\n" + "\n".join(lines)
        finally:
            db.close()

    # ── Accommodation ─────────────────────────────────────────────────────────

    @staticmethod
    def request_accommodation(
        email: str, type: str, check_in: str, check_out: str, location: str
    ) -> str:
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            new_a = Accommodation(
                employee_id=emp.id,
                type=type,
                check_in=datetime.datetime.strptime(check_in, "%Y-%m-%d").date(),
                check_out=datetime.datetime.strptime(check_out, "%Y-%m-%d").date(),
                location=location,
                status="Pending",
            )
            db.add(new_a)
            db.commit()
            return (
                f"Accommodation request ({type}) at {location} from {check_in} to {check_out} submitted. "
                f"The admin team will confirm availability shortly."
            )
        finally:
            db.close()

    # ── Facility Complaints ───────────────────────────────────────────────────

    @staticmethod
    def submit_facility_complaint(
        email: str, category: str, description: str, location: str, priority: str = "Medium"
    ) -> str:
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            ticket_id = f"FC-{datetime.datetime.now().strftime('%m%d%H%M%S')}"
            new_c = FacilityComplaint(
                ticket_id=ticket_id,
                employee_id=emp.id,
                category=category,
                description=description,
                location=location,
                priority=priority,
                status="Open",
            )
            db.add(new_c)
            db.commit()

            try:
                from app.services.email_service import send_facility_complaint_email
                send_facility_complaint_email(
                    user_email=email,
                    employee_name=emp.name,
                    employee_email=emp.email,
                    ticket_id=ticket_id,
                    category=category,
                    description=description,
                    location=location,
                    priority=priority,
                )
            except Exception:
                pass

            try:
                from app.services.email_service import send_notification_event
                send_notification_event(
                    email,
                    "facility_complaint",
                    f"[{priority}] {category} at {location}",
                    {
                        "ticket_id": ticket_id,
                        "category": category,
                        "location": location,
                        "priority": priority,
                        "employee_name": emp.name,
                        "employee_email": emp.email,
                    }
                )
            except Exception:
                pass

            AdminService._fire_webhook(settings.POWER_AUTOMATE_WEBHOOK_URL, {
                "complaint_type": "premises",
                "ticket_id": ticket_id,
                "category": category,
                "description": description,
                "location": location,
                "priority": priority,
                "status": "Open",
                "employee_name": emp.name,
                "employee_email": emp.email,
                "submitted_at": datetime.datetime.utcnow().isoformat() + "Z",
            })

            return (
                f"Facility complaint registered. **Ticket ID: {ticket_id}**. "
                f"The facility team has been notified and will address it based on priority."
            )
        finally:
            db.close()

    @staticmethod
    def get_complaint_status(ticket_id: str) -> str:
        db = SessionLocal()
        try:
            c = db.query(FacilityComplaint).filter(FacilityComplaint.ticket_id == ticket_id).first()
            if not c:
                return "Complaint ticket not found."
            return (
                f"Ticket: {c.ticket_id} | Category: {c.category} | "
                f"Status: {c.status} | Priority: {c.priority} | Location: {c.location}"
            )
        finally:
            db.close()

    # ── Food / Cafeteria ──────────────────────────────────────────────────────

    @staticmethod
    def submit_food_feedback(email: str, vendor_name: str, rating: int, comments: str = "") -> str:
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            new_f = FoodVendorFeedback(
                employee_id=emp.id,
                vendor_name=vendor_name,
                rating=rating,
                food_quality=rating,
                hygiene=rating,
                service=rating,
                comments=comments,
            )
            db.add(new_f)
            db.commit()
            return f"Thank you for your {rating}/5 rating for {vendor_name}!"
        finally:
            db.close()

    @staticmethod
    def submit_food_complaint(
        email: str, vendor_name: str, complaint_type: str, description: str
    ) -> str:
        """Lodge a food/cafeteria complaint — distinct from a star rating."""
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            ticket_id = f"FD-{datetime.datetime.now().strftime('%m%d%H%M%S')}"
            new_c = FoodComplaint(
                ticket_id=ticket_id,
                employee_id=emp.id,
                vendor_name=vendor_name,
                complaint_type=complaint_type,
                description=description,
                status="Open",
            )
            db.add(new_c)
            db.commit()
            db.refresh(new_c)

            try:
                from app.services.email_service import send_food_complaint_email
                send_food_complaint_email(
                    user_email=email,
                    employee_name=emp.name,
                    employee_email=emp.email,
                    vendor_name=vendor_name,
                    complaint_type=complaint_type,
                    description=description,
                    ticket_id=ticket_id,
                )
            except Exception:
                pass

            try:
                from app.services.email_service import send_notification_event
                send_notification_event(
                    email,
                    "food_complaint",
                    f"{vendor_name} — {complaint_type}",
                    {
                        "ticket_id": ticket_id,
                        "vendor_name": vendor_name,
                        "complaint_type": complaint_type,
                        "description": description[:200],
                        "employee_name": emp.name,
                        "employee_email": emp.email,
                    }
                )
            except Exception:
                pass

            AdminService._fire_webhook(settings.POWER_AUTOMATE_WEBHOOK_URL, {
                "complaint_type": "food_vendor",
                "ticket_id": str(new_c.id),
                "vendor_name": vendor_name,
                "category": complaint_type,
                "description": description,
                "status": "Open",
                "employee_name": emp.name,
                "employee_email": emp.email,
                "submitted_at": datetime.datetime.utcnow().isoformat() + "Z",
            })

            return (
                f"Food complaint submitted. **Ticket ID: {ticket_id}**. "
                f"Vendor: {vendor_name}, Type: {complaint_type}. The admin team has been notified."
            )
        finally:
            db.close()

    @staticmethod
    def get_vendor_ratings(vendor_name: str) -> str:
        db = SessionLocal()
        try:
            feedbacks = db.query(FoodVendorFeedback).filter(
                FoodVendorFeedback.vendor_name.ilike(f"%{vendor_name}%")
            ).all()
            if not feedbacks:
                return f"No feedback found for {vendor_name}."

            avg_rating = sum(f.rating for f in feedbacks) / len(feedbacks)
            return (
                f"Average rating for {vendor_name}: **{avg_rating:.1f}/5.0** "
                f"based on {len(feedbacks)} reviews."
            )
        finally:
            db.close()
