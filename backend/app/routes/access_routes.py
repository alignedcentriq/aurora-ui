"""Super Admin access management — role assignment with optional feature scopes.

Super Admin can assign any of the ASSIGNABLE_ROLES to any user by email.
Optional scopes restrict which features that user can access within their role.
Empty scopes = full role access. DB overrides take precedence over Azure AD claims.
"""

from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user, require_super_admin
from app.database import get_db
from app.models import UserRoleOverride, MS365User, Employee

router = APIRouter(prefix="/api/access", tags=["Access Management"])

# Roles that Super Admin can assign (including promoting another user to Super Admin)
ASSIGNABLE_ROLES = {"super admin", "admin", "hr", "it", "pmo", "functional manager", "employee"}

# Full catalogue: scope ID → { label, description, actions[] }
# actions define granular permissions within the scope.
# "scope" (no colon) = full access; "scope:action" = specific action only.
SCOPE_CATALOGUE = {
    # ── Admin portal sections ──────────────────────────────────────────────────
    "food_complaints": {
        "label": "Food & Facility Complaints", "description": "Food vendor feedback and facility complaints",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View all complaints and their status"},
            {"id": "manage", "label": "Manage", "description": "Update status, close and resolve tickets"},
        ],
    },
    "reimbursements": {
        "label": "Reimbursements", "description": "Expense, travel, and certification reimbursements",
        "actions": [
            {"id": "read",    "label": "View",    "description": "View all reimbursement requests"},
            {"id": "approve", "label": "Approve", "description": "Approve or reject reimbursement claims"},
        ],
    },
    "travel_management": {
        "label": "Travel Management", "description": "Business travel requests, trip approvals, and expense claims",
        "actions": [
            {"id": "read",    "label": "View",    "description": "View all travel requests and expense claims"},
            {"id": "approve", "label": "Approve", "description": "Approve/reject requests and expense claims, enter trip details"},
            {"id": "settings","label": "Settings","description": "Set global and per-trip expense limits"},
        ],
    },
    "parking": {
        "label": "Parking Management", "description": "Parking stickers, dues, and payment reminders",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View sticker applications and dues"},
            {"id": "manage", "label": "Manage", "description": "Issue/revoke stickers, mark dues paid, send reminders"},
        ],
    },
    "desk_keys": {
        "label": "Desk & Access Keys", "description": "Desk key requests and office access management",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View desk key requests"},
            {"id": "manage", "label": "Manage", "description": "Approve, reject, or release desk keys"},
        ],
    },
    "bookshelf": {
        "label": "Bookshelf Buddy", "description": "Company book library, borrow requests, and extensions",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View books, requests, and assignments"},
            {"id": "manage", "label": "Manage", "description": "Approve/reject requests, add books, mark returns"},
        ],
    },
    "announcements": {
        "label": "Announcements", "description": "Company-wide announcements and status updates",
        "actions": [
            {"id": "read",  "label": "View",  "description": "View posted announcements"},
            {"id": "write", "label": "Write", "description": "Create and post announcements"},
        ],
    },
    "form_library": {
        "label": "Form Library", "description": "Dynamic admin form templates and submissions",
        "actions": [
            {"id": "read",  "label": "View",  "description": "View forms and submissions"},
            {"id": "write", "label": "Write", "description": "Create and edit form templates"},
        ],
    },
    "manage_access": {
        "label": "Manage Admin Access", "description": "Grant or revoke Admin roles for other users",
        "actions": [
            {"id": "manage", "label": "Manage", "description": "Assign and revoke roles (delegated from Super Admin)"},
        ],
    },
    # ── HR portal sections ─────────────────────────────────────────────────────
    "leave_management": {
        "label": "HR Portal", "description": "Employee leave requests and approvals",
        "actions": [
            {"id": "read",    "label": "View",    "description": "View leave requests and balances"},
            {"id": "approve", "label": "Approve", "description": "Approve or reject leave requests"},
        ],
    },
    "document_generation": {
        "label": "Document Generation", "description": "NOC, experience letters, and other HR documents",
        "actions": [
            {"id": "read",     "label": "View",     "description": "View generated documents"},
            {"id": "generate", "label": "Generate", "description": "Create and release new documents"},
        ],
    },
    "skills_management": {
        "label": "Skills & Certifications", "description": "Employee skills, certifications, and profiles",
        "actions": [
            {"id": "read", "label": "View", "description": "View employee skills and certifications"},
            {"id": "edit", "label": "Edit", "description": "Update skills, certifications, and profiles"},
        ],
    },
    # ── IT portal sections ─────────────────────────────────────────────────────
    "it_support": {
        "label": "IT Support Portal", "description": "IT tickets, software requests, and support workflows",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View tickets and support requests"},
            {"id": "manage", "label": "Manage", "description": "Assign, resolve, and close tickets"},
        ],
    },
    "observability": {
        "label": "AI Observability", "description": "AI conversation logs and system observability",
        "actions": [
            {"id": "read", "label": "View", "description": "View AI logs, metrics, and observability data"},
        ],
    },
    "llm_controls": {
        "label": "LLM Model Controls", "description": "LLM model settings, tiers, and kill switches",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View model configurations"},
            {"id": "manage", "label": "Manage", "description": "Change models, tiers, toggle kill switches"},
        ],
    },
    # ── PMO portal sections ────────────────────────────────────────────────────
    "pmo_portal": {
        "label": "PMO Portal", "description": "Udemy licenses, project updates, and PMO workflows",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View license requests and project updates"},
            {"id": "manage", "label": "Manage", "description": "Approve licenses, configure PMO settings"},
        ],
    },
    # ── Functional Manager sections ────────────────────────────────────────────
    "attendance_reports": {
        "label": "Manager Attendance Portal", "description": "Team attendance reports and exports",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View team attendance data"},
            {"id": "export", "label": "Export", "description": "Export and schedule attendance reports"},
        ],
    },
    # ── Shared across roles ────────────────────────────────────────────────────
    "people_directory": {
        "label": "People Directory", "description": "Employee directory search and profiles",
        "actions": [
            {"id": "read", "label": "View", "description": "Search and view employee profiles"},
        ],
    },
    "email_automation": {
        "label": "Email Automation Hub", "description": "Automated email workflows and scheduling",
        "actions": [
            {"id": "read",   "label": "View",   "description": "View automation rules and history"},
            {"id": "manage", "label": "Manage", "description": "Create, edit, and trigger automations"},
        ],
    },
    "prompt_config": {
        "label": "AI Prompt Config", "description": "AI prompt templates for each domain",
        "actions": [
            {"id": "read",  "label": "View",  "description": "View prompt configurations"},
            {"id": "write", "label": "Edit",  "description": "Edit and save prompt templates"},
        ],
    },
}

# Scopes available per role — controls what Super Admin can assign
ROLE_SCOPES: dict[str, list[str]] = {
    "super admin": [],  # full platform access — no scope granularity needed
    "admin": [
        "food_complaints", "reimbursements", "parking", "desk_keys", "bookshelf",
        "announcements", "email_automation", "people_directory", "prompt_config",
        "form_library", "manage_access",
    ],
    "hr": [
        "leave_management", "document_generation", "skills_management",
        "people_directory", "email_automation", "prompt_config",
    ],
    "it": [
        "it_support", "observability", "llm_controls",
        "email_automation", "prompt_config",
    ],
    "pmo": [
        "pmo_portal", "people_directory", "email_automation", "prompt_config",
    ],
    "functional manager": [
        "attendance_reports", "people_directory", "email_automation",
    ],
    "employee": [],  # employees have no gated sub-features
}


class RoleAssignPayload(BaseModel):
    role: str
    scopes: Optional[List[str]] = None  # None or [] = full role access


@router.get("/me")
def get_my_access(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return the current user's effective role and scopes (for frontend auth-store bootstrap)."""
    override = db.query(UserRoleOverride).filter(UserRoleOverride.email == user.email).first()
    if override:
        return {
            "has_override": True,
            "role": override.role,
            "scopes": override.scopes or [],
        }
    return {"has_override": False, "role": user.role, "scopes": []}


@router.get("/users")
def list_users_with_access(
    search: Optional[str] = None,
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """List users with their current role overrides. Super Admin only.
    Uses MS365 directory when populated; falls back to employees table otherwise."""

    overrides = {
        o.email: o
        for o in db.query(UserRoleOverride).all()
    }

    # --- Try MS365 directory first ---
    ms_query = db.query(MS365User)
    if search:
        term = f"%{search.lower()}%"
        ms_query = ms_query.filter(
            (MS365User.email.ilike(term)) | (MS365User.name.ilike(term))
        )
    # isnot(False) correctly includes NULL rows (column not yet populated)
    ms_users = (
        ms_query
        .filter(MS365User.account_enabled.isnot(False))
        .order_by(MS365User.name)
        .limit(200)
        .all()
    )

    if ms_users:
        results = []
        for u in ms_users:
            ov = overrides.get(u.email)
            results.append({
                "email": u.email,
                "name": u.name,
                "job_title": u.job_title,
                "department": u.department,
                "has_override": ov is not None,
                "assigned_role": ov.role if ov else None,
                "scopes": ov.scopes or [] if ov else [],
                "granted_by": ov.granted_by if ov else None,
                "granted_at": ov.granted_at.isoformat() if (ov and ov.granted_at) else None,
            })
        return results

    # --- Fallback: employees table ---
    emp_query = db.query(Employee)
    if search:
        term = f"%{search.lower()}%"
        emp_query = emp_query.filter(
            (Employee.name.ilike(term)) | (Employee.email.ilike(term))
        )
    employees = emp_query.order_by(Employee.name).limit(200).all()

    results = []
    seen = set()
    for emp in employees:
        if not emp.email or emp.email in seen:
            continue
        seen.add(emp.email)
        ov = overrides.get(emp.email)
        results.append({
            "email": emp.email,
            "name": emp.name,
            "job_title": emp.designation,
            "department": emp.department,
            "has_override": ov is not None,
            "assigned_role": ov.role if ov else None,
            "scopes": ov.scopes or [] if ov else [],
            "granted_by": ov.granted_by if ov else None,
            "granted_at": ov.granted_at.isoformat() if (ov and ov.granted_at) else None,
        })

    # Always surface users who have overrides even if not in either table
    for email, ov in overrides.items():
        if email not in seen:
            results.append({
                "email": email,
                "name": email,
                "job_title": None,
                "department": None,
                "has_override": True,
                "assigned_role": ov.role,
                "scopes": ov.scopes or [],
                "granted_by": ov.granted_by,
                "granted_at": ov.granted_at.isoformat() if ov.granted_at else None,
            })

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
    if role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role '{role}'. Assignable: {sorted(ASSIGNABLE_ROLES)}")

    # Validate scopes — accept "scope" (full) and "scope:action" forms
    scopes = payload.scopes or []
    base_scopes = ROLE_SCOPES.get(role, [])
    valid_ids: set[str] = set()
    for base in base_scopes:
        valid_ids.add(base)  # full access
        for action in SCOPE_CATALOGUE.get(base, {}).get("actions", []):
            valid_ids.add(f"{base}:{action['id']}")
    invalid = [s for s in scopes if s not in valid_ids]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Scopes not valid for role '{role}': {invalid}")

    override = db.query(UserRoleOverride).filter(UserRoleOverride.email == email).first()
    if override:
        override.role = role
        override.scopes = scopes if scopes else None
        override.granted_by = user.email
        override.updated_at = datetime.utcnow()
    else:
        override = UserRoleOverride(
            email=email,
            role=role,
            scopes=scopes if scopes else None,
            granted_by=user.email,
        )
        db.add(override)

    db.commit()
    return {"message": f"Role '{role}' assigned to {email}", "scopes": scopes}


@router.delete("/users/{email}")
def revoke_role(
    email: str,
    user: CurrentUser = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Remove role override — user reverts to their Azure AD role. Super Admin only."""
    override = db.query(UserRoleOverride).filter(UserRoleOverride.email == email).first()
    if not override:
        raise HTTPException(status_code=404, detail="No role override found for this user.")
    db.delete(override)
    db.commit()
    return {"message": f"Role override removed for {email}. User reverts to Azure AD role."}


@router.get("/scopes")
def list_scopes(
    role: str = Query("admin"),
    user: CurrentUser = Depends(require_super_admin),
):
    """Return scope catalogue for a given role, including available actions per scope."""
    scope_ids = ROLE_SCOPES.get(role.lower().strip(), [])
    return [{"id": sid, **SCOPE_CATALOGUE[sid]} for sid in scope_ids if sid in SCOPE_CATALOGUE]
