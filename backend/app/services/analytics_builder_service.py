"""
Analytics Builder — conversational chart-building agent.

The user describes what they want in natural language; the LLM maps it to one of
the safe, pre-defined query templates below and returns a fully-specified ChartSpec.
No raw SQL is ever accepted from the client.
"""

from __future__ import annotations

import datetime
import logging
from typing import Any, Optional

from pydantic import BaseModel, Field
from sqlalchemy import func, case, and_
from sqlalchemy.orm import Session

from app.models import (
    Employee, EmployeeZohoProfile, MS365User, EmployeeAllocation,
    Leave, AiRequestLog, ChatFeedback, AiLlmCallLog,
    # Dynamic query data sources
    ITTicket, SoftwareRequest, AssetAssignment, AssetRequest,
    Reimbursement, Grievance, HRQuery, TravelRequest, TravelExpenseClaim,
    ParkingSticker, FacilityComplaint, FoodVendorFeedback,
    VisitorPass, DeskKeyRequest, Announcement,
    TeAssignment, TeTraining, UdemyLicenseRequest, BookRequest,
    Escalation, FormSubmission, OnboardingJourney,
    EmployeeSkill, Appreciation, ProjectProfile, Attendance,
)
from app.services.analytics_service import run_query, _period_cutoff, _PERIODS
from app.services.allocation_snapshot_service import latest_snapshot_date

log = logging.getLogger(__name__)

CHART_TYPES = ["bar", "line", "area", "pie", "scatter", "radar", "treemap", "funnel", "composed"]
PERIODS = list(_PERIODS.keys())  # 24h, 7d, 30d, 90d, 6m, 12m

# ── ChartSpec ──────────────────────────────────────────────────────────────────────────────
# Richer than the legacy {series: [{label,value}]} — supports multi-series, named axes, etc.

class ChartSpec(BaseModel):
    type: str
    title: str
    subtitle: Optional[str] = None
    data: list[dict[str, Any]]
    x_key: str
    y_keys: list[str]
    y_labels: dict[str, str] = Field(default_factory=dict)
    colors: list[str] = Field(default_factory=list)
    unit: Optional[str] = None
    stacked: bool = False
    label_key: Optional[str] = None   # for scatter: which key holds the point label


# ── LLM intent model ─────────────────────────────────────────────────────────────────────

_TEMPLATE_DOCS = """\
Available query templates (use exact id):

EMPLOYEE HEADCOUNT (from EmployeeZohoProfile / Employee tables):
  headcount_by_function     — count employees per function
  headcount_by_grade        — count employees per grade
  headcount_by_gender       — count employees per gender
  headcount_by_level        — count employees per level
  headcount_by_location     — count employees per office location from Azure AD (city/office)
  headcount_by_department   — count employees per department
  headcount_by_employment_type — count by employment type (Full-time/Contract)
  joining_trend             — new joiners per month. params: { period: "6m"|"12m"|"24m" }
  headcount_vs_bench        — scatter: total allocated headcount (x) vs bench (y) per function

LEAVE (from Leave table):
  leave_by_type             — leave request count per leave type. params: { period: "30d"|"90d"|"6m"|"12m" }
  leave_days_by_type        — total leave days per leave type. params: { period: "30d"|"90d"|"6m"|"12m" }
  leave_by_month            — leave count by month. params: { period: "6m"|"12m" }
  leave_days_by_month       — leave days by month. params: { period: "6m"|"12m" }
  leave_status_split        — count by status (Pending/Approved/Rejected). params: { period: "30d"|"90d"|"6m" }

WORKFORCE / ALLOCATION (from EmployeeAllocation table — latest snapshot):
  utilization_by_function   — avg utilization % per function
  bench_by_function         — bench headcount per function
  bench_vs_allocated        — multi-series: bench + allocated headcount by function. Use chart_type=bar
  utilization_trend         — avg utilization % by month. params: { period: "6m"|"12m" }
  allocation_by_client      — headcount per client
  allocation_by_project_type — headcount per project type
  billable_split            — billable vs non-billable headcount (pie)

MY TEAM ATTENDANCE (eSSL biometric — scoped to the logged-in manager's own reporting tree):
  reportee_attendance_split — part-of-whole of your team's attendance for a month:
                              On-time / Late / Half-day / Absent. Best as chart_type=pie.
                              params: { month: 1-12, year: YYYY } — both optional, default current month.
                              Use this for "my reportees/team attendance", "how is my team's attendance".

AI ASSISTANT (from AiRequestLog / ChatFeedback):
  ai_requests_by_domain     — AI request count per domain. params: { period: "30d"|"90d"|"6m" }
  ai_requests_over_time     — AI requests by month. params: { period: "90d"|"6m"|"12m" }
  ai_latency_by_domain      — avg latency per domain (ms). params: { period: "30d"|"90d" }
  ai_satisfaction_trend     — satisfaction % (helpful) by month. params: { period: "90d"|"6m"|"12m" }
  token_usage_by_model      — token count per model. params: { period: "30d"|"90d"|"6m" }
  ai_errors_over_time       — error count by day/week. params: { period: "30d"|"90d" }

CHART TYPE GUIDELINES:
  bar       — categorical comparisons, most common default
  line      — trends over time
  area      — volume/cumulative trends over time (fill under line)
  pie       — part-of-whole proportions (best for < 7 categories)
  scatter   — correlation between two numeric measures (headcount vs bench)
  radar     — compare multiple metrics for one entity (multi-dimensional profile)
  treemap   — proportional areas across many categories
  funnel    — sequential stages from large to small
  composed  — bar + line on the same chart (e.g. headcount bars + utilization line)
"""


class BuilderIntent(BaseModel):
    mode: str = Field(
        default="template",
        description="'template' — use a predefined query_id; 'dynamic' — query any registered DB table"
    )
    # ── Template mode ─────────────────────────────────────────────────────────
    query_id: Optional[str] = Field(default=None, description="Template id (required when mode='template')")
    params: dict = Field(default_factory=dict, description="Template params: period, month, year")
    # ── Dynamic mode ──────────────────────────────────────────────────────────
    data_source: Optional[str] = Field(default=None, description="Data source id (required when mode='dynamic')")
    group_by: Optional[str] = Field(default=None, description="Column to group by (required when mode='dynamic')")
    metric: str = Field(default="count", description="'count' | 'sum:col' | 'avg:col' | 'avg_resolution_hours'")
    period: Optional[str] = Field(default=None, description="Time period: 30d|90d|6m|12m (dynamic queries with a date column)")
    # ── Shared ────────────────────────────────────────────────────────────────
    chart_type: str = Field(description="bar|line|area|pie|scatter|radar|treemap|funnel|composed")
    title: str = Field(description="Concise chart title (under 55 chars)")
    subtitle: Optional[str] = Field(default=None, description="Optional subtitle — timeframe, scope, etc.")
    stacked: bool = Field(default=False, description="Stack multi-series bar/area?")


# ── Query executor ──────────────────────────────────────────────────────────────────────────

_PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#ec4899",
            "#14b8a6", "#f97316", "#84cc16"]

# ── Dynamic query data source registry ──────────────────────────────────────────
# Each entry defines a safe, aggregatable DB table for the conversational builder.
# NEVER include sensitive columns: PAN, PF, Aadhaar, bank, CTC, salary, personal
# mobile/email, full DOB, marital status, addresses. See feedback-sensitive-data.md
_DATA_SOURCES: dict[str, dict] = {
    # ── IT & OPERATIONS ──────────────────────────────────────────────────────────
    "it_tickets": {
        "model": ITTicket, "label": "IT Support Tickets",
        "date_col": "created_at", "resolved_col": "resolved_at",
        "groupable": {
            "category": "Software Install / Hardware / Network / Access / Security",
            "priority": "Low / Medium / High",
            "status": "Open / In Progress / Resolved / Closed",
            "assigned_to": "IT staff the ticket is assigned to",
        },
        "numeric": {},
    },
    "software_requests": {
        "model": SoftwareRequest, "label": "Software Requests",
        "date_col": None, "resolved_col": None,
        "groupable": {
            "software_name": "requested software name",
            "status": "Pending / Approved / Installed / Rejected",
        },
        "numeric": {},
    },
    "asset_assignments": {
        "model": AssetAssignment, "label": "Asset Assignments",
        "date_col": "assigned_date", "resolved_col": None,
        "groupable": {
            "asset_type": "Laptop / Monitor / Keyboard / Mouse / Headset",
            "brand": "hardware brand",
            "status": "Assigned / Returned",
        },
        "numeric": {},
    },
    "asset_requests": {
        "model": AssetRequest, "label": "Asset Requests",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "asset_name": "requested asset name",
            "status": "Pending / Fulfilled / Rejected",
        },
        "numeric": {},
    },
    # ── HR ───────────────────────────────────────────────────────────────────────
    "reimbursements": {
        "model": Reimbursement, "label": "Reimbursements",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "type": "Travel / Medical / Certification / Equipment",
            "status": "Pending / Approved / Rejected",
        },
        "numeric": {"amount": "reimbursement amount"},
    },
    "grievances": {
        "model": Grievance, "label": "Grievances",
        "date_col": "submitted_at", "resolved_col": "resolved_at",
        "groupable": {
            "category": "Harassment / Discrimination / Safety / Manager Conduct / Compensation / Workplace Culture / Other",
            "status": "Open / Under Review / Resolved / Closed",
        },
        "numeric": {},
    },
    "hr_queries": {
        "model": HRQuery, "label": "HR Queries",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "category": "query category",
            "status": "Open / In Progress / Resolved / Closed",
            "priority": "Low / Normal / High",
        },
        "numeric": {},
    },
    "travel_requests": {
        "model": TravelRequest, "label": "Travel Requests",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "status": "pending_rm / rm_approved / admin_approved / completed / rejected",
            "mode_of_travel": "Flight / Train / Car / Other",
            "from_location": "origin location",
            "to_destination": "destination",
        },
        "bool_as_label": {
            "is_international": ("International", "Domestic"),
            "visa_required": ("Visa Required", "No Visa"),
        },
        "numeric": {"estimated_cost": "estimated trip cost"},
    },
    "travel_expense_claims": {
        "model": TravelExpenseClaim, "label": "Travel Expense Claims",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "status": "Pending / Approved / Rejected",
            "currency": "claim currency",
        },
        "numeric": {"amount": "claimed amount"},
    },
    "onboarding_journeys": {
        "model": OnboardingJourney, "label": "New Hire Onboarding Journeys",
        "date_col": "started_at", "resolved_col": None,
        "groupable": {"status": "active / completed"},
        "numeric": {},
    },
    # ── ADMIN & FACILITIES ───────────────────────────────────────────────────────
    "parking_stickers": {
        "model": ParkingSticker, "label": "Parking Stickers",
        "date_col": None, "resolved_col": None,
        "groupable": {
            "vehicle_type": "2-wheeler / 4-wheeler",
            "status": "Active / Expired / Pending / Surrendered",
        },
        "numeric": {},
    },
    "facility_complaints": {
        "model": FacilityComplaint, "label": "Facility Complaints",
        "date_col": "created_at", "resolved_col": "resolved_at",
        "groupable": {
            "category": "Housekeeping / Electrical / Plumbing / AC / Cafeteria / Other",
            "priority": "Low / Medium / High / Critical",
            "status": "Open / In Progress / Resolved / Closed",
            "location": "office area of the complaint",
        },
        "numeric": {},
    },
    "food_vendor_feedback": {
        "model": FoodVendorFeedback, "label": "Food Vendor Feedback",
        "date_col": "date", "resolved_col": None,
        "groupable": {"vendor_name": "food vendor name"},
        "numeric": {
            "rating": "overall rating (1-5)",
            "food_quality": "food quality rating (1-5)",
            "hygiene": "hygiene rating (1-5)",
            "service": "service rating (1-5)",
        },
    },
    "visitor_passes": {
        "model": VisitorPass, "label": "Visitor Passes",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "status": "Pending / Approved / Rejected / Completed",
            "visitor_company": "visitor's company",
        },
        "numeric": {},
    },
    "desk_key_requests": {
        "model": DeskKeyRequest, "label": "Desk Key Requests",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {"status": "Pending / Approved / Rejected / Released"},
        "numeric": {},
    },
    "announcements": {
        "model": Announcement, "label": "Announcements",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "category": "Policy Update / Holiday / Events / Hiring / Training / General / IT Alert",
            "created_by_domain": "hr / admin / it_support / functional_manager",
            "target_audience": "intended audience",
        },
        "numeric": {},
    },
    # ── LEARNING & TRAINING ──────────────────────────────────────────────────────
    "te_assignments": {
        "model": TeAssignment, "label": "Training Assignments (TechElevate LMS)",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "status": "Assigned / In Progress / Completed / Failed",
            "department": "employee department",
        },
        "numeric": {"score": "assessment score (%)"},
    },
    "te_trainings": {
        "model": TeTraining, "label": "Training Courses (TechElevate LMS)",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "category": "Technical / Governance & Compliance / Business",
            "training_type": "single / levels",
        },
        "numeric": {"duration_minutes": "course duration in minutes"},
    },
    "udemy_license_requests": {
        "model": UdemyLicenseRequest, "label": "Udemy License Requests",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "platform": "Udemy / Coursera",
            "status": "Pending / Approved / Rejected",
        },
        "numeric": {},
    },
    "book_requests": {
        "model": BookRequest, "label": "Library Book Requests",
        "date_col": "requested_at", "resolved_col": None,
        "groupable": {
            "request_type": "Issue / Return",
            "status": "Pending / Approved / Rejected / Returned / Cancelled",
        },
        "numeric": {},
    },
    # ── AI & ESCALATIONS ─────────────────────────────────────────────────────────
    "escalations": {
        "model": Escalation, "label": "AI Assistant Escalations",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "domain": "hr / admin / it_support / pmo / general",
            "priority": "Low / Medium / High",
            "status": "Open / Acknowledged / Resolved",
            "error_type": "error / no_response / unsatisfied",
        },
        "numeric": {},
    },
    "form_submissions": {
        "model": FormSubmission, "label": "Form Submissions",
        "date_col": "submitted_at", "resolved_col": None,
        "groupable": {"status": "Pending / Approved / Rejected"},
        "numeric": {},
    },
    # ── WORKFORCE & SKILLS ───────────────────────────────────────────────────────
    "employee_skills": {
        "model": EmployeeSkill, "label": "Employee Skills (Alchemy Portal)",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {"skill": "skill name"},
        "bool_as_label": {"is_primary": ("Primary Skill", "Secondary Skill")},
        "numeric": {"years_experience": "years of experience in this skill"},
    },
    "appreciations": {
        "model": Appreciation, "label": "Client Appreciations",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {"client_name": "client who sent the appreciation"},
        "numeric": {},
    },
    "attendance": {
        "model": Attendance, "label": "Attendance Records (org-wide biometric)",
        "date_col": "date", "resolved_col": None,
        "groupable": {"status": "Present / Absent / WFH / Half-day"},
        "numeric": {},
    },
    # ── PROJECT INTELLIGENCE ─────────────────────────────────────────────────────
    "project_profiles": {
        "model": ProjectProfile, "label": "Project IQ Profiles",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "status": "project status",
            "client_industry": "client industry sector",
            "confidence": "verified / inferred",
            "review_status": "draft / reviewed",
            "project_size": "project size category",
        },
        "numeric": {},
    },
    # ── EMPLOYEE PROFILE (Zoho HRMS — non-sensitive fields only) ─────────────────
    "employee_zoho_profile": {
        "model": EmployeeZohoProfile, "label": "Employee Zoho Profile",
        "date_col": "date_of_joining", "resolved_col": None,
        "groupable": {
            "function": "business function / department",
            "designation": "job designation / title",
            "employment_type": "Full-time / Contract / Intern",
            "employee_status": "Active / Inactive",
            "source_of_hire": "Direct / Campus / Referral / Lateral",
            "gender": "Male / Female / Other",
            "level": "seniority level",
            "grade": "pay / seniority grade",
            "nationality": "nationality",
            "onboarding_status": "onboarding completion status",
            "sub_location": "office sub-location",
            "organization_structure": "org unit / sub-org",
        },
        "numeric": {},
    },
}


def _build_dynamic_docs() -> str:
    sections = [
        ("IT & OPERATIONS", ["it_tickets", "software_requests", "asset_assignments", "asset_requests"]),
        ("HR", ["reimbursements", "grievances", "hr_queries", "travel_requests", "travel_expense_claims", "onboarding_journeys"]),
        ("ADMIN & FACILITIES", ["parking_stickers", "facility_complaints", "food_vendor_feedback", "visitor_passes", "desk_key_requests", "announcements"]),
        ("LEARNING", ["te_assignments", "te_trainings", "udemy_license_requests", "book_requests"]),
        ("AI & ESCALATIONS", ["escalations", "form_submissions"]),
        ("WORKFORCE & SKILLS", ["employee_skills", "appreciations", "attendance"]),
        ("PROJECT INTELLIGENCE", ["project_profiles"]),
    ]
    lines = [
        "\nDYNAMIC QUERIES (mode='dynamic'):",
        "Use when the user asks about any data NOT covered by the template queries above.",
        "Set: mode='dynamic', data_source=<id>, group_by=<col>, metric=<metric>[, period=<period>].",
        "period: 30d|90d|6m|12m — only for data sources marked with * (have a date column).",
        "metric: count | sum:<col> | avg:<col> | avg_resolution_hours",
        "",
    ]
    for section, ids in sections:
        lines.append(f"{section}:")
        for sid in ids:
            src = _DATA_SOURCES.get(sid)
            if not src:
                continue
            date_flag = "*" if src.get("date_col") else ""
            grp_cols = list(src.get("groupable", {}).keys()) + list(src.get("bool_as_label", {}).keys())
            num_cols = list(src.get("numeric", {}).keys())
            metrics = ["count"]
            if src.get("resolved_col"):
                metrics.append("avg_resolution_hours")
            metrics += [f"sum:{c}" for c in num_cols] + [f"avg:{c}" for c in num_cols]
            lines.append(f"  {sid}{date_flag} — {src['label']}")
            lines.append(f"    group_by: {' | '.join(grp_cols)}")
            lines.append(f"    metric: {' | '.join(metrics)}")
        lines.append("")
    return "\n".join(lines)


_DYNAMIC_DOCS = _build_dynamic_docs()


def _snap_filter(M, db, dimension):
    """Latest-snapshot filter for allocation queries (reused from analytics_service)."""
    conds = [func.lower(func.coalesce(M.status, "")) != "inactive"]
    time_dims = {"month", "day", "week"}
    if dimension not in time_dims:
        d = latest_snapshot_date(db)
        if d is not None:
            conds.append(M.allocation_date == d)
    return and_(*conds)


def _rows_to_series(rows, label_col=0, value_col=1, none_label="—") -> list[dict]:
    out = []
    for row in rows:
        g = row[label_col]
        if g is None:
            label = none_label
        elif isinstance(g, (datetime.datetime, datetime.date)):
            label = g.isoformat()
        else:
            label = str(g)
        val = row[value_col]
        out.append({"x": label, "value": round(float(val or 0), 2)})
    return out


def _run_dynamic_query(db: Session, intent: BuilderIntent) -> ChartSpec:
    """Execute a safe, validated single-table aggregation on any registered data source."""
    src_id = (intent.data_source or "").strip()
    src = _DATA_SOURCES.get(src_id)
    if not src:
        raise ValueError(
            f"Unknown data source '{src_id}'. Available: {', '.join(_DATA_SOURCES)}"
        )

    Model = src["model"]
    date_col_name: Optional[str] = src.get("date_col")
    resolved_col_name: Optional[str] = src.get("resolved_col")
    groupable: dict = src.get("groupable", {})
    bool_labels: dict = src.get("bool_as_label", {})
    numeric: dict = src.get("numeric", {})

    # Validate group_by ─────────────────────────────────────────────────────────
    group_by = (intent.group_by or "").strip()
    is_bool_col = group_by in bool_labels
    if group_by not in groupable and not is_bool_col:
        allowed = list(groupable) + list(bool_labels)
        raise ValueError(
            f"Cannot group '{src_id}' by '{group_by}'. "
            f"Allowed: {', '.join(allowed)}"
        )
    grp_col = getattr(Model, group_by)

    # Build metric expression ───────────────────────────────────────────────────
    metric_raw = (intent.metric or "count").strip()
    extra_filters = []

    if metric_raw == "avg_resolution_hours":
        if not resolved_col_name or not date_col_name:
            raise ValueError(
                f"'{src_id}' does not support avg_resolution_hours (needs both date_col and resolved_col)."
            )
        r_col = getattr(Model, resolved_col_name)
        c_col = getattr(Model, date_col_name)
        metric_expr = func.avg(
            (func.extract("epoch", r_col) - func.extract("epoch", c_col)) / 3600.0
        )
        metric_label = "Avg Resolution (hrs)"
        unit = "hrs"
        extra_filters.append(r_col.isnot(None))

    elif metric_raw == "count":
        metric_expr = func.count(Model.id)
        metric_label = "Count"
        unit = "count"

    elif ":" in metric_raw:
        op, col_name = metric_raw.split(":", 1)
        if col_name not in numeric:
            raise ValueError(
                f"Cannot compute {op} on '{col_name}' for '{src_id}'. "
                f"Numeric columns: {', '.join(numeric) or 'none'}"
            )
        if op not in ("sum", "avg"):
            raise ValueError(f"Unknown metric operator '{op}'. Use 'sum' or 'avg'.")
        num_col = getattr(Model, col_name)
        metric_expr = func.sum(num_col) if op == "sum" else func.avg(num_col)
        metric_label = f"{'Total' if op == 'sum' else 'Avg'} {numeric[col_name]}"
        unit = ""
        extra_filters.append(num_col.isnot(None))

    else:
        raise ValueError(
            f"Unknown metric '{metric_raw}'. Use 'count', 'sum:col', 'avg:col', or 'avg_resolution_hours'."
        )

    # Build and execute query ───────────────────────────────────────────────────
    q = db.query(grp_col.label("grp"), metric_expr.label("val"))
    q = q.filter(grp_col.isnot(None))

    if intent.period and date_col_name:
        cutoff = _period_cutoff(intent.period)
        q = q.filter(getattr(Model, date_col_name) >= cutoff)

    for f in extra_filters:
        q = q.filter(f)

    q = q.group_by(grp_col).order_by(metric_expr.desc())
    rows = q.all()

    # Format rows ───────────────────────────────────────────────────────────────
    data = []
    for row in rows:
        raw = row[0]
        if is_bool_col:
            true_lbl, false_lbl = bool_labels[group_by]
            label = true_lbl if raw else false_lbl
        elif raw is None:
            label = "—"
        elif isinstance(raw, (datetime.date, datetime.datetime)):
            label = raw.isoformat()
        else:
            label = str(raw)
        val = row[1]
        data.append({"x": label, "value": round(float(val or 0), 2)})

    subtitle = intent.subtitle
    if not subtitle and intent.period:
        subtitle = f"Last {intent.period}"

    return ChartSpec(
        type=intent.chart_type,
        title=intent.title,
        subtitle=subtitle,
        data=data,
        x_key="x",
        y_keys=["value"],
        y_labels={"value": metric_label},
        colors=_PALETTE[: max(len(data), 1)],
        unit=unit,
        stacked=intent.stacked,
    )


def _run_query(db: Session, intent: BuilderIntent, user_email: Optional[str] = None) -> ChartSpec:
    if intent.mode == "dynamic":
        return _run_dynamic_query(db, intent)

    qid = intent.query_id
    period = intent.params.get("period", "30d")
    cutoff = _period_cutoff(period)

    # Shared active-employee filter for all EmployeeZohoProfile headcount queries.
    _ACTIVE = EmployeeZohoProfile.employee_status != "Inactive"

    # ── EMPLOYEE HEADCOUNT ──────────────────────────────────────────────────────
    if qid == "headcount_by_function":
        rows = (db.query(EmployeeZohoProfile.function, func.count(EmployeeZohoProfile.id))
                .filter(_ACTIVE, EmployeeZohoProfile.function.isnot(None))
                .group_by(EmployeeZohoProfile.function)
                .order_by(func.count(EmployeeZohoProfile.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=[_PALETTE[0]], unit="count")

    if qid == "headcount_by_grade":
        rows = (db.query(EmployeeZohoProfile.grade, func.count(EmployeeZohoProfile.id))
                .filter(_ACTIVE, EmployeeZohoProfile.grade.isnot(None))
                .group_by(EmployeeZohoProfile.grade)
                .order_by(func.count(EmployeeZohoProfile.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=[_PALETTE[2]], unit="count")

    if qid == "headcount_by_gender":
        rows = (db.query(EmployeeZohoProfile.gender, func.count(EmployeeZohoProfile.id))
                .filter(_ACTIVE, EmployeeZohoProfile.gender.isnot(None))
                .group_by(EmployeeZohoProfile.gender)
                .order_by(func.count(EmployeeZohoProfile.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"},
                         colors=[_PALETTE[0], _PALETTE[1], _PALETTE[3]], unit="count")

    if qid == "headcount_by_level":
        rows = (db.query(EmployeeZohoProfile.level, func.count(EmployeeZohoProfile.id))
                .filter(_ACTIVE, EmployeeZohoProfile.level.isnot(None))
                .group_by(EmployeeZohoProfile.level)
                .order_by(func.count(EmployeeZohoProfile.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=[_PALETTE[4]], unit="count")

    if qid == "headcount_by_location":
        # Use MS365User.office_location (Azure AD) — Employee.location was randomly assigned.
        # Azure AD only contains active users so no separate inactive filter is needed.
        rows = (db.query(MS365User.office_location, func.count(MS365User.id))
                .filter(MS365User.office_location.isnot(None),
                        MS365User.office_location != "")
                .group_by(MS365User.office_location)
                .order_by(func.count(MS365User.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=_PALETTE[:5], unit="count")

    if qid == "headcount_by_department":
        # Use EmployeeZohoProfile.function (Zoho) with inactive filter.
        # Employee.department was partially randomly assigned; Zoho function is authoritative.
        rows = (db.query(EmployeeZohoProfile.function, func.count(EmployeeZohoProfile.id))
                .filter(_ACTIVE, EmployeeZohoProfile.function.isnot(None))
                .group_by(EmployeeZohoProfile.function)
                .order_by(func.count(EmployeeZohoProfile.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=[_PALETTE[1]], unit="count")

    if qid == "headcount_by_employment_type":
        rows = (db.query(EmployeeZohoProfile.employment_type, func.count(EmployeeZohoProfile.id))
                .filter(_ACTIVE, EmployeeZohoProfile.employment_type.isnot(None))
                .group_by(EmployeeZohoProfile.employment_type)
                .order_by(func.count(EmployeeZohoProfile.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Count"}, colors=[_PALETTE[3], _PALETTE[5]], unit="count")

    if qid == "joining_trend":
        # Default to 12m — 30d produces near-zero data for a joining trend.
        join_period = intent.params.get("period", "12m")
        join_cutoff = _period_cutoff(join_period)
        rows = (db.query(func.date_trunc("month", EmployeeZohoProfile.date_of_joining),
                         func.count(EmployeeZohoProfile.id))
                .filter(EmployeeZohoProfile.date_of_joining >= join_cutoff,
                        EmployeeZohoProfile.date_of_joining.isnot(None))
                .group_by(func.date_trunc("month", EmployeeZohoProfile.date_of_joining))
                .order_by(func.date_trunc("month", EmployeeZohoProfile.date_of_joining)).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "New Joiners"}, colors=[_PALETTE[1]], unit="count")

    if qid == "headcount_vs_bench":
        # Scatter: per-function total allocated (x) vs bench (y)
        snap = latest_snapshot_date(db)
        base = [EmployeeAllocation.status.isnot(None),
                func.lower(func.coalesce(EmployeeAllocation.status, "")) != "inactive"]
        if snap:
            base.append(EmployeeAllocation.allocation_date == snap)

        alloc_rows = (db.query(EmployeeAllocation.function,
                               func.count(func.distinct(EmployeeAllocation.employee_name)).label("allocated"),
                               func.count(func.distinct(EmployeeAllocation.employee_name)).filter(
                                   func.lower(func.coalesce(EmployeeAllocation.billing, ""))
                                   .in_(["pipeline", "for allocation"])).label("bench"))
                      .filter(and_(*base))
                      .group_by(EmployeeAllocation.function).all())
        data = [{"name": r[0] or "—", "allocated": int(r[1] or 0), "bench": int(r[2] or 0)}
                for r in alloc_rows if r[0]]
        return ChartSpec(type="scatter", title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="allocated", y_keys=["bench"],
                         y_labels={"bench": "Bench Count", "allocated": "Allocated Count"},
                         colors=[_PALETTE[0]], unit="count", label_key="name")

    # ── MY TEAM ATTENDANCE ──────────────────────────────────────────────────────
    if qid == "reportee_attendance_split":
        # Person-scoped: only ever the caller's OWN reporting tree. team_report resolves
        # the manager from user_email and walks their descendants, so there's no way to
        # chart someone else's team here.
        if not user_email:
            raise ValueError("I need to know who you are to pull your team's attendance.")
        from app.services import attendance_service
        report = attendance_service.team_report(
            user_email,
            month=str(intent.params.get("month") or ""),
            year=str(intent.params.get("year") or ""),
        )
        if not report.get("success"):
            if report.get("error") == "no_team":
                raise ValueError("you have no reportees on record, so there's no team attendance to chart.")
            raise ValueError("I couldn't resolve your team to chart attendance.")
        t = report.get("totals", {})
        present = int(t.get("present", 0))
        late = int(t.get("late", 0))
        # `late` is a subset of `present` (a late day is still a present day) — peel it out
        # so the pie slices are mutually exclusive and sum to total person-days.
        on_time = max(present - late, 0)
        slices = [
            ("On-time", on_time),
            ("Late", late),
            ("Half-day", int(t.get("half_day", 0))),
            ("Absent", int(t.get("absent", 0))),
            ("WFH", int(t.get("wfh", 0))),
        ]
        data = [{"x": label, "value": val} for label, val in slices if val > 0]
        period = report.get("period", "")
        subtitle = intent.subtitle
        if not subtitle:
            subtitle = f"{report.get('headcount', 0)} reportees" + (f" · {period}" if period else "")
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Person-days"},
                         colors=[_PALETTE[1], _PALETTE[2], _PALETTE[5], _PALETTE[3], _PALETTE[0]],
                         unit="count")

    # ── LEAVE ──────────────────────────────────────────────────────────────────
    if qid == "leave_by_type":
        rows = (db.query(Leave.leave_type, func.count(Leave.id))
                .filter(Leave.created_at >= cutoff)
                .group_by(Leave.leave_type)
                .order_by(func.count(Leave.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Leave Requests"}, colors=_PALETTE[:6], unit="count")

    if qid == "leave_days_by_type":
        rows = (db.query(Leave.leave_type,
                         func.sum((Leave.end_date - Leave.start_date) + 1))
                .filter(Leave.created_at >= cutoff, Leave.status == "Approved")
                .group_by(Leave.leave_type)
                .order_by(func.sum((Leave.end_date - Leave.start_date) + 1).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Leave Days"}, colors=_PALETTE[:6], unit="days")

    if qid == "leave_by_month":
        rows = (db.query(func.date_trunc("month", Leave.created_at), func.count(Leave.id))
                .filter(Leave.created_at >= cutoff)
                .group_by(func.date_trunc("month", Leave.created_at))
                .order_by(func.date_trunc("month", Leave.created_at)).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Leave Requests"}, colors=[_PALETTE[2]], unit="count")

    if qid == "leave_days_by_month":
        rows = (db.query(func.date_trunc("month", Leave.created_at),
                         func.sum((Leave.end_date - Leave.start_date) + 1))
                .filter(Leave.created_at >= cutoff, Leave.status == "Approved")
                .group_by(func.date_trunc("month", Leave.created_at))
                .order_by(func.date_trunc("month", Leave.created_at)).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Leave Days"}, colors=[_PALETTE[1]], unit="days")

    if qid == "leave_status_split":
        rows = (db.query(Leave.status, func.count(Leave.id))
                .filter(Leave.created_at >= cutoff)
                .group_by(Leave.status)
                .order_by(func.count(Leave.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Count"}, colors=_PALETTE[:4], unit="count")

    # ── WORKFORCE ──────────────────────────────────────────────────────────────
    if qid == "utilization_by_function":
        snap = latest_snapshot_date(db)
        q = (db.query(EmployeeAllocation.function,
                      func.avg(EmployeeAllocation.efforts_percent).label("util"))
             .filter(func.lower(func.coalesce(EmployeeAllocation.status, "")) != "inactive"))
        if snap:
            q = q.filter(EmployeeAllocation.allocation_date == snap)
        rows = q.group_by(EmployeeAllocation.function).order_by(func.avg(EmployeeAllocation.efforts_percent).desc()).all()
        data = [{"x": r[0] or "—", "value": round(float(r[1] or 0), 1)} for r in rows if r[0]]
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Avg Utilization %"}, colors=[_PALETTE[0]], unit="pct")

    if qid == "bench_by_function":
        snap = latest_snapshot_date(db)
        q = (db.query(EmployeeAllocation.function,
                      func.count(func.distinct(EmployeeAllocation.employee_name)).label("bench"))
             .filter(func.lower(func.coalesce(EmployeeAllocation.billing, "")).in_(["pipeline", "for allocation"]),
                     func.lower(func.coalesce(EmployeeAllocation.status, "")) != "inactive"))
        if snap:
            q = q.filter(EmployeeAllocation.allocation_date == snap)
        rows = q.group_by(EmployeeAllocation.function).order_by(func.count(func.distinct(EmployeeAllocation.employee_name)).desc()).all()
        data = [{"x": r[0] or "—", "value": int(r[1] or 0)} for r in rows if r[0]]
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Bench Count"}, colors=[_PALETTE[2]], unit="count")

    if qid == "bench_vs_allocated":
        snap = latest_snapshot_date(db)
        q = (db.query(EmployeeAllocation.function,
                      func.count(func.distinct(EmployeeAllocation.employee_name)).label("allocated"),
                      func.count(func.distinct(EmployeeAllocation.employee_name)).filter(
                          func.lower(func.coalesce(EmployeeAllocation.billing, "")).in_(["pipeline", "for allocation"])
                      ).label("bench"))
             .filter(func.lower(func.coalesce(EmployeeAllocation.status, "")) != "inactive"))
        if snap:
            q = q.filter(EmployeeAllocation.allocation_date == snap)
        rows = q.group_by(EmployeeAllocation.function).all()
        data = [{"x": r[0] or "—", "allocated": int(r[1] or 0), "bench": int(r[2] or 0)}
                for r in rows if r[0]]
        data.sort(key=lambda d: d["allocated"], reverse=True)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["allocated", "bench"],
                         y_labels={"allocated": "Allocated", "bench": "On Bench"},
                         colors=[_PALETTE[0], _PALETTE[2]], unit="count",
                         stacked=intent.stacked)

    if qid == "utilization_trend":
        rows = (db.query(EmployeeAllocation.allocation_date,
                         func.avg(EmployeeAllocation.efforts_percent))
                .filter(func.lower(func.coalesce(EmployeeAllocation.status, "")) != "inactive",
                        EmployeeAllocation.allocation_date >= cutoff)
                .group_by(EmployeeAllocation.allocation_date)
                .order_by(EmployeeAllocation.allocation_date).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Avg Utilization %"}, colors=[_PALETTE[0]], unit="pct")

    if qid == "allocation_by_client":
        snap = latest_snapshot_date(db)
        q = (db.query(EmployeeAllocation.client_master,
                      func.count(func.distinct(EmployeeAllocation.employee_name)))
             .filter(func.lower(func.coalesce(EmployeeAllocation.status, "")) != "inactive",
                     EmployeeAllocation.client_master.isnot(None)))
        if snap:
            q = q.filter(EmployeeAllocation.allocation_date == snap)
        rows = q.group_by(EmployeeAllocation.client_master).order_by(func.count(func.distinct(EmployeeAllocation.employee_name)).desc()).all()
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=_PALETTE[:8], unit="count")

    if qid == "allocation_by_project_type":
        snap = latest_snapshot_date(db)
        q = (db.query(EmployeeAllocation.project_type,
                      func.count(func.distinct(EmployeeAllocation.employee_name)))
             .filter(func.lower(func.coalesce(EmployeeAllocation.status, "")) != "inactive",
                     EmployeeAllocation.project_type.isnot(None)))
        if snap:
            q = q.filter(EmployeeAllocation.allocation_date == snap)
        rows = q.group_by(EmployeeAllocation.project_type).order_by(func.count(func.distinct(EmployeeAllocation.employee_name)).desc()).all()
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=_PALETTE[:5], unit="count")

    if qid == "billable_split":
        snap = latest_snapshot_date(db)
        q = (db.query(EmployeeAllocation.billing,
                      func.count(func.distinct(EmployeeAllocation.employee_name)))
             .filter(func.lower(func.coalesce(EmployeeAllocation.status, "")) != "inactive",
                     EmployeeAllocation.billing.isnot(None)))
        if snap:
            q = q.filter(EmployeeAllocation.allocation_date == snap)
        rows = q.group_by(EmployeeAllocation.billing).order_by(func.count(func.distinct(EmployeeAllocation.employee_name)).desc()).all()
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=_PALETTE[:5], unit="count")

    # ── AI ASSISTANT ──────────────────────────────────────────────────────────
    if qid == "ai_requests_by_domain":
        rows = (db.query(AiRequestLog.domain, func.count(AiRequestLog.id))
                .filter(AiRequestLog.created_at >= cutoff)
                .group_by(AiRequestLog.domain)
                .order_by(func.count(AiRequestLog.id).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Requests"}, colors=_PALETTE[:7], unit="count")

    if qid == "ai_requests_over_time":
        rows = (db.query(func.date_trunc("month", AiRequestLog.created_at), func.count(AiRequestLog.id))
                .filter(AiRequestLog.created_at >= cutoff)
                .group_by(func.date_trunc("month", AiRequestLog.created_at))
                .order_by(func.date_trunc("month", AiRequestLog.created_at)).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Requests"}, colors=[_PALETTE[0]], unit="count")

    if qid == "ai_latency_by_domain":
        rows = (db.query(AiRequestLog.domain,
                         func.avg(AiRequestLog.total_latency_ms))
                .filter(AiRequestLog.created_at >= cutoff, AiRequestLog.error.is_(None))
                .group_by(AiRequestLog.domain)
                .order_by(func.avg(AiRequestLog.total_latency_ms).desc()).all())
        data = [{"x": r[0] or "—", "value": round(float(r[1] or 0) / 1000, 2)} for r in rows if r[0]]
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Avg Latency (s)"}, colors=[_PALETTE[2]], unit="sec")

    if qid == "ai_satisfaction_trend":
        # rating is -1 (unhelpful) or 1 (helpful). (rating+1)/2 → 0 or 1 binary.
        # Filter NULLs so sparse months don't get dragged toward 0 by coalesce.
        rows = (db.query(func.date_trunc("month", ChatFeedback.created_at),
                         func.avg((ChatFeedback.rating + 1) / 2.0))
                .filter(ChatFeedback.created_at >= cutoff,
                        ChatFeedback.rating.isnot(None))
                .group_by(func.date_trunc("month", ChatFeedback.created_at))
                .order_by(func.date_trunc("month", ChatFeedback.created_at)).all())
        data = [{"x": r[0].isoformat() if r[0] else "—", "value": round(float(r[1] or 0) * 100, 1)}
                for r in rows]
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Satisfaction %"}, colors=[_PALETTE[1]], unit="pct")

    if qid == "token_usage_by_model":
        rows = (db.query(AiRequestLog.model_name, func.sum(AiRequestLog.total_tokens))
                .filter(AiRequestLog.created_at >= cutoff, AiRequestLog.model_name.isnot(None))
                .group_by(AiRequestLog.model_name)
                .order_by(func.sum(AiRequestLog.total_tokens).desc()).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Total Tokens"}, colors=_PALETTE[:6], unit="count")

    if qid == "ai_errors_over_time":
        rows = (db.query(func.date_trunc("day", AiRequestLog.created_at),
                         func.count(AiRequestLog.id))
                .filter(AiRequestLog.created_at >= cutoff, AiRequestLog.error.isnot(None))
                .group_by(func.date_trunc("day", AiRequestLog.created_at))
                .order_by(func.date_trunc("day", AiRequestLog.created_at)).all())
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Errors"}, colors=[_PALETTE[5]], unit="count")

    raise ValueError(f"Unknown query_id: {qid!r}")


# ── Chat entrypoint ──────────────────────────────────────────────────────────────────────────

def builder_chat(
    db: Session,
    message: str,
    history: list[dict],
    role: str = "super admin",
    user_email: Optional[str] = None,
) -> dict:
    """
    Conversational chart builder. Returns:
      { ok, chart: ChartSpec|None, explanation, suggestions }
    """
    # Build conversation messages for the LLM
    system = (
        "You are an analytics chart-builder agent for Centriq AI, a corporate HR/IT/PMO platform. "
        "Your job is to map the user's request to a chart configuration using either a predefined "
        "template (mode='template') or a dynamic DB query (mode='dynamic').\n\n"
        f"{_TEMPLATE_DOCS}"
        f"{_DYNAMIC_DOCS}\n"
        "DECISION RULES:\n"
        "- Use mode='template' when the request matches one of the named templates above (headcount, leave, allocation, attendance, AI metrics).\n"
        "- Use mode='dynamic' for EVERYTHING ELSE — IT tickets, reimbursements, travel, training, facilities, skills, escalations, projects, etc.\n"
        "- For 'change the chart type' requests, keep the same mode/query but change chart_type.\n"
        "- Template period must be one of: 24h, 7d, 30d, 90d, 6m, 12m. Default: 6m.\n"
        "- Dynamic period: 30d|90d|6m|12m. Only set period when the data source has a date column (marked *).\n"
        "- For pie charts, prefer fewer than 7 categories; use bar for more.\n"
        "- For scatter, always use query_id=headcount_vs_bench (template).\n"
        "- For radar, choose the best single-category template query with chart_type=radar.\n"
        "- For treemap, any headcount or groupable dynamic query works.\n"
        "- For 'my team/reportees attendance', use mode='template', query_id=reportee_attendance_split, chart_type=pie.\n"
        "- Never invent a query_id or data_source — only use exactly what is listed.\n"
    )

    messages = [{"role": "system", "content": system}]
    for turn in history[-6:]:   # last 3 turns context
        messages.append({"role": turn.get("role", "user"), "content": turn.get("content", "")})
    messages.append({"role": "user", "content": message})

    try:
        from app.services.llm_resilience import resilient_invoke
        result = resilient_invoke(
            "router",
            messages,
            build=lambda llm: llm.with_structured_output(BuilderIntent),
        )
        intent = result if isinstance(result, BuilderIntent) else BuilderIntent(**dict(result))
    except Exception as exc:
        log.warning("Builder intent failed: %s", exc)
        return {
            "ok": False,
            "chart": None,
            "explanation": "I couldn't understand that request. Try describing the chart differently — "
                           "e.g. \"IT tickets by category\", \"reimbursements by type last 6 months\", "
                           "or \"headcount by function as a bar chart\".",
            "suggestions": [
                "IT tickets by category last 3 months",
                "Reimbursements by type as pie chart",
                "Headcount by function as bar chart",
                "Training assignments by status",
            ],
        }

    # Validate chart type
    if intent.chart_type not in CHART_TYPES:
        intent.chart_type = "bar"

    try:
        spec = _run_query(db, intent, user_email=user_email)
    except ValueError as exc:
        return {
            "ok": False,
            "chart": None,
            "explanation": f"That data isn't available yet ({exc}). Try one of the suggestions below.",
            "suggestions": [
                "Headcount by function",
                "Leave by type last 3 months",
                "Utilization by function",
                "AI requests by domain",
            ],
        }
    except Exception as exc:
        log.exception("Builder query failed for %s: %s", intent.query_id, exc)
        return {
            "ok": False,
            "chart": None,
            "explanation": "The query ran into an error. Please try a different question.",
            "suggestions": [],
        }

    # Auto-generate follow-up suggestions based on what was just shown
    suggestions = _next_suggestions(intent.query_id, data_source=intent.data_source)

    return {
        "ok": True,
        "chart": spec.model_dump(),
        "explanation": _explanation(intent, spec),
        "suggestions": suggestions,
    }


def _explanation(intent: BuilderIntent, spec: ChartSpec) -> str:
    n = len(spec.data)
    if n == 0:
        return f"No data found for \"{intent.title}\". The database may not have records for this period."
    suffix = f" ({intent.params.get('period', '')} period)" if intent.params.get("period") else ""
    return f"Showing **{intent.title}**{suffix} — {n} data point{'s' if n != 1 else ''}."


def _next_suggestions(query_id: str, data_source: Optional[str] = None) -> list[str]:
    # Template-based follow-ups
    template_follow_ups = {
        "headcount_by_function": ["Headcount by grade", "Bench by function", "IT tickets by category"],
        "headcount_by_grade": ["Headcount by function", "Headcount by level", "Headcount by gender"],
        "headcount_by_gender": ["Headcount by function", "Joining trend last 12 months"],
        "headcount_by_location": ["Headcount by function", "Headcount by employment type"],
        "joining_trend": ["Headcount by function", "Onboarding journeys by status"],
        "bench_vs_allocated": ["Utilization by function", "Bench by function as treemap"],
        "utilization_by_function": ["Bench vs allocated", "Utilization trend last 6 months"],
        "leave_by_type": ["Leave days by type", "Leave trend by month", "Leave status split"],
        "ai_requests_by_domain": ["AI requests over time", "AI latency by domain", "Escalations by domain"],
        "ai_requests_over_time": ["AI satisfaction trend", "AI errors over time", "Token usage by model"],
        "reportee_attendance_split": ["My team attendance last month", "Leave requests by type", "HR queries by status"],
    }
    # Dynamic data source follow-ups
    dynamic_follow_ups: dict[str, list[str]] = {
        "it_tickets": ["IT tickets by priority", "IT tickets by status", "Software requests by status"],
        "software_requests": ["Asset assignments by type", "IT tickets by category"],
        "asset_assignments": ["Asset requests by status", "IT tickets by priority"],
        "reimbursements": ["Reimbursements by status", "Travel requests by mode of travel"],
        "grievances": ["HR queries by category", "Escalations by domain"],
        "hr_queries": ["Grievances by category", "Leave requests by type"],
        "travel_requests": ["Travel expense claims by status", "Reimbursements by type"],
        "travel_expense_claims": ["Travel requests by status", "Reimbursements by type"],
        "facility_complaints": ["Facility complaints by category", "Visitor passes by status"],
        "food_vendor_feedback": ["Facility complaints by category", "Vendor avg food quality rating"],
        "te_assignments": ["Training courses by category", "Employee skills by skill"],
        "te_trainings": ["Training assignments by status", "Udemy license requests by status"],
        "employee_skills": ["Skills by primary vs secondary", "Training assignments by status"],
        "escalations": ["AI requests by domain", "HR queries by priority"],
        "project_profiles": ["Projects by client industry", "Projects by review status"],
        "appreciations": ["Headcount by function", "Training assignments by department"],
        "attendance": ["Leave by type last 6 months", "Headcount by location"],
    }
    if data_source and data_source in dynamic_follow_ups:
        return dynamic_follow_ups[data_source]
    defaults = [
        "IT tickets by category last 3 months",
        "Reimbursements by type as pie chart",
        "Headcount by function as bar chart",
        "Training assignments by status",
    ]
    return template_follow_ups.get(query_id or "", defaults)
