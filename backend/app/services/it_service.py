import datetime
from app.database import SessionLocal
from app.models import Employee, ITTicket, SoftwareRequest, AssetAssignment, HITLRequest


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
    def request_software_install(email: str, software_name: str, justification: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            ticket_id = f"IT-SW-{datetime.datetime.now().strftime('%m%d%H%M%S')}"
            
            # Create IT Ticket
            new_t = ITTicket(
                ticket_id=ticket_id,
                employee_id=emp.id,
                category="Software Install",
                subject=f"Install {software_name}",
                description=justification,
                priority="Medium",
                status="Awaiting Approval",
                requires_admin_password=True
            )
            db.add(new_t)
            db.flush() # Get the ID
            
            # Create Software Request
            new_sw = SoftwareRequest(
                employee_id=emp.id,
                it_ticket_id=new_t.id,
                software_name=software_name,
                justification=justification,
                requires_admin=True,
                status="Pending"
            )
            db.add(new_sw)
            
            # Create HITL Request for admin
            new_hitl = HITLRequest(
                ticket_id=ticket_id,
                request_type="admin_password",
                status="Pending"
            )
            db.add(new_hitl)
            
            db.commit()
            return {
                "ticket_id": ticket_id,
                "message": f"Software installation request for '{software_name}' has been created (Ticket ID: {ticket_id}). This requires an admin password. I've initiated a Human-In-The-Loop (HITL) request to the IT Admin team."
            }
        finally:
            db.close()

    @staticmethod
    def mark_admin_password_provided(ticket_id: str, admin_email: str):
        db = SessionLocal()
        try:
            # Update IT Ticket
            ticket = db.query(ITTicket).filter(ITTicket.ticket_id == ticket_id).first()
            if not ticket: return "Ticket not found."
            
            ticket.admin_password_provided = True
            ticket.status = "In Progress"
            
            # Update HITL Request
            hitl = db.query(HITLRequest).filter(HITLRequest.ticket_id == ticket_id, HITLRequest.status == "Pending").first()
            if hitl:
                hitl.status = "Completed"
                hitl.completed_at = datetime.datetime.utcnow()
                hitl.completed_by = admin_email
            
            db.commit()
            return f"Admin password successfully recorded for ticket {ticket_id}. The installation is now 'In Progress'."
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
