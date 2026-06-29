"""Dynamic Access Management — role creation, capability assignment, per-user grants.

Super Admin can:
  • Create custom roles (beyond the built-in set)
  • Assign any capability (portal / focus-mode / feature) to any role
  • Override individual users' role + restrict via scopes + grant extra capabilities
  • All changes take effect immediately on the next request (no cache)
"""

from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user, require_super_admin
from app.database import get_db
from app.models import UserRoleOverride, MS365User, Employee, AppRole, RoleCapabilityMap

router = APIRouter(prefix="/api/access", tags=["Access Management"])

# ── Capability catalogue ────────────────────────────────────────────────────────
# Three categories:  portal  |  mode  |  feature
# Features carry per-action granularity; portals/modes have a single "access" action.
CAPABILITY_CATALOGUE: dict[str, dict] = {

    # ── Portals (Control Hub tabs) ────────────────────────────────────────────
    "portal:dashboard": {
        "label": "Announcements & Status",
        "description": "Allows access to company announcements, status updates, and the admin dashboard page.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:roi": {
        "label": "ROI Dashboard",
        "description": "Allows viewing AI adoption ROI metrics and value-realisation reports.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:analytics_studio": {
        "label": "Analytics Studio",
        "description": "Allows access to HR and org analytics — leave trends, attendance splits, and headcount.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:analytics_builder": {
        "label": "Chart Builder AI",
        "description": "Allows building custom charts using natural-language queries over enterprise data.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:observability": {
        "label": "AI Observability",
        "description": "Allows viewing AI conversation logs, feedback triage, and system health metrics.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:llm_controls": {
        "label": "LLM Model Controls",
        "description": "Allows managing LLM model tiers, kill switches, and per-domain prompt budgets.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:automation_hub": {
        "label": "Email Automation Hub",
        "description": "Allows building and managing automated email workflows and schedules.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:admin_services": {
        "label": "Admin Services",
        "description": "Allows employees to open the Admin Services page and submit their own requests (food complaints, reimbursements, parking, desk keys, bookshelf). To view ALL requests and manage/resolve them, also enable the individual feature capabilities below.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:hr_portal": {
        "label": "HR Portal",
        "description": "Allows access to HR operations — leave approvals, document generation, and grievance management.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:onboarding_tracker": {
        "label": "Onboarding Tracker",
        "description": "Allows tracking new-hire onboarding progress and document submission status.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:it_portal": {
        "label": "IT Portal",
        "description": "Allows raising and managing IT support tickets and software requests.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:pmo_portal": {
        "label": "PMO Portal",
        "description": "Allows access to project management, Udemy licence requests, and skill supply tools.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:leadership_command": {
        "label": "Leadership Command",
        "description": "Allows viewing leadership capability scores, bench-upskill plans, and team-readiness digest.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:project_iq": {
        "label": "Project IQ",
        "description": "Allows running project DNA extraction, finding similar past projects, lessons, and experts.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:te_lms": {
        "label": "TechElevate LMS",
        "description": "Allows browsing the in-house training catalogue, enrolling in courses, and tracking completion.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:udemy_business": {
        "label": "Udemy Business",
        "description": "Allows browsing the Udemy Business course catalogue and requesting licences.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:manager_portal": {
        "label": "Manager Attendance Portal",
        "description": "Allows functional managers to view team attendance reports and export data.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:people": {
        "label": "People Directory",
        "description": "Allows searching the employee directory with skill, project, and certification filters.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:config": {
        "label": "AI Configuration",
        "description": "Allows editing per-domain AI prompt templates and model configuration settings.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:url_library": {
        "label": "URL Library",
        "description": "Allows managing the internal URL/app library and using AI to draft descriptions.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:form_library": {
        "label": "Form Library",
        "description": "Allows opening the Form Library page (page visibility only — use the Form Library feature below to control create/edit permissions).",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:cabin_directory": {
        "label": "Cabin Directory",
        "description": "Allows viewing and navigating the office seating and cabin assignment directory.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },
    "portal:connector_studio": {
        "label": "Connector Studio",
        "description": "Allows configuring API connectors and browsing the AI Xchange Marketplace.",
        "category": "portal",
        "actions": [{"id": "access", "label": "Access", "description": "Open this portal tab"}],
    },

    # ── Focus Modes (chat domain pins) ────────────────────────────────────────
    "mode:analytics": {
        "label": "Analytics Mode",
        "description": "Allows activating Analytics focus mode — pins the assistant to HR and data queries.",
        "category": "mode",
        "actions": [{"id": "use", "label": "Use", "description": "Activate analytics focus mode"}],
    },
    "mode:training": {
        "label": "Training Mode",
        "description": "Allows activating Training focus mode — pins the assistant to learning and course queries.",
        "category": "mode",
        "actions": [{"id": "use", "label": "Use", "description": "Activate training focus mode"}],
    },
    "mode:project": {
        "label": "Project Mode",
        "description": "Allows activating Project focus mode — pins the assistant to project management queries.",
        "category": "mode",
        "actions": [{"id": "use", "label": "Use", "description": "Activate project focus mode"}],
    },
    "mode:resource": {
        "label": "Resource Mode",
        "description": "Allows activating Resource focus mode — pins the assistant to staffing and allocation queries.",
        "category": "mode",
        "actions": [{"id": "use", "label": "Use", "description": "Activate resource focus mode"}],
    },

    # ── Features (feature-level scopes with per-action granularity) ───────────
    "food_complaints": {
        "label": "Food & Facility Complaints",
        "description": "Admin-level access: allows viewing ALL complaints from all users and managing/closing tickets. Employees submitting their own complaints only need the Admin Services portal — they do not need this feature.",
        "category": "feature",
        "actions": [
            {"id": "read",   "label": "View All",   "description": "View all complaints from all users"},
            {"id": "manage", "label": "Manage", "description": "Update status, close and resolve tickets"},
        ],
    },
    "reimbursements": {
        "label": "Reimbursements",
        "description": "Admin-level access: allows viewing ALL reimbursement requests and approving or rejecting them. Employees submitting their own claims only need the Admin Services portal.",
        "category": "feature",
        "actions": [
            {"id": "read",    "label": "View All",    "description": "View all reimbursement requests from all users"},
            {"id": "approve", "label": "Approve", "description": "Approve or reject reimbursement claims"},
        ],
    },
    "travel_management": {
        "label": "Travel Management",
        "description": "Allows viewing, approving, and configuring business travel requests and expense claims.",
        "category": "feature",
        "actions": [
            {"id": "read",     "label": "View",     "description": "View all travel requests and expense claims"},
            {"id": "approve",  "label": "Approve",  "description": "Approve/reject requests and expense claims"},
            {"id": "settings", "label": "Settings", "description": "Set global and per-trip expense limits"},
        ],
    },
    "parking": {
        "label": "Parking Management",
        "description": "Allows managing parking sticker applications, dues collection, and payment reminders.",
        "category": "feature",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View sticker applications and dues"},
            {"id": "manage", "label": "Manage", "description": "Issue/revoke stickers, mark dues paid, send reminders"},
        ],
    },
    "desk_keys": {
        "label": "Desk & Access Keys",
        "description": "Allows viewing and processing desk key and office access key requests.",
        "category": "feature",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View desk key requests"},
            {"id": "manage", "label": "Manage", "description": "Approve, reject, or release desk keys"},
        ],
    },
    "bookshelf": {
        "label": "Bookshelf Buddy",
        "description": "Allows managing the company book library — borrow requests, returns, and adding new books.",
        "category": "feature",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View books, requests, and assignments"},
            {"id": "manage", "label": "Manage", "description": "Approve/reject requests, add books, mark returns"},
        ],
    },
    "announcements": {
        "label": "Announcements",
        "description": "Allows creating and posting company-wide announcements (View only or full Write access).",
        "category": "feature",
        "actions": [
            {"id": "read",  "label": "View",  "description": "View posted announcements"},
            {"id": "write", "label": "Write", "description": "Create and post announcements"},
        ],
    },
    "form_library": {
        "label": "Form Library (Actions)",
        "description": "Allows viewing form submissions (View), or also creating and editing form templates (Write). Pair with the Form Library portal above to grant page access.",
        "category": "feature",
        "actions": [
            {"id": "read",  "label": "View",  "description": "View forms and submissions"},
            {"id": "write", "label": "Write", "description": "Create and edit form templates"},
        ],
    },
    "manage_access": {
        "label": "Manage Admin Access",
        "description": "Allows granting or revoking Admin roles for other users (delegated Super Admin action).",
        "category": "feature",
        "actions": [
            {"id": "manage", "label": "Manage", "description": "Assign and revoke roles (delegated from Super Admin)"},
        ],
    },
    "leave_management": {
        "label": "Leave Management",
        "description": "Allows viewing leave requests and balances, and approving or rejecting leave applications.",
        "category": "feature",
        "actions": [
            {"id": "read",    "label": "View",    "description": "View leave requests and balances"},
            {"id": "approve", "label": "Approve", "description": "Approve or reject leave requests"},
        ],
    },
    "document_generation": {
        "label": "Document Generation",
        "description": "Allows generating official HR documents such as NOC letters and experience certificates.",
        "category": "feature",
        "actions": [
            {"id": "read",     "label": "View",     "description": "View generated documents"},
            {"id": "generate", "label": "Generate", "description": "Create and release new documents"},
        ],
    },
    "skills_management": {
        "label": "Skills & Certifications",
        "description": "Allows viewing and editing employee skill profiles and certification records.",
        "category": "feature",
        "actions": [
            {"id": "read", "label": "View", "description": "View employee skills and certifications"},
            {"id": "edit", "label": "Edit", "description": "Update skills, certifications, and profiles"},
        ],
    },
    "it_support": {
        "label": "IT Support Portal",
        "description": "Allows viewing IT tickets and support requests, and assigning or resolving them.",
        "category": "feature",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View tickets and support requests"},
            {"id": "manage", "label": "Manage", "description": "Assign, resolve, and close tickets"},
        ],
    },
    "observability": {
        "label": "AI Observability",
        "description": "Allows viewing AI conversation logs, usage metrics, and system observability data.",
        "category": "feature",
        "actions": [
            {"id": "read", "label": "View", "description": "View AI logs, metrics, and observability data"},
        ],
    },
    "llm_controls": {
        "label": "LLM Model Controls",
        "description": "Allows viewing and changing LLM model configurations, tiers, and kill switches.",
        "category": "feature",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View model configurations"},
            {"id": "manage", "label": "Manage", "description": "Change models, tiers, toggle kill switches"},
        ],
    },
    "pmo_portal": {
        "label": "PMO Workflows",
        "description": "Allows viewing Udemy licence requests and approving or configuring PMO workflow settings.",
        "category": "feature",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View licence requests"},
            {"id": "manage", "label": "Manage", "description": "Approve licences, configure PMO settings"},
        ],
    },
    "attendance_reports": {
        "label": "Attendance Reports",
        "description": "Allows viewing team attendance data and exporting or scheduling attendance reports.",
        "category": "feature",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View team attendance data"},
            {"id": "export", "label": "Export", "description": "Export and schedule attendance reports"},
        ],
    },
    "people_directory": {
        "label": "People Directory",
        "description": "Allows searching and viewing employee profiles, skills, and project assignments.",
        "category": "feature",
        "actions": [
            {"id": "read", "label": "View", "description": "Search and view employee profiles"},
        ],
    },
    "email_automation": {
        "label": "Email Automation Hub",
        "description": "Allows viewing automation rules and history, and creating or triggering email automations.",
        "category": "feature",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View automation rules and history"},
            {"id": "manage", "label": "Manage", "description": "Create, edit, and trigger automations"},
        ],
    },
    "prompt_config": {
        "label": "AI Prompt Config",
        "description": "Allows viewing and editing the AI prompt templates used for each domain.",
        "category": "feature",
        "actions": [
            {"id": "read",  "label": "View", "description": "View prompt configurations"},
            {"id": "write", "label": "Edit", "description": "Edit and save prompt templates"},
        ],
    },
}

# Backward-compat alias (existing endpoint uses SCOPE_CATALOGUE name)
SCOPE_CATALOGUE = {k: v for k, v in CAPABILITY_CATALOGUE.items() if v["category"] == "feature"}

# ── Default capabilities per system role (used for DB seeding) ──────────────────
DEFAULT_ROLE_CAPABILITIES: dict[str, list[str]] = {
    "super admin": [],  # full platform — no capability restrictions
    "admin": [
        "portal:dashboard", "portal:roi", "portal:analytics_studio", "portal:analytics_builder",
        "portal:admin_services", "portal:automation_hub", "portal:people", "portal:config",
        "portal:url_library", "portal:form_library", "portal:cabin_directory",
        "portal:onboarding_tracker",
        "mode:analytics",
        "food_complaints", "reimbursements", "travel_management", "parking", "desk_keys",
        "bookshelf", "announcements", "email_automation", "people_directory",
        "prompt_config", "form_library", "manage_access",
    ],
    "hr": [
        "portal:roi", "portal:analytics_studio", "portal:analytics_builder",
        "portal:hr_portal", "portal:onboarding_tracker", "portal:te_lms",
        "portal:automation_hub", "portal:people", "portal:config",
        "portal:url_library", "portal:form_library", "portal:cabin_directory",
        "mode:analytics", "mode:training",
        "leave_management", "document_generation", "skills_management",
        "people_directory", "email_automation", "prompt_config",
    ],
    "it": [
        "portal:roi", "portal:analytics_studio", "portal:analytics_builder",
        "portal:it_portal", "portal:observability", "portal:llm_controls",
        "portal:automation_hub", "portal:people", "portal:config",
        "portal:url_library", "portal:form_library", "portal:cabin_directory",
        "mode:analytics",
        "it_support", "observability", "llm_controls",
        "email_automation", "prompt_config",
    ],
    "pmo": [
        "portal:roi", "portal:analytics_studio", "portal:analytics_builder",
        "portal:pmo_portal", "portal:leadership_command", "portal:project_iq",
        "portal:te_lms", "portal:udemy_business",
        "portal:automation_hub", "portal:people", "portal:config",
        "portal:url_library", "portal:form_library", "portal:cabin_directory",
        "mode:analytics", "mode:training", "mode:project", "mode:resource",
        "pmo_portal", "people_directory", "email_automation", "prompt_config",
    ],
    "functional manager": [
        "portal:roi", "portal:analytics_studio", "portal:analytics_builder",
        "portal:manager_portal", "portal:people", "portal:config",
        "portal:url_library", "portal:form_library", "portal:cabin_directory",
        "mode:analytics", "mode:resource",
        "attendance_reports", "people_directory", "email_automation",
    ],
    "employee": [
        # Portals employees can open for self-service
        "portal:admin_services",   # submit food complaints, reimbursements, parking, desk keys, bookshelf requests
        "portal:url_library",      # browse internal app/link library
        "portal:form_library",     # view and fill in company forms
        "portal:cabin_directory",  # look up seating and cabin assignments
        "portal:people",           # search the employee directory
        "portal:onboarding_tracker",  # track own onboarding progress
    ],
}

# System roles seed data
SYSTEM_ROLES = [
    {"slug": "employee",           "name": "Employee",           "color": "#64748b", "description": "Standard employee access — chat, onboarding, and directory"},
    {"slug": "hr",                 "name": "HR",                 "color": "#22C55E", "description": "Human Resources — leave, documents, skills, and people data"},
    {"slug": "it",                 "name": "IT",                 "color": "#14B8A6", "description": "IT Support — tickets, software, observability, and LLM controls"},
    {"slug": "pmo",                "name": "PMO",                "color": "#4F6FEF", "description": "Project Management Office — projects, training, and resource planning"},
    {"slug": "admin",              "name": "Admin",              "color": "#3B8FE8", "description": "Administrative team — admin services, announcements, and access delegation"},
    {"slug": "functional manager", "name": "Functional Manager", "color": "#10B981", "description": "Team leads with attendance reporting and people visibility"},
    {"slug": "super admin",        "name": "Super Admin",        "color": "#F59E0B", "description": "Full platform access — all portals, LLM controls, and role management"},
]


def seed_system_roles(db: Session) -> None:
    """Idempotent seed: create system roles + their default capability maps.
    Each phase commits independently so a failure in one doesn't abort the next.
    """
    try:
        for role_data in SYSTEM_ROLES:
            if not db.query(AppRole).filter(AppRole.slug == role_data["slug"]).first():
                db.add(AppRole(is_system=True, **role_data))
        db.commit()
    except Exception:
        db.rollback()

    try:
        for role_slug, cap_keys in DEFAULT_ROLE_CAPABILITIES.items():
            for key in cap_keys:
                exists = db.query(RoleCapabilityMap).filter(
                    RoleCapabilityMap.role_slug == role_slug,
                    RoleCapabilityMap.capability_key == key,
                ).first()
                if not exists:
                    db.add(RoleCapabilityMap(role_slug=role_slug, capability_key=key))
        db.commit()
    except Exception:
        db.rollback()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _all_assignable_roles(db: Session) -> set[str]:
    """Return slugs of all roles (system + custom) that can be assigned."""
    return {r.slug for r in db.query(AppRole).all()}


def _role_capabilities(role_slug: str, db: Session) -> list[str]:
    """Return capability keys currently assigned to a role."""
    rows = db.query(RoleCapabilityMap).filter(RoleCapabilityMap.role_slug == role_slug).all()
    return [r.capability_key for r in rows]


# ── Pydantic payloads ──────────────────────────────────────────────────────────

class RoleAssignPayload(BaseModel):
    role: str
    scopes: Optional[List[str]] = None           # restrictive scope override
    extra_capabilities: Optional[List[str]] = None  # additive capability grants


class CreateRolePayload(BaseModel):
    slug: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#6366F1"
    capabilities: Optional[List[str]] = None


class UpdateRolePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    capabilities: Optional[List[str]] = None


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/me")
def get_my_access(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return current user's EFFECTIVE role, scopes, extra_capabilities, and role capability list.

    `real_role` and `impersonating` let the UI keep showing the Super Admin role-switcher even
    while a Super Admin is test-acting as another role. Capabilities reflect the EFFECTIVE role
    so the app genuinely behaves as the role being tested.
    """
    impersonating = user.role if user.is_impersonating else None
    override = db.query(UserRoleOverride).filter(UserRoleOverride.email == user.email).first()
    role_caps = _role_capabilities(user.role, db)
    # While impersonating, present the target role cleanly (no super-admin extras/scopes).
    if override and not impersonating:
        return {
            "has_override": True,
            "role": user.role,
            "real_role": user.real_role,
            "impersonating": None,
            "scopes": override.scopes or [],
            "extra_capabilities": override.extra_capabilities or [],
            "role_capabilities": role_caps,
        }
    return {
        "has_override": bool(override),
        "role": user.role,
        "real_role": user.real_role or user.role,
        "impersonating": impersonating,
        "scopes": user.scopes or [],
        "extra_capabilities": [],
        "role_capabilities": role_caps,
    }


@router.post("/roles/reseed-defaults")
def reseed_role_defaults(
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Re-apply DEFAULT_ROLE_CAPABILITIES for all system roles (additive only).
    Call this after upgrading defaults to push new capabilities into existing roles."""
    added = []
    for role_slug, cap_keys in DEFAULT_ROLE_CAPABILITIES.items():
        for key in cap_keys:
            exists = db.query(RoleCapabilityMap).filter(
                RoleCapabilityMap.role_slug == role_slug,
                RoleCapabilityMap.capability_key == key,
            ).first()
            if not exists:
                db.add(RoleCapabilityMap(role_slug=role_slug, capability_key=key))
                added.append(f"{role_slug}:{key}")
    db.commit()
    return {"added": len(added), "entries": added}


# ── Capability catalogue ────────────────────────────────────────────────────────

@router.get("/capabilities")
def list_capabilities(
    category: Optional[str] = Query(None, description="Filter by category: portal | mode | feature"),
    user: CurrentUser = Depends(require_super_admin),
):
    """Return the full capability catalogue, optionally filtered by category."""
    result = []
    for key, meta in CAPABILITY_CATALOGUE.items():
        if category and meta.get("category") != category:
            continue
        result.append({"key": key, **meta})
    return result


# ── Role management ────────────────────────────────────────────────────────────

@router.get("/roles")
def list_roles(
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """List all roles (system + custom) with their assigned capability keys."""
    roles = db.query(AppRole).order_by(AppRole.is_system.desc(), AppRole.created_at).all()
    result = []
    for role in roles:
        caps = _role_capabilities(role.slug, db)
        result.append({
            "slug": role.slug,
            "name": role.name,
            "description": role.description,
            "color": role.color,
            "is_system": role.is_system,
            "created_by": role.created_by,
            "created_at": role.created_at.isoformat() if role.created_at else None,
            "capabilities": caps,
            "capability_count": len(caps),
        })
    return result


@router.post("/roles")
def create_role(
    payload: CreateRolePayload,
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Create a new custom role with optional initial capabilities."""
    slug = payload.slug.lower().strip().replace(" ", "_")
    if db.query(AppRole).filter(AppRole.slug == slug).first():
        raise HTTPException(status_code=409, detail=f"Role '{slug}' already exists.")

    # Validate capability keys
    caps = payload.capabilities or []
    invalid = [c for c in caps if c not in CAPABILITY_CATALOGUE]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown capability keys: {invalid}")

    db.add(AppRole(
        slug=slug,
        name=payload.name,
        description=payload.description,
        color=payload.color,
        is_system=False,
        created_by=user.email,
    ))
    db.commit()

    for key in caps:
        db.add(RoleCapabilityMap(role_slug=slug, capability_key=key))
    db.commit()

    return {"slug": slug, "name": payload.name, "capabilities": caps, "message": "Role created."}


@router.put("/roles/{slug}")
def update_role(
    slug: str,
    payload: UpdateRolePayload,
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Update a role's metadata and/or replace its full capability set."""
    role = db.query(AppRole).filter(AppRole.slug == slug).first()
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{slug}' not found.")

    if payload.name is not None:
        role.name = payload.name
    if payload.description is not None:
        role.description = payload.description
    if payload.color is not None:
        role.color = payload.color

    if payload.capabilities is not None:
        caps = payload.capabilities
        invalid = [c for c in caps if c not in CAPABILITY_CATALOGUE]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Unknown capability keys: {invalid}")
        # Replace capability set
        db.query(RoleCapabilityMap).filter(RoleCapabilityMap.role_slug == slug).delete()
        db.commit()
        for key in caps:
            db.add(RoleCapabilityMap(role_slug=slug, capability_key=key))

    db.commit()
    return {"slug": slug, "message": "Role updated.", "capabilities": payload.capabilities}


@router.delete("/roles/{slug}")
def delete_role(
    slug: str,
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Delete a custom role. System roles cannot be deleted."""
    role = db.query(AppRole).filter(AppRole.slug == slug).first()
    if not role:
        raise HTTPException(status_code=404, detail=f"Role '{slug}' not found.")
    if role.is_system:
        raise HTTPException(status_code=400, detail="System roles cannot be deleted.")

    db.query(RoleCapabilityMap).filter(RoleCapabilityMap.role_slug == slug).delete()
    db.delete(role)
    db.commit()
    return {"message": f"Role '{slug}' deleted."}


# ── User access management ─────────────────────────────────────────────────────

@router.get("/users")
def list_users_with_access(
    search: Optional[str] = None,
    role: Optional[str] = None,
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """List users with their current role overrides. Super Admin only.
    Pass ?role=<slug> to return only users who have that role override assigned."""
    overrides = {o.email: o for o in db.query(UserRoleOverride).all()}

    def _fmt(email, name, job_title, department, ov):
        return {
            "email": email,
            "name": name,
            "job_title": job_title,
            "department": department,
            "has_override": ov is not None,
            "assigned_role": ov.role if ov else None,
            "scopes": ov.scopes or [] if ov else [],
            "extra_capabilities": ov.extra_capabilities or [] if ov else [],
            "granted_by": ov.granted_by if ov else None,
            "granted_at": ov.granted_at.isoformat() if (ov and ov.granted_at) else None,
        }

    # Role-filter mode: only return users who have the requested override role.
    # We pull their names from MS365User/Employee if available so the list is readable.
    if role:
        role_norm = role.strip().lower()
        matched_overrides = [ov for ov in overrides.values() if (ov.role or "").lower() == role_norm]
        if search:
            term = search.lower()
            matched_overrides = [
                ov for ov in matched_overrides
                if term in ov.email.lower()
            ]
        # Enrich with display names from MS365
        ms_lookup = {
            u.email.lower(): u
            for u in db.query(MS365User)
            .filter(MS365User.email.in_([ov.email for ov in matched_overrides]))
            .all()
        }
        emp_lookup = {
            e.email.lower(): e
            for e in db.query(Employee)
            .filter(Employee.email.in_([ov.email for ov in matched_overrides]))
            .all()
        } if not ms_lookup else {}
        results = []
        for ov in sorted(matched_overrides, key=lambda o: (o.email or "")):
            key = ov.email.lower()
            ms = ms_lookup.get(key)
            emp = emp_lookup.get(key)
            results.append(_fmt(
                ov.email,
                ms.name if ms else (emp.name if emp else None),
                ms.job_title if ms else (emp.designation if emp else None),
                ms.department if ms else (emp.department if emp else None),
                ov,
            ))
        return results

    ms_query = db.query(MS365User)
    if search:
        term = f"%{search.lower()}%"
        ms_query = ms_query.filter(
            (MS365User.email.ilike(term)) | (MS365User.name.ilike(term))
        )
    ms_users = (
        ms_query
        .filter(MS365User.account_enabled.isnot(False))
        .order_by(MS365User.name)
        .limit(200)
        .all()
    )

    if ms_users:
        results = [_fmt(u.email, u.name, u.job_title, u.department, overrides.get(u.email)) for u in ms_users]
        return results

    emp_query = db.query(Employee)
    if search:
        term = f"%{search.lower()}%"
        emp_query = emp_query.filter(
            (Employee.name.ilike(term)) | (Employee.email.ilike(term))
        )
    employees = emp_query.order_by(Employee.name).limit(200).all()
    seen: set[str] = set()
    results = []
    for emp in employees:
        if not emp.email or emp.email in seen:
            continue
        seen.add(emp.email)
        results.append(_fmt(emp.email, emp.name, emp.designation, emp.department, overrides.get(emp.email)))

    for email, ov in overrides.items():
        if email not in seen:
            results.append(_fmt(email, email, None, None, ov))

    return results


@router.put("/users/{email}")
def assign_role(
    email: str,
    payload: RoleAssignPayload,
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Assign or update a role override for a user. Super Admin only."""
    role = payload.role.lower().strip()
    assignable = _all_assignable_roles(db)
    if role not in assignable:
        raise HTTPException(status_code=400, detail=f"Unknown role '{role}'. Available: {sorted(assignable)}")

    # Validate restrictive scopes (must be feature-level scope keys for this role)
    role_feature_caps = [
        k for k in _role_capabilities(role, db) if CAPABILITY_CATALOGUE.get(k, {}).get("category") == "feature"
    ]
    # For system roles without seeded caps yet, fall back to SCOPE_CATALOGUE keys
    if not role_feature_caps and role in DEFAULT_ROLE_CAPABILITIES:
        role_feature_caps = [
            k for k in DEFAULT_ROLE_CAPABILITIES[role]
            if CAPABILITY_CATALOGUE.get(k, {}).get("category") == "feature"
        ]

    valid_scope_ids: set[str] = set()
    for base in role_feature_caps:
        valid_scope_ids.add(base)
        for action in CAPABILITY_CATALOGUE.get(base, {}).get("actions", []):
            valid_scope_ids.add(f"{base}:{action['id']}")

    scopes = payload.scopes or []
    invalid_scopes = [s for s in scopes if s not in valid_scope_ids]
    if invalid_scopes:
        raise HTTPException(status_code=400, detail=f"Scopes not valid for role '{role}': {invalid_scopes}")

    # Validate extra_capabilities
    extra = payload.extra_capabilities or []
    invalid_extra = [c for c in extra if c not in CAPABILITY_CATALOGUE]
    if invalid_extra:
        raise HTTPException(status_code=400, detail=f"Unknown capability keys: {invalid_extra}")

    override = db.query(UserRoleOverride).filter(UserRoleOverride.email == email).first()
    if override:
        override.role = role
        override.scopes = scopes if scopes else None
        override.extra_capabilities = extra if extra else None
        override.granted_by = user.email
        override.updated_at = datetime.utcnow()
    else:
        override = UserRoleOverride(
            email=email,
            role=role,
            scopes=scopes if scopes else None,
            extra_capabilities=extra if extra else None,
            granted_by=user.email,
        )
        db.add(override)

    db.commit()
    return {"message": f"Role '{role}' assigned to {email}", "scopes": scopes, "extra_capabilities": extra}


@router.delete("/users/{email}")
def revoke_role(
    email: str,
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Remove role override — user reverts to Azure AD role. Super Admin only."""
    override = db.query(UserRoleOverride).filter(UserRoleOverride.email == email).first()
    if not override:
        raise HTTPException(status_code=404, detail="No role override found for this user.")
    db.delete(override)
    db.commit()
    return {"message": f"Role override removed for {email}. User reverts to Azure AD role."}


# ── Backward-compat endpoint (used by old frontend) ────────────────────────────

@router.get("/scopes")
def list_scopes(
    role: str = Query("admin"),
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Return feature-scope catalogue for a given role (backward-compat)."""
    role_caps = _role_capabilities(role.lower().strip(), db)
    if not role_caps and role.lower() in DEFAULT_ROLE_CAPABILITIES:
        role_caps = DEFAULT_ROLE_CAPABILITIES[role.lower()]
    feature_caps = [k for k in role_caps if CAPABILITY_CATALOGUE.get(k, {}).get("category") == "feature"]
    return [{"id": k, **CAPABILITY_CATALOGUE[k]} for k in feature_caps if k in CAPABILITY_CATALOGUE]
