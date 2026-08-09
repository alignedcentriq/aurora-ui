import datetime
import secrets
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Employee, Leave, Policy, ApprovalToken, EmployeeZohoProfile, Grievance, LeaveType, LeaveBalance, HRQuery

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
                shift_type="Day",
            )
            db.add(emp)
            db.commit()
            db.refresh(emp)
        return emp

    @staticmethod
    def get_leave_balance(email: str):
        from app.services import leave_balance_sync
        year = datetime.date.today().year

        # Prefer real Zoho-sourced balances (DB view / cache / API / CSV — see
        # leave_balance_sync.get_or_refresh) over the synthetic entitlement-only tables.
        result = leave_balance_sync.get_or_refresh(email)
        if result.get("success") and result.get("balances"):
            lines = [f"**Leave Balance ({year}):**\n"]
            for b in result["balances"]:
                if str(b.get("type", "")).strip().upper() in ("LEAVE WITHOUT PAY", "LWP"):
                    lines.append(f"- **{b['type']}**: No limit (deducted from salary)")
                else:
                    lines.append(f"- **{b['type']}**: {b['balance']} available ({b['used']} used of {b['total']})")
            return "\n".join(lines)

        return HRService._synthetic_leave_balance(email, year)

    @staticmethod
    def _synthetic_leave_balance(email: str, year: int):
        """Fallback when no real Zoho leave source is reachable/configured: locally
        seeded entitlement-only balances (used=0 unless tracked via apply_leave)."""
        db = SessionLocal()
        try:
            emp = HRService.get_employee_by_email(db, email)

            balances = (
                db.query(LeaveBalance, LeaveType)
                .join(LeaveType, LeaveBalance.leave_type_id == LeaveType.id)
                .filter(
                    LeaveBalance.employee_id == emp.id,
                    LeaveBalance.year == year,
                    LeaveType.is_active == True,
                )
                .all()
            )

            if not balances:
                # Fallback: init balances if missing and retry
                HRService._init_employee_balances(db, emp.id, emp.joining_date)
                db.commit()
                balances = (
                    db.query(LeaveBalance, LeaveType)
                    .join(LeaveType, LeaveBalance.leave_type_id == LeaveType.id)
                    .filter(
                        LeaveBalance.employee_id == emp.id,
                        LeaveBalance.year == year,
                        LeaveType.is_active == True,
                    )
                    .all()
                )

            if not balances:
                return "Leave balance data is not available. Please contact HR."

            lines = [f"**Leave Balance ({year}):**\n"]
            for lb, lt in balances:
                if lt.code == "LWP":
                    lines.append(f"- **{lt.name}**: No limit (deducted from salary)")
                elif lt.is_earned:
                    lines.append(f"- **{lt.name}**: {lb.balance} available ({lb.earned} earned, {lb.used} used)")
                else:
                    lines.append(f"- **{lt.name}**: {lb.balance} available ({lb.used} used of {lb.entitled})")
            return "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def _init_employee_balances(db: Session, employee_id: int, joining_date=None):
        """Create LeaveBalance records for current year if missing."""
        year = datetime.date.today().year
        leave_types = db.query(LeaveType).filter(LeaveType.is_active == True).all()
        for lt in leave_types:
            existing = db.query(LeaveBalance).filter(
                LeaveBalance.employee_id == employee_id,
                LeaveBalance.leave_type_id == lt.id,
                LeaveBalance.year == year,
            ).first()
            if existing:
                continue
            if lt.is_earned:
                entitled = 0
            elif lt.annual_entitlement is None:
                entitled = 0
            else:
                if joining_date and joining_date.year == year:
                    months_remaining = 12 - joining_date.month + 1
                    entitled = round(lt.annual_entitlement * months_remaining / 12, 1)
                else:
                    entitled = lt.annual_entitlement
            db.add(LeaveBalance(
                employee_id=employee_id, leave_type_id=lt.id, year=year,
                entitled=entitled, used=0, balance=entitled, earned=0,
            ))

    @staticmethod
    def deduct_leave_balance(db: Session, employee_id: int, leave_type_name: str, days: float):
        """Deduct balance on approval. Returns True if successful."""
        year = datetime.date.today().year
        lt = db.query(LeaveType).filter(LeaveType.name.ilike(f"%{leave_type_name}%")).first()
        if not lt:
            return False
        if lt.code == "LWP":
            return True  # No balance tracking for LWP
        lb = db.query(LeaveBalance).filter(
            LeaveBalance.employee_id == employee_id,
            LeaveBalance.leave_type_id == lt.id,
            LeaveBalance.year == year,
        ).first()
        if lb:
            lb.used += days
            lb.balance = lb.entitled + lb.earned - lb.used
        return True

    @staticmethod
    def restore_leave_balance(db: Session, employee_id: int, leave_type_name: str, days: float):
        """Restore balance on cancellation of an approved leave."""
        year = datetime.date.today().year
        lt = db.query(LeaveType).filter(LeaveType.name.ilike(f"%{leave_type_name}%")).first()
        if not lt or lt.code == "LWP":
            return
        lb = db.query(LeaveBalance).filter(
            LeaveBalance.employee_id == employee_id,
            LeaveBalance.leave_type_id == lt.id,
            LeaveBalance.year == year,
        ).first()
        if lb:
            lb.used = max(0, lb.used - days)
            lb.balance = lb.entitled + lb.earned - lb.used

    @staticmethod
    def _find_manager_email(db, emp: Employee) -> str:
        """Best-effort Reporting Manager email lookup; falls back to HR_EMAIL."""
        from app.config import settings
        if emp.manager_id:
            mgr = db.query(Employee).filter(Employee.id == emp.manager_id).first()
            if mgr and mgr.email:
                return mgr.email
        profile = db.query(EmployeeZohoProfile).filter(EmployeeZohoProfile.employee_id == emp.id).first()
        if profile and profile.reporting_manager:
            mgr = db.query(Employee).filter(
                Employee.name.ilike(f"%{profile.reporting_manager.split()[0]}%")
            ).first()
            if mgr and mgr.email:
                return mgr.email
        return settings.HR_EMAIL

    @staticmethod
    def _find_functional_manager_email(db, emp: Employee) -> str | None:
        """Look up Functional Manager email from Zoho profile. Returns None if not found."""
        profile = db.query(EmployeeZohoProfile).filter(EmployeeZohoProfile.employee_id == emp.id).first()
        if profile and profile.functional_manager:
            mgr = db.query(Employee).filter(
                Employee.name.ilike(f"%{profile.functional_manager.split()[0]}%")
            ).first()
            if mgr and mgr.email:
                return mgr.email
        return None

    @staticmethod
    def apply_leave(email: str, start_date: str, end_date: str, leave_type: str, reason: str = "Applied via AI Assistant"):
        from app.config import settings
        from app.services.email_service import send_leave_approval_request, send_leave_fyi_notification
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
                reason=reason,
            )
            db.add(new_leave)
            db.commit()
            db.refresh(new_leave)

            # Send Reporting Manager approval email with clickable links
            _manager_notified = False
            try:
                manager_email = HRService._find_manager_email(db, emp)
                expires = datetime.datetime.utcnow() + datetime.timedelta(hours=24)
                approve_tok = secrets.token_urlsafe(32)
                reject_tok = secrets.token_urlsafe(32)
                db.add(ApprovalToken(
                    token=approve_tok, entity_type="leave", entity_id=new_leave.id,
                    action="approve", approver_email=manager_email, employee_email=emp.email, expires_at=expires,
                ))
                db.add(ApprovalToken(
                    token=reject_tok, entity_type="leave", entity_id=new_leave.id,
                    action="reject", approver_email=manager_email, employee_email=emp.email, expires_at=expires,
                ))
                db.commit()
                _manager_notified = send_leave_approval_request(
                    user_email=emp.email,
                    employee_name=emp.name, employee_email=emp.email,
                    leave_type=leave_type, start_date=start_date, end_date=end_date,
                    reason=reason,
                    approve_url=f"{settings.APP_BASE_URL}/api/approve/{approve_tok}",
                    reject_url=f"{settings.APP_BASE_URL}/api/approve/{reject_tok}",
                    manager_email=manager_email, leave_id=new_leave.id,
                )
            except Exception as e:
                import logging as _logging
                _logging.getLogger(__name__).warning("[leave] Failed to send manager approval email: %s", e)

            # Send FYI notification to Functional Manager (no approve/reject links)
            try:
                fm_email = HRService._find_functional_manager_email(db, emp)
                if fm_email and fm_email != manager_email:
                    send_leave_fyi_notification(
                        user_email=emp.email,
                        employee_name=emp.name, employee_email=emp.email,
                        leave_type=leave_type, start_date=start_date, end_date=end_date,
                        reason=reason, functional_manager_email=fm_email,
                    )
            except Exception as e:
                import logging as _logging
                _logging.getLogger(__name__).warning("[leave] Failed to send FM FYI email: %s", e)

            _notif_note = (
                " Your reporting manager has been notified for approval."
                if _manager_notified
                else " Note: the notification to your reporting manager could not be sent right now "
                     "(Microsoft 365 may not be connected) — your leave is recorded and your manager "
                     "can still review it from the portal."
            )
            return (
                f"Your {leave_type} leave request from {start_date} to {end_date} has been submitted."
                + _notif_note
            )
        finally:
            db.close()


    @staticmethod
    def submit_hr_query(email: str, category: str, subject: str, description: str) -> str:
        """Public entry point (unchanged behaviour): create the HR query, emit a receipt, and
        return the human string with the inline receipt+undo line appended. The side effect is
        factored into _submit_hr_query_core so the action registry can reuse it and own receipt
        emission itself — see docs/action-registry-design.md."""
        db = SessionLocal()
        try:
            core = HRService._submit_hr_query_core(db, email, category, subject, description)
            try:
                from app.services import receipt_service as _receipt
                _line = _receipt.format_receipt_line(_receipt.emit(
                    core["user_email"], "hr_query", "HR", f"HR query: {subject}",
                    confirmation_id=core["confirmation_id"], idempotency_key=core["confirmation_id"],
                ))
            except Exception:
                _line = ""  # receipt bookkeeping must never break the action
            return core["message"] + (f"\n\n{_line}" if _line else "")
        finally:
            db.close()

    @staticmethod
    def _submit_hr_query_core(db, email: str, category: str, subject: str, description: str) -> dict:
        """Side effect only — create an HR query and notify HR. Returns
        {"confirmation_id", "user_email", "already", "message"} WITHOUT emitting a receipt, so
        each caller (the submit_hr_query shim and the action registry) owns receipt emission."""
        from app.services.email_service import send_hr_query_notification
        emp = HRService.get_employee_by_email(db, email)
        count = db.query(HRQuery).count()
        reference_id = f"HRQ-{count + 1:03}"
        query = HRQuery(
            reference_id=reference_id,
            employee_id=emp.id,
            category=category,
            subject=subject,
            description=description,
        )
        db.add(query)
        db.commit()
        try:
            send_hr_query_notification(
                user_email=emp.email,
                reference_id=reference_id,
                employee_name=emp.name,
                employee_email=emp.email,
                category=category,
                subject=subject,
                description=description,
            )
        except Exception:
            pass
        return {
            "confirmation_id": reference_id,
            "user_email": emp.email,
            "already": False,
            "message": (f"Your HR query has been submitted (Ref: **{reference_id}**). "
                        f"Category: {category}. HR will respond within 2 working days."),
        }

    @staticmethod
    def withdraw_hr_query(reference_id: str, email: str) -> dict:
        """Undo handler for a just-raised HR query. Withdraws it ONLY while still 'Open'
        (HR hasn't started responding). Verifies ownership by employee email."""
        db = SessionLocal()
        try:
            q = db.query(HRQuery).filter(HRQuery.reference_id == reference_id).first()
            if not q:
                return {"success": False, "error": "not_found"}
            emp = HRService.get_employee_by_email(db, email)
            if not emp or q.employee_id != emp.id:
                return {"success": False, "error": "not_owner"}
            if q.status == "Cancelled":
                return {"success": True, "already": True}
            if q.status != "Open":
                return {"success": False, "error": "in_progress",
                        "message": f"HR has already moved this query to '{q.status}', "
                                   f"so it can't be withdrawn automatically."}
            q.status = "Cancelled"
            db.commit()
            return {"success": True}
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
    def get_team_absence(manager_email: str, from_date_str: str = "", to_date_str: str = "") -> str:
        """Return a formatted list of leaves for an employee's team in the given date range."""
        db = SessionLocal()
        try:
            emp = HRService.get_employee_by_email(db, manager_email)
            today = datetime.date.today()
            if from_date_str:
                try:
                    from_dt = datetime.datetime.strptime(from_date_str, "%Y-%m-%d").date()
                except ValueError:
                    from_dt = today
            else:
                # default: current week Monday
                from_dt = today - datetime.timedelta(days=today.weekday())
            if to_date_str:
                try:
                    to_dt = datetime.datetime.strptime(to_date_str, "%Y-%m-%d").date()
                except ValueError:
                    to_dt = from_dt + datetime.timedelta(days=6)
            else:
                to_dt = from_dt + datetime.timedelta(days=6)

            # Find direct reports
            team = db.query(Employee).filter(Employee.manager_id == emp.id).all()
            if not team:
                # Fallback: everyone in the same department
                team = db.query(Employee).filter(
                    Employee.department == emp.department,
                    Employee.id != emp.id,
                ).limit(20).all()

            if not team:
                return "No team members found."

            team_ids = [t.id for t in team]
            leaves = db.query(Leave, Employee).join(
                Employee, Leave.employee_id == Employee.id
            ).filter(
                Leave.employee_id.in_(team_ids),
                Leave.start_date <= to_dt,
                Leave.end_date >= from_dt,
                Leave.status.in_(["Approved", "Pending"]),
            ).all()

            period = f"{from_dt.strftime('%d %b')} – {to_dt.strftime('%d %b %Y')}"
            if not leaves:
                return f"No leaves found for your team during {period}."

            lines = [f"Team leaves — {period}:\n"]
            for leave, member in leaves:
                lines.append(
                    f"- **{member.name}**: {leave.leave_type} | "
                    f"{leave.start_date} to {leave.end_date} | Status: {leave.status}"
                )
            return "\n".join(lines)
        finally:
            db.close()

    @staticmethod
    def submit_grievance(email: str, category: str, description: str, is_anonymous: bool = False) -> str:
        from app.config import settings
        from app.services.email_service import send_grievance_notification
        db = SessionLocal()
        try:
            emp = HRService.get_employee_by_email(db, email)
            count = db.query(Grievance).count()
            reference_id = f"GRV-{count + 1:03}"
            g = Grievance(
                reference_id=reference_id,
                employee_id=None if is_anonymous else emp.id,
                category=category,
                description=description,
                is_anonymous=is_anonymous,
            )
            db.add(g)
            db.commit()
            submitter = "Anonymous" if is_anonymous else emp.name
            send_grievance_notification(
                user_email=emp.email,
                reference_id=reference_id,
                category=category,
                description=description,
                is_anonymous=is_anonymous,
                submitted_by=submitter,
            )
            return (
                f"Your grievance has been submitted (Ref: **{reference_id}**). "
                f"HR will review it within 5 working days. "
                + ("Your identity has been kept anonymous." if is_anonymous else "")
            )
        finally:
            db.close()

    @staticmethod
    def trigger_onboarding(employee_email: str, triggered_by: str = "") -> str:
        from app.config import settings
        from app.services.email_service import send_onboarding_checklist
        db = SessionLocal()
        try:
            emp = HRService.get_employee_by_email(db, employee_email)
            joining = emp.joining_date.strftime("%d %b %Y") if emp.joining_date else "As per offer letter"
            send_onboarding_checklist(
                user_email=triggered_by or employee_email,
                employee_name=emp.name,
                employee_email=emp.email,
                joining_date=joining,
                department=emp.department or "N/A",
                designation=emp.designation or "N/A",
            )
            return (
                f"Onboarding checklist triggered for **{emp.name}** (joining: {joining}). "
                f"Emails sent to IT, Admin, and HR with setup tasks."
            )
        finally:
            db.close()

    @staticmethod
    def trigger_offboarding(employee_email: str, last_day: str = "", triggered_by: str = "") -> str:
        from app.config import settings
        from app.services.email_service import send_offboarding_checklist
        db = SessionLocal()
        try:
            emp = HRService.get_employee_by_email(db, employee_email)
            if not last_day:
                last_day = (datetime.date.today() + datetime.timedelta(days=30)).strftime("%Y-%m-%d")
            manager_email = HRService._find_manager_email(db, emp)
            send_offboarding_checklist(
                user_email=triggered_by or employee_email,
                employee_name=emp.name,
                employee_email=emp.email,
                last_day=last_day,
                department=emp.department or "N/A",
                manager_email=manager_email,
            )
            return (
                f"Offboarding checklist triggered for **{emp.name}** (last day: {last_day}). "
                f"Emails sent to manager, IT, Admin, and HR with clearance tasks."
            )
        finally:
            db.close()

    @staticmethod
    def search_policies(query: str, limit: int = 3, char_budget: int | None = None):
        """Search policies using the enhanced PolicyService (real documents)."""
        try:
            from app.services.policy_service import PolicyService
            return PolicyService.search_policies(query, limit=limit, char_budget=char_budget)
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
                
                return "\n\n".join([f"**{p.title}**\n{(p.content or '')[:3000]}" for p in top_policies])
            finally:
                db.close()
