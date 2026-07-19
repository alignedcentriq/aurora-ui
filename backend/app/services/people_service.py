"""
People service — import from Excel and search employees.

Supports Employee Data.xlsx, Allocation Data.xlsx, and Project Details.xlsx.
"""

import io
import datetime
from typing import Optional

import pandas as pd
from sqlalchemy import or_, and_, exists
from app.database import SessionLocal
from app.models import Employee, EmployeeZohoProfile, EmployeeAllocation, Project, Appreciation


# ── Column maps ───────────────────────────────────────────────────────────────

EMPLOYEE_COL = {
    "Employee ID": "employee_id_str",
    "Name": "name",
    "Email": "email",
    "Designation": "designation",
    "Function": "function",
    "Subfunction": "subfunction",
    "Gender": "gender",
    "Status-Active/Inactive": "employee_status",
    "Joining Date": "date_of_joining",
    "Relieving Date": "relieving_date",
    "Reporting Manager": "reporting_manager",
    "Functional Manager": "functional_manager",
    "Primary Skills": "skill_set",
    "Skill Set Board": "expertise",
    "Total Experience (Years)": "total_experience",
    "Past Experience ": "total_experience_past",  # trailing space in xlsx
    "AA Experience": "aa_experience",
    "Active Details": "active_details",
}

ALLOCATION_COL = {
    "Zoho Record ID": "zoho_record_id",
    "Employee ID": "employee_id",
    "Name": "employee_name",
    "Project Name": "project_name",
    "Sub Project": "sub_project",
    "Project Lead": "project_lead",
    "Delivery Manager": "delivery_manager",
    "Completion Status": "completion_status",
    "Efforts %": "efforts_percent",
    "Billability %": "billability_percent",
    "Allocation Date": "allocation_date",
    "Project Status": "project_status",
    "Client Master": "client_master",
    "Billing": "billing",
    "Project Type": "project_type",
    "Reporting Manager": "reporting_manager",
    "Functional Manager": "functional_manager",
    "Function": "function",
    "Status-Active/Inactive": "status",
}

PROJECT_COL = {
    "Project Name": "name",
    "Project Lead": "project_lead",
    "Delivery Manager": "delivery_manager",
    "Project Status": "status",
    "Project Start Date": "start_date",
    "Project End Date": "end_date",
    "Client Master": "client_name",
    "Project Type": "project_type",
    "Billing": "billing_type",
    "Remarks": "description",
}


def _safe(val):
    """Return None for NaN/NaT, otherwise string strip."""
    if val is None:
        return None
    try:
        import math
        if isinstance(val, float) and math.isnan(val):
            return None
    except Exception:
        pass
    if hasattr(val, "isoformat"):
        return val
    s = str(val).strip()
    return s if s and s.lower() not in ("nan", "nat", "none") else None


def _safe_float(val):
    try:
        return float(val)
    except Exception:
        return None


def _safe_date(val):
    if val is None:
        return None
    if isinstance(val, (datetime.date, datetime.datetime)):
        return val if isinstance(val, datetime.date) else val.date()
    try:
        return pd.to_datetime(val).date()
    except Exception:
        return None


class PeopleService:

    # ── Import ────────────────────────────────────────────────────────────────

    @staticmethod
    def import_employees(file_bytes: bytes, actor_email: str = "") -> dict:
        df = pd.read_excel(io.BytesIO(file_bytes))
        df = df.dropna(how="all")
        if df.empty:
            return {"imported": 0, "skipped": 0, "message": "No data rows found in file."}

        db = SessionLocal()
        imported = skipped = 0
        new_hires: list[tuple[str, str]] = []
        try:
            for _, row in df.iterrows():
                name = _safe(row.get("Name"))
                email = _safe(row.get("Email"))
                emp_id_str = _safe(row.get("Employee ID"))

                if not name and not email:
                    skipped += 1
                    continue

                # Get or create base Employee record
                emp = None
                if email:
                    emp = db.query(Employee).filter(Employee.email == email.lower()).first()
                if not emp and emp_id_str:
                    emp = db.query(Employee).filter(Employee.employee_id == emp_id_str).first()

                if not emp:
                    parts = (name or "").split(" ", 1)
                    emp = Employee(
                        employee_id=emp_id_str or email or name,
                        name=name or "",
                        email=(email or "").lower(),
                        department=_safe(row.get("Function")) or "",
                        designation=_safe(row.get("Designation")) or "",
                    )
                    db.add(emp)
                    db.flush()
                    if emp.email:
                        new_hires.append((emp.email, emp.name or ""))
                else:
                    if name:
                        emp.name = name
                    if email:
                        emp.email = email.lower()
                    emp.department = _safe(row.get("Function")) or emp.department
                    emp.designation = _safe(row.get("Designation")) or emp.designation

                # Upsert ZohoProfile
                profile = db.query(EmployeeZohoProfile).filter(
                    EmployeeZohoProfile.employee_id == emp.id
                ).first()

                parts = (name or "").split(" ", 1)
                first = parts[0] if parts else ""
                last = parts[1] if len(parts) > 1 else ""

                if not profile:
                    profile = EmployeeZohoProfile(employee_id=emp.id)
                    db.add(profile)

                profile.first_name = first
                profile.last_name = last
                profile.official_email = (email or "").lower()
                profile.zoho_link_id = emp_id_str
                profile.designation = _safe(row.get("Designation"))
                profile.function = _safe(row.get("Function"))
                profile.gender = _safe(row.get("Gender"))
                profile.employee_status = _safe(row.get("Status-Active/Inactive"))
                profile.date_of_joining = _safe_date(row.get("Joining Date"))
                profile.reporting_manager = _safe(row.get("Reporting Manager"))
                profile.functional_manager = _safe(row.get("Functional Manager"))
                profile.skill_set = _safe(row.get("Primary Skills"))
                profile.expertise = _safe(row.get("Skill Set Board"))
                profile.total_experience = str(_safe(row.get("Total Experience (Years)")) or "")
                profile.active_details = _safe(row.get("Active Details"))

                imported += 1

            db.commit()

            # Kick off onboarding (auto welcome email + manager intro-call invite) for
            # every genuinely new employee this import created — never for rows that
            # matched an existing Employee.
            if new_hires:
                from app.services.welcome_service import kickoff_new_hire
                initiator = actor_email or "system:import"
                for hire_email, hire_name in new_hires:
                    try:
                        kickoff_new_hire(hire_email, hire_name, db, initiated_by=initiator)
                    except Exception:
                        pass

            return {"imported": imported, "skipped": skipped, "message": f"Imported {imported} employee records."}
        except Exception as e:
            db.rollback()
            raise RuntimeError(f"Import failed: {e}")
        finally:
            db.close()

    @staticmethod
    def add_employee(data: dict, actor_email: str = "") -> dict:
        """Create a single Employee record directly (the "Add Employee" HR action) and
        immediately kick off onboarding — welcome email + manager intro-call invite —
        for the new hire. This is the deliberate, auditable counterpart to the lazy
        get-or-create-employee stub paths used elsewhere in the app."""
        name = (data.get("name") or "").strip()
        email = (data.get("email") or "").strip().lower()
        if not name or not email:
            raise ValueError("Name and email are required.")

        db = SessionLocal()
        try:
            if db.query(Employee).filter(Employee.email == email).first():
                raise ValueError(f"An employee with email {email} already exists.")

            joining_date = _safe_date(data.get("joining_date")) or datetime.date.today()
            emp = Employee(
                employee_id=(data.get("employee_id") or "").strip() or f"EMP{abs(hash(email)) % 9000 + 1000}",
                name=name,
                email=email,
                department=(data.get("department") or "").strip(),
                designation=(data.get("designation") or "").strip(),
                location=(data.get("location") or "").strip(),
                joining_date=joining_date,
                employment_type=(data.get("employment_type") or "Full-time").strip(),
            )
            db.add(emp)
            db.commit()
            db.refresh(emp)

            from app.services.welcome_service import kickoff_new_hire
            kickoff_new_hire(emp.email, emp.name, db, initiated_by=actor_email or "system")

            return {
                "ok": True,
                "employee": {
                    "id": emp.id,
                    "employee_id": emp.employee_id,
                    "name": emp.name,
                    "email": emp.email,
                    "department": emp.department,
                    "designation": emp.designation,
                    "joining_date": emp.joining_date.isoformat() if emp.joining_date else None,
                },
                "message": f"{emp.name} added. Welcome email and manager intro-call invite are being sent automatically.",
            }
        finally:
            db.close()

    # ── Onboarding audit + manual trigger ────────────────────────────────────────

    @staticmethod
    def get_onboarding_audit(search: str = "", limit: int = 20, offset: int = 0) -> dict:
        """Unified onboarding audit: one row per employee showing when onboarding was
        initiated/completed across the welcome email, manager-call invite, document, and
        journey subsystems — so HR can see the whole picture instead of four disconnected
        tabs. Powers the HR Portal Onboarding tab's audit table. Server-side paginated —
        returns {total, offset, limit, results}, same shape as search_people()."""
        from app.models import WelcomeLog, ManagerCallInvite, OnboardingJourney, OnboardingDocSubmission
        from app.services.onboarding_service import required_doc_keys

        db = SessionLocal()
        try:
            q = db.query(Employee)
            term = (search or "").strip()
            search_filters = []
            if term:
                like = f"%{term}%"
                search_filters.append(or_(Employee.name.ilike(like), Employee.email.ilike(like)))
                q = q.filter(*search_filters)
            total = q.count()

            # Aggregate counts over the FULL filtered set (not just this page), via
            # correlated EXISTS subqueries — cheap even at thousands of employees.
            welcome_exists = exists().where(WelcomeLog.employee_email == Employee.email)
            invite_exists = exists().where(ManagerCallInvite.new_hire_email == Employee.email)
            journey_completed_exists = exists().where(
                and_(OnboardingJourney.employee_id == Employee.id, OnboardingJourney.status == "completed")
            )
            triggered_count = (
                db.query(Employee.id)
                .filter(*search_filters)
                .filter(or_(welcome_exists, invite_exists))
                .count()
            )
            completed_count = (
                db.query(Employee.id)
                .filter(*search_filters)
                .filter(journey_completed_exists)
                .count()
            )
            counts = {
                "not_triggered": total - triggered_count,
                "in_progress": triggered_count - completed_count,
                "completed": completed_count,
            }

            employees = q.order_by(Employee.id.desc()).offset(offset).limit(limit).all()
            if not employees:
                return {"total": total, "counts": counts, "offset": offset, "limit": limit, "results": []}

            emails = [e.email for e in employees if e.email]
            emp_ids = [e.id for e in employees]

            welcome_by_email = {
                w.employee_email: w
                for w in db.query(WelcomeLog).filter(WelcomeLog.employee_email.in_(emails)).all()
            }
            invite_by_email = {
                i.new_hire_email: i
                for i in db.query(ManagerCallInvite).filter(ManagerCallInvite.new_hire_email.in_(emails)).all()
            }
            journeys = db.query(OnboardingJourney).filter(OnboardingJourney.employee_id.in_(emp_ids)).all()
            journey_by_emp_id = {j.employee_id: j for j in journeys}
            journey_ids = [j.id for j in journeys]

            required_count = len(required_doc_keys())
            docs_by_journey: dict[int, list] = {}
            if journey_ids:
                all_docs = (
                    db.query(OnboardingDocSubmission)
                    .filter(OnboardingDocSubmission.journey_id.in_(journey_ids))
                    .order_by(OnboardingDocSubmission.submitted_at.desc())
                    .all()
                )
                for d in all_docs:
                    docs_by_journey.setdefault(d.journey_id, []).append(d)

            rows = []
            for emp in employees:
                w = welcome_by_email.get(emp.email)
                inv = invite_by_email.get(emp.email)
                j = journey_by_emp_id.get(emp.id)

                doc_summary = {"submitted": 0, "required": required_count, "failed": 0, "failed_ids": []}
                if j:
                    seen_keys = set()
                    for d in docs_by_journey.get(j.id, []):
                        if d.doc_key in seen_keys:
                            continue  # keep only the latest submission per doc
                        seen_keys.add(d.doc_key)
                        if d.status in ("submitted", "emailed"):
                            doc_summary["submitted"] += 1
                        elif d.status == "failed":
                            doc_summary["failed"] += 1
                            doc_summary["failed_ids"].append(d.id)

                rows.append({
                    "employee_id": emp.id,
                    "name": emp.name,
                    "email": emp.email,
                    "department": emp.department,
                    "designation": emp.designation,
                    "added_at": emp.created_at.isoformat() if emp.created_at else None,
                    "welcome": {
                        "log_id": w.id if w else None,
                        "status": w.status if w else "not_started",
                        "initiated_at": w.created_at.isoformat() if w and w.created_at else None,
                        "initiated_by": w.initiated_by if w else None,
                        "completed_at": w.acted_at.isoformat() if w and w.acted_at else None,
                    },
                    "manager_call": {
                        "invite_id": inv.id if inv else None,
                        "status": inv.status if inv else "not_started",
                        "manager_name": inv.manager_name if inv else None,
                        "manager_email": inv.manager_email if inv else None,
                        "initiated_at": inv.created_at.isoformat() if inv and inv.created_at else None,
                        "completed_at": inv.scheduled_at.isoformat() if inv and inv.scheduled_at else None,
                    },
                    "journey": {
                        "status": j.status if j else "not_started",
                        "started_at": j.started_at.isoformat() if j and j.started_at else None,
                        "completed_at": j.completed_at.isoformat() if j and j.completed_at else None,
                    },
                    "documents": doc_summary,
                    "onboarding_triggered": bool(w or inv),
                })
            return {"total": total, "counts": counts, "offset": offset, "limit": limit, "results": rows}
        finally:
            db.close()

    @staticmethod
    def trigger_onboarding(employee_id: int, actor_email: str = "") -> dict:
        """HR's one-click 'Trigger Onboarding' action for an existing employee — see
        welcome_service.trigger_onboarding_manual for the exact semantics (fresh kickoff
        vs. retry vs. no-op)."""
        db = SessionLocal()
        try:
            emp = db.query(Employee).filter(Employee.id == employee_id).first()
            if not emp or not emp.email:
                raise ValueError("Employee not found or has no email on file.")
            from app.services.welcome_service import trigger_onboarding_manual
            return trigger_onboarding_manual(emp.email, emp.name, actor_email or "system", db)
        finally:
            db.close()

    @staticmethod
    def import_allocations(file_bytes: bytes) -> dict:
        df = pd.read_excel(io.BytesIO(file_bytes))
        df = df.dropna(how="all")
        if df.empty:
            return {"imported": 0, "skipped": 0, "message": "No data rows found in file."}

        db = SessionLocal()
        imported = skipped = 0
        try:
            for _, row in df.iterrows():
                emp_name = _safe(row.get("Name"))
                project = _safe(row.get("Project Name"))
                if not emp_name and not project:
                    skipped += 1
                    continue

                zoho_id = _safe(row.get("Zoho Record ID"))
                existing = None
                if zoho_id:
                    existing = db.query(EmployeeAllocation).filter(
                        EmployeeAllocation.zoho_record_id == zoho_id
                    ).first()

                if not existing:
                    existing = EmployeeAllocation(zoho_record_id=zoho_id)
                    db.add(existing)

                existing.employee_id = _safe(row.get("Employee ID")) or ""
                existing.employee_name = emp_name or ""
                existing.project_name = project or ""
                existing.sub_project = _safe(row.get("Sub Project"))
                existing.project_lead = _safe(row.get("Project Lead"))
                existing.delivery_manager = _safe(row.get("Delivery Manager"))
                existing.completion_status = _safe(row.get("Completion Status"))
                existing.efforts_percent = _safe_float(row.get("Efforts %"))
                existing.billability_percent = _safe_float(row.get("Billability %"))
                existing.allocation_date = _safe_date(row.get("Allocation Date"))
                existing.project_status = _safe(row.get("Project Status"))
                existing.client_master = _safe(row.get("Client Master"))
                existing.billing = _safe(row.get("Billing"))
                existing.project_type = _safe(row.get("Project Type"))
                existing.reporting_manager = _safe(row.get("Reporting Manager"))
                existing.functional_manager = _safe(row.get("Functional Manager"))
                existing.function = _safe(row.get("Function"))
                existing.status = _safe(row.get("Status-Active/Inactive"))

                imported += 1

            db.commit()
            return {"imported": imported, "skipped": skipped, "message": f"Imported {imported} allocation records."}
        except Exception as e:
            db.rollback()
            raise RuntimeError(f"Import failed: {e}")
        finally:
            db.close()

    @staticmethod
    def import_projects(file_bytes: bytes) -> dict:
        df = pd.read_excel(io.BytesIO(file_bytes))
        df = df.dropna(how="all")
        if df.empty:
            return {"imported": 0, "skipped": 0, "message": "No data rows found in file."}

        db = SessionLocal()
        imported = skipped = 0
        try:
            for _, row in df.iterrows():
                name = _safe(row.get("Project Name"))
                if not name:
                    skipped += 1
                    continue

                existing = db.query(Project).filter(Project.name == name).first()
                if not existing:
                    existing = Project(name=name)
                    db.add(existing)

                existing.status = _safe(row.get("Project Status")) or existing.status
                existing.description = _safe(row.get("Remarks")) or ""

                imported += 1

            db.commit()
            return {"imported": imported, "skipped": skipped, "message": f"Imported {imported} project records."}
        except Exception as e:
            db.rollback()
            raise RuntimeError(f"Import failed: {e}")
        finally:
            db.close()

    # ── Search ────────────────────────────────────────────────────────────────

    @staticmethod
    def search_people(
        query: Optional[str] = None,
        skill: Optional[str] = None,
        designation: Optional[str] = None,
        function: Optional[str] = None,
        reporting_manager: Optional[str] = None,
        min_exp: Optional[float] = None,
        max_exp: Optional[float] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        db = SessionLocal()
        try:
            q = db.query(EmployeeZohoProfile)

            # Status filter
            if status:
                q = q.filter(EmployeeZohoProfile.employee_status.ilike(f"%{status}%"))

            # Free-text search across name, skills, designation
            if query:
                term = f"%{query}%"
                q = q.filter(or_(
                    (EmployeeZohoProfile.first_name + " " + EmployeeZohoProfile.last_name).ilike(term),
                    EmployeeZohoProfile.skill_set.ilike(term),
                    EmployeeZohoProfile.expertise.ilike(term),
                    EmployeeZohoProfile.designation.ilike(term),
                    EmployeeZohoProfile.function.ilike(term),
                    EmployeeZohoProfile.official_email.ilike(term),
                ))

            if skill:
                term = f"%{skill}%"
                q = q.filter(or_(
                    EmployeeZohoProfile.skill_set.ilike(term),
                    EmployeeZohoProfile.expertise.ilike(term),
                ))

            if designation:
                q = q.filter(EmployeeZohoProfile.designation.ilike(f"%{designation}%"))

            if function:
                q = q.filter(EmployeeZohoProfile.function.ilike(f"%{function}%"))

            if reporting_manager:
                q = q.filter(or_(
                    EmployeeZohoProfile.reporting_manager.ilike(f"%{reporting_manager}%"),
                    EmployeeZohoProfile.functional_manager.ilike(f"%{reporting_manager}%"),
                ))

            # Stable ordering so offset-based pagination is consistent
            q = q.order_by(EmployeeZohoProfile.first_name, EmployeeZohoProfile.last_name, EmployeeZohoProfile.id)

            # Experience is stored as a string, so it is filtered in Python.
            # Fetch all SQL-matching rows (lightweight — no joins), apply the
            # experience filter, then paginate the resulting list. Allocation
            # subqueries run only for the current page below.
            matching = q.all()
            if min_exp is not None or max_exp is not None:
                filtered = []
                for p in matching:
                    try:
                        exp_val = float(p.total_experience) if p.total_experience else None
                    except Exception:
                        exp_val = None
                    if min_exp is not None and (exp_val is None or exp_val < min_exp):
                        continue
                    if max_exp is not None and (exp_val is None or exp_val > max_exp):
                        continue
                    filtered.append(p)
                matching = filtered

            total = len(matching)
            page = matching[offset:offset + limit]

            results = []
            for p in page:
                full_name = f"{p.first_name or ''} {p.last_name or ''}".strip()

                # Fetch recent project allocations
                allocations = db.query(EmployeeAllocation).filter(
                    or_(
                        EmployeeAllocation.employee_name.ilike(f"%{full_name}%"),
                        EmployeeAllocation.employee_id == p.zoho_link_id,
                    )
                ).order_by(EmployeeAllocation.allocation_date.desc()).limit(5).all()

                appreciation_count = 0
                if p.official_email:
                    appreciation_count = db.query(Appreciation).filter(
                        Appreciation.employee_email == (p.official_email or "").lower()
                    ).count()

                results.append({
                    "name": full_name,
                    "email": p.official_email,
                    "designation": p.designation,
                    "function": p.function,
                    # Skills
                    "skills": p.skill_set,            # backward compat alias
                    "primary_skills": p.skill_set,    # Primary Skills from Excel
                    "secondary_skills": p.expertise,  # Skill Set Board / secondary skills
                    "expertise": p.expertise,          # backward compat alias
                    "can_teach": p.expertise,          # same field — "what they can teach others"
                    # Certifications stored in tags column
                    "certifications": p.tags,
                    # Profile extras
                    "about_me": p.about_me,
                    "language_known": p.language_known,
                    "level": p.level,
                    "grade": p.grade,
                    "total_experience": p.total_experience,
                    "joining_date": p.date_of_joining.isoformat() if p.date_of_joining else None,
                    "reporting_manager": p.reporting_manager,
                    "functional_manager": p.functional_manager,
                    "status": p.employee_status,
                    "appreciation_count": appreciation_count,
                    "projects": [
                        {
                            "project": a.project_name,
                            "sub_project": a.sub_project,
                            "client": a.client_master,
                            "status": a.completion_status or a.project_status,
                            "efforts_pct": a.efforts_percent,
                            "billability_pct": a.billability_percent,
                            "date": a.allocation_date.isoformat() if a.allocation_date else None,
                            "delivery_manager": a.delivery_manager,
                            "project_lead": a.project_lead,
                            "project_type": a.project_type,
                            "billing": a.billing,
                        }
                        for a in allocations
                    ],
                })

            return {"total": total, "offset": offset, "limit": limit, "results": results}
        finally:
            db.close()

    @staticmethod
    def search_people_text(query: str) -> str:
        """LLM-friendly string result for agent tool use."""
        results = PeopleService.search_people(query=query, limit=10).get("results", [])
        if not results:
            return "No employees found matching your query."
        lines = [f"Found {len(results)} employee(s):\n"]
        for r in results:
            proj_names = ", ".join(p["project"] for p in r["projects"]) or "No allocations on record"
            lines.append(
                f"**{r['name']}** — {r['designation'] or 'N/A'} | {r['function'] or 'N/A'}\n"
                f"  Skills: {r['skills'] or 'N/A'}\n"
                f"  Experience: {r['total_experience'] or 'N/A'} years\n"
                f"  Reporting Manager: {r['reporting_manager'] or 'N/A'}\n"
                f"  Projects: {proj_names}\n"
                f"  Email: {r['email'] or 'N/A'}"
            )
        return "\n\n".join(lines)
