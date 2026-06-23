import datetime
import threading
from app.database import SessionLocal
from app.config import settings
from app.models import (
    Employee, Reimbursement, ParkingSticker,
    Accommodation, FacilityComplaint, FoodVendorFeedback, FoodComplaint,
    VisitorPass, DeskKeyRequest, ApprovalToken
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

            # Idempotency: same type+amount submitted moments ago is a double-submit.
            from app.services.idempotency import find_recent_duplicate
            dup = find_recent_duplicate(
                db, Reimbursement, window_seconds=120,
                employee_id=emp.id, type=type, amount=amount, status="Pending",
            )
            if dup:
                return (
                    f"You already submitted a {type} reimbursement of INR {amount:,.0f} moments ago "
                    f"(ref #{dup.id}). I didn't create a duplicate."
                )

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

            # Idempotency: same type+location requested moments ago is a double-submit.
            from app.services.idempotency import find_recent_duplicate
            dup = find_recent_duplicate(
                db, Accommodation, window_seconds=120,
                employee_id=emp.id, type=type, location=location, status="Pending",
            )
            if dup:
                return (
                    f"You already have a pending {type} accommodation request for {location} "
                    f"(ref #{dup.id}). I didn't create a duplicate."
                )

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

    # ── Visitor Passes ────────────────────────────────────────────────────────

    @staticmethod
    def request_visitor_pass(
        email: str,
        visitor_name: str,
        visit_date: str,
        purpose: str,
        visit_time: str = "",
        visitor_company: str = "",
    ) -> str:
        # Guard against LLM-invented placeholder values: never create a pass for
        # a templated name or an unparseable/past visit date. Forces the agent to
        # ask the user for real details instead of fabricating "John Doe / 2023".
        name_clean = (visitor_name or "").strip()
        _PLACEHOLDER_NAMES = {
            "john doe", "jane doe", "test", "test visitor", "visitor", "visitor name",
            "n/a", "na", "none", "example", "first last", "firstname lastname",
        }
        if not name_clean or name_clean.lower() in _PLACEHOLDER_NAMES:
            return ("I need the visitor's actual name to register the pass. "
                    "Who is visiting?")
        try:
            visit_date_obj = datetime.datetime.strptime(visit_date.strip(), "%Y-%m-%d").date()
        except (ValueError, AttributeError):
            return ("I couldn't read the visit date. Please give it as a real "
                    "calendar date (YYYY-MM-DD), e.g. 2026-06-05.")
        if visit_date_obj < datetime.date.today():
            return (f"The visit date {visit_date} is in the past. "
                    "Please provide the actual upcoming visit date.")

        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            pass_id = f"VP-{datetime.datetime.now().strftime('%m%d%H%M%S')}"

            new_p = VisitorPass(
                pass_id=pass_id,
                employee_id=emp.id,
                visitor_name=visitor_name,
                visitor_company=visitor_company,
                visit_date=visit_date_obj,
                visit_time=visit_time,
                purpose=purpose,
                status="Pending",
            )
            db.add(new_p)
            db.commit()

            try:
                from app.services.email_service import send_visitor_pass_email
                send_visitor_pass_email(
                    user_email=email,
                    employee_name=emp.name,
                    employee_email=emp.email,
                    visitor_name=visitor_name,
                    visit_date=visit_date,
                    purpose=purpose,
                    pass_id=pass_id,
                    visit_time=visit_time,
                    visitor_company=visitor_company,
                )
            except Exception:
                pass

            company = f" from {visitor_company}" if visitor_company else ""
            when = f"{visit_date}" + (f" at {visit_time}" if visit_time else "")
            return (
                f"Visitor pass requested for **{visitor_name}**{company} on {when}. "
                f"**Pass ID: {pass_id}**. The admin/reception team has been notified and will "
                f"have the pass ready at the front desk."
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

            # Idempotency: identical open complaint moments ago is a double-submit.
            from app.services.idempotency import find_recent_duplicate
            dup = find_recent_duplicate(
                db, FacilityComplaint, window_seconds=120,
                employee_id=emp.id, description=description, location=location, status="Open",
            )
            if dup:
                return (
                    f"You already logged this facility complaint — **Ticket ID: {dup.ticket_id}**. "
                    f"I didn't create a duplicate."
                )

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

            # Idempotency: identical food complaint moments ago is a double-submit.
            from app.services.idempotency import find_recent_duplicate
            dup = find_recent_duplicate(
                db, FoodComplaint, window_seconds=120,
                employee_id=emp.id, vendor_name=vendor_name,
                complaint_type=complaint_type, description=description,
            )
            if dup:
                return (
                    f"You already logged this food complaint about {vendor_name} — "
                    f"**Ticket ID: {dup.ticket_id}**. I didn't create a duplicate."
                )

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

    # ── Desk Keys ─────────────────────────────────────────────────────────────

    @staticmethod
    def _mint_desk_key_tokens(entity_id: int, approver_email: str, employee_email: str) -> tuple[str, str]:
        import secrets
        approve_tok = secrets.token_urlsafe(32)
        reject_tok = secrets.token_urlsafe(32)
        expires = datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        db = SessionLocal()
        try:
            for tok, action in ((approve_tok, "approve"), (reject_tok, "reject")):
                db.add(ApprovalToken(
                    token=tok, entity_type="desk_key", entity_id=entity_id, action=action,
                    approver_email=approver_email, employee_email=employee_email, expires_at=expires,
                ))
            db.commit()
        finally:
            db.close()
        return approve_tok, reject_tok

    @staticmethod
    def request_desk_key(email: str, desk_number: str, reason: str = "") -> str:
        """Request a desk key. Auto-rejected if the desk is already assigned to someone else."""
        desk = (desk_number or "").strip().upper()
        if not desk:
            return "Please provide the desk number you need a key for (e.g. B-07)."
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            # Auto-reject if an active (Approved) assignment for this desk belongs to someone else.
            existing = db.query(DeskKeyRequest).filter(
                DeskKeyRequest.desk_number == desk,
                DeskKeyRequest.status == "Approved",
                DeskKeyRequest.employee_id != emp.id,
            ).first()
            if existing:
                db.add(DeskKeyRequest(
                    employee_id=emp.id, desk_number=desk, reason=reason or None,
                    status="Auto-Rejected",
                    decision_reason="Desk already assigned to another employee.",
                ))
                db.commit()
                return (
                    f"Desk {desk} is already assigned to another employee, so your request was "
                    f"automatically declined. Please request a different desk number."
                )

            req = DeskKeyRequest(
                employee_id=emp.id, desk_number=desk, reason=reason or None, status="Pending",
            )
            db.add(req)
            db.commit()
            db.refresh(req)
            req_id, emp_name = req.id, emp.name
        finally:
            db.close()

        # Notify Admin with approve/reject links.
        approve_url = reject_url = ""
        try:
            if settings.NOTIFY_TO_EMAIL:
                approve_tok, reject_tok = AdminService._mint_desk_key_tokens(
                    entity_id=req_id, approver_email=settings.NOTIFY_TO_EMAIL, employee_email=email,
                )
                approve_url = f"{settings.APP_BASE_URL}/api/approve/{approve_tok}"
                reject_url = f"{settings.APP_BASE_URL}/api/approve/{reject_tok}"
        except Exception:
            pass

        def _notify():
            try:
                from app.services.email_service import send_desk_key_request_email
                send_desk_key_request_email(
                    user_email=email, employee_name=emp_name, employee_email=email,
                    desk_number=desk, reason=reason or "",
                    approve_url=approve_url, reject_url=reject_url,
                )
            except Exception:
                pass

        threading.Thread(target=_notify, daemon=True).start()
        return (
            f"Your desk key request for Desk {desk} has been submitted (Request #{req_id}). "
            "The Admin team will confirm the desk is available and notify you by email."
        )

    @staticmethod
    def _desk_key_decide(req_id: int, decision: str, decided_by: str, reason: str = "") -> dict:
        db = SessionLocal()
        try:
            req = db.query(DeskKeyRequest).filter(DeskKeyRequest.id == req_id).first()
            if not req:
                return {"ok": False, "error": "Request not found"}

            if decision == "Approved":
                # Re-check the desk isn't assigned to someone else in the meantime.
                clash = db.query(DeskKeyRequest).filter(
                    DeskKeyRequest.desk_number == req.desk_number,
                    DeskKeyRequest.status == "Approved",
                    DeskKeyRequest.employee_id != req.employee_id,
                ).first()
                if clash:
                    return {"ok": False, "error": f"Desk {req.desk_number} is already assigned to another employee."}
                req.assigned_at = datetime.datetime.utcnow()

            req.status = decision
            req.decided_by = decided_by
            req.decision_reason = reason or None
            emp = db.query(Employee).filter(Employee.id == req.employee_id).first()
            db.commit()
            info = {
                "ok": True,
                "employee_email": emp.email if emp else "",
                "employee_name": emp.name if emp else "",
                "desk_number": req.desk_number,
            }
        finally:
            db.close()

        try:
            from app.services.email_service import send_desk_key_decision_email
            if info.get("employee_email"):
                send_desk_key_decision_email(
                    user_email=decided_by or info["employee_email"],
                    employee_email=info["employee_email"], employee_name=info["employee_name"],
                    desk_number=info["desk_number"], decision=decision, reason=reason,
                )
        except Exception:
            pass
        return info

    @staticmethod
    def approve_desk_key(req_id: int, decided_by: str) -> dict:
        return AdminService._desk_key_decide(req_id, "Approved", decided_by)

    @staticmethod
    def reject_desk_key(req_id: int, decided_by: str, reason: str = "") -> dict:
        return AdminService._desk_key_decide(req_id, "Rejected", decided_by, reason)

    @staticmethod
    def release_desk_key(req_id: int, decided_by: str) -> dict:
        """Free a previously-assigned desk so it can be requested again."""
        db = SessionLocal()
        try:
            req = db.query(DeskKeyRequest).filter(DeskKeyRequest.id == req_id).first()
            if not req:
                return {"ok": False, "error": "Request not found"}
            req.status = "Released"
            req.released_at = datetime.datetime.utcnow()
            req.decided_by = decided_by
            db.commit()
            return {"ok": True, "desk_number": req.desk_number}
        finally:
            db.close()

    @staticmethod
    def build_office_supply_email(email: str, item_name: str):
        subject = f"Office Supply Request - {item_name}"
        body = (
            f"Dear Admin Team,\n\n"
            f"I would like to request the following office supply at the earliest convenience.\n\n"
            f"Details:\n"
            f"  Requested by: {email}\n"
            f"  Item requested: {item_name}\n\n"
            f"Please let me know if any additional information is required.\n\n"
            f"Thank you.\n\n"
            f"Best regards"
        )
        to = settings.NOTIFY_TO_EMAIL or settings.HELPDESK_EMAIL
        return {"to": to, "subject": subject, "body": body}

    @staticmethod
    def request_office_supply(email: str, item_name: str):
        import json
        draft = AdminService.build_office_supply_email(email, item_name)
        draft_json = json.dumps({"to": draft["to"], "subject": draft["subject"], "body": draft["body"]})
        return (
            f"I've prepared a request email for **{item_name}**. "
            f"Review and edit it below, then click Send.\n\n"
            f"[EMAIL_DRAFT_START]{draft_json}[EMAIL_DRAFT_END]"
        )

    @staticmethod
    def list_desk_keys(status: str | None = None) -> list[dict]:
        db = SessionLocal()
        try:
            q = db.query(DeskKeyRequest, Employee).join(
                Employee, DeskKeyRequest.employee_id == Employee.id
            ).order_by(DeskKeyRequest.created_at.desc())
            if status:
                q = q.filter(DeskKeyRequest.status == status)
            out = []
            for req, emp in q.all():
                out.append({
                    "id": req.id,
                    "employee_name": emp.name,
                    "employee_email": emp.email,
                    "desk_number": req.desk_number,
                    "reason": req.reason or "",
                    "status": req.status,
                    "decided_by": req.decided_by or "",
                    "decision_reason": req.decision_reason or "",
                    "assigned_at": req.assigned_at.isoformat() if req.assigned_at else None,
                    "released_at": req.released_at.isoformat() if req.released_at else None,
                    "created_at": req.created_at.isoformat() if req.created_at else None,
                })
            return out
        finally:
            db.close()
