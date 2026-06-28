"""
Travel Management Service — business logic for travel requests, expense claims, and settings.

Approval flow:
  Employee submits → status: pending_rm
  RM clicks approve email → status: rm_approved  (email token, 48h expiry)
  RM clicks reject email  → status: rm_rejected
  Admin approves via portal (with trip details, expense limit) → status: admin_approved
  Admin rejects via portal → status: admin_rejected
  Employee marks trip done + files expense → TravelExpenseClaim created
  Admin approves/rejects expense claim
"""

import datetime
import logging
import secrets
import threading
from app.database import SessionLocal
from app.config import settings
from app.models import Employee, TravelRequest, TravelExpenseClaim, TravelSettings

logger = logging.getLogger(__name__)


def _get_or_create_employee(db, email: str) -> Employee:
    emp = db.query(Employee).filter(Employee.email == email).first()
    if not emp:
        name = email.split("@")[0].replace(".", " ").replace("_", " ").title()
        emp = Employee(
            employee_id=f"EMP{abs(hash(email)) % 9000 + 1000}",
            name=name, email=email,
            department="General", designation="Employee",
            joining_date=datetime.date.today(),
            employment_type="Full-time", shift_type="Day",
        )
        db.add(emp)
        db.commit()
        db.refresh(emp)
    return emp


def _next_ref(db, model, prefix: str, col_name: str = "ref_id") -> str:
    from sqlalchemy import func
    col = getattr(model, col_name)
    like = f"{prefix}-%"
    row = db.query(func.max(col)).filter(col.like(like)).scalar()
    if row:
        try:
            n = int(row.split("-")[-1]) + 1
        except Exception:
            n = 1
    else:
        n = 1
    return f"{prefix}-{n:04d}"


def _fire_webhook(url: str, payload: dict) -> None:
    if not url:
        return
    def _post():
        try:
            import requests as _r
            _r.post(url, json=payload, timeout=10)
        except Exception:
            pass
    threading.Thread(target=_post, daemon=True).start()


# ── Travel Request ─────────────────────────────────────────────────────────────

def submit_travel_request(
    employee_email: str,
    business_reason: str,
    from_location: str,
    to_destination: str,
    travel_date: str,
    return_date: str = "",
    is_international: bool = False,
    visa_required: bool = False,
    mode_of_travel: str = "",
    accommodation_required: bool = False,
    estimated_cost: float = 0.0,
    notes: str = "",
) -> dict:
    """Submit a new travel request. Returns the created request summary."""
    db = SessionLocal()
    try:
        emp = _get_or_create_employee(db, employee_email)
        ref_id = _next_ref(db, TravelRequest, "TRVL")

        # Generate RM approval token (48h expiry)
        token = secrets.token_urlsafe(32)
        expires = datetime.datetime.utcnow() + datetime.timedelta(hours=48)

        try:
            t_date = datetime.date.fromisoformat(travel_date)
        except Exception:
            t_date = datetime.date.today()
        r_date = None
        if return_date:
            try:
                r_date = datetime.date.fromisoformat(return_date)
            except Exception:
                pass

        # Idempotency: an identical pending request raised moments ago is a double-submit.
        from app.services.idempotency import find_recent_duplicate
        dup = find_recent_duplicate(
            db, TravelRequest, window_seconds=120,
            employee_id=emp.id, from_location=from_location,
            to_destination=to_destination, travel_date=t_date, status="pending_rm",
        )
        if dup:
            return {
                "success": True, "ref_id": dup.ref_id, "id": dup.id,
                "rm_notified": False, "duplicate": True,
                "message": (
                    f"You just submitted a travel request to {to_destination} for {t_date} "
                    f"(**{dup.ref_id}**) — it's awaiting approval. I didn't create a duplicate."
                ),
            }

        req = TravelRequest(
            ref_id=ref_id,
            employee_id=emp.id,
            business_reason=business_reason,
            from_location=from_location,
            to_destination=to_destination,
            travel_date=t_date,
            return_date=r_date,
            is_international=is_international,
            visa_required=visa_required,
            mode_of_travel=mode_of_travel or "Flight",
            accommodation_required=accommodation_required,
            estimated_cost=estimated_cost,
            notes=notes,
            status="pending_rm",
            rm_approval_token=token,
            rm_token_expires_at=expires,
        )
        db.add(req)
        db.commit()
        db.refresh(req)

        # Look up RM email for approval email; fall back to NOTIFY_TO_EMAIL so email always fires
        rm_email = None
        try:
            from app.services.ms365_service import MS365Service
            rm_data = MS365Service.get_manager(employee_email)
            rm_email = (rm_data or {}).get("mail") or (rm_data or {}).get("email")
        except Exception as e:
            logger.warning("Could not fetch manager for %s: %s", employee_email, e)
        notify_target = rm_email or settings.NOTIFY_TO_EMAIL

        if notify_target:
            try:
                from app.services.email_service import send_travel_rm_approval_email
                base = settings.APP_BASE_URL
                approve_url = f"{base}/api/travel/rm-approve/{token}"
                reject_url = f"{base}/api/travel/rm-reject/{token}"
                send_travel_rm_approval_email(
                    user_email=employee_email,
                    employee_name=emp.name,
                    employee_email=employee_email,
                    ref_id=ref_id,
                    from_location=from_location,
                    to_destination=to_destination,
                    travel_date=str(t_date),
                    return_date=str(r_date) if r_date else "",
                    business_reason=business_reason,
                    estimated_cost=estimated_cost,
                    is_international=is_international,
                    mode=mode_of_travel or "Flight",
                    accommodation_required=accommodation_required,
                    notes=notes,
                    approve_url=approve_url,
                    reject_url=reject_url,
                    manager_email=notify_target,
                    travel_id=req.id,
                )
            except Exception as e:
                logger.error("Failed to send travel RM approval email for %s: %s", ref_id, e)

        return {
            "success": True,
            "ref_id": ref_id,
            "id": req.id,
            "rm_notified": bool(notify_target),
            "message": (
                f"Travel request {ref_id} submitted successfully. "
                + (f"Your reporting manager ({rm_email}) has been notified for approval."
                   if rm_email else "The admin team has been notified for approval.")
            ),
        }
    finally:
        db.close()


def get_my_travel_requests(employee_email: str) -> str:
    db = SessionLocal()
    try:
        emp = db.query(Employee).filter(Employee.email == employee_email).first()
        if not emp:
            return "No travel requests found."
        reqs = db.query(TravelRequest).filter(
            TravelRequest.employee_id == emp.id
        ).order_by(TravelRequest.created_at.desc()).all()
        if not reqs:
            return "You have no travel requests yet."
        lines = ["**Your Travel Requests**\n"]
        status_labels = {
            "pending_rm": "Pending RM Approval",
            "rm_approved": "RM Approved — Pending Admin",
            "rm_rejected": "Rejected by RM",
            "admin_approved": "Approved — Trip Details Sent",
            "admin_rejected": "Rejected by Admin",
            "completed": "Completed",
        }
        for r in reqs:
            label = status_labels.get(r.status, r.status)
            lines.append(
                f"- **{r.ref_id}** | {r.from_location} → {r.to_destination} | "
                f"{r.travel_date} | {label}"
            )
        return "\n".join(lines)
    finally:
        db.close()


# ── RM Approval (token-based, called from email link) ─────────────────────────

def rm_approve(token: str) -> dict:
    db = SessionLocal()
    try:
        req = db.query(TravelRequest).filter(TravelRequest.rm_approval_token == token).first()
        if not req:
            return {"ok": False, "message": "Invalid or already-used approval link."}
        if req.status != "pending_rm":
            return {"ok": False, "message": f"Request is already {req.status}."}
        if req.rm_token_expires_at and datetime.datetime.utcnow() > req.rm_token_expires_at:
            return {"ok": False, "message": "This approval link has expired."}

        req.status = "rm_approved"
        req.rm_decision_at = datetime.datetime.utcnow()
        req.rm_approval_token = None  # one-time use
        db.commit()
        db.refresh(req)

        emp = db.query(Employee).filter(Employee.id == req.employee_id).first()

        # Notify employee
        if emp:
            try:
                from app.services.email_service import send_travel_decision_email
                send_travel_decision_email(
                    user_email=emp.email, employee_name=emp.name,
                    employee_email=emp.email, ref_id=req.ref_id,
                    from_loc=req.from_location, to_loc=req.to_destination,
                    travel_date=str(req.travel_date), stage="RM", decision="Approved",
                )
            except Exception:
                pass

        # Notify admin
        try:
            from app.services.email_service import send_travel_admin_pending_email
            send_travel_admin_pending_email(
                user_email=emp.email if emp else employee_email_fallback(req),
                employee_name=emp.name if emp else "Employee",
                employee_email=emp.email if emp else "",
                ref_id=req.ref_id,
                from_location=req.from_location,
                to_destination=req.to_destination,
                travel_date=str(req.travel_date),
                return_date=str(req.return_date) if req.return_date else "",
                business_reason=req.business_reason,
                estimated_cost=req.estimated_cost or 0,
                is_international=req.is_international,
                mode=req.mode_of_travel or "",
                accommodation_required=req.accommodation_required,
                notes=req.notes or "",
                travel_id=req.id,
            )
        except Exception:
            pass

        return {"ok": True, "message": f"Travel request {req.ref_id} approved. Admin has been notified."}
    finally:
        db.close()


def rm_reject(token: str, reason: str = "") -> dict:
    db = SessionLocal()
    try:
        req = db.query(TravelRequest).filter(TravelRequest.rm_approval_token == token).first()
        if not req:
            return {"ok": False, "message": "Invalid or already-used link."}
        if req.status != "pending_rm":
            return {"ok": False, "message": f"Request is already {req.status}."}

        req.status = "rm_rejected"
        req.rm_decision_at = datetime.datetime.utcnow()
        req.rm_rejection_reason = reason
        req.rm_approval_token = None
        db.commit()
        db.refresh(req)

        emp = db.query(Employee).filter(Employee.id == req.employee_id).first()
        if emp:
            try:
                from app.services.email_service import send_travel_decision_email
                send_travel_decision_email(
                    user_email=emp.email, employee_name=emp.name,
                    employee_email=emp.email, ref_id=req.ref_id,
                    from_loc=req.from_location, to_loc=req.to_destination,
                    travel_date=str(req.travel_date), stage="RM", decision="Rejected",
                    reason=reason,
                )
            except Exception:
                pass

        return {"ok": True, "message": f"Travel request {req.ref_id} rejected."}
    finally:
        db.close()


def employee_email_fallback(req: TravelRequest) -> str:
    """Best-effort sender fallback when employee record is missing."""
    return settings.NOTIFY_TO_EMAIL or ""


# ── Admin Actions ──────────────────────────────────────────────────────────────

def admin_approve_travel(
    travel_id: int,
    decided_by: str,
    expense_limit: float = None,
    expense_limit_currency: str = "INR",
    ticket_details: str = "",
    hotel_details: str = "",
    visa_status: str = "",
) -> dict:
    db = SessionLocal()
    try:
        req = db.query(TravelRequest).filter(TravelRequest.id == travel_id).first()
        if not req:
            return {"ok": False, "detail": "Travel request not found."}
        if req.status not in ("rm_approved", "pending_rm"):
            return {"ok": False, "detail": f"Cannot approve — current status is {req.status}."}

        req.status = "admin_approved"
        req.admin_decision_by = decided_by
        req.admin_decision_at = datetime.datetime.utcnow()
        req.ticket_details = ticket_details
        req.hotel_details = hotel_details
        req.visa_status = visa_status
        if expense_limit is not None:
            req.expense_limit = expense_limit
            req.expense_limit_currency = expense_limit_currency or "INR"
        else:
            # Fall back to global currency so the employee sees the right symbol
            req.expense_limit_currency = _get_global_limit_currency(db)
        db.commit()
        db.refresh(req)

        emp = db.query(Employee).filter(Employee.id == req.employee_id).first()
        if emp:
            try:
                from app.services.email_service import send_travel_admin_approved_email
                send_travel_admin_approved_email(
                    user_email=decided_by,
                    employee_name=emp.name,
                    employee_email=emp.email,
                    ref_id=req.ref_id,
                    from_location=req.from_location,
                    to_destination=req.to_destination,
                    travel_date=str(req.travel_date),
                    return_date=str(req.return_date) if req.return_date else "",
                    ticket_details=ticket_details,
                    hotel_details=hotel_details,
                    visa_status=visa_status,
                    expense_limit=req.expense_limit,
                    decided_by=decided_by,
                )
            except Exception:
                pass

        return {"ok": True, "detail": f"Travel request {req.ref_id} approved and employee notified."}
    finally:
        db.close()


def admin_reject_travel(travel_id: int, decided_by: str, reason: str = "") -> dict:
    db = SessionLocal()
    try:
        req = db.query(TravelRequest).filter(TravelRequest.id == travel_id).first()
        if not req:
            return {"ok": False, "detail": "Travel request not found."}

        req.status = "admin_rejected"
        req.admin_decision_by = decided_by
        req.admin_decision_at = datetime.datetime.utcnow()
        req.admin_rejection_reason = reason
        db.commit()
        db.refresh(req)

        emp = db.query(Employee).filter(Employee.id == req.employee_id).first()
        if emp:
            try:
                from app.services.email_service import send_travel_decision_email
                send_travel_decision_email(
                    user_email=decided_by, employee_name=emp.name,
                    employee_email=emp.email, ref_id=req.ref_id,
                    from_loc=req.from_location, to_loc=req.to_destination,
                    travel_date=str(req.travel_date), stage="Admin", decision="Rejected",
                    reason=reason,
                )
            except Exception:
                pass

        return {"ok": True, "detail": f"Travel request {req.ref_id} rejected."}
    finally:
        db.close()


def list_travel_requests(status_filter: str = "") -> list:
    db = SessionLocal()
    try:
        q = db.query(TravelRequest, Employee).join(Employee, TravelRequest.employee_id == Employee.id)
        if status_filter:
            q = q.filter(TravelRequest.status == status_filter)
        rows = q.order_by(TravelRequest.created_at.desc()).all()
        result = []
        for r, emp in rows:
            result.append({
                "id": r.id,
                "ref_id": r.ref_id,
                "employee_name": emp.name,
                "employee_email": emp.email,
                "from_location": r.from_location,
                "to_destination": r.to_destination,
                "travel_date": r.travel_date.isoformat() if r.travel_date else None,
                "return_date": r.return_date.isoformat() if r.return_date else None,
                "is_international": r.is_international,
                "visa_required": r.visa_required,
                "mode_of_travel": r.mode_of_travel,
                "accommodation_required": r.accommodation_required,
                "estimated_cost": r.estimated_cost,
                "business_reason": r.business_reason,
                "notes": r.notes,
                "status": r.status,
                "expense_limit": r.expense_limit,
                "expense_limit_currency": r.expense_limit_currency or "INR",
                "ticket_details": r.ticket_details,
                "hotel_details": r.hotel_details,
                "visa_status": r.visa_status,
                "admin_rejection_reason": r.admin_rejection_reason,
                "rm_rejection_reason": r.rm_rejection_reason,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            })
        return result
    finally:
        db.close()


# ── Expense Claims ─────────────────────────────────────────────────────────────

def submit_expense_claim(
    employee_email: str,
    travel_ref_id: str,
    amount: float,
    currency: str = "INR",
    breakdown: str = "",
    over_limit_reason: str = "",
) -> dict:
    db = SessionLocal()
    try:
        emp = _get_or_create_employee(db, employee_email)
        req = db.query(TravelRequest).filter(TravelRequest.ref_id == travel_ref_id).first()
        if not req:
            return {"success": False, "message": f"Travel request {travel_ref_id} not found."}
        if req.employee_id != emp.id:
            return {"success": False, "message": "You can only file expenses for your own travel requests."}
        if req.status not in ("admin_approved", "completed"):
            return {"success": False, "message": f"Cannot file expenses — trip status is '{req.status}'. Admin must approve the trip first."}

        # Check against limit — only enforce when currencies match
        trip_limit = req.expense_limit
        limit_currency = req.expense_limit_currency or "INR"
        global_limit = _get_global_limit(db)
        global_currency = _get_global_limit_currency(db)
        effective_limit = trip_limit if trip_limit is not None else global_limit
        effective_currency = limit_currency if trip_limit is not None else global_currency

        same_currency = (currency or "INR").upper() == effective_currency.upper()
        if effective_limit and same_currency and amount > effective_limit and not over_limit_reason:
            return {
                "success": False,
                "over_limit": True,
                "limit": effective_limit,
                "limit_currency": effective_currency,
                "amount": amount,
                "currency": currency,
                "message": (
                    f"Claimed amount {effective_currency} {amount:,.0f} exceeds the limit of "
                    f"{effective_currency} {effective_limit:,.0f}. Please provide a reason for the excess."
                ),
            }

        # Idempotency: an identical claim filed moments ago is a double-submit.
        from app.services.idempotency import find_recent_duplicate
        dup = find_recent_duplicate(
            db, TravelExpenseClaim, window_seconds=120,
            travel_request_id=req.id, employee_id=emp.id, amount=amount, status="Pending",
        )
        if dup:
            return {
                "success": True, "ref_id": dup.ref_id, "duplicate": True,
                "message": (
                    f"You just filed an expense claim of {currency} {amount:,.0f} for "
                    f"{travel_ref_id} (**{dup.ref_id}**). I didn't create a duplicate."
                ),
            }

        ref_id = _next_ref(db, TravelExpenseClaim, "TEXPC")
        claim = TravelExpenseClaim(
            ref_id=ref_id,
            travel_request_id=req.id,
            employee_id=emp.id,
            amount=amount,
            currency=currency or "INR",
            breakdown=breakdown,
            over_limit_reason=over_limit_reason,
            status="Pending",
        )
        db.add(claim)
        db.commit()
        db.refresh(claim)

        # Notify admin
        try:
            from app.services.email_service import send_travel_expense_submitted_email
            send_travel_expense_submitted_email(
                user_email=employee_email,
                employee_name=emp.name,
                employee_email=employee_email,
                expense_ref=ref_id,
                travel_ref=travel_ref_id,
                from_location=req.from_location,
                to_destination=req.to_destination,
                amount=amount,
                breakdown=breakdown,
                over_limit_reason=over_limit_reason,
                limit=effective_limit,
                claim_id=claim.id,
            )
        except Exception:
            pass

        return {
            "success": True,
            "ref_id": ref_id,
            "message": f"Expense claim {ref_id} submitted for {currency} {amount:,.0f}. Admin will review it shortly.",
        }
    finally:
        db.close()


def admin_approve_expense(claim_id: int, decided_by: str) -> dict:
    db = SessionLocal()
    try:
        claim = db.query(TravelExpenseClaim).filter(TravelExpenseClaim.id == claim_id).first()
        if not claim:
            return {"ok": False, "detail": "Claim not found."}
        claim.status = "Approved"
        claim.approved_by = decided_by
        claim.updated_at = datetime.datetime.utcnow()
        # Mark the travel request as completed
        req = db.query(TravelRequest).filter(TravelRequest.id == claim.travel_request_id).first()
        if req:
            req.status = "completed"
        db.commit()
        db.refresh(claim)

        emp = db.query(Employee).filter(Employee.id == claim.employee_id).first()
        if emp and req:
            try:
                from app.services.email_service import send_travel_expense_decision_email
                send_travel_expense_decision_email(
                    user_email=decided_by, employee_name=emp.name,
                    employee_email=emp.email, expense_ref=claim.ref_id,
                    travel_ref=req.ref_id, amount=claim.amount,
                    decision="Approved", decided_by=decided_by,
                )
            except Exception:
                pass

        return {"ok": True, "detail": f"Expense claim {claim.ref_id} approved."}
    finally:
        db.close()


def admin_reject_expense(claim_id: int, decided_by: str, reason: str = "") -> dict:
    db = SessionLocal()
    try:
        claim = db.query(TravelExpenseClaim).filter(TravelExpenseClaim.id == claim_id).first()
        if not claim:
            return {"ok": False, "detail": "Claim not found."}
        claim.status = "Rejected"
        claim.rejection_reason = reason
        claim.updated_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(claim)

        req = db.query(TravelRequest).filter(TravelRequest.id == claim.travel_request_id).first()
        emp = db.query(Employee).filter(Employee.id == claim.employee_id).first()
        if emp and req:
            try:
                from app.services.email_service import send_travel_expense_decision_email
                send_travel_expense_decision_email(
                    user_email=decided_by, employee_name=emp.name,
                    employee_email=emp.email, expense_ref=claim.ref_id,
                    travel_ref=req.ref_id, amount=claim.amount,
                    decision="Rejected", decided_by=decided_by, reason=reason,
                )
            except Exception:
                pass

        return {"ok": True, "detail": f"Expense claim {claim.ref_id} rejected."}
    finally:
        db.close()


def list_expense_claims(status_filter: str = "") -> list:
    db = SessionLocal()
    try:
        q = db.query(TravelExpenseClaim, TravelRequest, Employee).join(
            TravelRequest, TravelExpenseClaim.travel_request_id == TravelRequest.id
        ).join(Employee, TravelExpenseClaim.employee_id == Employee.id)
        if status_filter:
            q = q.filter(TravelExpenseClaim.status == status_filter)
        rows = q.order_by(TravelExpenseClaim.created_at.desc()).all()
        return [
            {
                "id": c.id, "ref_id": c.ref_id,
                "travel_ref": r.ref_id,
                "employee_name": emp.name, "employee_email": emp.email,
                "from_location": r.from_location, "to_destination": r.to_destination,
                "amount": c.amount, "currency": c.currency or "INR",
                "breakdown": c.breakdown,
                "over_limit_reason": c.over_limit_reason,
                "expense_limit": r.expense_limit,
                "expense_limit_currency": r.expense_limit_currency or "INR",
                "status": c.status,
                "approved_by": c.approved_by,
                "rejection_reason": c.rejection_reason,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c, r, emp in rows
        ]
    finally:
        db.close()


# ── Settings ───────────────────────────────────────────────────────────────────

def _get_global_limit(db) -> float | None:
    row = db.query(TravelSettings).filter(TravelSettings.key == "global_expense_limit").first()
    if row and row.value:
        try:
            return float(row.value)
        except Exception:
            pass
    return None


def _get_global_limit_currency(db) -> str:
    row = db.query(TravelSettings).filter(TravelSettings.key == "global_expense_limit_currency").first()
    return row.value if row and row.value else "INR"


def _upsert_setting(db, key: str, value: str | None):
    row = db.query(TravelSettings).filter(TravelSettings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(TravelSettings(key=key, value=value))


def get_travel_settings() -> dict:
    db = SessionLocal()
    try:
        limit = _get_global_limit(db)
        currency = _get_global_limit_currency(db)
        return {"global_expense_limit": limit, "global_expense_limit_currency": currency}
    finally:
        db.close()


def set_global_expense_limit(limit: float | None, currency: str = "INR") -> dict:
    db = SessionLocal()
    try:
        _upsert_setting(db, "global_expense_limit", str(limit) if limit is not None else None)
        _upsert_setting(db, "global_expense_limit_currency", currency or "INR")
        db.commit()
        return {"ok": True, "global_expense_limit": limit, "global_expense_limit_currency": currency}
    finally:
        db.close()
