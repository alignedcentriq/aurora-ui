import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Employee, Leave, Policy

class HRService:
    @staticmethod
    def get_employee_by_email(db: Session, email: str) -> Employee:
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
                location="Mumbai",
                shift_type="Day",
            )
            db.add(emp)
            db.commit()
            db.refresh(emp)
        return emp

    @staticmethod
    def get_leave_balance(email: str):
        db = SessionLocal()
        try:
            emp = HRService.get_employee_by_email(db, email)
            
            # Simple logic: 24 days annual - approved leaves
            approved_leaves = db.query(Leave).filter(
                Leave.employee_id == emp.id, 
                Leave.status == "Approved"
            ).all()
            used = len(approved_leaves)
            balance = 24 - used
            return f"You have {balance} days of leave remaining (Used: {used} days)."
        finally:
            db.close()

    @staticmethod
    def apply_leave(email: str, start_date: str, end_date: str, leave_type: str, reason: str = "Applied via AI Assistant"):
        db = SessionLocal()
        try:
            emp = HRService.get_employee_by_email(db, email)
            
            try:
                start_dt = datetime.datetime.strptime(start_date, "%Y-%m-%d").date()
                end_dt = datetime.datetime.strptime(end_date, "%Y-%m-%d").date()
            except ValueError:
                return "Invalid date format. Please use YYYY-MM-DD."

            new_leave = Leave(
                employee_id=emp.id,
                leave_type=leave_type,
                start_date=start_dt,
                end_date=end_dt,
                status="Pending",
                reason=reason
            )
            db.add(new_leave)
            db.commit()
            return f"Success! Your {leave_type} leave request from {start_date} to {end_date} has been submitted for approval."
        finally:
            db.close()


    @staticmethod
    def upsert_policy(title: str, content: str, category: str = "General"):
        db = SessionLocal()
        try:
            policy = db.query(Policy).filter(Policy.title.ilike(title)).first()
            if policy:
                policy.content = content
                policy.category = category
            else:
                policy = Policy(title=title, content=content, category=category)
                db.add(policy)
            db.commit()
            return True
        finally:
            db.close()

    @staticmethod
    def search_policies(query: str):
        """Search policies using the enhanced PolicyService (real documents)."""
        try:
            from app.services.policy_service import PolicyService
            return PolicyService.search_policies(query)
        except Exception as e:
            # Fallback to basic search if PolicyService fails
            db = SessionLocal()
            try:
                policies = db.query(Policy).all()
                query_words = [w.lower() for w in query.split() if len(w) > 3]
                if not query_words:
                    query_words = [query.lower()]
                    
                relevant = []
                for p in policies:
                    text = (p.title + " " + (p.content or "")).lower()
                    score = sum(1 for w in query_words if w in text)
                    if score > 0:
                        relevant.append((score, p))
                        
                if not relevant:
                    available_titles = "\n".join([f"- {p.title}" for p in policies])
                    return f"No specific policy found for your query. Available policies:\n{available_titles}"
                
                relevant.sort(key=lambda x: x[0], reverse=True)
                top_policies = [p for score, p in relevant[:3]]
                
                return "\n\n".join([f"**{p.title}**\n{(p.content or '')[:500]}..." for p in top_policies])
            finally:
                db.close()
