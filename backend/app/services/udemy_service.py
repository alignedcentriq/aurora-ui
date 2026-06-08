import datetime
import secrets
import threading
import logging

from app.database import SessionLocal
from app.config import settings
from app.models import Employee, UdemyLicenseRequest, ApprovalToken
from app.services.admin_service import AdminService

logger = logging.getLogger(__name__)

_APPROVAL_TOKEN_TTL_HOURS = 24


_SUPPORTED_PLATFORMS = ("Udemy", "Coursera")


def normalize_platform(value: str) -> str:
    """Map free text to a canonical training platform. Defaults to 'Udemy'."""
    v = (value or "").strip().lower()
    for p in _SUPPORTED_PLATFORMS:
        if p.lower() in v:
            return p
    return "Udemy"


class UdemyService:
    """PMO-managed training-license requests — Udemy, Coursera, … (granted subject to availability)."""

    @staticmethod
    def _mint_action_tokens(entity_id: int, approver_email: str, employee_email: str) -> tuple[str, str]:
        approve_tok = secrets.token_urlsafe(32)
        reject_tok = secrets.token_urlsafe(32)
        expires = datetime.datetime.utcnow() + datetime.timedelta(hours=_APPROVAL_TOKEN_TTL_HOURS)
        db = SessionLocal()
        try:
            for tok, action in ((approve_tok, "approve"), (reject_tok, "reject")):
                db.add(ApprovalToken(
                    token=tok, entity_type="udemy_license", entity_id=entity_id, action=action,
                    approver_email=approver_email, employee_email=employee_email, expires_at=expires,
                ))
            db.commit()
        finally:
            db.close()
        return approve_tok, reject_tok

    @staticmethod
    def request_license(email: str, justification: str = "", course_name: str = "",
                        platform: str = "Udemy") -> str:
        platform = normalize_platform(platform)
        db = SessionLocal()
        try:
            emp = AdminService._get_or_create_employee(db, email)

            # Idempotency: block a new request if one is already open for this platform.
            existing = (
                db.query(UdemyLicenseRequest)
                .filter(
                    UdemyLicenseRequest.employee_id == emp.id,
                    UdemyLicenseRequest.platform == platform,
                    UdemyLicenseRequest.status.in_(["Pending", "Approved"]),
                )
                .order_by(UdemyLicenseRequest.created_at.desc())
                .first()
            )
            if existing:
                course_label = f" for **{existing.course_name}**" if existing.course_name else ""
                if existing.status == "Pending":
                    return (
                        f"You already have a {platform} license request{course_label} (Request #{existing.id}) "
                        f"pending PMO review. Please wait for it to be resolved before submitting a new one."
                    )
                else:
                    return (
                        f"Your {platform} license request{course_label} (Request #{existing.id}) was already **approved**. "
                        f"Contact the PMO team if you need a different course or an additional seat."
                    )

            req = UdemyLicenseRequest(
                employee_id=emp.id,
                platform=platform,
                course_name=(course_name or "").strip() or None,
                justification=(justification or "").strip() or None,
                status="Pending",
            )
            db.add(req)
            db.commit()
            db.refresh(req)
            req_id, emp_name = req.id, emp.name
        finally:
            db.close()

        # Notify the PMO team with approve/reject links (fire-and-forget).
        approve_url = reject_url = ""
        try:
            if settings.NOTIFY_TO_EMAIL:
                approve_tok, reject_tok = UdemyService._mint_action_tokens(
                    entity_id=req_id, approver_email=settings.NOTIFY_TO_EMAIL, employee_email=email,
                )
                approve_url = f"{settings.APP_BASE_URL}/api/approve/{approve_tok}"
                reject_url = f"{settings.APP_BASE_URL}/api/approve/{reject_tok}"
        except Exception as e:
            logger.warning("[udemy] Could not mint approval tokens for request %s: %s", req_id, e)

        def _notify():
            try:
                from app.services.email_service import send_udemy_request_email
                send_udemy_request_email(
                    user_email=email, employee_name=emp_name, employee_email=email,
                    course_name=course_name or "", justification=justification or "",
                    approve_url=approve_url, reject_url=reject_url, platform=platform,
                )
            except Exception as e:
                logger.warning("[udemy] PMO notification email failed for request %s: %s", req_id, e)

        threading.Thread(target=_notify, daemon=True).start()

        course_label = f" for '{course_name}'" if course_name else ""
        return (
            f"Your {platform} license request{course_label} has been submitted to the PMO team (Request #{req_id}). "
            "Licenses are provided subject to availability — you'll be notified by email once it's reviewed."
        )

    @staticmethod
    def _decide(req_id: int, decision: str, decided_by: str, reason: str = "") -> dict:
        db = SessionLocal()
        try:
            req = db.query(UdemyLicenseRequest).filter(UdemyLicenseRequest.id == req_id).first()
            if not req:
                return {"ok": False, "error": "Request not found"}
            req.status = decision
            req.decided_by = decided_by
            req.decision_reason = reason or None
            req.decided_at = datetime.datetime.utcnow()
            emp = db.query(Employee).filter(Employee.id == req.employee_id).first()
            db.commit()
            info = {
                "ok": True,
                "employee_email": emp.email if emp else "",
                "employee_name": emp.name if emp else "",
                "course_name": req.course_name or "",
                "platform": req.platform or "Udemy",
            }
        finally:
            db.close()

        # Notify the employee.
        try:
            from app.services.email_service import send_udemy_decision_email
            if info.get("employee_email"):
                send_udemy_decision_email(
                    user_email=decided_by or info["employee_email"],
                    employee_email=info["employee_email"], employee_name=info["employee_name"],
                    course_name=info["course_name"], decision=decision, reason=reason,
                    platform=info["platform"],
                )
        except Exception as e:
            logger.warning("[udemy] Decision email failed for request %s: %s", req_id, e)
        return info

    @staticmethod
    def approve(req_id: int, decided_by: str, reason: str = "") -> dict:
        return UdemyService._decide(req_id, "Approved", decided_by, reason)

    @staticmethod
    def reject(req_id: int, decided_by: str, reason: str = "") -> dict:
        return UdemyService._decide(req_id, "Rejected", decided_by, reason)

    @staticmethod
    def list_requests(status: str | None = None) -> list[dict]:
        db = SessionLocal()
        try:
            q = db.query(UdemyLicenseRequest, Employee).join(
                Employee, UdemyLicenseRequest.employee_id == Employee.id
            ).order_by(UdemyLicenseRequest.created_at.desc())
            if status:
                q = q.filter(UdemyLicenseRequest.status == status)
            out = []
            for req, emp in q.all():
                out.append({
                    "id": req.id,
                    "employee_name": emp.name,
                    "employee_email": emp.email,
                    "platform": req.platform or "Udemy",
                    "course_name": req.course_name or "",
                    "justification": req.justification or "",
                    "status": req.status,
                    "decided_by": req.decided_by or "",
                    "decision_reason": req.decision_reason or "",
                    "created_at": req.created_at.isoformat() if req.created_at else None,
                    "decided_at": req.decided_at.isoformat() if req.decided_at else None,
                })
            return out
        finally:
            db.close()
