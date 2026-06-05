"""
Employee directory service — queries EmployeeZohoProfile (non-sensitive ZOHO fields).
Used by the HR agent for directory search, org-chart, skill-matching, etc.
"""

from typing import Optional
from sqlalchemy import or_, func
from app.database import SessionLocal
from app.models import Employee, EmployeeZohoProfile, MS365User, EmployeeSkill


def _employee_table(headers: list[str], rows: list[list[str]]) -> str:
    """Render rows as a GitHub-flavored markdown table.

    A markdown table renders far more readably than newline-joined bullets,
    which the frontend (remark-gfm) otherwise collapses into one paragraph.
    Pipes inside cell values are escaped so they don't break the table.
    """
    def cell(v) -> str:
        return str(v if v not in (None, "") else "N/A").replace("|", "\\|").strip()

    head = "| " + " | ".join(headers) + " |"
    sep = "| " + " | ".join("---" for _ in headers) + " |"
    body = "\n".join("| " + " | ".join(cell(c) for c in r) + " |" for r in rows)
    return f"{head}\n{sep}\n{body}"


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
                    # Match the full "First Last" name, e.g. "tejas autkar"
                    (EmployeeZohoProfile.first_name + " " + EmployeeZohoProfile.last_name).ilike(term),
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
                # Fall back to the MS365 / Azure AD directory — many people exist
                # there (synced via Graph) without a Zoho profile yet.
                if query:
                    ms = EmployeeService._search_ms365(query, limit)
                    if ms:
                        return ms
                return "No employees found matching your search."

            rows = []
            for p in results:
                name = f"{p.first_name or ''} {p.last_name or ''}".strip()
                rows.append([
                    name, p.designation, p.function,
                    p.reporting_manager, p.official_email,
                ])
            table = _employee_table(
                ["Name", "Designation", "Function", "Reporting To", "Email"], rows
            )
            return f"Found {len(results)} employee(s):\n\n{table}"
        finally:
            db.close()

    @staticmethod
    def _search_ms365(query: str, limit: int = 10) -> Optional[str]:
        """Fallback lookup against the MS365 / Azure AD directory (ms365_users)."""
        db = SessionLocal()
        try:
            term = f"%{query}%"
            rows = (
                db.query(MS365User)
                .filter(or_(
                    MS365User.name.ilike(term),
                    MS365User.email.ilike(term),
                    MS365User.job_title.ilike(term),
                    MS365User.department.ilike(term),
                ))
                .limit(limit)
                .all()
            )
            if not rows:
                return None
            table_rows = []
            for u in rows:
                table_rows.append([
                    u.name or u.email, u.job_title, u.department,
                    u.manager_name, u.email,
                ])
            table = _employee_table(
                ["Name", "Designation", "Department", "Reporting To", "Email"],
                table_rows,
            )
            return (
                f"Found {len(rows)} employee(s) in the Microsoft 365 directory:\n\n{table}"
            )
        finally:
            db.close()

    @staticmethod
    def _real_skills(db, email: str) -> str:
        """Return the employee's self-entered skills (employee_skills table),
        formatted for display. Empty string if none on file."""
        if not email:
            return ""
        emp = db.query(Employee).filter(Employee.email.ilike(email)).first()
        if not emp:
            return ""
        rows = (
            db.query(EmployeeSkill)
            .filter(EmployeeSkill.employee_id == emp.id)
            .order_by(EmployeeSkill.is_primary.desc())
            .all()
        )
        parts = []
        for s in rows:
            label = s.skill
            extras = []
            if s.is_primary:
                extras.append("primary")
            if s.years_experience:
                extras.append(f"{s.years_experience:g} yrs")
            if s.certification:
                extras.append(f"cert: {s.certification}")
            if extras:
                label += f" ({', '.join(extras)})"
            parts.append(label)
        return ", ".join(parts)

    @staticmethod
    def get_profile(identifier: str) -> str:
        """Get a non-sensitive profile by name or email.

        Authoritative live fields (designation, office location, manager,
        department) come from the MS365 / Azure AD directory (User.Read.All).
        Skills come from the self-entered employee_skills table. The Zoho CSV
        profile is used only to fill fields MS365 doesn't carry.
        """
        db = SessionLocal()
        try:
            term = f"%{identifier}%"

            # Real, live record from Azure AD.
            ms = db.query(MS365User).filter(or_(
                MS365User.email.ilike(term),
                MS365User.name.ilike(term),
            )).first()

            # Supplementary CSV-sourced record (may be stale / missing).
            profile = db.query(EmployeeZohoProfile).filter(or_(
                EmployeeZohoProfile.official_email.ilike(term),
                EmployeeZohoProfile.first_name.ilike(term),
                EmployeeZohoProfile.last_name.ilike(term),
                (EmployeeZohoProfile.first_name + " " + EmployeeZohoProfile.last_name).ilike(term),
            )).first()

            if not ms and not profile:
                return f"No employee profile found for '{identifier}'."

            def pick(*vals):
                for v in vals:
                    if v:
                        return v
                return "N/A"

            email = pick(
                ms.email if ms else None,
                profile.official_email if profile else None,
            )
            name = pick(
                ms.name if ms else None,
                f"{profile.first_name or ''} {profile.last_name or ''}".strip() if profile else None,
                identifier,
            )

            # Office location: prefer the explicit Azure AD officeLocation,
            # then fall back to city/state/country.
            office = "N/A"
            if ms:
                geo = ", ".join([p for p in (ms.city, ms.state, ms.country) if p])
                office = pick(ms.office_location, geo)

            skills = EmployeeService._real_skills(db, email if email != "N/A" else "")

            lines = [
                f"**Employee Profile — {name}**",
                f"• **Email:** {email}",
                f"• **Designation:** {pick(ms.job_title if ms else None, profile.designation if profile else None)}",
                f"• **Department / Function:** {pick(ms.department if ms else None, profile.function if profile else None)}",
                f"• **Office Location:** {office}",
                f"• **Reporting Manager:** {pick(ms.manager_name if ms else None, profile.reporting_manager if profile else None)}",
                f"• **Skills:** {skills or 'None on file'}",
            ]
            # Supplementary detail from the Zoho profile, only where present.
            if profile:
                lines.extend([
                    f"• **Level / Grade:** {profile.level or 'N/A'} / {profile.grade or 'N/A'}",
                    f"• **Employment Type:** {pick(profile.employment_type, ms.employee_type if ms else None)}",
                    f"• **Total Experience:** {profile.total_experience or 'N/A'}",
                    f"• **Expertise / Ask Me About:** {profile.expertise or 'N/A'}",
                    f"• **Languages Known:** {profile.language_known or 'N/A'}",
                ])
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

            rows = []
            for r in reports:
                name = f"{r.first_name or ''} {r.last_name or ''}".strip()
                rows.append([name, r.designation, r.official_email])
            table = _employee_table(["Name", "Designation", "Email"], rows)
            return (
                f"**Team roster for {manager_name} ({len(reports)} members):**\n\n{table}"
            )
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

            rows = []
            for p in matches:
                name = f"{p.first_name or ''} {p.last_name or ''}".strip()
                rows.append([name, p.designation, p.function, p.official_email])
            table = _employee_table(
                ["Name", "Designation", "Function", "Email"], rows
            )
            return (
                f"**Employees with '{skill}' expertise ({len(matches)}):**\n\n{table}"
            )
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
