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


def rewire_manager_hierarchy() -> dict:
    """
    Wire Employee.manager_id from Zoho reporting_manager_email (primary, email-exact).
    Falls back to EmployeeZohoProfile.reporting_manager stored locally (name-based)
    for employees that don't match a live Zoho row.

    Safe to call repeatedly — idempotent. Returns counts for logging.
    """
    from app.models import EmployeeZohoProfile
    from app.services.zoho_directory_service import fetch_directory, is_configured

    db = SessionLocal()
    try:
        all_emps = db.query(Employee).all()
        email_to_id: dict[str, int] = {(e.email or "").lower(): e.id for e in all_emps if e.email}
        name_to_id: dict[str, int] = {(e.name or "").lower(): e.id for e in all_emps if e.name}

        # 1. Primary: live Zoho directory → reporting_manager_email (email-exact, most reliable)
        zoho_email_map: dict[str, str] = {}  # emp_email → mgr_email
        if is_configured():
            try:
                rows = fetch_directory()
                zoho_email_map = {
                    (r["email"] or "").lower(): (r["reporting_manager_email"] or "").lower()
                    for r in rows if r.get("email")
                }
            except Exception:
                pass  # will fall through to name-based

        # 2. Fallback: EmployeeZohoProfile.reporting_manager (name stored at import time)
        zoho_name_rows = (
            db.query(EmployeeZohoProfile.employee_id, EmployeeZohoProfile.reporting_manager)
            .filter(EmployeeZohoProfile.reporting_manager.isnot(None))
            .all()
        )
        zoho_name_map: dict[int, str] = {
            r.employee_id: (r.reporting_manager or "").strip()
            for r in zoho_name_rows if r.reporting_manager
        }

        linked_email = linked_name = unchanged = 0

        for emp in all_emps:
            emp_email = (emp.email or "").lower()

            # 1. Zoho email-based (most reliable)
            mgr_email = zoho_email_map.get(emp_email, "")
            if mgr_email:
                mgr_id = email_to_id.get(mgr_email)
                if mgr_id and mgr_id != emp.id:
                    emp.manager_id = mgr_id
                    linked_email += 1
                    continue

            # 2. Zoho name-based (local profile cache)
            mgr_name = zoho_name_map.get(emp.id, "")
            if mgr_name:
                mgr_id = name_to_id.get(mgr_name.lower())
                if not mgr_id:
                    first = mgr_name.split()[0].lower() if mgr_name else ""
                    mgr_id = next(
                        (eid for n, eid in name_to_id.items() if n.startswith(first)), None
                    )
                if mgr_id and mgr_id != emp.id:
                    emp.manager_id = mgr_id
                    linked_name += 1
                    continue

            unchanged += 1

        db.commit()
        return {
            "total": len(all_emps),
            "linked_from_zoho_email": linked_email,
            "linked_from_zoho_name": linked_name,
            "no_manager_found": unchanged,
        }
    finally:
        db.close()
