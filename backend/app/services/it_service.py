import datetime
import urllib.parse
from app.config import settings
from app.database import SessionLocal
from app.models import Employee, ITTicket, AssetAssignment, HITLRequest


class ITService:
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
    @staticmethod
    def create_ticket(email: str, category: str, subject: str, description: str, priority: str = "Medium"):
        db = SessionLocal()
        try:
            emp = ITService._get_or_create_employee(db, email)

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
                    user_email=email,
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
            emp = ITService._get_or_create_employee(db, email)

            tickets = db.query(ITTicket).filter(ITTicket.employee_id == emp.id).all()
            if not tickets: return "You have no active IT support tickets."
            
            lines = [f"- {t.ticket_id}: {t.subject} ({t.status})" for t in tickets]
            return "Your IT support tickets:\n" + "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def request_software_install_mailto_legacy(email: str, software_name: str):
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
    def build_software_install_email(email: str, software_name: str):
        subject = f"Software Installation Request - {software_name}"
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
        return {"to": settings.HELPDESK_EMAIL, "subject": subject, "body": body}

    # Generic nouns that are NOT a specific product. When the user says
    # "install software" / "an app" / "some program", these get mis-extracted as
    # the product name — we must ask which one instead of drafting an email for a
    # product literally named "software".
    _GENERIC_SOFTWARE_WORDS = frozenset({
        "software", "softwares", "app", "apps", "application", "applications",
        "program", "programs", "programme", "programmes", "tool", "tools",
        "package", "packages", "something", "anything", "stuff", "it", "this",
        "that",
    })

    @staticmethod
    def _looks_like_software_name(software_name: str) -> bool:
        """Reject sentences / non-product phrases that get mis-extracted into software_name."""
        s = (software_name or "").strip()
        if not s:
            return False
        lowered = s.lower()
        # Phrases that signal a mis-routed request rather than a product name.
        bad_leads = ("to ", "i ", "a ", "an ", "the ", "please ", "request ", "need ", "want ")
        if lowered.startswith(bad_leads):
            return False
        # Real product names are short; full sentences are not.
        if len(s.split()) > 5:
            return False
        # A bare generic noun ("software", "app", "program") names no product.
        if lowered in ITService._GENERIC_SOFTWARE_WORDS:
            return False
        return True

    @staticmethod
    def request_software_install(email: str, software_name: str):
        import json
        if not ITService._looks_like_software_name(software_name):
            return (
                "I couldn't tell which software you'd like installed. "
                "Please tell me the exact application name (for example: Node.js, Figma, or Docker)."
            )
        draft = ITService.build_software_install_email(email, software_name)
        draft_json = json.dumps({"to": draft["to"], "subject": draft["subject"], "body": draft["body"]})
        return (
            f"I've prepared this email to IT Support for **{software_name}**. "
            f"Review and edit it below, then click Send.\n\n"
            f"[EMAIL_DRAFT_START]{draft_json}[EMAIL_DRAFT_END]"
        )

    @staticmethod
    def send_software_install_request(email: str, software_name: str):
        draft = ITService.build_software_install_email(email, software_name)
        try:
            from app.services.email_service import send_software_install_email
            sent = send_software_install_email(
                user_email=email,
                software_name=software_name,
                subject=draft["subject"],
                body=draft["body"],
            )
        except Exception:
            sent = False

        if not sent:
            return (
                "I prepared the email, but I could not send it because the mail service is not available "
                "or SMTP credentials are not configured correctly. Please try again after mail settings are fixed."
            )

        return (
            f"Done. I sent the software installation request for **{software_name}** to IT Support "
            f"and copied **{email}**."
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
            emp = ITService._get_or_create_employee(db, email)

            assets = db.query(AssetAssignment).filter(AssetAssignment.employee_id == emp.id, AssetAssignment.status == "Assigned").all()
            if not assets: return "No IT assets assigned to you."
            
            lines = [f"- {a.asset_type}: {a.brand} {a.model} (Tag: {a.asset_tag})" for a in assets]
            return "Your assigned IT assets:\n" + "\n".join(lines)
        finally:
            db.close()
