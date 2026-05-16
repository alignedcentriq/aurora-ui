from app.database import SessionLocal
from app.models import Employee


class ManagerService:
    @staticmethod
    def get_reportees(manager_email: str):
        db = SessionLocal()
        try:
            manager = db.query(Employee).filter(Employee.email == manager_email).first()
            if not manager:
                return "Manager not found."

            reportees = db.query(Employee).filter(Employee.manager_id == manager.id).all()
            if not reportees:
                return "No direct reportees found for you."

            lines = [f"- {e.name} ({e.designation}, {e.department})" for e in reportees]
            return f"Your team ({len(reportees)} members):\n" + "\n".join(lines)
        finally:
            db.close()
