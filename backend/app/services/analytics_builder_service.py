"""
Analytics Builder — conversational chart-building agent.

The user describes what they want in natural language; the LLM maps it to one of
the safe, pre-defined query templates below and returns a fully-specified ChartSpec.
No raw SQL is ever accepted from the client.
"""

from __future__ import annotations

import datetime
import logging
import re
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field
from sqlalchemy import func, case, and_
from sqlalchemy.orm import Session

from app.models import (
    Employee, EmployeeZohoProfile, MS365User, EmployeeAllocation,
    Leave, AiRequestLog, ChatFeedback, AiLlmCallLog, ConnectorCallLog,
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

# Chart types that render one label/slice per category — unreadable past a couple dozen
# categories. Dynamic/combine queries can return arbitrarily many groups (e.g. skills,
# designations), so results above this threshold auto-switch to treemap (see _execute_grouped_query).
_LABEL_HEAVY_TYPES = {"bar", "pie", "radar", "funnel", "composed"}
_MANY_CATEGORIES_THRESHOLD = 20

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


class FilterCondition(BaseModel):
    source: str = Field(description="Data source id this filter's field/value belongs to")
    field: str = Field(description="Column name on that source (groupable/numeric/date_col only)")
    op: str = Field(description="One of: eq | neq | gt | gte | lt | lte | in | contains")
    value: str = Field(
        description="The value as a string, coerced server-side to the column's real type "
                    "(number/date/bool as needed). For op='in', comma-separate multiple values."
    )


class BuilderIntent(BaseModel):
    off_topic: bool = Field(
        default=False,
        description="True when the request is a knowledge/policy question rather than a "
                    "chartable data request — e.g. 'what is the maternity leave policy', "
                    "'how do I apply for leave'. Set this true instead of guessing a chart "
                    "for it; leave every other field at its default.",
    )
    mode: str = Field(
        default="template",
        description="'template' — use a predefined query_id; 'dynamic' — query any registered DB "
                    "table; 'combine' — one primary_source supplies chart rows, filter_sources "
                    "constrain WHICH employees are included via a different source"
    )
    # ── Template mode ─────────────────────────────────────────────────────────
    query_id: Optional[str] = Field(default=None, description="Template id (required when mode='template')")
    params: dict = Field(default_factory=dict, description="Template params: period, month, year")
    # ── Dynamic mode ──────────────────────────────────────────────────────────
    data_source: Optional[str] = Field(default=None, description="Data source id (required when mode='dynamic')")
    # ── Combine mode ──────────────────────────────────────────────────────────
    primary_source: Optional[str] = Field(
        default=None,
        description="Data source id supplying chart rows (required when mode='combine'); "
                    "group_by/metric/period below apply to THIS source only"
    )
    filter_sources: list[str] = Field(
        default_factory=list,
        description="Other data source ids used purely to constrain which employees are "
                    "included — they never contribute rows to the chart"
    )
    filters: list[FilterCondition] = Field(
        default_factory=list,
        description="Filter predicates; each filter's source must be primary_source or one of filter_sources"
    )
    # ── Shared: applies to data_source (dynamic) or primary_source (combine) ────
    group_by: Optional[str] = Field(default=None, description="Column to group by (required when mode='dynamic'/'combine')")
    metric: str = Field(default="count", description="'count' | 'sum:col' | 'avg:col' | 'avg_resolution_hours'")
    period: Optional[str] = Field(default=None, description="Time period: 30d|90d|6m|12m (dynamic queries with a date column)")
    # ── Shared across all modes ──────────────────────────────────────────────────
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "software_requests": {
        "model": SoftwareRequest, "label": "Software Requests",
        "date_col": None, "resolved_col": None,
        "groupable": {
            "software_name": "requested software name",
            "status": "Pending / Approved / Installed / Rejected",
        },
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "asset_requests": {
        "model": AssetRequest, "label": "Asset Requests",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "asset_name": "requested asset name",
            "status": "Pending / Fulfilled / Rejected",
        },
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "grievances": {
        "model": Grievance, "label": "Grievances",
        "date_col": "submitted_at", "resolved_col": "resolved_at",
        "groupable": {
            "category": "Harassment / Discrimination / Safety / Manager Conduct / Compensation / Workplace Culture / Other",
            "status": "Open / Under Review / Resolved / Closed",
        },
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},  # nullable (anonymous grievances)
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "travel_expense_claims": {
        "model": TravelExpenseClaim, "label": "Travel Expense Claims",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "status": "Pending / Approved / Rejected",
            "currency": "claim currency",
        },
        "numeric": {"amount": "claimed amount"},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "onboarding_journeys": {
        "model": OnboardingJourney, "label": "New Hire Onboarding Journeys",
        "date_col": "started_at", "resolved_col": None,
        "groupable": {"status": "active / completed"},
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "visitor_passes": {
        "model": VisitorPass, "label": "Visitor Passes",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "status": "Pending / Approved / Rejected / Completed",
            "visitor_company": "visitor's company",
        },
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},  # host employee
    },
    "desk_key_requests": {
        "model": DeskKeyRequest, "label": "Desk Key Requests",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {"status": "Pending / Approved / Rejected / Released"},
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
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
        "employee_link": {"type": "none", "column": None},  # authored by admin/HR, not employee-scoped
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "te_trainings": {
        "model": TeTraining, "label": "Training Courses (TechElevate LMS)",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "category": "Technical / Governance & Compliance / Business",
            "training_type": "single / levels",
        },
        "numeric": {"duration_minutes": "course duration in minutes"},
        "employee_link": {"type": "none", "column": None},  # course catalog, no employee link
    },
    "udemy_license_requests": {
        "model": UdemyLicenseRequest, "label": "Udemy License Requests",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "platform": "Udemy / Coursera",
            "status": "Pending / Approved / Rejected",
        },
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "book_requests": {
        "model": BookRequest, "label": "Library Book Requests",
        "date_col": "requested_at", "resolved_col": None,
        "groupable": {
            "request_type": "Issue / Return",
            "status": "Pending / Approved / Rejected / Returned / Cancelled",
        },
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
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
        "employee_link": {"type": "email", "column": "user_email"},
    },
    "form_submissions": {
        "model": FormSubmission, "label": "Form Submissions",
        "date_col": "submitted_at", "resolved_col": None,
        "groupable": {"status": "Pending / Approved / Rejected"},
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},  # nullable (anonymous submissions)
    },
    # ── WORKFORCE & SKILLS ───────────────────────────────────────────────────────
    "employee_skills": {
        "model": EmployeeSkill, "label": "Employee Skills (Alchemy Portal)",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {"skill": "skill name"},
        "bool_as_label": {"is_primary": ("Primary Skill", "Secondary Skill")},
        "numeric": {"years_experience": "years of experience in this skill"},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "appreciations": {
        "model": Appreciation, "label": "Client Appreciations",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {"client_name": "client who sent the appreciation"},
        "numeric": {},
        "employee_link": {"type": "email", "column": "employee_email"},
    },
    "attendance": {
        "model": Attendance, "label": "Attendance Records (org-wide biometric)",
        "date_col": "date", "resolved_col": None,
        "groupable": {"status": "Present / Absent / WFH / Half-day"},
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
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
        "employee_link": {"type": "none", "column": None},  # no employee link
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
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    # ── EMPLOYEE DIRECTORY & CORE HR (NEW — combinable primary/filter sources) ───
    "employee": {
        "model": Employee, "label": "Employee Directory",
        "date_col": "joining_date", "resolved_col": None,
        "groupable": {
            "department": "employee department",
            "designation": "job title",
            "location": "office location",
            "employment_type": "Full-time / Contract",
            "shift_type": "Day / Night",
        },
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "id"},  # Employee IS the spine
    },
    "leave": {
        "model": Leave, "label": "Leave Requests",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "leave_type": "leave type",
            "status": "Pending / Approved / Rejected",
        },
        "numeric": {},
        "employee_link": {"type": "fk_id", "column": "employee_id"},
    },
    "employee_allocation": {
        "model": EmployeeAllocation, "label": "Employee Allocation (latest snapshot)",
        "date_col": "allocation_date", "resolved_col": None,
        "groupable": {
            "function": "function",
            "client_master": "client",
            "billing": "billing status (Billable / Pipeline / For Allocation etc.)",
            "project_type": "project type",
            "status": "Active / Inactive",
        },
        "numeric": {
            "efforts_percent": "effort allocation %",
            "billability_percent": "billability %",
        },
        "employee_link": {"type": "code", "column": "employee_id"},  # string code, NOT the FK id
    },
    # ── APP USAGE (NEW — AI assistant activity) ──────────────────────────────────
    "ai_request_log": {
        "model": AiRequestLog, "label": "AI Assistant Requests",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {
            "domain": "HR / IT / Admin / PMO / General",
            "model_name": "LLM model used",
        },
        "numeric": {
            "total_latency_ms": "total latency (ms)",
            "total_tokens": "total tokens",
        },
        "employee_link": {"type": "email", "column": "user_email"},
    },
    "chat_feedback": {
        "model": ChatFeedback, "label": "Chat Feedback",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {"domain": "hr / admin / it_support / pmo / general"},
        "numeric": {"rating": "1 = helpful, -1 = unhelpful"},
        "employee_link": {"type": "none", "column": None},  # only session_id, no employee/email link
    },
    "connector_call_log": {
        "model": ConnectorCallLog, "label": "Connector Usage",
        "date_col": "created_at", "resolved_col": None,
        "groupable": {"status": "success / error / timeout"},
        "numeric": {"latency_ms": "latency (ms)"},
        "employee_link": {"type": "email", "column": "user_email"},
    },
}


# Core Employee fields any employee-linked source can be grouped by via a join
# (e.g. "leave by department" when Leave itself has no department column).
_EMPLOYEE_GROUPABLE = _DATA_SOURCES["employee"]["groupable"]


def _build_dynamic_docs() -> str:
    sections = [
        ("IT & OPERATIONS", ["it_tickets", "software_requests", "asset_assignments", "asset_requests"]),
        ("HR", ["reimbursements", "grievances", "hr_queries", "travel_requests", "travel_expense_claims", "onboarding_journeys"]),
        ("ADMIN & FACILITIES", ["parking_stickers", "facility_complaints", "food_vendor_feedback", "visitor_passes", "desk_key_requests", "announcements"]),
        ("LEARNING", ["te_assignments", "te_trainings", "udemy_license_requests", "book_requests"]),
        ("AI & ESCALATIONS", ["escalations", "form_submissions"]),
        ("WORKFORCE & SKILLS", ["employee_skills", "appreciations", "attendance"]),
        ("PROJECT INTELLIGENCE", ["project_profiles"]),
        ("EMPLOYEE DIRECTORY & CORE HR", ["employee", "employee_zoho_profile", "leave", "employee_allocation"]),
        ("APP USAGE", ["ai_request_log", "chat_feedback", "connector_call_log"]),
    ]
    lines = [
        "\nDYNAMIC QUERIES (mode='dynamic'):",
        "Use when the user asks about any data NOT covered by the template queries above.",
        "Set: mode='dynamic', data_source=<id>, group_by=<col>, metric=<metric>[, period=<period>].",
        "period: 30d|90d|6m|12m — only for data sources marked with * (have a date column).",
        "metric: count | sum:<col> | avg:<col> | avg_resolution_hours",
        "  Q: 'top 10 skills chart' or 'skills breakdown' (single source, no constraint named)",
        "  -> mode='dynamic', data_source='employee_skills', group_by='skill', metric='count' "
        "(query_id/filter_sources/filters stay empty/unset — do not set mode='template' here, "
        "'employee_skills' is not a template id)",
        "",
        "Any data_source below marked with an employee link can ALSO be grouped by a core "
        f"Employee field even if that field isn't in its own group_by list: "
        f"{' | '.join(_EMPLOYEE_GROUPABLE)}. Use this whenever the request names one of these "
        "fields and the data source itself doesn't have that column.",
        "  Q: 'leave data by department' (Leave has no department column of its own)",
        "  -> mode='dynamic', data_source='leave', group_by='department', metric='count' "
        "(NOT data_source='employee_skills' — 'department' has nothing to do with skills)",
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

# Keyword a user message must contain (whole word/phrase, case-insensitive) to unambiguously
# imply a given dynamic/combine data source. Guards against the router LLM anchoring to the
# wrong worked example in its own prompt (e.g. asked for "leave by department" but it echoes
# back the skills or Finance-attendance example instead) — see builder_chat's retry loop.
_SOURCE_KEYWORDS: dict[str, list[str]] = {
    "leave": ["leave"],
    "attendance": ["attendance"],
    "employee_skills": ["skill"],
    "it_tickets": ["it ticket"],
    "reimbursements": ["reimbursement"],
    "grievances": ["grievance"],
    "hr_queries": ["hr quer"],
    "travel_requests": ["travel request"],
    "travel_expense_claims": ["travel expense", "travel claim"],
    "onboarding_journeys": ["onboarding"],
    "parking_stickers": ["parking"],
    "facility_complaints": ["facility complaint"],
    "food_vendor_feedback": ["food vendor", "cafeteria feedback"],
    "visitor_passes": ["visitor pass"],
    "desk_key_requests": ["desk key"],
    "escalations": ["escalation"],
    "te_assignments": ["training assignment"],
    "udemy_license_requests": ["udemy"],
    "book_requests": ["book request", "library book"],
    "appreciations": ["appreciation"],
    "employee_allocation": ["allocation", "bench", "utilization"],
}


def _unambiguous_source_hint(message: str) -> Optional[str]:
    """Return the one data source id whose keyword unambiguously appears in `message`,
    or None if zero or multiple sources match (too ambiguous to override the model)."""
    hits = {sid for sid, kws in _SOURCE_KEYWORDS.items()
            if any(re.search(rf"\b{re.escape(kw)}", message, re.I) for kw in kws)}
    return next(iter(hits)) if len(hits) == 1 else None


def _field_hint(message: str, candidate_fields: list) -> Optional[str]:
    """Return the one candidate group_by field (e.g. 'department') named as a literal word/
    phrase in `message`, or None if zero or multiple candidates match — same anchoring guard
    as _unambiguous_source_hint, applied to the group_by choice instead of the data source."""
    hits = {f for f in candidate_fields
            if re.search(rf"\b{re.escape(f.replace('_', ' '))}\b", message, re.I)}
    return next(iter(hits)) if len(hits) == 1 else None


def _default_title(data_source: str, group_by: str) -> str:
    src = _DATA_SOURCES.get(data_source)
    label = src["label"] if src else data_source.replace("_", " ").title()
    return f"{label} by {group_by.replace('_', ' ').title()}"


def _build_combine_docs() -> str:
    linkable = [sid for sid, s in _DATA_SOURCES.items()
                if s.get("employee_link", {}).get("type") != "none"]
    lines = [
        "\nCOMBINE QUERIES (mode='combine') — cross-domain questions spanning multiple sources:",
        "Use when the question constrains one data source's rows by a condition that lives on "
        "a DIFFERENT source, via employee identity — e.g. 'attendance rate for employees with "
        "skill X', 'leave days by leave type for people in the Pune office', 'IT ticket volume "
        "by category for employees on billable projects'.",
        "Set: mode='combine', primary_source=<id that supplies the chart's rows/group_by/metric>, "
        "filter_sources=[<other ids used only to constrain WHICH employees qualify>], "
        "filters=[{source, field, op, value}, ...].",
        "- group_by/metric/period apply ONLY to primary_source (same rules as dynamic mode).",
        "- A filter with source==primary_source is a plain column condition on the primary table "
        "itself (e.g. {source:'attendance', field:'status', op:'eq', value:'Present'}).",
        "- A filter with source in filter_sources constrains primary rows to employees who have "
        "at least one matching row in THAT source (e.g. {source:'employee_skills', field:'skill', "
        "op:'eq', value:'Python'} limits the primary source to employees who know Python).",
        "- Multiple different filter_sources are combined with AND (employee must satisfy all).",
        "- op is one of: eq | neq | gt | gte | lt | lte | in | contains.",
        "- Only sources below carry an employee identity and can be used in filter_sources. "
        "Sources NOT listed here (e.g. announcements, te_trainings, project_profiles, "
        "chat_feedback) can only be used as primary_source, never in filter_sources.",
        "- Prefer mode='dynamic' when there is only one relevant source; use 'combine' ONLY when "
        "filter_sources is non-empty and genuinely different from primary_source.",
        "- group_by MUST be a field on primary_source; every filter's field MUST be a field on "
        "the source named in that same filter (see the field list below). Never group the primary "
        "source by a column that only exists on a filter source.",
        "- NEVER invent a filter value that isn't explicitly named in the user's message. The "
        "worked examples below are shape templates only — do NOT reuse their literal values "
        "(e.g. 'Python', 'Pune', 'Billable') for unrelated requests. If the user's request names "
        "no constraining value at all (e.g. 'top 10 skills chart' with no department/location/"
        "status mentioned), use mode='dynamic' with filter_sources=[] and filters=[] — do not "
        "fabricate a filter just because a field happens to be filterable.",
        "",
        "WORKED EXAMPLES (copy this exact shape — the field/source structure, never the literal values):",
        "  Q: 'attendance status for employees who know Python'",
        "  -> mode='combine', primary_source='attendance', group_by='status', metric='count', "
        "filter_sources=['employee_skills'], "
        "filters=[{source:'employee_skills', field:'skill', op:'eq', value:'Python'}]",
        "  Q: 'leave requests by type for employees in the Pune office'",
        "  -> mode='combine', primary_source='leave', group_by='leave_type', metric='count', "
        "filter_sources=['employee'], "
        "filters=[{source:'employee', field:'location', op:'eq', value:'Pune'}]",
        "  Q: 'IT tickets by category for employees on billable projects'",
        "  -> mode='combine', primary_source='it_tickets', group_by='category', metric='count', "
        "filter_sources=['employee_allocation'], "
        "filters=[{source:'employee_allocation', field:'billing', op:'eq', value:'Billable'}]",
        "  Q: 'present-day attendance count for the Finance department' (filter is on a different "
        "source than the one being counted)",
        "  -> mode='combine', primary_source='attendance', group_by='status', metric='count', "
        "filter_sources=['employee'], "
        "filters=[{source:'attendance', field:'status', op:'eq', value:'Present'}, "
        "{source:'employee', field:'department', op:'eq', value:'Finance'}]",
        "  Q: 'top 10 skills chart' (no constraining value named anywhere)",
        "  -> mode='dynamic', data_source='employee_skills', group_by='skill', metric='count' "
        "(no filters, no filter_sources — there is nothing in the request to filter by)",
        "",
        "Filterable (employee-linked) sources and their allowed fields:",
    ]
    for sid in linkable:
        src = _DATA_SOURCES[sid]
        cols = list(src.get("groupable", {})) + list(src.get("numeric", {}))
        if src.get("date_col"):
            cols.append(src["date_col"])
        lines.append(f"  {sid} — fields: {' | '.join(cols)}")
    return "\n".join(lines)


_COMBINE_DOCS = _build_combine_docs()

def _normalize_source_id(src_id: Optional[str]) -> str:
    """Strip whitespace and the '*' date-column marker the docs annotate sources with — the
    router LLM occasionally echoes that marker straight into data_source/primary_source."""
    return (src_id or "").strip().rstrip("*").strip()


# ── Filter safety: operator whitelist + value coercion ───────────────────────────────────────

_FILTER_OPS: dict[str, Callable] = {
    "eq":       lambda col, v: col == v,
    "neq":      lambda col, v: col != v,
    "gt":       lambda col, v: col > v,
    "gte":      lambda col, v: col >= v,
    "lt":       lambda col, v: col < v,
    "lte":      lambda col, v: col <= v,
    "in":       lambda col, v: col.in_(v),
    "contains": lambda col, v: col.ilike(f"%{v}%"),
}

_OP_SYMBOLS = {"eq": "=", "neq": "≠", "gt": ">", "gte": "≥", "lt": "<", "lte": "≤",
               "in": "in", "contains": "contains"}


def _describe_combine_filters(conditions: list, period: Optional[str]) -> Optional[str]:
    """Build an accurate, human-readable subtitle from the applied filters (not LLM freeform)."""
    parts = [f"{c.field} {_OP_SYMBOLS.get(c.op, c.op)} {c.value}" for c in conditions]
    text = "Filtered: " + "; ".join(parts) if parts else None
    if period:
        text = f"{text} · last {period}" if text else f"Last {period}"
    return text


def _coerce_scalar(python_type: type, raw: Any) -> Any:
    if python_type is str:
        return str(raw)
    if python_type is bool:
        if isinstance(raw, bool):
            return raw
        s = str(raw).strip().lower()
        if s in ("true", "yes", "1"):
            return True
        if s in ("false", "no", "0"):
            return False
        raise ValueError(f"Cannot interpret '{raw}' as true/false.")
    if python_type is int:
        try:
            return int(raw)
        except (TypeError, ValueError):
            raise ValueError(f"Cannot interpret '{raw}' as a whole number.")
    if python_type is float:
        try:
            return float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"Cannot interpret '{raw}' as a number.")
    if python_type in (datetime.date, datetime.datetime):
        try:
            s = str(raw)
            return (datetime.datetime.fromisoformat(s) if python_type is datetime.datetime
                    else datetime.date.fromisoformat(s))
        except ValueError:
            raise ValueError(f"Cannot interpret '{raw}' as a date (use YYYY-MM-DD).")
    return raw


def _coerce_value(col, op: str, raw_value: str) -> Any:
    try:
        python_type = col.type.python_type
    except NotImplementedError:
        python_type = str
    if op == "in":
        parts = [p.strip() for p in str(raw_value).split(",") if p.strip()]
        if not parts:
            raise ValueError("Operator 'in' requires at least one comma-separated value.")
        return [_coerce_scalar(python_type, v) for v in parts]
    if op == "contains" and python_type is not str:
        raise ValueError("Operator 'contains' only applies to text columns.")
    return _coerce_scalar(python_type, raw_value)


def _build_column_predicate(Model, src: dict, src_id: str, cond: FilterCondition):
    """Validate field/op against src's allowlist, coerce value, return a safe SQLAlchemy predicate."""
    allowed = set(src.get("groupable", {})) | set(src.get("numeric", {})) | set(src.get("bool_as_label", {}))
    if src.get("date_col"):
        allowed.add(src["date_col"])
    if cond.field not in allowed:
        raise ValueError(f"Cannot filter '{src_id}' on '{cond.field}'. Allowed: {', '.join(sorted(allowed))}")
    col = getattr(Model, cond.field)
    op_fn = _FILTER_OPS.get(cond.op)
    if op_fn is None:
        raise ValueError(f"Unknown filter operator '{cond.op}'. Allowed: {', '.join(_FILTER_OPS)}")
    value = _coerce_value(col, cond.op, cond.value)
    return op_fn(col, value)


# ── Employee-identity spine resolution (for combine mode) ────────────────────────────────────

def _get_employee_link(src_id: str) -> dict:
    src = _DATA_SOURCES.get(_normalize_source_id(src_id))
    if not src:
        raise ValueError(f"Unknown data source '{src_id}'.")
    return src.get("employee_link") or {"type": "none", "column": None}


def _resolve_employee_filter(db: Session, source_id: str, conditions: list) -> set:
    """Apply `conditions` (all targeting `source_id`) to that source's own table, then project
    down to the DISTINCT set of canonical Employee.id values satisfying them. Never returns rows
    from `source_id` itself — only identities, so combining sources can never fan out."""
    source_id = _normalize_source_id(source_id)
    src = _DATA_SOURCES.get(source_id)
    if not src:
        raise ValueError(f"Unknown data source '{source_id}'.")
    link = _get_employee_link(source_id)
    if link["type"] == "none":
        raise ValueError(
            f"'{source_id}' has no employee linkage and cannot be used as a filter source."
        )
    Model = src["model"]
    preds = [_build_column_predicate(Model, src, source_id, c) for c in conditions]

    if link["type"] == "fk_id":
        col = getattr(Model, link["column"])
        q = db.query(col).filter(col.isnot(None), *preds).distinct()
        return {r[0] for r in q.all()}
    if link["type"] == "code":
        col = getattr(Model, link["column"])
        q = (db.query(Employee.id)
               .join(Model, col == Employee.employee_id)
               .filter(*preds).distinct())
        return {r[0] for r in q.all()}
    if link["type"] == "email":
        col = getattr(Model, link["column"])
        q = (db.query(Employee.id)
               .join(Model, func.lower(col) == func.lower(Employee.email))
               .filter(*preds).distinct())
        return {r[0] for r in q.all()}
    raise ValueError(f"Unrecognized employee_link type for '{source_id}'.")


def _employee_id_set_predicate(db: Session, primary_source_id: str, qualifying_ids: set):
    """Translate a set of canonical Employee.id back into a predicate on the PRIMARY source's
    own identity column, whatever convention that source uses."""
    link = _get_employee_link(primary_source_id)
    Model = _DATA_SOURCES[primary_source_id]["model"]
    if link["type"] == "fk_id":
        return getattr(Model, link["column"]).in_(qualifying_ids)
    if link["type"] == "code":
        codes = {r[0] for r in db.query(Employee.employee_id).filter(Employee.id.in_(qualifying_ids))}
        return getattr(Model, link["column"]).in_(codes)
    if link["type"] == "email":
        emails = {r[0] for r in db.query(Employee.email).filter(Employee.id.in_(qualifying_ids))}
        return getattr(Model, link["column"]).in_(emails)
    raise ValueError(
        f"'{primary_source_id}' has no employee linkage and cannot be constrained by filter_sources."
    )


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


def _zoho_headcount_rows(db: Session, field_candidates: tuple, local_column, local_active_filter):
    """Headcount-by-<field>, preferring the live Zoho HR view over the local
    employee_zoho_profiles copy (which is only populated by a manual CSV import and is easy to
    let go stale/empty). Falls back to the local table when the live view isn't configured or
    is unreachable, so this still works in demo/offline environments."""
    from app.services import zoho_directory_service as zds
    if zds.is_configured():
        live = zds.aggregate_field_counts(*field_candidates)
        if live:
            return live
    return (db.query(local_column, func.count(EmployeeZohoProfile.id))
            .filter(local_active_filter, local_column.isnot(None))
            .group_by(local_column)
            .order_by(func.count(EmployeeZohoProfile.id).desc()).all())


def _zoho_joining_trend_rows(db: Session, cutoff):
    """New-joiner counts per month, preferring the live Zoho HR view (see _zoho_headcount_rows)."""
    from app.services import zoho_directory_service as zds
    if zds.is_configured():
        cutoff_date = cutoff.date() if isinstance(cutoff, datetime.datetime) else cutoff
        live = zds.aggregate_joining_trend(cutoff_date)
        if live:
            return live
    return (db.query(func.date_trunc("month", EmployeeZohoProfile.date_of_joining),
                     func.count(EmployeeZohoProfile.id))
            .filter(EmployeeZohoProfile.date_of_joining >= cutoff,
                    EmployeeZohoProfile.date_of_joining.isnot(None))
            .group_by(func.date_trunc("month", EmployeeZohoProfile.date_of_joining))
            .order_by(func.date_trunc("month", EmployeeZohoProfile.date_of_joining)).all())


def _empty_chart_spec(intent: BuilderIntent) -> ChartSpec:
    return ChartSpec(
        type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
        data=[], x_key="x", y_keys=["value"], y_labels={"value": "Count"},
        colors=[], unit="count", stacked=intent.stacked,
    )


def _run_dynamic_query(db: Session, intent: BuilderIntent) -> ChartSpec:
    """Execute a safe, validated single-table aggregation on any registered data source."""
    return _execute_grouped_query(db, intent, intent.data_source)


def _run_combine_query(db: Session, intent: BuilderIntent) -> ChartSpec:
    """Multi-source: primary_source supplies rows/columns; filter_sources constrain which
    employees are included via identity-set intersection (semi-join) — never a row-level join,
    so a one-to-many filter source (e.g. multiple skills per employee) can never fan out and
    inflate the primary source's count/sum/avg."""
    primary_id = _normalize_source_id(intent.primary_source)
    if primary_id not in _DATA_SOURCES:
        raise ValueError(f"Unknown primary_source '{primary_id}'. Available: {', '.join(_DATA_SOURCES)}")

    norm_filters = [(_normalize_source_id(c.source), c) for c in intent.filters]
    primary_filters = [c for sid, c in norm_filters if sid == primary_id]
    identity_filters_by_src: dict[str, list] = {}
    for sid, c in norm_filters:
        if sid != primary_id:
            identity_filters_by_src.setdefault(sid, []).append(c)
    for raw_sid in intent.filter_sources:   # declared even with zero explicit conditions on it
        sid = _normalize_source_id(raw_sid)
        if sid != primary_id:
            identity_filters_by_src.setdefault(sid, [])

    qualifying: Optional[set] = None
    for sid, conds in identity_filters_by_src.items():
        ids = _resolve_employee_filter(db, sid, conds)
        qualifying = ids if qualifying is None else (qualifying & ids)

    if qualifying is not None and len(qualifying) == 0:
        return _empty_chart_spec(intent)

    Model = _DATA_SOURCES[primary_id]["model"]
    extra_predicates = [
        _build_column_predicate(Model, _DATA_SOURCES[primary_id], primary_id, c)
        for c in primary_filters
    ]
    if qualifying is not None:
        extra_predicates.append(_employee_id_set_predicate(db, primary_id, qualifying))

    # Deterministic, accurate subtitle from the actual filters — the small router LLM tends to
    # hallucinate freeform subtitles (e.g. listing statuses that aren't in the data), so we
    # override rather than trust intent.subtitle here.
    intent.subtitle = _describe_combine_filters([c for _sid, c in norm_filters], intent.period)

    return _execute_grouped_query(db, intent, primary_id, extra_predicates=extra_predicates)


def _execute_grouped_query(db: Session, intent: BuilderIntent, src_id: Optional[str],
                            extra_predicates: tuple = ()) -> ChartSpec:
    """Shared executor for 'dynamic' (extra_predicates=()) and 'combine' (extra_predicates from
    filter_sources / primary-source filters) modes — one validated group_by/metric query."""
    src_id = _normalize_source_id(src_id)
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
    link = src.get("employee_link") or {"type": "none", "column": None}

    # Validate group_by ─────────────────────────────────────────────────────────
    group_by = (intent.group_by or "").strip()
    is_bool_col = group_by in bool_labels
    # Any employee-linked source can also be grouped by a core Employee field
    # (department, designation, location, ...) via a join — e.g. "leave by department"
    # when the source itself (Leave) has no department column of its own.
    is_employee_join = (
        group_by in _EMPLOYEE_GROUPABLE
        and group_by not in groupable
        and link["type"] != "none"
    )
    if group_by not in groupable and not is_bool_col and not is_employee_join:
        allowed = list(groupable) + list(bool_labels) + list(_EMPLOYEE_GROUPABLE)
        raise ValueError(
            f"Cannot group '{src_id}' by '{group_by}'. "
            f"Allowed: {', '.join(allowed)}"
        )
    grp_col = getattr(Employee, group_by) if is_employee_join else getattr(Model, group_by)

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
    if is_employee_join:
        q = db.query(grp_col.label("grp"), metric_expr.label("val")).select_from(Model)
        if link["type"] == "fk_id":
            q = q.join(Employee, getattr(Model, link["column"]) == Employee.id)
        elif link["type"] == "code":
            q = q.join(Employee, getattr(Model, link["column"]) == Employee.employee_id)
        elif link["type"] == "email":
            q = q.join(Employee, func.lower(getattr(Model, link["column"])) == func.lower(Employee.email))
    else:
        q = db.query(grp_col.label("grp"), metric_expr.label("val"))
    q = q.filter(grp_col.isnot(None))

    if intent.period and date_col_name:
        cutoff = _period_cutoff(intent.period)
        q = q.filter(getattr(Model, date_col_name) >= cutoff)

    for f in extra_filters:
        q = q.filter(f)

    for p in extra_predicates:
        q = q.filter(p)

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

    # A label-per-category chart (bar/pie/radar/funnel/composed) becomes unreadable well
    # before 290 categories — the LLM picks chart_type before it knows how many rows come
    # back, so cap it here instead. Treemap scales to many categories without axis/legend
    # clutter, so it's the fallback rather than silently truncating the data.
    chart_type = intent.chart_type
    if chart_type in _LABEL_HEAVY_TYPES and len(data) > _MANY_CATEGORIES_THRESHOLD:
        chart_type = "treemap"
        note = f"{len(data)} categories — showing as treemap for readability"
        subtitle = f"{subtitle} · {note}" if subtitle else note

    return ChartSpec(
        type=chart_type,
        title=intent.title,
        subtitle=subtitle,
        data=data,
        x_key="x",
        y_keys=["value"],
        y_labels={"value": metric_label},
        colors=_PALETTE[: max(len(data), 1)],
        unit=unit,
        stacked=False,   # single series — stacking is meaningless and renders oddly
    )


def _run_query(db: Session, intent: BuilderIntent, user_email: Optional[str] = None) -> ChartSpec:
    if intent.mode == "dynamic":
        return _run_dynamic_query(db, intent)
    if intent.mode == "combine":
        return _run_combine_query(db, intent)

    qid = intent.query_id
    period = intent.params.get("period", "30d")
    cutoff = _period_cutoff(period)

    # Shared active-employee filter for all EmployeeZohoProfile headcount queries.
    _ACTIVE = EmployeeZohoProfile.employee_status != "Inactive"

    # ── EMPLOYEE HEADCOUNT ──────────────────────────────────────────────────────
    if qid == "headcount_by_function":
        rows = _zoho_headcount_rows(db, ("department", "parentdepartment"),
                                     EmployeeZohoProfile.function, _ACTIVE)
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=[_PALETTE[0]], unit="count")

    if qid == "headcount_by_grade":
        rows = _zoho_headcount_rows(db, ("grade",), EmployeeZohoProfile.grade, _ACTIVE)
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=[_PALETTE[2]], unit="count")

    if qid == "headcount_by_gender":
        rows = _zoho_headcount_rows(db, ("gender",), EmployeeZohoProfile.gender, _ACTIVE)
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"},
                         colors=[_PALETTE[0], _PALETTE[1], _PALETTE[3]], unit="count")

    if qid == "headcount_by_level":
        rows = _zoho_headcount_rows(db, ("level",), EmployeeZohoProfile.level, _ACTIVE)
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
        # Employee.department was partially randomly assigned; the live Zoho HR view
        # (falling back to the local EmployeeZohoProfile.function copy) is authoritative.
        rows = _zoho_headcount_rows(db, ("department", "parentdepartment"),
                                     EmployeeZohoProfile.function, _ACTIVE)
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Headcount"}, colors=[_PALETTE[1]], unit="count")

    if qid == "headcount_by_employment_type":
        rows = _zoho_headcount_rows(db, ("employeetype", "employment_type"),
                                     EmployeeZohoProfile.employment_type, _ACTIVE)
        data = _rows_to_series(rows)
        return ChartSpec(type=intent.chart_type, title=intent.title, subtitle=intent.subtitle,
                         data=data, x_key="x", y_keys=["value"],
                         y_labels={"value": "Count"}, colors=[_PALETTE[3], _PALETTE[5]], unit="count")

    if qid == "joining_trend":
        # Default to 12m — 30d produces near-zero data for a joining trend.
        join_period = intent.params.get("period", "12m")
        join_cutoff = _period_cutoff(join_period)
        rows = _zoho_joining_trend_rows(db, join_cutoff)
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
        "Your job is to map the user's request to a chart configuration using a predefined "
        "template (mode='template'), a single-table DB query (mode='dynamic'), or a multi-source "
        "query that filters one source by a condition on another (mode='combine').\n\n"
        f"{_TEMPLATE_DOCS}"
        f"{_DYNAMIC_DOCS}\n"
        f"{_COMBINE_DOCS}\n"
        "DECISION RULES:\n"
        "- Use mode='template' when the request matches one of the named templates above (headcount, leave, allocation, attendance, AI metrics).\n"
        "- Use mode='dynamic' when the request is about ONE data source only — IT tickets, reimbursements, travel, training, facilities, skills, escalations, projects, app usage, etc.\n"
        "- Use mode='combine' when the request needs rows from one source filtered by a condition on a DIFFERENT source via employee identity (see COMBINE QUERIES above).\n"
        "- For 'change the chart type' requests, keep the same mode/query but change chart_type.\n"
        "- Template period must be one of: 24h, 7d, 30d, 90d, 6m, 12m. Default: 6m.\n"
        "- Dynamic/combine period: 30d|90d|6m|12m. Only set period when the data source has a date column (marked *).\n"
        "- For pie charts, prefer fewer than 7 categories; use bar for more.\n"
        "- For scatter, always use query_id=headcount_vs_bench (template).\n"
        "- For radar, choose the best single-category template query with chart_type=radar.\n"
        "- For treemap, any headcount or groupable dynamic query works.\n"
        "- For 'my team/reportees attendance', use mode='template', query_id=reportee_attendance_split, chart_type=pie.\n"
        "- Never invent a query_id, data_source, primary_source, or filter_sources entry — only use exactly what is listed.\n"
        "- If the request is a knowledge/policy question rather than a chartable data request "
        "(e.g. 'what is the maternity leave policy', 'how do I apply for leave'), set off_topic=true "
        "instead of forcing it into a chart.\n"
    )

    messages = [{"role": "system", "content": system}]
    for turn in history[-6:]:   # last 3 turns context
        messages.append({"role": turn.get("role", "user"), "content": turn.get("content", "")})
    messages.append({"role": "user", "content": message})

    from app.services.llm_resilience import resilient_invoke

    def _invoke_intent(msgs: list) -> BuilderIntent:
        # Ideally "service" tier (llama3.1:8b) — this schema spans ~35 data sources,
        # group_by/filter/chart_type fields, and combine-mode joins, a much harder
        # structured-extraction job than the domain classification "router" was sized for.
        # Reverted to "router" for now: ml01 currently has only llama3.2:3b resident (on
        # CPU) and is rejecting new model loads, so requesting "service" just burns retries
        # against the load-reject rescue and sometimes times out outright — worse than
        # answering promptly on 3b. Flip this back to "service" once ml01 has spare capacity
        # to hold llama3.1:8b resident (see ml01-load-reject-rescue).
        result = resilient_invoke(
            "router", msgs, build=lambda llm: llm.with_structured_output(BuilderIntent),
        )
        return result if isinstance(result, BuilderIntent) else BuilderIntent(**dict(result))

    # Up to 2 passes: if the first config names an invalid source/field/metric, feed the exact
    # validation error back to the model once and let it self-correct (the errors already say
    # what's allowed). The retry LLM call only happens on a miss — the happy path is one call.
    intent: Optional[BuilderIntent] = None
    spec: Optional[ChartSpec] = None
    for attempt in range(2):
        try:
            intent = _invoke_intent(messages)
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

        if intent.off_topic:
            return {
                "ok": False,
                "chart": None,
                "off_topic": True,
                "explanation": "That doesn't look like a chartable data request — try describing "
                               "a metric to visualize, e.g. \"headcount by function as a bar chart\" "
                               "or \"IT tickets by category last 3 months\".",
                "suggestions": [
                    "Headcount by function as bar chart",
                    "IT tickets by category last 3 months",
                    "Reimbursements by type as pie chart",
                    "Training assignments by status",
                ],
            }

        # Validate chart type
        if intent.chart_type not in CHART_TYPES:
            intent.chart_type = "bar"
        # Sanitize period — the router LLM sometimes echoes the whole options list
        # ("30d|90d|6m|12m") into the field, which then leaks into the subtitle.
        if intent.period and intent.period not in _PERIODS:
            intent.period = None
        # The router LLM occasionally copies a literal filter value straight out of the
        # prompt's worked examples (e.g. a department name) instead of leaving filters empty
        # when the user's request names no constraint at all. A filter whose value doesn't
        # appear anywhere in the conversation text is almost certainly hallucinated — drop it
        # rather than silently returning zero rows.
        if intent.mode == "combine":
            # Only the actual conversation (history + this message) — NOT the system prompt,
            # which contains example filter values (e.g. 'Finance', 'Pune') that would otherwise
            # trivially "ground" any hallucinated filter the model copies from those examples.
            convo_text = " ".join(
                [message] + [t.get("content", "") for t in history if isinstance(t.get("content"), str)]
            ).lower()
            grounded = [f for f in intent.filters if f.value.lower() in convo_text]
            if len(grounded) != len(intent.filters):
                dropped = [f for f in intent.filters if f not in grounded]
                log.info("Builder dropped ungrounded filter(s) not present in conversation: %s", dropped)
            intent.filters = grounded
            if not intent.filters:
                intent.mode = "dynamic"
                intent.data_source = intent.primary_source
                intent.filter_sources = []
                intent.title = _default_title(intent.data_source, intent.group_by or "")

        # The router LLM occasionally anchors to an unrelated worked example from its own
        # prompt instead of the actual request (e.g. "leave by department" comes back as the
        # skills chart, the Finance/attendance example, or the right source but wrong column).
        # When the user's own words unambiguously name a source/field, trust that over the model.
        if intent.mode in ("dynamic", "combine"):
            chosen = _normalize_source_id(intent.data_source if intent.mode == "dynamic" else intent.primary_source)
            source_hint = _unambiguous_source_hint(message)
            effective_source = source_hint or chosen
            field_hint = _field_hint(
                message,
                list(_DATA_SOURCES.get(effective_source, {}).get("groupable", {})) + list(_EMPLOYEE_GROUPABLE),
            ) if effective_source in _DATA_SOURCES else None
            source_mismatch = bool(source_hint) and chosen != source_hint
            field_mismatch = bool(field_hint) and field_hint != (intent.group_by or "").strip()

            if source_mismatch or field_mismatch:
                if attempt == 0:
                    log.info("Builder intent mismatch: message implies source=%s field=%s, model picked "
                              "source=%s field=%s — retrying", source_hint, field_hint, chosen, intent.group_by)
                    messages.append({"role": "assistant", "content": intent.model_dump_json()})
                    src_note = f"data_source='{source_hint}' (or primary_source='{source_hint}' for mode='combine')" \
                        if source_mismatch else f"data_source='{chosen}'"
                    group_note = f", grouped by '{field_hint}'" if field_mismatch else ""
                    messages.append({"role": "user", "content": (
                        f"Your request clearly refers to '{effective_source}' data{group_note or ''}. "
                        f"Re-read the DYNAMIC/COMBINE docs and return a corrected configuration using "
                        f"{src_note}{group_note}."
                    )})
                    continue
                # Last attempt still wrong — trust the user's words over the model.
                log.warning("Builder intent mismatch persisted; forcing source=%s field=%s",
                            effective_source, field_hint or intent.group_by)
                intent.mode = "dynamic"
                intent.data_source = effective_source
                intent.filter_sources = []
                intent.filters = []
                src_groupable = _DATA_SOURCES[effective_source].get("groupable", {})
                if field_hint:
                    intent.group_by = field_hint
                elif intent.group_by not in src_groupable and intent.group_by not in _EMPLOYEE_GROUPABLE:
                    intent.group_by = next(iter(src_groupable), intent.group_by or "")
                intent.title = _default_title(intent.data_source, intent.group_by or "")

        try:
            spec = _run_query(db, intent, user_email=user_email)
            break
        except ValueError as exc:
            if attempt == 0:
                log.info("Builder self-correcting after validation error: %s", exc)
                messages.append({"role": "assistant", "content": intent.model_dump_json()})
                messages.append({"role": "user", "content": (
                    f"That configuration was invalid: {exc} "
                    "Return a corrected configuration for the SAME request, using ONLY the source "
                    "ids, group_by columns, filter fields, and metrics listed above and named in "
                    "that error. Do not invent names."
                )})
                continue
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
        "explanation": _explanation(intent, spec, message),
        "suggestions": suggestions,
    }


# reportee_attendance_split is the ONLY team-scoped template; every other metric is
# org-wide. Templates also can't slice finer than their period (30d/90d/6m/12m) — no
# week/day granularity. When the user asked for a team or sub-month cut we can't deliver,
# say so instead of presenting the broader figure as if it answered the question (P2).
_TEAM_SCOPE_KW = ("my team", "my reportees", "reportees", "direct report", "our team", "my people")
_SUBMONTH_KW = ("this week", "last week", "past week", "this fortnight", "today", "yesterday")


def _scope_caveat(intent: BuilderIntent, message: str) -> str:
    msg = (message or "").lower()
    notes = []
    if any(k in msg for k in _TEAM_SCOPE_KW) and intent.query_id != "reportee_attendance_split":
        notes.append("your whole organisation, not just your team")
    if any(k in msg for k in _SUBMONTH_KW):
        period = intent.params.get("period")
        notes.append(f"the {period} window" if period else "all available history")
    if not notes:
        return ""
    return f"⚠️ I don't have that exact cut — this covers {' and '.join(notes)}.\n\n"


def _explanation(intent: BuilderIntent, spec: ChartSpec, message: str = "") -> str:
    n = len(spec.data)
    if n == 0:
        return f"No data found for \"{intent.title}\". The database may not have records for this period."
    suffix = f" ({intent.params.get('period', '')} period)" if intent.params.get("period") else ""
    return f"{_scope_caveat(intent, message)}Showing **{intent.title}**{suffix} — {n} data point{'s' if n != 1 else ''}."


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
