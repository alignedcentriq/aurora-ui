"""
Document generation service — produces formal HR/employee letters (No Objection
Certificate, Experience letter, Project Proposal, etc.) by streaming LLM-written
prose, then rebuilding a branded PDF on download.

Design rules:
- The LLM only formats prose. It must NEVER invent facts, dates, salaries or figures;
  employee fields are resolved server-side from the DB and passed in verbatim.
- Prompts are short (rules live here + in app code), per the prompt-architecture rule.
- Money/salary letters are intentionally not offered (no authoritative figure source).
"""

import datetime
from typing import Optional

from sqlalchemy import or_

from app.config import settings
from app.database import SessionLocal
from app.models import Employee, EmployeeZohoProfile


# ── Document catalogue ────────────────────────────────────────────────────────
# Each entry: label (display), system_prompt (short, formal-letter rules), and
# whether a purpose is required from the user.

_LETTER_RULES = (
    "Write ONLY the letter — no preamble, no markdown, no explanation of what you are doing. "
    "Use the employee details and date provided verbatim; never invent names, dates, employee "
    "IDs, salaries, amounts or facts that were not given. Keep it formal, concise and "
    "professional. End with a signature block reading 'For Aligned Automation' followed by "
    "'Human Resources Department' (do not invent a signatory name)."
)

DOC_TEMPLATES = {
    "no_objection_certificate": {
        "label": "No Objection Certificate",
        "system_prompt": (
            "You are an HR officer drafting a No Objection Certificate (NOC) for an employee. "
            "State clearly that the company has no objection to the employee for the stated "
            "purpose. Address it 'To Whom It May Concern:' unless a recipient is given. "
            + _LETTER_RULES
        ),
        "requires_purpose": True,
    },
    "experience_certificate": {
        "label": "Experience Certificate",
        "system_prompt": (
            "You are an HR officer drafting an Experience / Employment Certificate. Confirm the "
            "employee's tenure, designation and department based only on the details provided. "
            "Address it 'To Whom It May Concern:'. " + _LETTER_RULES
        ),
        "requires_purpose": False,
    },
    "employment_verification": {
        "label": "Employment Verification Letter",
        "system_prompt": (
            "You are an HR officer drafting an Employment Verification letter confirming that "
            "the named person is currently employed, with their designation and department. "
            "Address it 'To Whom It May Concern:'. " + _LETTER_RULES
        ),
        "requires_purpose": False,
    },
    "address_proof": {
        "label": "Address Proof Letter",
        "system_prompt": (
            "You are an HR officer drafting an address/employment proof letter confirming the "
            "employee's association with the company for the stated purpose. Do NOT invent any "
            "residential address — only mention an address if it appears in the provided details. "
            "Address it 'To Whom It May Concern:'. " + _LETTER_RULES
        ),
        "requires_purpose": True,
    },
    "relieving_letter": {
        "label": "Relieving Letter",
        "system_prompt": (
            "You are an HR officer drafting a Relieving Letter acknowledging that the employee "
            "has been relieved of their duties. Use only the dates and details provided; do not "
            "invent a last working day if none is given. " + _LETTER_RULES
        ),
        "requires_purpose": False,
    },
    "internship_certificate": {
        "label": "Internship Completion Certificate",
        "system_prompt": (
            "You are an HR officer drafting an Internship Completion Certificate confirming the "
            "intern completed their internship in the stated department. Address it "
            "'To Whom It May Concern:'. " + _LETTER_RULES
        ),
        "requires_purpose": False,
    },
    "recommendation_letter": {
        "label": "Recommendation Letter",
        "system_prompt": (
            "You are a manager drafting a professional recommendation / appreciation letter for "
            "the employee, highlighting their role and contribution based only on the details "
            "provided. Keep praise general and credible — do not invent specific achievements "
            "or metrics. " + _LETTER_RULES
        ),
        "requires_purpose": True,
    },
    "travel_support_letter": {
        "label": "Travel / Visa Support Letter",
        "system_prompt": (
            "You are an HR officer drafting a travel / visa support letter for an embassy or "
            "consulate, confirming the employee's employment and supporting the stated travel "
            "purpose. Do not invent travel dates, itineraries or financial guarantees unless "
            "explicitly provided. Address it 'To the Visa Officer:' unless a recipient is given. "
            + _LETTER_RULES
        ),
        "requires_purpose": True,
    },
    "project_proposal": {
        "label": "Project Proposal",
        "system_prompt": (
            "You are a consultant drafting a concise, business-facing Project Proposal based on "
            "the purpose and additional information provided. Organise it into clear sections "
            "such as Overview, Objectives, Scope, Approach, Timeline and Next Steps, each on its "
            "own line ending with a colon followed by the content. Do not invent client names, "
            "budgets or dates that were not provided. Write ONLY the proposal — no markdown, no "
            "preamble."
        ),
        "requires_purpose": True,
    },
}


def doc_catalogue() -> list:
    """Public list of available document types for the frontend picker."""
    return [
        {
            "doc_type": key,
            "label": tpl["label"],
            "requires_purpose": tpl["requires_purpose"],
        }
        for key, tpl in DOC_TEMPLATES.items()
    ]


# ── Employee resolution ──────────────────────────────────────────────────────

def _profile_for(db, employee: Employee) -> Optional[EmployeeZohoProfile]:
    return (
        db.query(EmployeeZohoProfile)
        .filter(EmployeeZohoProfile.employee_id == employee.id)
        .first()
    )


def _employee_to_dict(db, emp: Employee) -> dict:
    profile = _profile_for(db, emp)
    department = emp.department or (profile.function if profile else None) or ""
    designation = emp.designation or (profile.designation if profile else None) or ""
    joining = emp.joining_date or (profile.date_of_joining if profile else None)
    return {
        "name": emp.name or "",
        "employee_id": emp.employee_id or (profile.zoho_link_id if profile else "") or "",
        "department": department,
        "designation": designation,
        "email": emp.email or "",
        "joining_date": joining.isoformat() if joining else None,
    }


def resolve_employee(db, email: Optional[str] = None) -> Optional[dict]:
    """Resolve a single employee's official fields by email (server-side source of truth)."""
    if not email:
        return None
    emp = db.query(Employee).filter(Employee.email == email.strip().lower()).first()
    if emp:
        return _employee_to_dict(db, emp)
    # Fall back to a Zoho profile keyed by official_email when no base row exists
    profile = (
        db.query(EmployeeZohoProfile)
        .filter(EmployeeZohoProfile.official_email == email.strip().lower())
        .first()
    )
    if profile:
        full = f"{profile.first_name or ''} {profile.last_name or ''}".strip()
        return {
            "name": full,
            "employee_id": profile.zoho_link_id or "",
            "department": profile.function or "",
            "designation": profile.designation or "",
            "email": profile.official_email or email,
            "joining_date": profile.date_of_joining.isoformat() if profile.date_of_joining else None,
        }
    return None


def _profile_to_dict(profile: EmployeeZohoProfile) -> dict:
    full = f"{profile.first_name or ''} {profile.last_name or ''}".strip()
    return {
        "name": full,
        "employee_id": profile.zoho_link_id or "",
        "department": profile.function or "",
        "designation": profile.designation or "",
        "email": (profile.official_email or "").lower(),
        "joining_date": profile.date_of_joining.isoformat() if profile.date_of_joining else None,
    }


def search_employees(db, name: str, limit: int = 8) -> list:
    """HR autofill: fuzzy search employees by name across BOTH the MS365-derived
    `employees` table and the richer `employee_zoho_profiles` dataset, merged by email
    so HR finds a person regardless of which dataset holds them."""
    if not name or not name.strip():
        return []
    term = f"%{name.strip()}%"

    # Keyed by email (or name when no email) so the same person isn't listed twice.
    merged: dict[str, dict] = {}

    def _key(card: dict) -> str:
        return (card.get("email") or card.get("name") or "").lower()

    def _absorb(card: dict):
        k = _key(card)
        if not k:
            return
        existing = merged.get(k)
        if not existing:
            merged[k] = card
            return
        # Fill any blanks on the already-stored card from this one.
        for field in ("employee_id", "department", "designation", "joining_date"):
            if not existing.get(field) and card.get(field):
                existing[field] = card[field]

    # `employees` first — it carries a clean employee_id.
    emp_rows = (
        db.query(Employee)
        .filter(or_(Employee.name.ilike(term), Employee.email.ilike(term)))
        .order_by(Employee.name)
        .limit(limit * 2)
        .all()
    )
    for emp in emp_rows:
        _absorb(_employee_to_dict(db, emp))

    # `employee_zoho_profiles` — richer HR fields; matched on name or official email.
    prof_rows = (
        db.query(EmployeeZohoProfile)
        .filter(or_(
            (EmployeeZohoProfile.first_name + " " + EmployeeZohoProfile.last_name).ilike(term),
            EmployeeZohoProfile.official_email.ilike(term),
        ))
        .order_by(EmployeeZohoProfile.first_name, EmployeeZohoProfile.last_name)
        .limit(limit * 2)
        .all()
    )
    for prof in prof_rows:
        _absorb(_profile_to_dict(prof))

    return list(merged.values())[:limit]


# ── Prompt + streaming ───────────────────────────────────────────────────────

def build_messages(doc_type: str, employee: dict, purpose: str, additional_info: str,
                   is_official: bool) -> list:
    tpl = DOC_TEMPLATES[doc_type]
    today = datetime.date.today().strftime("%B %d, %Y")
    tenure = ""
    if employee.get("joining_date"):
        tenure = f"\nDate of Joining: {employee['joining_date']}"
    context = (
        f"Today's date: {today}\n"
        f"Employee Name: {employee.get('name') or 'N/A'}\n"
        f"Employee ID: {employee.get('employee_id') or 'N/A'}\n"
        f"Department: {employee.get('department') or 'N/A'}\n"
        f"Designation: {employee.get('designation') or 'N/A'}"
        f"{tenure}\n"
        f"Purpose / Reason: {purpose or 'Not specified'}\n"
        f"Additional Information: {additional_info or 'None'}\n"
    )
    if not is_official:
        context += (
            "\nNote: This is a self-service draft requested by the employee themselves; "
            "do not add any approval signature beyond the standard HR signature block.\n"
        )
    return [
        {"role": "system", "content": tpl["system_prompt"]},
        {"role": "user", "content": context},
    ]


async def generate_stream(doc_type: str, employee: dict, purpose: str,
                         additional_info: str, is_official: bool):
    """Async generator yielding text chunks of the generated letter."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        base_url=settings.AGENT_BASE_URL,
        api_key=settings.AGENT_API_KEY,
    )
    messages = build_messages(doc_type, employee, purpose, additional_info, is_official)
    stream = await client.chat.completions.create(
        model=settings.AGENT_MODEL_NAME,
        messages=messages,
        temperature=0.2,
        max_tokens=1500,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta
