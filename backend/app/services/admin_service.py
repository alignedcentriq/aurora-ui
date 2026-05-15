import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Employee, Reimbursement, ParkingSticker, Accommodation, FacilityComplaint, FoodVendorFeedback

class AdminService:
    @staticmethod
    def submit_reimbursement(email: str, type: str, amount: float, reason: str = ""):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            new_r = Reimbursement(
                employee_id=emp.id,
                type=type,
                amount=amount,
                reason=reason,
                status="Pending"
            )
            db.add(new_r)
            db.commit()
            return f"Reimbursement request of INR {amount:,.2f} for {type} submitted successfully."
        finally:
            db.close()

    @staticmethod
    def get_reimbursements(email: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            items = db.query(Reimbursement).filter(Reimbursement.employee_id == emp.id).all()
            if not items: return "No reimbursement requests found."
            
            lines = [f"- {r.type}: INR {r.amount:,.2f} ({r.status}) on {r.created_at.date()}" for r in items]
            return "Your reimbursement requests:\n" + "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def request_parking_sticker(email: str, vehicle_type: str, vehicle_number: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            new_s = ParkingSticker(
                employee_id=emp.id,
                vehicle_type=vehicle_type,
                vehicle_number=vehicle_number,
                valid_from=datetime.date.today(),
                valid_until=datetime.date.today() + datetime.timedelta(days=365),
                status="Pending"
            )
            db.add(new_s)
            db.commit()
            return f"Parking sticker request for your {vehicle_type} ({vehicle_number}) submitted successfully."
        finally:
            db.close()

    @staticmethod
    def get_parking_info(email: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            sticker = db.query(ParkingSticker).filter(ParkingSticker.employee_id == emp.id).first()
            if not sticker: return "No parking sticker records found."
            
            return f"Vehicle: {sticker.vehicle_number} ({sticker.vehicle_type}) | Status: {sticker.status} | Valid until: {sticker.valid_until}"
        finally:
            db.close()

    @staticmethod
    def request_accommodation(email: str, type: str, check_in: str, check_out: str, location: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            new_a = Accommodation(
                employee_id=emp.id,
                type=type,
                check_in=datetime.datetime.strptime(check_in, "%Y-%m-%d").date(),
                check_out=datetime.datetime.strptime(check_out, "%Y-%m-%d").date(),
                location=location,
                status="Pending"
            )
            db.add(new_a)
            db.commit()
            return f"Accommodation request at {location} from {check_in} to {check_out} submitted."
        finally:
            db.close()

    @staticmethod
    def submit_facility_complaint(email: str, category: str, description: str, location: str, priority: str = "Medium"):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            ticket_id = f"FC-{datetime.datetime.now().strftime('%m%d%H%M%S')}"
            new_c = FacilityComplaint(
                ticket_id=ticket_id,
                employee_id=emp.id,
                category=category,
                description=description,
                location=location,
                priority=priority,
                status="Open"
            )
            db.add(new_c)
            db.commit()
            return f"Complaint registered. Ticket ID: {ticket_id}. Our facility team will look into it."
        finally:
            db.close()

    @staticmethod
    def get_complaint_status(ticket_id: str):
        db = SessionLocal()
        try:
            c = db.query(FacilityComplaint).filter(FacilityComplaint.ticket_id == ticket_id).first()
            if not c: return "Complaint ticket not found."
            return f"Ticket: {c.ticket_id} | Status: {c.status} | Priority: {c.priority} | Location: {c.location}"
        finally:
            db.close()

    @staticmethod
    def submit_food_feedback(email: str, vendor_name: str, rating: int, comments: str = ""):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == email).first()
            if not emp: return "Employee not found."
            
            new_f = FoodVendorFeedback(
                employee_id=emp.id,
                vendor_name=vendor_name,
                rating=rating,
                food_quality=rating, # Simplified for mock
                hygiene=rating,
                service=rating,
                comments=comments
            )
            db.add(new_f)
            db.commit()
            return f"Thank you for your feedback on {vendor_name}!"
        finally:
            db.close()

    @staticmethod
    def get_vendor_ratings(vendor_name: str):
        db = SessionLocal()
        try:
            feedbacks = db.query(FoodVendorFeedback).filter(FoodVendorFeedback.vendor_name.ilike(f"%{vendor_name}%")).all()
            if not feedbacks: return f"No feedback found for {vendor_name}."
            
            avg_rating = sum(f.rating for f in feedbacks) / len(feedbacks)
            return f"Average rating for {vendor_name}: {avg_rating:.1f}/5.0 based on {len(feedbacks)} reviews."
        finally:
            db.close()
