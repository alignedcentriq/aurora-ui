"""
Employee directory service — queries EmployeeZohoProfile (non-sensitive ZOHO fields).
Used by the HR agent for directory search, org-chart, skill-matching, etc.
"""

from typing import Optional
from sqlalchemy import or_, func
from app.database import SessionLocal
from app.models import Employee, EmployeeZohoProfile


class EmployeeService:

    @staticmethod
    def search_directory(query: str, function: Optional[str] = None,
                         designation: Optional[str] = None,
                         limit: int = 10) -> str:
        """Full-text search across name, function, designation, skill_set, expertise."""
        db = SessionLocal()
        try:
            q = db.query(EmployeeZohoProfile)
            q = q.filter(EmployeeZohoProfile.employee_status != "Inactive")

            if query:
                term = f"%{query}%"
                q = q.filter(or_(
                    EmployeeZohoProfile.first_name.ilike(term),
                    EmployeeZohoProfile.last_name.ilike(term),
                    EmployeeZohoProfile.designation.ilike(term),
                    EmployeeZohoProfile.function.ilike(term),
                    EmployeeZohoProfile.skill_set.ilike(term),
                    EmployeeZohoProfile.expertise.ilike(term),
                    EmployeeZohoProfile.official_email.ilike(term),
                ))
            if function:
                q = q.filter(EmployeeZohoProfile.function.ilike(f"%{function}%"))
            if designation:
                q = q.filter(EmployeeZohoProfile.designation.ilike(f"%{designation}%"))

            results = q.limit(limit).all()
            if not results:
                return "No employees found matching your search."

            lines = []
            for p in results:
                name = f"{p.first_name or ''} {p.last_name or ''}".strip()
                mgr = p.reporting_manager or "N/A"
                lines.append(
                    f"• **{name}** | {p.designation or 'N/A'} | {p.function or 'N/A'} | "
                    f"Reporting to: {mgr} | Email: {p.official_email or 'N/A'}"
                )
            return f"Found {len(results)} employee(s):\n" + "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def get_profile(identifier: str) -> str:
        """Get full non-sensitive profile by name or email."""
        db = SessionLocal()
        try:
            term = f"%{identifier}%"
            profile = db.query(EmployeeZohoProfile).filter(or_(
                EmployeeZohoProfile.official_email.ilike(term),
                EmployeeZohoProfile.first_name.ilike(term),
                EmployeeZohoProfile.last_name.ilike(term),
                (EmployeeZohoProfile.first_name + " " + EmployeeZohoProfile.last_name).ilike(term),
            )).first()

            if not profile:
                return f"No employee profile found for '{identifier}'."

            name = f"{profile.first_name or ''} {profile.last_name or ''}".strip()
            lines = [
                f"**Employee Profile — {name}**",
                f"• **Email:** {profile.official_email or 'N/A'}",
                f"• **Designation:** {profile.designation or 'N/A'}",
                f"• **Function:** {profile.function or 'N/A'}",
                f"• **Level / Grade:** {profile.level or 'N/A'} / {profile.grade or 'N/A'}",
                f"• **Employment Type:** {profile.employment_type or 'N/A'}",
                f"• **Work Phone:** {profile.work_phone or 'N/A'} (Ext: {profile.extension or 'N/A'})",
                f"• **Reporting Manager:** {profile.reporting_manager or 'N/A'}",
                f"• **Functional Manager:** {profile.functional_manager or 'N/A'}",
                f"• **Project Manager:** {profile.project_manager or 'N/A'}",
                f"• **Date of Joining:** {profile.date_of_joining or 'N/A'}",
                f"• **Tenure at AA:** {profile.tenure_in_aa or 'N/A'}",
                f"• **Total Experience:** {profile.total_experience or 'N/A'}",
                f"• **Skills:** {profile.skill_set or 'N/A'}",
                f"• **Expertise / Ask Me About:** {profile.expertise or 'N/A'}",
                f"• **Languages Known:** {profile.language_known or 'N/A'}",
                f"• **About:** {profile.about_me or 'N/A'}",
                f"• **Blood Group:** {profile.blood_group or 'N/A'}",
                f"• **Onboarding Status:** {profile.onboarding_status or 'N/A'}",
                f"• **Nationality:** {profile.nationality or 'N/A'}",
                f"• **Tags:** {profile.tags or 'N/A'}",
            ]
            return "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def get_org_chart(name_or_email: str) -> str:
        """Show the reporting chain above and direct reports below a given employee."""
        db = SessionLocal()
        try:
            term = f"%{name_or_email}%"
            profile = db.query(EmployeeZohoProfile).filter(or_(
                EmployeeZohoProfile.official_email.ilike(term),
                (EmployeeZohoProfile.first_name + " " + EmployeeZohoProfile.last_name).ilike(term),
            )).first()

            if not profile:
                return f"Employee '{name_or_email}' not found."

            name = f"{profile.first_name or ''} {profile.last_name or ''}".strip()
            lines = [f"**Org Chart for {name}**"]

            # Manager chain
            if profile.reporting_manager:
                lines.append(f"\n**Reports to:** {profile.reporting_manager}")
            if profile.functional_manager and profile.functional_manager != profile.reporting_manager:
                lines.append(f"**Functional Manager:** {profile.functional_manager}")

            # Direct reports
            full_name_expr = (EmployeeZohoProfile.first_name + " " + EmployeeZohoProfile.last_name)
            reports = db.query(EmployeeZohoProfile).filter(
                EmployeeZohoProfile.reporting_manager.ilike(f"%{name}%")
            ).all()

            if reports:
                lines.append(f"\n**Direct Reports ({len(reports)}):**")
                for r in reports:
                    rname = f"{r.first_name or ''} {r.last_name or ''}".strip()
                    lines.append(f"  • {rname} — {r.designation or 'N/A'} ({r.official_email or 'N/A'})")
            else:
                lines.append("\nNo direct reports found.")

            return "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def get_team_roster(manager_name: str) -> str:
        """List all direct reports for a given manager."""
        db = SessionLocal()
        try:
            reports = db.query(EmployeeZohoProfile).filter(
                EmployeeZohoProfile.reporting_manager.ilike(f"%{manager_name}%"),
                EmployeeZohoProfile.employee_status != "Inactive",
            ).all()

            if not reports:
                return f"No direct reports found for '{manager_name}'."

            lines = [f"**Team roster for {manager_name} ({len(reports)} members):**"]
            for r in reports:
                name = f"{r.first_name or ''} {r.last_name or ''}".strip()
                lines.append(
                    f"  • {name} | {r.designation or 'N/A'} | {r.official_email or 'N/A'}"
                )
            return "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def find_skills_expert(skill: str) -> str:
        """Find employees with a specific skill from their ZOHO skill_set profile."""
        db = SessionLocal()
        try:
            term = f"%{skill}%"
            matches = db.query(EmployeeZohoProfile).filter(
                EmployeeZohoProfile.skill_set.ilike(term)
            ).all()

            if not matches:
                return f"No employees found with '{skill}' in their skill set."

            lines = [f"**Employees with '{skill}' expertise ({len(matches)}):**"]
            for p in matches:
                name = f"{p.first_name or ''} {p.last_name or ''}".strip()
                lines.append(
                    f"  • {name} | {p.designation or 'N/A'} | {p.function or 'N/A'} | {p.official_email or 'N/A'}"
                )
            return "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def get_department_headcount(function: Optional[str] = None) -> str:
        """Count of active employees by function/department."""
        db = SessionLocal()
        try:
            q = db.query(EmployeeZohoProfile).filter(
                EmployeeZohoProfile.employee_status != "Inactive"
            )
            if function:
                q = q.filter(EmployeeZohoProfile.function.ilike(f"%{function}%"))
                count = q.count()
                return f"Active headcount in '{function}': **{count} employees**."

            # Group by function
            rows = (
                db.query(EmployeeZohoProfile.function, func.count(EmployeeZohoProfile.id))
                .filter(EmployeeZohoProfile.employee_status != "Inactive")
                .group_by(EmployeeZohoProfile.function)
                .order_by(func.count(EmployeeZohoProfile.id).desc())
                .all()
            )
            if not rows:
                return "No employee data available."
            lines = ["**Headcount by Function:**"]
            for fn, cnt in rows:
                lines.append(f"  • {fn or 'Unknown'}: {cnt}")
            return "\n".join(lines)
        finally:
            db.close()
