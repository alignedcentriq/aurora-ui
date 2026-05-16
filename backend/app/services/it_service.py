import datetime
import urllib.parse
from app.config import settings
from app.database import SessionLocal
from app.models import Employee, ITTicket, AssetAssignment, HITLRequest


class ITService:
    @staticmethod
    def create_ticket(email: str, category: str, subject: str, description: str, priority: str = "Medium"):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp:
                return "Employee not found."

            ticket_id = f"IT-{datetime.datetime.now().strftime('%m%d%H%M%S')}"
            new_t = ITTicket(
                ticket_id=ticket_id,
                employee_id=emp.id,
                category=category,
                subject=subject,
                description=description,
                priority=priority,
                status="Open",
            )
            db.add(new_t)
            db.commit()

            # Send email to helpdesk — ManageEngine auto-creates ticket from this
            try:
                from app.services.email_service import send_it_ticket_email
                send_it_ticket_email(
                    employee_name=emp.name,
                    employee_email=emp.email,
                    employee_id=emp.employee_id or str(emp.id),
                    department=emp.department or "N/A",
                    category=category,
                    subject=subject,
                    description=description,
                    priority=priority,
                    ticket_id=ticket_id,
                )
            except Exception:
                pass  # email failure must never block ticket creation

            return (
                f"IT Support Ticket created. **Ticket ID: {ticket_id}**. "
                f"Your request has been sent to the helpdesk and a ticket will be created in ManageEngine. "
                f"An IT executive will be assigned to you shortly."
            )
        finally:
            db.close()

    @staticmethod
    def get_ticket_status(ticket_id: str):
        db = SessionLocal()
        try:
            t = db.query(ITTicket).filter(ITTicket.ticket_id == ticket_id).first()
            if not t: return "IT ticket not found."
            return f"Ticket: {t.ticket_id} | Subject: {t.subject} | Status: {t.status} | Priority: {t.priority}"
        finally:
            db.close()

    @staticmethod
    def get_my_tickets(email: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            tickets = db.query(ITTicket).filter(ITTicket.employee_id == emp.id).all()
            if not tickets: return "You have no active IT support tickets."
            
            lines = [f"- {t.ticket_id}: {t.subject} ({t.status})" for t in tickets]
            return "Your IT support tickets:\n" + "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def request_software_install(email: str, software_name: str):
        subject = f"Software Installation Request – {software_name}"
        body = (
            f"Dear IT Support Team,\n\n"
            f"I hope this message finds you well.\n\n"
            f"I would like to request the installation of {software_name} on my workstation "
            f"at the earliest convenience.\n\n"
            f"Details:\n"
            f"  Requested by: {email}\n"
            f"  Software required: {software_name}\n\n"
            f"Please let me know if any additional approvals or information are required.\n\n"
            f"Thank you for your assistance.\n\n"
            f"Best regards"
        )
        mailto_url = (
            f"mailto:{settings.HELPDESK_EMAIL}"
            f"?subject={urllib.parse.quote(subject)}"
            f"&body={urllib.parse.quote(body)}"
        )
        return (
            f"I've prepared a professional email to the IT support team requesting installation of **{software_name}**.\n\n"
            f"[Open in Outlook to send]({mailto_url})\n\n"
            f"Click the link above — it will open your Outlook with the email pre-filled and ready to send."
        )

    @staticmethod
    def approve_hitl_request(ticket_id: str, approved_by: str):
        """Mark a pending HITL software-install request as approved."""
        db = SessionLocal()
        try:
            ticket = db.query(ITTicket).filter(ITTicket.ticket_id == ticket_id).first()
            if not ticket:
                return "Ticket not found."

            ticket.status = "In Progress"

            hitl = db.query(HITLRequest).filter(
                HITLRequest.ticket_id == ticket_id,
                HITLRequest.status == "Pending",
            ).first()
            if hitl:
                hitl.status = "Completed"
                hitl.completed_at = datetime.datetime.utcnow()
                hitl.completed_by = approved_by

            db.commit()
            return f"Ticket {ticket_id} approved by {approved_by}. Status is now 'In Progress'."
        finally:
            db.close()

    @staticmethod
    def get_my_assets(email: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            assets = db.query(AssetAssignment).filter(AssetAssignment.employee_id == emp.id, AssetAssignment.status == "Assigned").all()
            if not assets: return "No IT assets assigned to you."
            
            lines = [f"- {a.asset_type}: {a.brand} {a.model} (Tag: {a.asset_tag})" for a in assets]
            return "Your assigned IT assets:\n" + "\n".join(lines)
        finally:
            db.close()
