"""
Smart email generators for each automation catalog kind.

Each public function follows the signature:
    gen_<kind>(rule: AutomationRule) -> tuple[str, str]
                                        (subject, html_body)

The dispatch layer in automation_service._dispatch_smart() calls
    getattr(smart_generators, f"gen_{kind}", None)
so any function named gen_<kind> is automatically reachable.
"""

from __future__ import annotations

import datetime
import html as _html
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import AutomationRule

# ── Shared email shell helpers ─────────────────────────────────────────────────

def _shell(subject: str, intro_html: str, body_html: str, preheader: str = "") -> str:
    from app.services.email_service import _email_shell
    return _email_shell(subject, intro_html, body_html, preheader=preheader)


def _rows(pairs: list[tuple[str, str]]) -> str:
    from app.services.email_service import _detail_rows
    return _detail_rows(pairs)


def _pill(text: str, color: str) -> str:
    from app.services.email_service import _status_pill
    return _status_pill(text, color)


def _note(text: str) -> str:
    from app.services.email_service import _note as _n
    return _n(text)


_C_OK     = "#16A34A"
_C_WARN   = "#F59E0B"
_C_ERR    = "#DC2626"
_C_BLUE   = "#3B82F6"
_C_PURPLE = "#7C3AED"
_C_SLATE  = "#64748B"
_C_PRIMARY = "#0d1b2e"
FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def _tbl(headers: list[str], rows: list[list[str]], accent: str = _C_PRIMARY) -> str:
    head = "".join(
        f'<th style="padding:8px 10px;background:{accent};color:#fff;'
        f'font:700 11px {FONT};text-align:left;white-space:nowrap;">{h}</th>'
        for h in headers
    )
    body = ""
    for i, row in enumerate(rows[:60]):
        bg = "#ffffff" if i % 2 == 0 else "#f5f8fc"
        cells = "".join(
            f'<td style="padding:7px 10px;background:{bg};font:400 12px {FONT};'
            f'color:#374151;white-space:nowrap;">{_html.escape(str(c))}</td>'
            for c in row
        )
        body += f"<tr>{cells}</tr>"
    overflow = len(rows) - 60
    overflow_note = _note(f"Showing first 60 of {len(rows)} rows.") if overflow > 0 else ""
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden;'
        f'margin:16px 0;border:1px solid #e6edf6;">'
        f'<tr>{head}</tr>{body}</table>{overflow_note}'
    )


def _fmt_date(d) -> str:
    if d is None:
        return "—"
    if isinstance(d, datetime.date):
        return d.strftime("%d %b %Y")
    return str(d)


def _today_str() -> str:
    return datetime.datetime.now().strftime("%d %b %Y")


# ── Hierarchy scoping ───────────────────────────────────────────────────────────
# People-data automations (attendance, leave, onboarding, allocation, training, IT
# tickets) must only ever expose the rule creator's own reporting hierarchy —
# the creator plus every descendant beneath them in the org tree. Super Admin is the
# SOLE role with organization-wide visibility (product decision, 2026-07-09).
#
# This mirrors attendance_service.team_report() / access_control's self-manager-HR
# model, tightened to a Super-Admin-only bypass. Every generator that reads
# per-employee data resolves a _Scope up front and filters rows through it. A
# non-Super-Admin owner who cannot be placed in the org tree fails CLOSED (empty
# report) rather than leaking the whole org.

from dataclasses import dataclass, field


@dataclass
class _Scope:
    unrestricted: bool                              # True only for Super Admin
    ids: set = field(default_factory=set)           # allowed Employee.id (int)
    names: set = field(default_factory=set)         # allowed lowercased Employee.name
    emails: set = field(default_factory=set)        # allowed lowercased Employee.email
    label: str = ""                                 # human line rendered in the email footer

    def by_id(self, employee_id) -> bool:
        if self.unrestricted:
            return True
        try:
            return int(employee_id) in self.ids
        except (TypeError, ValueError):
            return False

    def by_name(self, name) -> bool:
        if self.unrestricted:
            return True
        return bool(name) and str(name).strip().lower() in self.names

    def by_any(self, employee_id=None, name=None, email=None) -> bool:
        if self.unrestricted:
            return True
        if employee_id is not None and self.by_id(employee_id):
            return True
        if email and str(email).strip().lower() in self.emails:
            return True
        return bool(name) and str(name).strip().lower() in self.names


def _resolve_scope(rule: "AutomationRule") -> _Scope:
    """Resolve the set of employees the rule owner may see, from rule.created_by
    (email) and rule.created_by_role. Super Admin → unrestricted; everyone else →
    their own reporting tree (creator + descendants); unresolvable owner → empty."""
    role = (getattr(rule, "created_by_role", "") or "").strip().lower()
    if role == "super admin":
        return _Scope(unrestricted=True, label="Scope: organization-wide (Super Admin).")

    from app.database import SessionLocal
    from app.services.attendance_service import resolve_employee, descendants

    db = SessionLocal()
    try:
        owner_email = getattr(rule, "created_by", None)
        creator = resolve_employee(db, owner_email) if owner_email else None
        if not creator:
            return _Scope(
                unrestricted=False,
                label="Scope: no reporting hierarchy could be resolved for the automation "
                      "owner, so this report is intentionally empty.",
            )
        members = [creator] + descendants(db, creator.id)
        ids = {e.id for e in members}
        names = {(e.name or "").strip().lower() for e in members if e.name}
        emails = {(e.email or "").strip().lower() for e in members if e.email}
        return _Scope(
            unrestricted=False, ids=ids, names=names, emails=emails,
            label=f"Scope: {creator.name or creator.email}'s reporting hierarchy "
                  f"({len(ids)} employee(s)).",
        )
    finally:
        db.close()


def _scope_note(scope: _Scope) -> str:
    return _note(scope.label) if scope.label else ""


# ── Leave balance report ───────────────────────────────────────────────────────

def gen_leave_balance_report(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import Employee, LeaveBalance, LeaveType

    today = _today_str()
    year = datetime.datetime.now().year
    subject = f"Team Leave Balance Report — {datetime.datetime.now().strftime('%B %Y')}"

    # Only ever the rule owner's reporting hierarchy (Super Admin = org-wide).
    scope = _resolve_scope(rule)

    # Source of truth is the LeaveBalance / LeaveType DB tables (same data the chat
    # `get_leave_balance` tool serves) — one row per employee × leave type for the
    # current year. LWP is excluded (it's "no limit", nothing to report a balance for).
    #
    # Balances are materialised lazily (the chat tool inits a user's rows on first
    # query), so a team report first ensures every in-scope employee has current-year
    # rows — otherwise the roster reads empty.
    db = SessionLocal()
    try:
        from app.hr_service import HRService
        emp_q = db.query(Employee.id, Employee.joining_date)
        if not scope.unrestricted:
            emp_q = emp_q.filter(Employee.id.in_(scope.ids or {-1}))
        for emp in emp_q.all():
            HRService._init_employee_balances(db, emp.id, emp.joining_date)
        db.commit()

        rows_q = (
            db.query(
                Employee.name,
                Employee.employee_id,
                LeaveType.name.label("leave_name"),
                LeaveType.is_earned,
                LeaveBalance.balance,
                LeaveBalance.used,
                LeaveBalance.earned,
            )
            .join(LeaveBalance, LeaveBalance.employee_id == Employee.id)
            .join(LeaveType, LeaveType.id == LeaveBalance.leave_type_id)
            .filter(
                LeaveBalance.year == year,
                LeaveType.is_active.is_(True),
                LeaveType.code != "LWP",
            )
        )
        if not scope.unrestricted:
            rows_q = rows_q.filter(Employee.id.in_(scope.ids or {-1}))
        rows = rows_q.order_by(Employee.name.asc(), LeaveType.name.asc()).all()
    finally:
        db.close()

    flat: list[list[str]] = []
    seen_emps: set[str] = set()
    for r in rows:
        # Show earned credits alongside used for earned types (e.g. Comp Off).
        used_str = f"{r.used or 0}" + (f" (+{r.earned or 0} earned)" if r.is_earned else "")
        flat.append([
            r.name or r.employee_id or "—",
            r.employee_id or "—",
            r.leave_name or "—",
            str(r.balance if r.balance is not None else 0),
            used_str,
        ])
        seen_emps.add(r.employee_id or r.name or "")
    emp_count = len(seen_emps)

    intro = (
        f'<p>{_pill("Team Leave Balance", _C_OK)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">Report generated on <strong>{today}</strong>.</p>'
    )
    summary = _rows([
        ("Report Date", today),
        ("Employees with Data", str(emp_count)),
        ("Leave Records", str(len(flat))),
    ])
    if flat:
        tbl = _tbl(["Employee", "Code", "Leave Type", "Balance (days)", "Used (days)"], flat, _C_OK)
    else:
        tbl = '<p style="color:#64748B;">No leave balance data available.</p>'

    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · HR Portal Automation")
    return subject, _shell(subject, intro, body, preheader=f"Team leave balances as of {today}")


# ── Attendance summary ─────────────────────────────────────────────────────────

def gen_attendance_summary(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import Attendance, Employee
    from sqlalchemy import func

    cfg = rule.extra_config or {}
    period = cfg.get("period", "last_week")
    now = datetime.datetime.now().date()
    if period == "last_week":
        from_date = now - datetime.timedelta(days=7)
        period_label = "Last 7 Days"
    elif period == "last_month":
        from_date = now - datetime.timedelta(days=30)
        period_label = "Last 30 Days"
    else:
        from_date = now.replace(day=1)
        period_label = f"Current Month ({now.strftime('%B %Y')})"

    subject = f"Team Attendance Summary — {period_label}"

    # Only ever the rule owner's reporting hierarchy (Super Admin = org-wide).
    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        rows_q = (
            db.query(Attendance)
            .filter(Attendance.date >= from_date, Attendance.date <= now)
        )
        if not scope.unrestricted:
            rows_q = rows_q.filter(Attendance.employee_id.in_(scope.ids or {-1}))
        rows = rows_q.all()

        emp_q = db.query(Employee)
        if not scope.unrestricted:
            emp_q = emp_q.filter(Employee.id.in_(scope.ids or {-1}))
        emp_map: dict[int, str] = {
            e.id: (e.name or e.email or str(e.id))
            for e in emp_q.all()
        }
    finally:
        db.close()

    total = len(rows)
    status_counts: dict[str, int] = {}
    emp_rows: dict[int, dict] = {}
    for r in rows:
        s = r.status or "Unknown"
        status_counts[s] = status_counts.get(s, 0) + 1
        eid = r.employee_id
        if eid not in emp_rows:
            emp_rows[eid] = {"name": emp_map.get(eid, str(eid)), "Present": 0, "Absent": 0, "WFH": 0, "Half-day": 0}
        k = s if s in emp_rows[eid] else "Present"
        emp_rows[eid][k] = emp_rows[eid].get(k, 0) + 1

    intro = (
        f'<p>{_pill("Attendance Summary", _C_BLUE)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">Period: <strong>{period_label}</strong> · {_today_str()}</p>'
    )
    summary = _rows([
        ("Period", period_label),
        ("Total Records", str(total)),
        ("Present", str(status_counts.get("Present", 0))),
        ("Absent", str(status_counts.get("Absent", 0))),
        ("WFH", str(status_counts.get("WFH", 0))),
        ("Half-day", str(status_counts.get("Half-day", 0))),
    ])
    tbl_data = [
        [v["name"], str(v.get("Present", 0)), str(v.get("Absent", 0)),
         str(v.get("WFH", 0)), str(v.get("Half-day", 0))]
        for v in sorted(emp_rows.values(), key=lambda x: x["name"])
    ]
    tbl = _tbl(["Employee", "Present", "Absent", "WFH", "Half-day"], tbl_data, _C_BLUE)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · HR Portal Automation")
    return subject, _shell(subject, intro, body, preheader=f"Attendance snapshot — {period_label}")


# ── IT ticket backlog ──────────────────────────────────────────────────────────

def gen_it_ticket_digest(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import ITTicket

    cfg = rule.extra_config or {}
    include_in_progress = cfg.get("include_in_progress", True)
    today = _today_str()
    subject = f"IT Ticket Status Report — {today}"

    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        statuses = ["Open", "Awaiting Approval"]
        if include_in_progress:
            statuses.append("In Progress")
        tickets_q = (
            db.query(ITTicket)
            .filter(ITTicket.status.in_(statuses))
        )
        if not scope.unrestricted:
            tickets_q = tickets_q.filter(ITTicket.employee_id.in_(scope.ids or {-1}))
        tickets = tickets_q.order_by(ITTicket.created_at.asc()).all()
    finally:
        db.close()

    priority_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
    tickets_sorted = sorted(tickets, key=lambda t: priority_order.get(t.priority or "Low", 4))

    priority_counts: dict[str, int] = {}
    for t in tickets_sorted:
        p = t.priority or "Unknown"
        priority_counts[p] = priority_counts.get(p, 0) + 1

    # Flag old tickets (>7 days)
    now = datetime.datetime.now()
    aging = [t for t in tickets_sorted if t.created_at and (now - t.created_at).days > 7]

    intro = (
        f'<p>{_pill("IT Ticket Backlog", _C_BLUE)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">Open tickets as of <strong>{today}</strong>.</p>'
    )
    summary = _rows([
        ("Report Date", today),
        ("Total Open", str(len(tickets_sorted))),
        ("Critical", str(priority_counts.get("Critical", 0))),
        ("High", str(priority_counts.get("High", 0))),
        ("Medium", str(priority_counts.get("Medium", 0))),
        ("Aging >7 days", str(len(aging))),
    ])
    tbl_data = [
        [
            str(t.ticket_id or t.id),
            t.category or "—",
            (t.subject or "")[:60],
            t.priority or "—",
            t.status or "—",
            t.assigned_to or "Unassigned",
            str((now - t.created_at).days) + "d" if t.created_at else "—",
        ]
        for t in tickets_sorted[:60]
    ]
    tbl = _tbl(["Ticket", "Category", "Subject", "Priority", "Status", "Assigned To", "Age"], tbl_data, _C_BLUE)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · IT Portal Automation")
    return subject, _shell(subject, intro, body, preheader=f"{len(tickets_sorted)} open IT tickets")


# ── IT overdue tickets alert ───────────────────────────────────────────────────

def gen_it_overdue_tickets_alert(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import ITTicket

    cfg = rule.extra_config or {}
    overdue_days = int(cfg.get("overdue_days") or 5)
    min_priority = cfg.get("min_priority", "High")
    priority_tiers = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
    min_tier = priority_tiers.get(min_priority, 1)

    now = datetime.datetime.now()
    cutoff = now - datetime.timedelta(days=overdue_days)
    subject = f"IT SLA Alert — Tickets Open >{overdue_days} Days"

    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        tickets_q = (
            db.query(ITTicket)
            .filter(
                ITTicket.status.in_(["Open", "In Progress", "Awaiting Approval"]),
                ITTicket.created_at <= cutoff,
            )
        )
        if not scope.unrestricted:
            tickets_q = tickets_q.filter(ITTicket.employee_id.in_(scope.ids or {-1}))
        tickets = tickets_q.all()
    finally:
        db.close()

    filtered = [
        t for t in tickets
        if priority_tiers.get(t.priority or "Low", 4) <= min_tier
    ]
    filtered_sorted = sorted(filtered, key=lambda t: priority_tiers.get(t.priority or "Low", 4))

    intro = (
        f'<p>{_pill("SLA Alert", _C_ERR)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">'
        f'<strong>{len(filtered_sorted)}</strong> ticket(s) have been open for more than <strong>{overdue_days} days</strong>.</p>'
    )
    summary = _rows([
        ("SLA Threshold", f"{overdue_days} days"),
        ("Min Priority Filter", min_priority),
        ("Overdue Tickets", str(len(filtered_sorted))),
        ("Report Date", _today_str()),
    ])
    tbl_data = [
        [
            str(t.ticket_id or t.id),
            (t.subject or "")[:60],
            t.priority or "—",
            t.status or "—",
            t.assigned_to or "Unassigned",
            str((now - t.created_at).days) + "d" if t.created_at else "—",
        ]
        for t in filtered_sorted
    ]
    tbl = _tbl(["Ticket", "Subject", "Priority", "Status", "Assigned To", "Age"], tbl_data, _C_ERR)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · IT Portal Automation")
    return subject, _shell(subject, intro, body, preheader=f"SLA breach: {len(filtered_sorted)} overdue tickets")


# ── Leave approval reminder ────────────────────────────────────────────────────

def gen_leave_approval_reminder(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import Leave, Employee

    cfg = rule.extra_config or {}
    pending_days_min = int(cfg.get("pending_days_min") or 0)
    now = datetime.datetime.now()
    cutoff = now - datetime.timedelta(days=pending_days_min) if pending_days_min else None

    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        q = db.query(Leave).filter(Leave.status == "Pending")
        if not scope.unrestricted:
            q = q.filter(Leave.employee_id.in_(scope.ids or {-1}))
        pending = q.all()
        emp_q = db.query(Employee)
        if not scope.unrestricted:
            emp_q = emp_q.filter(Employee.id.in_(scope.ids or {-1}))
        emp_map: dict[str, str] = {
            str(e.id): (e.name or e.email or str(e.id))
            for e in emp_q.all()
        }
    finally:
        db.close()

    if cutoff:
        pending = [
            l for l in pending
            if l.created_at and l.created_at <= cutoff
        ]

    subject = f"Pending Leave Requests — {len(pending)} Awaiting Approval"
    intro = (
        f'<p>{_pill("Leave Approval Needed", _C_WARN)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">'
        f'<strong>{len(pending)}</strong> leave request(s) are pending your approval.</p>'
    )
    summary = _rows([
        ("Report Date", _today_str()),
        ("Pending Requests", str(len(pending))),
        ("Min Pending Days", str(pending_days_min) if pending_days_min else "All"),
    ])

    tbl_data = []
    for l in sorted(pending, key=lambda x: x.created_at or datetime.datetime.min):
        emp_name = emp_map.get(str(l.employee_id), str(l.employee_id))
        days_pending = (now - l.created_at).days if l.created_at else "—"
        tbl_data.append([
            emp_name,
            l.leave_type or "—",
            _fmt_date(l.start_date),
            _fmt_date(l.end_date),
            str(l.days or "—"),
            str(days_pending) + "d" if isinstance(days_pending, int) else days_pending,
        ])
    tbl = _tbl(["Employee", "Leave Type", "From", "To", "Days", "Pending For"], tbl_data, _C_WARN)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · HR Portal Automation")
    return subject, _shell(subject, intro, body, preheader=f"{len(pending)} leave requests need action")


# ── Bench & utilization report ─────────────────────────────────────────────────

def gen_bench_utilization_report(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import EmployeeAllocation

    today = _today_str()
    subject = f"Bench & Utilization Report — {datetime.datetime.now().strftime('%B %Y')}"

    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        allocs = db.query(EmployeeAllocation).all()
    finally:
        db.close()

    if not scope.unrestricted:
        # Allocations link to people by name (no FK to employees.id), so scope by name.
        allocs = [a for a in allocs if scope.by_name(a.employee_name)]

    bench = [a for a in allocs if (a.billability_percent or 0) == 0 or (a.project_name or "").lower() == "bench"]
    billable = [a for a in allocs if (a.billability_percent or 0) > 0 and (a.project_name or "").lower() != "bench"]
    total = len(allocs)
    bench_count = len({a.employee_name for a in bench})
    billable_count = len({a.employee_name for a in billable})
    util_pct = round(billable_count / max(total, 1) * 100, 1)

    intro = (
        f'<p>{_pill("Workforce Utilization", _C_BLUE)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">Report as of <strong>{today}</strong>.</p>'
    )
    summary = _rows([
        ("Report Date", today),
        ("Total Allocations", str(total)),
        ("Bench Headcount", str(bench_count)),
        ("Billable Headcount", str(billable_count)),
        ("Utilization %", f"{util_pct}%"),
    ])
    bench_tbl_data = [
        [a.employee_name or "—", str(a.billability_percent or 0) + "%", a.project_status or "—"]
        for a in bench[:60]
    ]
    tbl = _tbl(["Employee", "Billability %", "Status"], bench_tbl_data, _C_BLUE)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · PMO Automation")
    return subject, _shell(subject, intro, body, preheader=f"Utilization: {util_pct}% | Bench: {bench_count}")


# ── Training compliance report ─────────────────────────────────────────────────

def gen_training_compliance_report(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import TeAssignment

    cfg = rule.extra_config or {}
    overdue_only = cfg.get("overdue_only", False)
    today_date = datetime.datetime.now().date()
    today = _today_str()
    subject = f"Training Compliance Report — {today}"

    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        from sqlalchemy.orm import joinedload
        assignments = db.query(TeAssignment).options(joinedload(TeAssignment.training)).all()
    finally:
        db.close()

    if not scope.unrestricted:
        assignments = [
            a for a in assignments
            if scope.by_any(employee_id=a.employee_id, name=a.employee_name, email=a.employee_email)
        ]

    if overdue_only:
        assignments = [
            a for a in assignments
            if a.due_date and a.due_date < today_date and a.status not in ("Completed",)
        ]

    completed = [a for a in assignments if a.status == "Completed"]
    overdue = [
        a for a in assignments
        if a.due_date and a.due_date < today_date and a.status not in ("Completed",)
    ]
    in_progress = [a for a in assignments if a.status == "In Progress"]

    comp_rate = round(len(completed) / max(len(assignments), 1) * 100, 1)

    intro = (
        f'<p>{_pill("Training Compliance", _C_PURPLE)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">'
        f'Compliance rate: <strong>{comp_rate}%</strong> · Report date: {today}</p>'
    )
    summary = _rows([
        ("Report Date", today),
        ("Total Assignments", str(len(assignments))),
        ("Completed", str(len(completed))),
        ("In Progress", str(len(in_progress))),
        ("Overdue", str(len(overdue))),
        ("Compliance Rate", f"{comp_rate}%"),
    ])
    show = assignments if not overdue_only else overdue
    tbl_data = [
        [
            a.employee_name or "—",
            (a.training.title if a.training else None) or "—",
            a.status or "Assigned",
            _fmt_date(a.due_date),
            "Overdue" if a.due_date and a.due_date < today_date and a.status not in ("Completed",) else a.status or "—",
        ]
        for a in sorted(show, key=lambda x: x.due_date or datetime.date.max)
    ]
    tbl = _tbl(["Employee", "Course", "Status", "Due Date", "Flag"], tbl_data, _C_PURPLE)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · TechElevate Automation")
    return subject, _shell(subject, intro, body, preheader=f"Training compliance: {comp_rate}%")


# ── Training due reminder ──────────────────────────────────────────────────────

def gen_training_due_reminder(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import TeAssignment

    cfg = rule.extra_config or {}
    due_within_days = int(cfg.get("due_within_days") or 7)
    today_date = datetime.datetime.now().date()
    deadline = today_date + datetime.timedelta(days=due_within_days)
    today = _today_str()
    subject = f"Training Deadline Reminder — Due in {due_within_days} Days"

    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        from sqlalchemy.orm import joinedload
        assignments = db.query(TeAssignment).options(joinedload(TeAssignment.training)).all()
    finally:
        db.close()

    if not scope.unrestricted:
        assignments = [
            a for a in assignments
            if scope.by_any(employee_id=a.employee_id, name=a.employee_name, email=a.employee_email)
        ]

    due_soon = [
        a for a in assignments
        if a.due_date and today_date <= a.due_date <= deadline and a.status not in ("Completed",)
    ]

    intro = (
        f'<p>{_pill("Training Due Soon", _C_WARN)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">'
        f'<strong>{len(due_soon)}</strong> assignment(s) due within the next <strong>{due_within_days} days</strong>.</p>'
    )
    summary = _rows([
        ("Reminder Date", today),
        ("Due Within", f"{due_within_days} days"),
        ("Assignments Due Soon", str(len(due_soon))),
    ])
    tbl_data = [
        [
            a.employee_name or "—",
            (a.training.title if a.training else None) or "—",
            a.status or "Assigned",
            _fmt_date(a.due_date),
            str((a.due_date - today_date).days) + "d remaining" if a.due_date else "—",
        ]
        for a in sorted(due_soon, key=lambda x: x.due_date or datetime.date.max)
    ]
    tbl = _tbl(["Employee", "Course", "Status", "Due Date", "Days Left"], tbl_data, _C_WARN)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · TechElevate Automation")
    return subject, _shell(subject, intro, body, preheader=f"{len(due_soon)} training deadlines approaching")


# ── Inactive Udemy learners (catalog alias for udemy_inactive) ─────────────────

def gen_inactive_udemy_digest(rule: "AutomationRule") -> tuple[str, str]:
    """Alias into the existing udemy_inactive renderer."""
    from app.services.automation_service import _render_udemy_inactive
    report_html, _, users = _render_udemy_inactive(rule)
    cfg = rule.extra_config or {}
    inactive_days = int(cfg.get("inactive_days") or 14)
    subject = f"Udemy Inactive Learners — {len(users)} Idle >{inactive_days}d"
    return subject, report_html


# ── Project delivery status report ────────────────────────────────────────────

def gen_project_status_report(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import EmployeeAllocation

    cfg = rule.extra_config or {}
    active_only = cfg.get("active_only", True)
    today = _today_str()
    subject = f"Project Delivery Status — Week of {today}"

    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        allocs = db.query(EmployeeAllocation).all()
    finally:
        db.close()

    if not scope.unrestricted:
        allocs = [a for a in allocs if scope.by_name(a.employee_name)]

    if active_only:
        allocs = [a for a in allocs if (a.project_status or "").lower() in ("active", "ongoing", "in progress")]

    # Group by project name
    by_project: dict[str, list] = {}
    for a in allocs:
        pname = a.project_name or "Unknown"
        if pname not in by_project:
            by_project[pname] = []
        by_project[pname].append(a)

    intro = (
        f'<p>{_pill("Project Status", _C_PURPLE)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">Delivery snapshot as of <strong>{today}</strong>.</p>'
    )
    summary = _rows([
        ("Report Date", today),
        ("Projects Listed", str(len(by_project))),
        ("Total Allocations", str(len(allocs))),
        ("Filter", "Active only" if active_only else "All statuses"),
    ])
    tbl_data = []
    for pname, members in sorted(by_project.items()):
        avg_bill = round(sum(a.billability_percent or 0 for a in members) / len(members), 0)
        status = members[0].project_status or "—"
        tbl_data.append([pname, str(len(members)), f"{int(avg_bill)}%", status])
    tbl = _tbl(["Project", "Team Size", "Avg Billability", "Status"], tbl_data, _C_PURPLE)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · PMO Automation")
    return subject, _shell(subject, intro, body, preheader=f"{len(by_project)} active projects")


# ── Onboarding pending reminder ────────────────────────────────────────────────

def gen_onboarding_pending_reminder(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import OnboardingJourney, OnboardingStepProgress, Employee
    from sqlalchemy.orm import joinedload

    cfg = rule.extra_config or {}
    stalled_days = int(cfg.get("stalled_days") or 2)
    now = datetime.datetime.now()
    stall_cutoff = now - datetime.timedelta(days=stalled_days)
    today = _today_str()

    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        journeys_q = (
            db.query(OnboardingJourney)
            .options(joinedload(OnboardingJourney.employee), joinedload(OnboardingJourney.steps))
            .filter(OnboardingJourney.status != "completed")
        )
        if not scope.unrestricted:
            journeys_q = journeys_q.filter(OnboardingJourney.employee_id.in_(scope.ids or {-1}))
        journeys = journeys_q.all()
    finally:
        db.close()

    stalled = []
    for j in journeys:
        latest = max(
            (s.updated_at or s.created_at for s in j.steps),
            default=j.created_at,
        )
        if latest is None or (isinstance(latest, datetime.datetime) and latest <= stall_cutoff):
            stalled.append(j)

    subject = f"Onboarding Steps Pending — {len(stalled)} Journeys Need Attention"
    intro = (
        f'<p>{_pill("Onboarding Alert", _C_PURPLE)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">'
        f'<strong>{len(stalled)}</strong> onboarding journey(s) have been stalled for more than <strong>{stalled_days} day(s)</strong>.</p>'
    )
    summary = _rows([
        ("Report Date", today),
        ("Stalled Threshold", f"{stalled_days} days"),
        ("Stalled Journeys", str(len(stalled))),
        ("Total Active Journeys", str(len(journeys))),
    ])
    tbl_data = [
        [
            (j.employee.name if j.employee else None) or str(j.employee_id),
            (j.employee.email if j.employee else None) or "—",
            j.status or "active",
            _fmt_date(j.started_at.date() if j.started_at else None),
        ]
        for j in sorted(stalled, key=lambda x: x.started_at or datetime.datetime.min)
    ]
    tbl = _tbl(["New Joiner", "Email", "Status", "Start Date"], tbl_data, _C_PURPLE)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · HR Onboarding Automation")
    return subject, _shell(subject, intro, body, preheader=f"{len(stalled)} onboarding journeys need attention")


# ── Expense cutoff reminder ────────────────────────────────────────────────────

def gen_expense_cutoff_reminder(rule: "AutomationRule") -> tuple[str, str]:
    cfg = rule.extra_config or {}
    cutoff_day = int(cfg.get("cutoff_day") or 20)
    now = datetime.datetime.now()
    cutoff_date = now.replace(day=cutoff_day).date()
    if cutoff_date < now.date():
        # Already past this month — show next month
        if now.month == 12:
            cutoff_date = cutoff_date.replace(year=now.year + 1, month=1)
        else:
            cutoff_date = cutoff_date.replace(month=now.month + 1)

    days_left = (cutoff_date - now.date()).days
    subject = f"Expense Reimbursement Cutoff — Submit by {_fmt_date(cutoff_date)}"

    intro = (
        f'<p>{_pill("Expense Submission Reminder", _C_WARN)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">'
        f'The monthly expense cutoff is in <strong>{days_left} day(s)</strong> — <strong>{_fmt_date(cutoff_date)}</strong>.</p>'
    )
    body_html = (
        _rows([
            ("Submission Deadline", _fmt_date(cutoff_date)),
            ("Days Remaining", str(days_left)),
            ("Late submissions", "Not accepted after cutoff"),
        ])
        + f'<p style="font-size:14px;color:#374151;margin:16px 0;">Please submit all eligible expense claims before the cutoff date. '
          f'Late submissions will not be processed until the following cycle.</p>'
        + f'<p style="font-size:13px;color:#64748B;margin:8px 0;">Steps:<br>'
          f'1. Log in to the Admin Portal → Expenses section.<br>'
          f'2. Upload receipts and fill in the expense form.<br>'
          f'3. Submit before <strong>{_fmt_date(cutoff_date)}</strong>.</p>'
        + _note("Generated by Centriq AI · Admin Portal Automation")
    )
    return subject, _shell(subject, intro, body_html, preheader=f"Expense cutoff in {days_left} days")


# ── Team learning digest ───────────────────────────────────────────────────────

def gen_team_learning_digest(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import TeAssignment

    cfg = rule.extra_config or {}
    source = cfg.get("source", "te_lms")
    today = _today_str()
    week_label = f"Week of {today}"
    subject = f"Team Learning Digest — {week_label}"

    scope = _resolve_scope(rule)

    rows_data: list[list[str]] = []

    if source in ("te_lms", "both"):
        db = SessionLocal()
        try:
            from sqlalchemy.orm import joinedload
            assignments = db.query(TeAssignment).options(joinedload(TeAssignment.training)).all()
        finally:
            db.close()
        if not scope.unrestricted:
            assignments = [
                a for a in assignments
                if scope.by_any(employee_id=a.employee_id, name=a.employee_name, email=a.employee_email)
            ]
        for a in assignments:
            status = a.status or "Assigned"
            rows_data.append([
                a.employee_name or "—",
                (a.training.title if a.training else None) or "—",
                "TechElevate",
                status,
                "✓" if status == "Completed" else ("⏳" if status == "In Progress" else "—"),
            ])

    if source in ("udemy", "both"):
        try:
            from app.services import udemy_business_service as udemy
            if udemy.configured():
                result = udemy.get_user_list()
                udemy_users = result.get("results") or []
                if not scope.unrestricted:
                    udemy_users = [
                        u for u in udemy_users
                        if (u.get("email") or "").strip().lower() in scope.emails
                    ]
                for u in udemy_users[:100]:
                    rows_data.append([
                        u.get("display_name") or u.get("email") or "—",
                        "— (Udemy Business)",
                        "Udemy Business",
                        "—",
                        "Active" if u.get("is_active") else "Inactive",
                    ])
        except Exception:
            pass

    completed = sum(1 for r in rows_data if r[4] == "Complete")
    in_progress = sum(1 for r in rows_data if r[4] == "In Progress")
    not_started = sum(1 for r in rows_data if r[4] == "Not Started")

    intro = (
        f'<p>{_pill("Learning Digest", _C_PURPLE)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">{week_label}</p>'
    )
    summary = _rows([
        ("Period", week_label),
        ("Total Learners", str(len(rows_data))),
        ("Completed", str(completed)),
        ("In Progress", str(in_progress)),
        ("Not Started", str(not_started)),
    ])
    tbl = _tbl(["Employee", "Course", "Platform", "Status", "Done?"], rows_data, _C_PURPLE)
    body = summary + tbl + _scope_note(scope) + _note("Generated by Centriq AI · Learning Automation")
    return subject, _shell(subject, intro, body, preheader=f"Learning digest: {completed} completed this week")


# ── Workforce readiness digest ─────────────────────────────────────────────────

def gen_workforce_readiness_digest(rule: "AutomationRule") -> tuple[str, str]:
    from app.database import SessionLocal
    from app.models import EmployeeAllocation

    today = _today_str()
    week_label = f"Week of {today}"
    subject = f"Workforce Readiness Digest — {week_label}"

    scope = _resolve_scope(rule)

    db = SessionLocal()
    try:
        allocs = db.query(EmployeeAllocation).all()
    finally:
        db.close()

    if not scope.unrestricted:
        allocs = [a for a in allocs if scope.by_name(a.employee_name)]

    total_employees = len({a.employee_name for a in allocs})
    bench = [a for a in allocs if (a.billability_percent or 0) == 0]
    bench_count = len({a.employee_name for a in bench})
    billable_count = total_employees - bench_count
    util_pct = round(billable_count / max(total_employees, 1) * 100, 1)
    active = [a for a in allocs if (a.project_status or "").lower() == "active"]
    active_projects = len({a.project_name for a in active})

    intro = (
        f'<p>{_pill("Workforce Readiness", _C_BLUE)}</p>'
        f'<p style="margin:0 0 12px;font-size:14px;color:#374151;">{week_label} — leadership snapshot</p>'
    )
    summary = _rows([
        ("Period", week_label),
        ("Total Employees", str(total_employees)),
        ("Bench Headcount", str(bench_count)),
        ("Billable Headcount", str(billable_count)),
        ("Utilization %", f"{util_pct}%"),
        ("Active Projects", str(active_projects)),
    ])
    bench_names = sorted({a.employee_name for a in bench})[:30]
    bench_block = ""
    if bench_names:
        bench_block = (
            f'<p style="font-size:13px;font-weight:700;color:{_C_PRIMARY};margin:16px 0 8px;">Bench Employees ({bench_count})</p>'
            + "".join(
                f'<span style="display:inline-block;margin:2px 4px;padding:3px 10px;'
                f'background:#f1f5f9;border:1px solid #e2e8f0;border-radius:20px;'
                f'font-size:12px;color:#334155;">{_html.escape(n)}</span>'
                for n in bench_names
            )
        )
        if bench_count > 30:
            bench_block += _note(f"…and {bench_count - 30} more on bench.")

    body = summary + bench_block + _scope_note(scope) + _note("Generated by Centriq AI · Leadership Automation")
    return subject, _shell(subject, intro, body, preheader=f"Utilization: {util_pct}% | Bench: {bench_count}")
