"""
Zoho People Document / Letter Generation — dual-mode service.

DEMO mode  (ZOHO_DEMO_MODE=true, the default):
    Generates branded PDFs from our built-in HTML templates using reportlab —
    exactly the same letter content Zoho would produce from its own template
    store.  No external calls, works out-of-the-box.

LIVE mode  (ZOHO_DEMO_MODE=false):
    Calls the Zoho People API instead:
      List templates  GET  {ZOHO_BASE_URL}/people/api/v2/forms/P_EmployeeView/lettertemplate
      Generate letter POST {ZOHO_BASE_URL}/people/api/v2/forms/P_EmployeeView/generateLetter
    Required OAuth scopes: ZohoPeople.documents.READ  ZohoPeople.documents.CREATE
    The employee's zoho_link_id is passed as the Zoho recordId.

Switching DEMO → LIVE (3 steps):
  1. Add ZohoPeople.documents.READ + ZohoPeople.documents.CREATE to the OAuth
     app's scope list in the Zoho API Console and re-authorise.
  2. Set ZOHO_DEMO_MODE=false in backend/.env.
  3. Map each letter template's real Zoho Template_Id via env vars:
       ZOHO_TEMPLATE_no_objection_certificate=<zoho id>
       ZOHO_TEMPLATE_experience_certificate=<zoho id>
       ... (one per doc_type)
     If not set, the demo placeholder IDs (10001-10009) are sent — Zoho will
     return a 404 for templates it doesn't know.

Architecture contract:
  - generate_letter() always returns raw PDF bytes.
  - get_preview_html() always returns an HTML string (local, no Zoho call).
  - Both functions accept the same arguments regardless of mode — callers do
    not need to know which mode is active.
"""

import datetime
import os
import re
from html.parser import HTMLParser
from typing import Optional

import requests

from app.config import settings
from app.document_generation.generator import generate_pdf

_BASE = settings.ZOHO_BASE_URL or "https://people.zoho.com"


# ── Template catalogue ──────────────────────────────────────────────────────────
# Template_Id values are read from env vars so they can be overridden with real
# Zoho IDs once API access is provisioned.  The demo defaults (10001-10009) are
# used in DEMO mode and as a fallback in LIVE mode when the env var is absent.

_TEMPLATES: list[dict] = [
    {
        "Template_Id": os.getenv("ZOHO_TEMPLATE_no_objection_certificate", "10001"),
        "Template_Name": "No Objection Certificate",
        "Template_Type": "Letter",
        "doc_type": "no_objection_certificate",
        "requires_approval": True,
        "fields": [
            {"name": "purpose", "label": "Purpose / Reason", "type": "textarea", "required": True},
        ],
    },
    {
        "Template_Id": os.getenv("ZOHO_TEMPLATE_experience_certificate", "10002"),
        "Template_Name": "Experience Certificate",
        "Template_Type": "Letter",
        "doc_type": "experience_certificate",
        "requires_approval": True,
        "fields": [],
    },
    {
        "Template_Id": os.getenv("ZOHO_TEMPLATE_employment_verification", "10003"),
        "Template_Name": "Employment Verification Letter",
        "Template_Type": "Letter",
        "doc_type": "employment_verification",
        "requires_approval": True,
        "fields": [],
    },
    {
        "Template_Id": os.getenv("ZOHO_TEMPLATE_address_proof", "10004"),
        "Template_Name": "Address Proof Letter",
        "Template_Type": "Letter",
        "doc_type": "address_proof",
        "requires_approval": True,
        "fields": [
            {"name": "purpose", "label": "Purpose / Reason", "type": "textarea", "required": True},
        ],
    },
    {
        "Template_Id": os.getenv("ZOHO_TEMPLATE_relieving_letter", "10005"),
        "Template_Name": "Relieving Letter",
        "Template_Type": "Letter",
        "doc_type": "relieving_letter",
        "requires_approval": True,
        "fields": [
            {"name": "last_working_date", "label": "Last Working Date", "type": "date", "required": True},
        ],
    },
    {
        "Template_Id": os.getenv("ZOHO_TEMPLATE_internship_certificate", "10006"),
        "Template_Name": "Internship Completion Certificate",
        "Template_Type": "Letter",
        "doc_type": "internship_certificate",
        "requires_approval": True,
        "fields": [
            {
                "name": "internship_duration",
                "label": "Internship Duration (e.g. June 2024 – August 2024)",
                "type": "text",
                "required": True,
            },
        ],
    },
    {
        "Template_Id": os.getenv("ZOHO_TEMPLATE_recommendation_letter", "10007"),
        "Template_Name": "Recommendation Letter",
        "Template_Type": "Letter",
        "doc_type": "recommendation_letter",
        "requires_approval": True,
        "fields": [
            {"name": "purpose", "label": "Purpose / what the recommendation is for", "type": "textarea", "required": True},
            {
                "name": "recipient",
                "label": "Recipient (leave blank for 'To Whom It May Concern')",
                "type": "text",
                "required": False,
            },
        ],
    },
    {
        "Template_Id": os.getenv("ZOHO_TEMPLATE_travel_support_letter", "10008"),
        "Template_Name": "Travel / Visa Support Letter",
        "Template_Type": "Letter",
        "doc_type": "travel_support_letter",
        "requires_approval": True,
        "fields": [
            {"name": "destination", "label": "Destination Country / City", "type": "text", "required": True},
            {"name": "travel_purpose", "label": "Purpose of Travel", "type": "textarea", "required": True},
            {
                "name": "travel_dates",
                "label": "Travel Dates (e.g. 10 July – 20 July 2025)",
                "type": "text",
                "required": False,
            },
        ],
    },
    {
        "Template_Id": os.getenv("ZOHO_TEMPLATE_project_proposal", "10009"),
        "Template_Name": "Project Proposal",
        "Template_Type": "Letter",
        "doc_type": "project_proposal",
        "requires_approval": False,
        "fields": [
            {"name": "project_title", "label": "Project Title", "type": "text", "required": True},
            {"name": "client_name", "label": "Client / Recipient Name", "type": "text", "required": True},
            {"name": "overview", "label": "Project Overview", "type": "textarea", "required": True},
            {"name": "objectives", "label": "Objectives", "type": "textarea", "required": True},
            {"name": "timeline", "label": "Estimated Timeline", "type": "text", "required": False},
        ],
    },
]

# Fast-lookup maps — built once at import time.
_BY_DOCTYPE: dict[str, dict] = {t["doc_type"]: t for t in _TEMPLATES}
_BY_ID: dict[str, dict] = {t["Template_Id"]: t for t in _TEMPLATES}


# ── Public interface ────────────────────────────────────────────────────────────

def list_templates(token: Optional[str] = None) -> list[dict]:
    """Return the list of available letter templates in Zoho API shape.

    Demo: returns the built-in catalogue.
    Live: calls Zoho lettertemplate API and enriches with local field defs.
    Falls back to demo on any live-mode error so the UI is never blank.
    """
    if settings.ZOHO_DEMO_MODE or not token:
        return _demo_list()
    try:
        live = _live_list(token)
        return live if live else _demo_list()
    except Exception:
        return _demo_list()


def generate_letter(
    doc_type: str,
    employee_data: dict,
    extra_fields: dict,
    token: Optional[str] = None,
    zoho_record_id: Optional[str] = None,
) -> bytes:
    """Generate a letter and return raw PDF bytes.

    Args:
        doc_type:        Internal doc type key (e.g. 'no_objection_certificate').
        employee_data:   Auto-fill values: employee_name, employee_id, department,
                         designation, email, joining_date, company_name, today_date.
        extra_fields:    User-supplied values (purpose, last_working_date, …).
        token:           Zoho OAuth access token — live mode only.
        zoho_record_id:  Employee's Zoho People record ID — live mode only.

    Returns: PDF bytes (starts with b'%PDF').

    Raises:
        ValueError('unknown_template') if doc_type is not in the catalogue.
        ValueError('not_connected')    if Zoho auth fails in live mode.
    """
    tpl = _BY_DOCTYPE.get(doc_type)
    if not tpl:
        raise ValueError("unknown_template")

    if settings.ZOHO_DEMO_MODE or not token:
        return _demo_generate(tpl, employee_data, extra_fields)

    try:
        return _live_generate(token, tpl["Template_Id"], zoho_record_id or "")
    except ValueError:
        raise  # propagate not_connected / unknown_template as-is
    except Exception:
        # Zoho API error (template not yet configured, network hiccup, etc.)
        # → fall back to demo so the user still gets a document.
        return _demo_generate(tpl, employee_data, extra_fields)


def get_preview_html(doc_type: str, employee_data: dict, extra_fields: dict) -> str:
    """Return an HTML preview of the letter body.

    Always generated locally from the seed HTML template — no Zoho call.
    Used for the on-screen preview panel in both DEMO and LIVE modes.
    """
    from app.services.document_service import _SEED_TEMPLATES  # avoid circular at module level
    tpl = _BY_DOCTYPE.get(doc_type)
    if not tpl:
        return ""
    seed = next((s for s in _SEED_TEMPLATES if s["doc_type"] == doc_type), None)
    if not seed:
        return ""
    return _fill_html(seed["html_template"], employee_data, extra_fields)


def get_user_fields(doc_type: str) -> list[dict]:
    """User-supplied fields for a given doc_type (used by the catalogue endpoint)."""
    tpl = _BY_DOCTYPE.get(doc_type)
    return list(tpl.get("fields", [])) if tpl else []


def get_template_meta(doc_type: str) -> Optional[dict]:
    """Full template metadata dict, or None if not found."""
    return _BY_DOCTYPE.get(doc_type)


# ── Demo-mode implementation ────────────────────────────────────────────────────

def _demo_list() -> list[dict]:
    return [
        {
            "Template_Id": t["Template_Id"],
            "Template_Name": t["Template_Name"],
            "Template_Type": t["Template_Type"],
            "doc_type": t["doc_type"],
            "requires_approval": t["requires_approval"],
            "fields": [dict(f) for f in t["fields"]],
        }
        for t in _TEMPLATES
    ]


def _demo_generate(tpl: dict, employee_data: dict, extra_fields: dict) -> bytes:
    """Fill the seed HTML template and render a branded PDF via reportlab."""
    from app.services.document_service import _SEED_TEMPLATES
    doc_type = tpl["doc_type"]
    seed = next((s for s in _SEED_TEMPLATES if s["doc_type"] == doc_type), None)

    if seed:
        filled_html = _fill_html(seed["html_template"], employee_data, extra_fields)
        content = _html_to_prose(filled_html)
    else:
        content = _fallback_prose(tpl["Template_Name"], employee_data, extra_fields)

    return generate_pdf(
        doc_type=doc_type,
        title=tpl["Template_Name"],
        content=content,
        subject_name=employee_data.get("employee_name") or employee_data.get("name", ""),
    )


def _fill_html(html_template: str, employee_data: dict, extra_fields: dict) -> str:
    """Replace {{placeholder}} tokens in the seed HTML template with real values."""
    today = datetime.date.today().strftime("%B %d, %Y")
    values: dict[str, str] = {
        "employee_name": str(employee_data.get("employee_name") or employee_data.get("name") or ""),
        "employee_id":   str(employee_data.get("employee_id") or ""),
        "department":    str(employee_data.get("department") or ""),
        "designation":   str(employee_data.get("designation") or ""),
        "email":         str(employee_data.get("email") or ""),
        "joining_date":  str(employee_data.get("joining_date") or ""),
        "company_name":  settings.DOC_COMPANY_NAME,
        "today_date":    today,
    }
    # Extra / user-supplied fields win over auto values.
    values.update({k: str(v) for k, v in (extra_fields or {}).items() if v not in (None, "")})

    filled = html_template
    for key, val in values.items():
        filled = filled.replace("{{" + key + "}}", val)
    # Remove any placeholders that were not resolved.
    filled = re.sub(r"\{\{[^}]+\}\}", "", filled)
    return filled


def _html_to_prose(html: str) -> str:
    """Strip HTML tags and return clean paragraph text for the reportlab renderer."""

    class _Stripper(HTMLParser):
        _BLOCK = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "br", "div", "tr"}

        def __init__(self):
            super().__init__()
            self._parts: list[str] = []

        def handle_starttag(self, tag: str, attrs):
            if tag in self._BLOCK:
                self._parts.append("\n")

        def handle_endtag(self, tag: str):
            if tag in self._BLOCK:
                self._parts.append("\n")

        def handle_data(self, data: str):
            self._parts.append(data)

    s = _Stripper()
    s.feed(html)
    text = "".join(s._parts)
    # Collapse 3+ blank lines → single blank line (paragraph break).
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _fallback_prose(title: str, emp: dict, extra: dict) -> str:
    """Minimal letter body used when no seed template is found for a doc_type."""
    today = datetime.date.today().strftime("%B %d, %Y")
    name    = emp.get("employee_name") or emp.get("name") or "the employee"
    emp_id  = emp.get("employee_id", "")
    dept    = emp.get("department", "")
    desig   = emp.get("designation", "")
    join    = emp.get("joining_date", "")
    company = settings.DOC_COMPANY_NAME

    id_part    = f" (Employee ID: {emp_id})" if emp_id else ""
    dept_part  = f" in the {dept} department" if dept else ""
    desig_part = f" as {desig}" if desig else ""
    join_part  = f" since {join}" if join else ""
    purpose_chunk = (
        f"\n\nPurpose: {extra['purpose']}"
        if extra.get("purpose") else ""
    )

    return (
        f"Date: {today}\n\n"
        "To Whom It May Concern,\n\n"
        f"This is to certify that {name}{id_part} is employed with {company}"
        f"{dept_part}{desig_part}{join_part}.{purpose_chunk}\n\n"
        "This letter is issued upon the request of the employee for official purposes.\n\n"
        "Yours faithfully,"
    )


# ── Live-mode implementation ────────────────────────────────────────────────────

def _auth_header(token: str) -> dict:
    return {"Authorization": f"Zoho-oauthtoken {token}"}


def _live_list(token: str) -> list[dict]:
    """GET /people/api/v2/forms/P_EmployeeView/lettertemplate
    Scope: ZohoPeople.documents.READ
    """
    resp = requests.get(
        f"{_BASE}/people/api/v2/forms/P_EmployeeView/lettertemplate",
        headers=_auth_header(token),
        timeout=15,
    )
    if resp.status_code in (401, 403):
        raise ValueError("not_connected")
    resp.raise_for_status()

    data = resp.json()
    raw: list = (
        data.get("response", {}).get("result") or
        data.get("result") or
        data.get("data") or []
    )
    if not isinstance(raw, list):
        return []

    # Enrich each live template with our local field definitions where the
    # Template_Id matches so the form still renders correctly.
    enriched = []
    for item in raw:
        zoho_id = str(item.get("Template_Id") or "")
        matched = _BY_ID.get(zoho_id)
        enriched.append({
            "Template_Id":    zoho_id,
            "Template_Name":  item.get("Template_Name") or item.get("name", ""),
            "Template_Type":  item.get("Template_Type", "Letter"),
            "doc_type":       matched["doc_type"] if matched else None,
            "requires_approval": matched["requires_approval"] if matched else True,
            "fields":         list(matched["fields"]) if matched else [],
        })
    return enriched


def _live_generate(token: str, template_id: str, record_id: str) -> bytes:
    """POST /people/api/v2/forms/P_EmployeeView/generateLetter
    Scope: ZohoPeople.documents.CREATE
    Returns raw PDF bytes.
    """
    resp = requests.post(
        f"{_BASE}/people/api/v2/forms/P_EmployeeView/generateLetter",
        headers={**_auth_header(token), "Content-Type": "application/json"},
        json={"templateId": template_id, "recordId": record_id, "format": "pdf"},
        timeout=30,
    )
    if resp.status_code in (401, 403):
        raise ValueError("not_connected")
    resp.raise_for_status()

    ct = resp.headers.get("Content-Type", "")
    # Zoho may return the PDF directly …
    if "application/pdf" in ct or "octet-stream" in ct:
        return resp.content

    # … or a JSON payload with a download URL.
    data = resp.json()
    url = (
        (data.get("response", {}).get("result") or {}).get("letter", {}).get("downloadUrl") or
        data.get("downloadUrl") or
        data.get("url")
    )
    if url:
        dl = requests.get(url, headers=_auth_header(token), timeout=30)
        dl.raise_for_status()
        return dl.content

    raise ValueError(f"Zoho generateLetter returned unexpected payload: {data}")
