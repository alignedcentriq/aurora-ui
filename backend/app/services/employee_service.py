"""
Employee directory service — used by the HR agent for directory search, org-chart,
skill-matching, etc.

Primary source is the live Zoho HR view (see services/zoho_directory_service.py — the
same authoritative roster the Employee Directory page uses), tried first via the
`_zoho_*` helpers below. EmployeeZohoProfile (a local CSV-synced overlay table) and
MS365User are the fallback when the Zoho view is unset/unreachable/empty — mirroring
_compose_directory()'s "Zoho primary, MS365 fallback" pattern in employee_routes.py.

Skills always come from Alchemy (the org's system of record for skills), via the cached
alchemy_profile_cache table (see alchemy_service.get_cached_enrichment_map) — never from
Zoho's own skill fields. find_skills_expert() below is a last-resort fallback used only
when Alchemy (search_alchemy_skill_experts, the preferred tool) is disabled/unreachable.
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

    # ── Live Zoho HR view helpers ────────────────────────────────────────────────
    # All of these are fail-soft: None means "unconfigured, unreachable, or no match" —
    # callers fall through to the local MS365/EmployeeZohoProfile-based logic below.

    @staticmethod
    def _zoho_rows() -> Optional[list[dict]]:
        """Fetch the live Zoho roster, or None if unavailable (unconfigured/unreachable/empty)."""
        from app.services import zoho_directory_service
        if not zoho_directory_service.is_configured():
            return None
        try:
            rows = zoho_directory_service.fetch_directory()
        except Exception:
            return None
        return rows or None

    @staticmethod
    def _zoho_skills_lines(employee_code: Optional[str]) -> list[str]:
        """Format an employee's skills from the cached Alchemy enrichment (never from
        Zoho's own skill fields — Alchemy is the org's system of record for skills)."""
        if not employee_code:
            return ["- None on file"]
        try:
            from app.services import alchemy_service
            cache = alchemy_service.get_cached_enrichment_map([employee_code])
            skills = cache.get(employee_code, {}).get("skills") or []
        except Exception:
            skills = []
        if not skills:
            return ["- None on file"]
        lines = []
        for s in skills:
            name = s.get("skill", "Unknown")
            extra = " | ".join(x for x in [
                s.get("competency"),
                (f"{s['years_experience']} yrs"
                 if s.get("years_experience") not in (None, "", "0", "0.00") else None),
                ("Certified" if s.get("certified") else None),
            ] if x)
            lines.append(f"- {name}" + (f" ({extra})" if extra else ""))
        return lines

    @staticmethod
    def _zoho_profile(identifier: str) -> Optional[str]:
        rows = EmployeeService._zoho_rows()
        if not rows:
            return None
        term = (identifier or "").strip().lower()
        if not term:
            return None
        matches = [r for r in rows if term in r["name"].lower()
                   or (r["email"] and term in r["email"].lower())]
        if not matches:
            return None
        exact = [r for r in matches
                 if r["name"].lower() == term or (r["email"] or "").lower() == term]
        r = exact[0] if exact else matches[0]

        def _row(label: str, value) -> Optional[list]:
            v = str(value).strip() if value else None
            return [label, v] if v else None

        table_rows: list[list[str]] = [
            ["Email", r["email"] or "N/A"],
            ["Designation", r["designation"] or "N/A"],
            ["Department / Function", r["department"] or "N/A"],
            ["Office Location", r["location"] or "N/A"],
            ["Reporting Manager", r["reporting_manager"] or "N/A"],
        ]
        for row in filter(None, [
            _row("Functional Manager", r.get("functional_manager")),
            _row("Phone", r.get("phone")),
            _row("Extension", r.get("extension")),
            _row("Birthday", r.get("birthday")),
        ]):
            table_rows.append(row)

        lines = [f"### 👤 Employee Profile: **{r['name']}**\n",
                 _employee_table(["Field", "Detail"], table_rows), "",
                 "**Skills & Certifications:**"]
        lines.extend(EmployeeService._zoho_skills_lines(r.get("employee_code")))
        return "\n".join(lines)

    @staticmethod
    def _zoho_search(query: str, function: Optional[str], designation: Optional[str],
                      limit: int) -> Optional[str]:
        rows = EmployeeService._zoho_rows()
        if not rows:
            return None
        q = (query or "").strip().lower()
        fn = (function or "").strip().lower()
        des = (designation or "").strip().lower()

        def match(r: dict) -> bool:
            if q and not (
                q in r["name"].lower()
                or q in (r["designation"] or "").lower()
                or q in (r["department"] or "").lower()
                or q in (r["email"] or "").lower()
            ):
                return False
            if fn and fn not in (r["department"] or "").lower():
                return False
            if des and des not in (r["designation"] or "").lower():
                return False
            return True

        matches = [r for r in rows if match(r)][:limit]
        if not matches:
            return None
        table_rows = [
            [r["name"], r["designation"] or "N/A", r["department"] or "N/A",
             r["reporting_manager"] or "N/A", r["email"] or "N/A", r["phone"] or "N/A"]
            for r in matches
        ]
        table = _employee_table(
            ["Name", "Designation", "Department", "Reporting To", "Email", "Phone"], table_rows
        )
        return f"Found {len(matches)} employee(s):\n\n{table}"

    @staticmethod
    def _zoho_org_chart(name_or_email: str) -> Optional[str]:
        rows = EmployeeService._zoho_rows()
        if not rows:
            return None
        term = (name_or_email or "").strip().lower()
        if not term:
            return None
        matches = [r for r in rows if term in r["name"].lower()
                   or (r["email"] and term in r["email"].lower())]
        if not matches:
            return None
        exact = [r for r in matches
                 if r["name"].lower() == term or (r["email"] or "").lower() == term]
        person = exact[0] if exact else matches[0]
        name = person["name"]

        lines = [f"**Org Chart for {name}**"]
        if person.get("reporting_manager"):
            lines.append(f"\n**Reports to:** {person['reporting_manager']}")
        if person.get("functional_manager") and person["functional_manager"] != person.get("reporting_manager"):
            lines.append(f"**Functional Manager:** {person['functional_manager']}")

        reports = [r for r in rows
                   if r.get("reporting_manager") and name.lower() in r["reporting_manager"].lower()]
        if reports:
            lines.append(f"\n**Direct Reports ({len(reports)}):**")
            for r in reports:
                lines.append(f"  • {r['name']} — {r['designation'] or 'N/A'} ({r['email'] or 'N/A'})")
        else:
            lines.append("\nNo direct reports found.")
        return "\n".join(lines)

    @staticmethod
    def _zoho_team_roster(manager_name: str) -> Optional[str]:
        rows = EmployeeService._zoho_rows()
        if not rows:
            return None
        term = (manager_name or "").strip().lower()
        if not term:
            return None
        reports = [r for r in rows if r.get("reporting_manager") and term in r["reporting_manager"].lower()]
        if not reports:
            return None
        table_rows = [[r["name"], r["designation"] or "N/A", r["email"] or "N/A"] for r in reports]
        table = _employee_table(["Name", "Designation", "Email"], table_rows)
        return f"**Team roster for {manager_name} ({len(reports)} members):**\n\n{table}"

    @staticmethod
    def _zoho_headcount(function: Optional[str] = None) -> Optional[str]:
        rows = EmployeeService._zoho_rows()
        if not rows:
            return None
        if function:
            fn = function.strip().lower()
            count = sum(1 for r in rows if fn in (r.get("department") or "").lower())
            return f"Active headcount in '{function}': **{count} employees**."
        counts: dict[str, int] = {}
        for r in rows:
            dept = r.get("department") or "Unknown"
            counts[dept] = counts.get(dept, 0) + 1
        lines = ["**Headcount by Function:**"]
        for dept, cnt in sorted(counts.items(), key=lambda kv: kv[1], reverse=True):
            lines.append(f"  • {dept}: {cnt}")
        return "\n".join(lines)

    # ── Public API — Zoho view first, local tables as fallback ─────────────────

    @staticmethod
    def search_directory(query: str, function: Optional[str] = None,
                         designation: Optional[str] = None,
                         limit: int = 10) -> str:
        """Full-text search across name, function, designation, skill_set, expertise."""
        zoho_hit = EmployeeService._zoho_search(query, function, designation, limit)
        if zoho_hit is not None:
            return zoho_hit
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
                phone = p.work_phone or "N/A"
                if p.extension:
                    phone = f"{phone} ext. {p.extension}" if phone != "N/A" else f"ext. {p.extension}"
                rows.append([
                    name, p.designation, p.function,
                    p.reporting_manager, p.official_email,
                    phone, p.sub_location or "N/A",
                ])
            table = _employee_table(
                ["Name", "Designation", "Function", "Reporting To", "Email", "Phone", "Seat"], rows
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
                phone = u.business_phone or "N/A"
                table_rows.append([
                    u.name or u.email, u.job_title, u.department,
                    u.manager_name, u.email, phone,
                ])
            table = _employee_table(
                ["Name", "Designation", "Department", "Reporting To", "Email", "Phone"],
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

        Tries the live Zoho HR view first (authoritative roster — see _zoho_profile).
        Falls back to MS365 / Azure AD (User.Read.All) + the local Zoho CSV overlay
        when the person isn't in the Zoho view (unconfigured, unreachable, or a very
        recent joiner not yet synced there). Skills come from the self-entered
        employee_skills table in this fallback path.
        """
        zoho_hit = EmployeeService._zoho_profile(identifier)
        if zoho_hit:
            return zoho_hit
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
                # No exact name/email match — this is a single-record lookup, so a person
                # whose display name doesn't contain `identifier` as a contiguous substring
                # (word order, nickname, or the caller passed something that isn't a real
                # name/email at all — e.g. a guessed "first.last@domain" email) falls through
                # here even though they may be findable another way. Retry with the broader,
                # multi-field directory search (name/designation/function/skills/email, plus
                # its own MS365 fallback) instead of failing outright — same DB, no LLM call,
                # and its "no match" message doesn't echo back a possibly-fabricated identifier.
                return EmployeeService.search_directory(identifier)

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

            lines = []
            lines.append(f"### 👤 Employee Profile: **{name}**\n")

            # Contact fields — work numbers only (no personal mobile/personal email per policy)
            work_phone = pick(
                profile.work_phone if profile else None,
                ms.business_phone if ms else None,
            )
            extension = profile.extension if profile else None

            def _row(label: str, value) -> Optional[list]:
                """Return a table row only when the value is real (not N/A / None / blank)."""
                v = str(value).strip() if value not in (None, "", "N/A") else None
                return [label, v] if v and v != "N/A" else None

            # Always-shown core fields
            table_rows: list[list[str]] = [
                ["Email", email],
                ["Designation", pick(ms.job_title if ms else None, profile.designation if profile else None)],
                ["Department / Function", pick(ms.department if ms else None, profile.function if profile else None)],
                ["Office Location", office],
                ["Reporting Manager", pick(ms.manager_name if ms else None, profile.reporting_manager if profile else None)],
            ]

            # Optional fields — only emitted when data exists
            for row in filter(None, [
                _row("Seat / Sub-location", profile.sub_location if profile else None),
                _row("Work Phone", work_phone),
                _row("Extension", extension),
                _row("Functional Manager", profile.functional_manager if profile else None),
                _row("Project Manager", profile.project_manager if profile else None),
                _row("Level / Grade",
                     f"{profile.level} / {profile.grade}"
                     if profile and (profile.level or profile.grade) else None),
                _row("Employment Type",
                     pick(profile.employment_type if profile else None,
                          ms.employee_type if ms else None)),
                _row("Date of Joining",
                     profile.date_of_joining.strftime("%d %b %Y")
                     if profile and profile.date_of_joining
                     else (ms.hire_date.strftime("%d %b %Y") if ms and ms.hire_date else None)),
                _row("Tenure at Company", profile.tenure_in_aa if profile else None),
                _row("Total Experience",
                     f"{profile.total_experience} years" if profile and profile.total_experience else None),
                _row("Blood Group", profile.blood_group if profile else None),
                _row("Languages Known", profile.language_known if profile else None),
                _row("Nationality", profile.nationality if profile else None),
            ]):
                table_rows.append(row)

            lines.append(_employee_table(["Field", "Detail"], table_rows))
            lines.append("")

            if profile and profile.expertise:
                lines.append(f"**Expertise / Ask Me About:**\n{profile.expertise}\n")

            if profile and profile.about_me:
                lines.append(f"**About:**\n{profile.about_me}\n")

            lines.append("**Skills & Certifications:**")
            if skills:
                skill_items = [s.strip() for s in skills.split(",") if s.strip()]
                for s in skill_items:
                    lines.append(f"- {s}")
            else:
                lines.append("- None on file")

            return "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def get_org_chart(name_or_email: str) -> str:
        """Show the reporting chain above and direct reports below a given employee."""
        zoho_hit = EmployeeService._zoho_org_chart(name_or_email)
        if zoho_hit:
            return zoho_hit
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
        zoho_hit = EmployeeService._zoho_team_roster(manager_name)
        if zoho_hit:
            return zoho_hit
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
        zoho_hit = EmployeeService._zoho_headcount(function)
        if zoho_hit is not None:
            return zoho_hit
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
