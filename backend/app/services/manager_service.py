import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Employee, Attendance, Leave, TrainingAssignment, EmployeeSkillMap, ProjectAssignment

class ManagerService:
    @staticmethod
    def get_reportees(manager_email: str):
        db = SessionLocal()
        try:
            manager = db.query(Employee).filter(Employee.email == manager_email).first()
            if not manager: return "Manager not found."
            
            reportees = db.query(Employee).filter(Employee.reporting_manager_id == manager.id).all()
            if not reportees: return "No direct reportees found for you."
            
            lines = [f"- {e.name} ({e.designation})" for e in reportees]
            return f"Your team ({len(reportees)} members):\n" + "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def get_team_attendance(manager_email: str, date_str: str = None):
        db = SessionLocal()
        try:
            manager = db.query(Employee).filter(Employee.email == manager_email).first()
            if not manager: return "Manager not found."
            
            target_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else datetime.date.today()
            
            reportees = db.query(Employee).filter(Employee.reporting_manager_id == manager.id).all()
            if not reportees: return "No direct reportees found."
            
            reportee_ids = [e.id for e in reportees]
            attendances = db.query(Attendance).filter(
                Attendance.employee_id.in_(reportee_ids),
                Attendance.date == target_date
            ).all()
            
            att_map = {a.employee_id: a.status for a in attendances}
            
            lines = []
            for e in reportees:
                status = att_map.get(e.id, "Absent/No record")
                lines.append(f"- {e.name}: {status}")
            
            return f"Team Attendance for {target_date}:\n" + "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def get_team_leave_requests(manager_email: str, status: str = "Pending"):
        db = SessionLocal()
        try:
            manager = db.query(Employee).filter(Employee.email == manager_email).first()
            if not manager: return "Manager not found."
            
            reportees = db.query(Employee).filter(Employee.reporting_manager_id == manager.id).all()
            if not reportees: return "No direct reportees found."
            
            reportee_ids = [e.id for e in reportees]
            leaves = db.query(Leave).filter(
                Leave.employee_id.in_(reportee_ids),
                Leave.status == status
            ).all()
            
            if not leaves: return f"No {status} leave requests for your team."
            
            emp_map = {e.id: e.name for e in reportees}
            lines = [f"- [ID: {l.id}] {emp_map[l.employee_id]}: {l.leave_type} ({l.start_date} to {l.end_date})" for l in leaves]
            return f"{status} team leave requests:\n" + "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def approve_leave(leave_id: int, manager_email: str):
        db = SessionLocal()
        try:
            manager = db.query(Employee).filter(Employee.email == manager_email).first()
            if not manager: return "Manager not found."
            
            leave = db.query(Leave).filter(Leave.id == leave_id).first()
            if not leave: return "Leave request not found."
            
            # Check if manager is authorized
            emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
            if emp.reporting_manager_id != manager.id:
                return "Unauthorized. You are not the reporting manager for this employee."
            
            leave.status = "Approved"
            db.commit()
            return f"Leave request for {emp.name} has been approved."
        finally:
            db.close()

    @staticmethod
    def reject_leave(leave_id: int, manager_email: str, reason: str = ""):
        db = SessionLocal()
        try:
            manager = db.query(Employee).filter(Employee.email == manager_email).first()
            if not manager: return "Manager not found."
            
            leave = db.query(Leave).filter(Leave.id == leave_id).first()
            if not leave: return "Leave request not found."
            
            emp = db.query(Employee).filter(Employee.id == leave.employee_id).first()
            if emp.reporting_manager_id != manager.id:
                return "Unauthorized."
            
            leave.status = "Rejected"
            db.commit()
            return f"Leave request for {emp.name} has been rejected. Reason: {reason}"
        finally:
            db.close()

    @staticmethod
    def assign_training(employee_email: str, course_name: str, platform: str, due_date: str, manager_email: str):
        db = SessionLocal()
        try:
            manager = db.query(Employee).filter(Employee.email == manager_email).first()
            if not manager: return "Manager not found."
            
            emp = db.query(Employee).filter(Employee.email == employee_email).first()
            if not emp: return "Target employee not found."
            
            new_t = TrainingAssignment(
                employee_id=emp.id,
                assigned_by=manager.id,
                course_name=course_name,
                platform=platform,
                due_date=datetime.datetime.strptime(due_date, "%Y-%m-%d").date(),
                status="Assigned"
            )
            db.add(new_t)
            db.commit()
            return f"Course '{course_name}' on {platform} assigned to {emp.name} (Due: {due_date})."
        finally:
            db.close()

    @staticmethod
    def get_training_status(employee_email: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == employee_email).first()
            if not emp: return "Employee not found."
            
            trainings = db.query(TrainingAssignment).filter(TrainingAssignment.employee_id == emp.id).all()
            if not trainings: return f"No training assignments found for {emp.name}."
            
            lines = [f"- {t.course_name} ({t.platform}): {t.status} | Due: {t.due_date}" for t in trainings]
            return f"Training status for {emp.name}:\n" + "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def get_employee_skills(employee_email: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == employee_email).first()
            if not emp: return "Employee not found."
            
            skills = db.query(EmployeeSkillMap).filter(EmployeeSkillMap.employee_id == emp.id).all()
            if not skills: return f"No skills mapped for {emp.name}."
            
            lines = [f"- {s.skill_name}: {s.proficiency} (Certified: {s.certified})" for s in skills]
            return f"Skill profile for {emp.name}:\n" + "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def get_employee_projects(employee_email: str):
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.email == employee_email).first()
            if not emp: return "Employee not found."
            
            projects = db.query(ProjectAssignment).filter(ProjectAssignment.employee_id == emp.id).all()
            if not projects: return f"No project history found for {emp.name}."
            
            lines = [f"- {p.project_name} ({p.role}): {p.status} | {p.start_date} to {p.end_date or 'Present'}" for p in projects]
            return f"Project history for {emp.name}:\n" + "\n".join(lines)
        finally:
            db.close()
