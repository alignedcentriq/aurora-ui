"""Parking payment ledger + reminder system.

Admin sets global monthly costs (2-wheeler / 4-wheeler) and a single reminder
cadence (weekly / monthly / quarterly). A daily background loop accrues one
monthly charge per active sticker holder and emails reminders on the cadence.
Admin can mark individual months paid, close them, or settle in full.
"""

import datetime
import logging
import threading

from app.database import SessionLocal
from app.config import settings
from app.models import Employee, ParkingSticker, ParkingPayment
from app.services.company_settings_service import CompanySettingsService

logger = logging.getLogger(__name__)

# CompanySettings keys
K_COST_2W = "parking_2wheeler_monthly_cost"
K_COST_4W = "parking_4wheeler_monthly_cost"
K_CADENCE = "parking_reminder_cadence"          # weekly | monthly | quarterly
K_LAST_RUN = "parking_reminder_last_run"        # ISO date (loop bookkeeping)

_CADENCE_DAYS = {"weekly": 7, "monthly": 30, "quarterly": 90}


def _first_of_month(d: datetime.date) -> datetime.date:
    return d.replace(day=1)


def _add_month(d: datetime.date) -> datetime.date:
    """First day of the month after `d` (which must be a first-of-month date)."""
    return (d.replace(day=28) + datetime.timedelta(days=7)).replace(day=1)


def _is_two_wheeler(vehicle_type: str) -> bool:
    return "2" in (vehicle_type or "") or "two" in (vehicle_type or "").lower()


def _cost_for(vehicle_type: str) -> float:
    raw = CompanySettingsService.get(K_COST_2W if _is_two_wheeler(vehicle_type) else K_COST_4W)
    try:
        return float(raw) if raw else 0.0
    except (TypeError, ValueError):
        return 0.0


class ParkingPaymentService:

    # ── Settings ──────────────────────────────────────────────────────────────

    @staticmethod
    def get_settings() -> dict:
        return {
            "two_wheeler_cost": _cost_for("2-wheeler"),
            "four_wheeler_cost": _cost_for("4-wheeler"),
            "cadence": CompanySettingsService.get(K_CADENCE) or "monthly",
            "last_run": CompanySettingsService.get(K_LAST_RUN) or "",
        }

    @staticmethod
    def format_charges() -> str:
        """Human-readable summary of the admin-configured monthly parking charges."""
        two = _cost_for("2-wheeler")
        four = _cost_for("4-wheeler")
        if two <= 0 and four <= 0:
            return ("Parking charges haven't been configured yet. "
                    "Please check with the Admin team.")
        two_line = f"INR {two:,.0f} / month" if two > 0 else "not configured yet"
        four_line = f"INR {four:,.0f} / month" if four > 0 else "not configured yet"
        return (
            "**Parking Charges**\n\n"
            f"- 🛵 **2-Wheeler:** {two_line}\n"
            f"- 🚗 **4-Wheeler:** {four_line}\n\n"
            "_Charges are billed per active parking sticker. Contact the Admin team for any queries._"
        )

    @staticmethod
    def set_costs(two_wheeler: float, four_wheeler: float, by: str = "") -> None:
        CompanySettingsService.set(K_COST_2W, str(float(two_wheeler)), updated_by=by)
        CompanySettingsService.set(K_COST_4W, str(float(four_wheeler)), updated_by=by)

    @staticmethod
    def set_cadence(cadence: str, by: str = "") -> None:
        cadence = (cadence or "").lower().strip()
        if cadence not in _CADENCE_DAYS:
            cadence = "monthly"
        CompanySettingsService.set(K_CADENCE, cadence, updated_by=by)

    # ── Accrual ────────────────────────────────────────────────────────────────

    @staticmethod
    def accrue_dues() -> int:
        """Ensure a ParkingPayment row exists for every elapsed month of each active
        sticker, from valid_from through the current month. Idempotent. Returns rows created."""
        db = SessionLocal()
        created = 0
        try:
            today_first = _first_of_month(datetime.date.today())
            stickers = db.query(ParkingSticker).filter(ParkingSticker.status == "Active").all()
            for st in stickers:
                cost = _cost_for(st.vehicle_type)
                if cost <= 0:
                    continue  # no configured price for this vehicle type yet
                start = _first_of_month(st.valid_from or datetime.date.today())
                # Existing periods for this sticker holder
                existing = {
                    p.period_month for p in db.query(ParkingPayment).filter(
                        ParkingPayment.employee_id == st.employee_id
                    ).all()
                }
                month = start
                while month <= today_first:
                    if month not in existing:
                        db.add(ParkingPayment(
                            employee_id=st.employee_id,
                            parking_sticker_id=st.id,
                            period_month=month,
                            vehicle_type=st.vehicle_type,
                            amount_due=cost,
                            amount_paid=0.0,
                            status="Due",
                        ))
                        created += 1
                    month = _add_month(month)
            if created:
                db.commit()
        except Exception as e:
            db.rollback()
            logger.warning("[parking] accrue_dues error: %s", e)
        finally:
            db.close()
        return created

    # ── Queries ────────────────────────────────────────────────────────────────

    @staticmethod
    def get_outstanding(email: str) -> dict:
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp:
                return {"total": 0.0, "months": []}
            rows = db.query(ParkingPayment).filter(
                ParkingPayment.employee_id == emp.id,
                ParkingPayment.status == "Due",
            ).order_by(ParkingPayment.period_month).all()
            months = [(p.period_month.strftime("%b %Y"), float(p.amount_due)) for p in rows]
            total = sum(float(p.amount_due) for p in rows)
            return {"total": total, "months": months}
        finally:
            db.close()

    @staticmethod
    def list_holders_with_dues() -> list[dict]:
        """One entry per active sticker holder with their full payment breakdown."""
        db = SessionLocal()
        try:
            out = []
            stickers = db.query(ParkingSticker, Employee).join(
                Employee, ParkingSticker.employee_id == Employee.id
            ).filter(ParkingSticker.status == "Active").all()
            seen = set()
            for st, emp in stickers:
                if emp.id in seen:
                    continue
                seen.add(emp.id)
                payments = db.query(ParkingPayment).filter(
                    ParkingPayment.employee_id == emp.id
                ).order_by(ParkingPayment.period_month).all()
                outstanding = sum(float(p.amount_due) for p in payments if p.status == "Due")
                out.append({
                    "employee_name": emp.name,
                    "employee_email": emp.email,
                    "vehicle_type": st.vehicle_type,
                    "vehicle_number": st.vehicle_number,
                    "outstanding": outstanding,
                    "monthly_cost": _cost_for(st.vehicle_type),
                    "payments": [
                        {
                            "id": p.id,
                            "month": p.period_month.strftime("%b %Y"),
                            "amount_due": float(p.amount_due),
                            "amount_paid": float(p.amount_paid or 0),
                            "status": p.status,
                        }
                        for p in payments
                    ],
                })
            return out
        finally:
            db.close()

    # ── Closing payments ─────────────────────────────────────────────────────────

    @staticmethod
    def mark_month_paid(payment_id: int, by: str = "") -> dict:
        db = SessionLocal()
        try:
            p = db.query(ParkingPayment).filter(ParkingPayment.id == payment_id).first()
            if not p:
                return {"ok": False, "error": "Payment not found"}
            p.status = "Paid"
            p.amount_paid = p.amount_due
            p.paid_at = datetime.datetime.utcnow()
            p.closed_by = by or None
            db.commit()
            return {"ok": True}
        finally:
            db.close()

    @staticmethod
    def close_payment(payment_id: int, by: str = "") -> dict:
        db = SessionLocal()
        try:
            p = db.query(ParkingPayment).filter(ParkingPayment.id == payment_id).first()
            if not p:
                return {"ok": False, "error": "Payment not found"}
            p.status = "Closed"
            p.closed_by = by or None
            db.commit()
            return {"ok": True}
        finally:
            db.close()

    @staticmethod
    def pay_full(email: str, by: str = "") -> dict:
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp:
                return {"ok": False, "error": "Employee not found"}
            rows = db.query(ParkingPayment).filter(
                ParkingPayment.employee_id == emp.id,
                ParkingPayment.status == "Due",
            ).all()
            for p in rows:
                p.status = "Paid"
                p.amount_paid = p.amount_due
                p.paid_at = datetime.datetime.utcnow()
                p.closed_by = by or None
            db.commit()
            return {"ok": True, "count": len(rows)}
        finally:
            db.close()

    # ── Reminders ─────────────────────────────────────────────────────────────

    @staticmethod
    def _reminder_sender() -> str:
        return getattr(settings, "PARKING_REMINDER_SENDER", "") or settings.NOTIFY_TO_EMAIL or ""

    @staticmethod
    def send_reminder_now(email: str, sender: str | None = None) -> dict:
        """Send a reminder to a single holder. `sender` is the mailbox to send FROM
        (defaults to the configured reminder sender)."""
        info = ParkingPaymentService.get_outstanding(email)
        if info["total"] <= 0:
            return {"ok": False, "error": "No outstanding dues for this employee."}
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            st = db.query(ParkingSticker).filter(
                ParkingSticker.employee_id == emp.id, ParkingSticker.status == "Active"
            ).first() if emp else None
            name = emp.name if emp else email
            vehicle_number = st.vehicle_number if st else ""
            monthly_cost = _cost_for(st.vehicle_type) if st else 0.0
        finally:
            db.close()

        from app.services.email_service import send_parking_payment_reminder_email
        ok = send_parking_payment_reminder_email(
            user_email=sender or ParkingPaymentService._reminder_sender(),
            employee_name=name, employee_email=email, vehicle_number=vehicle_number,
            outstanding_total=info["total"], months=info["months"], monthly_cost=monthly_cost,
        )
        return {"ok": bool(ok)}

    @staticmethod
    def send_all_reminders(sender: str | None = None) -> int:
        """Send reminders to every holder with outstanding dues. Returns count sent."""
        sent = 0
        for holder in ParkingPaymentService.list_holders_with_dues():
            if holder["outstanding"] > 0:
                res = ParkingPaymentService.send_reminder_now(holder["employee_email"], sender=sender)
                if res.get("ok"):
                    sent += 1
        return sent


# ── Background loop ───────────────────────────────────────────────────────────

def parking_reminder_loop():
    """Daily tick: accrue dues, then send reminders if the cadence interval has elapsed."""
    # Stagger the first run slightly so startup isn't blocked.
    threading.Event().wait(60)
    while True:
        try:
            ParkingPaymentService.accrue_dues()
            cadence = (CompanySettingsService.get(K_CADENCE) or "monthly").lower()
            interval = _CADENCE_DAYS.get(cadence, 30)
            last_run_raw = CompanySettingsService.get(K_LAST_RUN)
            due = True
            if last_run_raw:
                try:
                    last = datetime.date.fromisoformat(last_run_raw[:10])
                    due = (datetime.date.today() - last).days >= interval
                except ValueError:
                    due = True
            if due:
                sent = ParkingPaymentService.send_all_reminders()
                CompanySettingsService.set(K_LAST_RUN, datetime.date.today().isoformat(), updated_by="system")
                logger.info("[parking] reminder run complete — %s reminders sent (cadence=%s)", sent, cadence)
            else:
                logger.info("[parking] reminder skipped — next run in <%s days (cadence=%s)", interval, cadence)
        except Exception as e:
            logger.warning("[parking] reminder loop error: %s", e)
        threading.Event().wait(86400)  # 24h
