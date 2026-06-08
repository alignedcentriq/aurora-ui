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
from app.document_generation import template_engine as engine
from app.models import DocumentTemplate, Employee, EmployeeZohoProfile


# ── Document catalogue ────────────────────────────────────────────────────────
# Each entry: label (display), system_prompt (short, formal-letter rules), and
# whether a purpose is required from the user.

_LETTER_RULES = (
    "Write ONLY the letter body — no preamble, no markdown, no explanatory notes. "
    "Begin with the appropriate salutation (e.g., 'To Whom It May Concern,') on its own line. "
    "Write in formal, professional corporate language using complete, well-formed sentences. "
    "The letter must be comprehensive: include at least 3 to 4 well-developed paragraphs, "
    "each providing meaningful, substantive content appropriate for an official HR document. "
    "Avoid one-liners or terse statements — this letter will be printed on official letterhead "
    "and must carry the full weight and authority of an institutional document. "
    "Do not use bullet points, numbered lists, or markdown. Write in flowing formal prose. "
    "Use the employee details and date provided verbatim; never invent names, dates, employee "
    "IDs, salaries, amounts, or any facts not explicitly given. "
    "End the letter with 'Yours faithfully,' on its own line. "
    "Do NOT write any signature block — it is added automatically to the document."
)

DOC_TEMPLATES = {
    "no_objection_certificate": {
        "label": "No Objection Certificate",
        "system_prompt": (
            "You are a senior HR officer drafting a formal No Objection Certificate (NOC) on "
            "official company letterhead. State clearly and authoritatively that the company has "
            "no objection to the employee pursuing the stated purpose. Confirm the employee's "
            "employment details, good standing, and the company's full support. Elaborate on the "
            "nature of the no-objection in context of the stated purpose so the document carries "
            "genuine informational value for the receiving authority. "
            "Address it 'To Whom It May Concern,' unless a specific recipient is provided. "
            + _LETTER_RULES
        ),
        "requires_purpose": True,
    },
    "experience_certificate": {
        "label": "Experience Certificate",
        "system_prompt": (
            "You are a senior HR officer drafting a formal Experience Certificate. "
            "Confirm the employee's tenure, designation, and department based solely on the "
            "details provided. Describe their role and responsibilities in general professional "
            "terms, and commend their dedication and conduct without inventing specific "
            "achievements or metrics. The certificate should be comprehensive enough to satisfy "
            "prospective employers or institutions as a credible record of service. "
            "Address it 'To Whom It May Concern,'. " + _LETTER_RULES
        ),
        "requires_purpose": False,
    },
    "employment_verification": {
        "label": "Employment Verification Letter",
        "system_prompt": (
            "You are a senior HR officer drafting a formal Employment Verification letter. "
            "Confirm the employee's current employment status, official designation, department, "
            "and tenure at the company. Provide context about the company and the employee's role "
            "that would satisfy a bank, financial institution, embassy, or third-party requiring "
            "official confirmation of employment. "
            "Address it 'To Whom It May Concern,'. " + _LETTER_RULES
        ),
        "requires_purpose": False,
    },
    "address_proof": {
        "label": "Address Proof Letter",
        "system_prompt": (
            "You are a senior HR officer drafting an Address Proof letter on official letterhead. "
            "Confirm the employee's association with the company for the stated purpose. "
            "Do NOT invent or include any residential address — only reference an address if it "
            "explicitly appears in the provided employee details. Focus instead on confirming "
            "the employee's employment status, length of service, and the company's endorsement "
            "of the employee for the stated purpose. "
            "Address it 'To Whom It May Concern,'. " + _LETTER_RULES
        ),
        "requires_purpose": True,
    },
    "relieving_letter": {
        "label": "Relieving Letter",
        "system_prompt": (
            "You are a senior HR officer drafting a formal Relieving Letter. "
            "Acknowledge that the employee has completed their tenure and has been formally "
            "relieved of all duties and responsibilities. Confirm their service period, "
            "designation, and department. Wish them well in their future endeavours and confirm "
            "that there are no outstanding obligations from the company's side. "
            "Do not invent a last working day if none is given. " + _LETTER_RULES
        ),
        "requires_purpose": False,
    },
    "internship_certificate": {
        "label": "Internship Completion Certificate",
        "system_prompt": (
            "You are a senior HR officer drafting a formal Internship Completion Certificate. "
            "Confirm that the intern has successfully completed their internship in the stated "
            "department. Describe the nature of the internship program in general terms, "
            "acknowledge the intern's contribution and professional conduct, and express the "
            "company's best wishes for their academic and professional future. "
            "Address it 'To Whom It May Concern,'. " + _LETTER_RULES
        ),
        "requires_purpose": False,
    },
    "recommendation_letter": {
        "label": "Recommendation Letter",
        "system_prompt": (
            "You are a senior manager drafting a formal professional recommendation letter for "
            "the employee. Highlight the employee's role, tenure, and overall contribution based "
            "only on the details provided. Keep praise credible and professional — describe "
            "general competencies such as reliability, work ethic, teamwork, and professional "
            "growth without inventing specific metrics or achievements. Clearly recommend the "
            "individual to the attention of the receiving authority for the stated purpose. "
            + _LETTER_RULES
        ),
        "requires_purpose": True,
    },
    "travel_support_letter": {
        "label": "Travel / Visa Support Letter",
        "system_prompt": (
            "You are a senior HR officer drafting a formal Travel / Visa Support Letter addressed "
            "to an embassy or consulate. Confirm the employee's current employment, designation, "
            "and tenure. State that the travel is for the stated purpose and that the employee "
            "has the company's full support and is expected to return to their duties upon "
            "completion of the trip. Do not invent travel dates, itineraries, financial "
            "guarantees, or sponsorship unless explicitly provided in the details. "
            "Address it 'To the Visa Officer,' unless a specific recipient is given. "
            + _LETTER_RULES
        ),
        "requires_purpose": True,
    },
    "project_proposal": {
        "label": "Project Proposal",
        "system_prompt": (
            "You are a senior consultant drafting a formal, business-facing Project Proposal. "
            "Organise the document into clearly labelled sections: Overview, Objectives, Scope, "
            "Proposed Approach, Estimated Timeline, and Next Steps. Each section heading must "
            "appear on its own line followed by a colon, then the content. "
            "Write each section with substantive detail appropriate for a senior stakeholder "
            "audience. Do not invent client names, budgets, or dates not provided. "
            "Write ONLY the proposal body — no preamble, no markdown, no commentary."
        ),
        "requires_purpose": True,
    },
}


# ── Template-driven catalogue (SharePoint-synced DocumentTemplate rows) ───────
# The legacy DOC_TEMPLATES / build_messages / generate_stream below are retained for
# reference/rollback but are NOT used by the live generate path, which now does a
# deterministic placeholder merge over HR-managed templates.

# ── Seed templates ────────────────────────────────────────────────────────────
# Built-in HTML templates for each legacy doc type. Used by seed_default_templates()
# to populate the DB when no templates exist (no SharePoint sync required).

_AUTO = {"source": "auto"}
_USER = {"source": "user"}


def _af(name: str, label: str, ftype: str = "text") -> dict:
    return {"name": name, "label": label, "type": ftype, "required": False, **_AUTO}


def _uf(name: str, label: str, ftype: str = "text", required: bool = True) -> dict:
    return {"name": name, "label": label, "type": ftype, "required": required, **_USER}


_SEED_TEMPLATES = [
    {
        "doc_type": "no_objection_certificate",
        "label": "No Objection Certificate",
        "requires_approval": True,
        "fields": [
            _af("employee_name", "Employee Name"),
            _af("employee_id", "Employee ID"),
            _af("department", "Department"),
            _af("designation", "Designation"),
            _af("joining_date", "Date of Joining", "date"),
            _af("today_date", "Date", "date"),
            _af("company_name", "Company Name"),
            _uf("purpose", "Purpose", "textarea"),
        ],
        "html_template": (
            "<p>Date: {{today_date}}</p>"
            "<p>To Whom It May Concern,</p>"
            "<p>This is to certify that <strong>{{employee_name}}</strong> (Employee ID: {{employee_id}})"
            " is currently employed with <strong>{{company_name}}</strong> in the <strong>{{department}}</strong>"
            " department as <strong>{{designation}}</strong>, with effect from {{joining_date}}.</p>"
            "<p>We wish to state that this organisation has no objection to the above-named employee"
            " for the following purpose: <em>{{purpose}}</em>.</p>"
            "<p>During the tenure of their employment, {{employee_name}} has maintained a commendable"
            " record and continues to fulfil their professional responsibilities diligently. This"
            " certificate is issued upon their request and in good faith, without prejudice to any"
            " rights of the organisation.</p>"
            "<p>Should you require any further information or clarification, please do not hesitate"
            " to contact our Human Resources department.</p>"
            "<p>Yours faithfully,</p>"
        ),
    },
    {
        "doc_type": "experience_certificate",
        "label": "Experience Certificate",
        "requires_approval": True,
        "fields": [
            _af("employee_name", "Employee Name"),
            _af("employee_id", "Employee ID"),
            _af("department", "Department"),
            _af("designation", "Designation"),
            _af("joining_date", "Date of Joining", "date"),
            _af("today_date", "Date", "date"),
            _af("company_name", "Company Name"),
        ],
        "html_template": (
            "<p>Date: {{today_date}}</p>"
            "<p>To Whom It May Concern,</p>"
            "<p>This is to certify that <strong>{{employee_name}}</strong> (Employee ID: {{employee_id}})"
            " has been employed with <strong>{{company_name}}</strong> in the"
            " <strong>{{department}}</strong> department as <strong>{{designation}}</strong>"
            " since {{joining_date}}.</p>"
            "<p>During this period, {{employee_name}} has demonstrated a high level of professionalism,"
            " commitment, and dedication towards their work. They have consistently met their"
            " responsibilities and contributed positively to the functioning of the team.</p>"
            "<p>We wish {{employee_name}} the very best in all their future endeavours and recommend"
            " them without reservation to any organisation that may seek their services.</p>"
            "<p>This certificate is issued upon the request of the employee for whatever purpose it"
            " may serve.</p>"
            "<p>Yours faithfully,</p>"
        ),
    },
    {
        "doc_type": "employment_verification",
        "label": "Employment Verification Letter",
        "requires_approval": True,
        "fields": [
            _af("employee_name", "Employee Name"),
            _af("employee_id", "Employee ID"),
            _af("department", "Department"),
            _af("designation", "Designation"),
            _af("joining_date", "Date of Joining", "date"),
            _af("today_date", "Date", "date"),
            _af("company_name", "Company Name"),
        ],
        "html_template": (
            "<p>Date: {{today_date}}</p>"
            "<p>To Whom It May Concern,</p>"
            "<p>This letter is to verify that <strong>{{employee_name}}</strong>"
            " (Employee ID: {{employee_id}}) is presently employed with"
            " <strong>{{company_name}}</strong> in the <strong>{{department}}</strong>"
            " department, holding the position of <strong>{{designation}}</strong>"
            " since {{joining_date}}.</p>"
            "<p>The employment is on a full-time basis and the individual is in active service"
            " at the time of issuance of this letter. {{company_name}} is a registered organisation"
            " operating in the technology and services sector, and {{employee_name}} is a valued"
            " member of our team.</p>"
            "<p>This letter is being issued upon the request of the employee for presentation to"
            " a bank, financial institution, embassy, or any other authority requiring official"
            " confirmation of employment.</p>"
            "<p>For any further verification or queries, please feel free to contact the Human"
            " Resources department.</p>"
            "<p>Yours faithfully,</p>"
        ),
    },
    {
        "doc_type": "address_proof",
        "label": "Address Proof Letter",
        "requires_approval": True,
        "fields": [
            _af("employee_name", "Employee Name"),
            _af("employee_id", "Employee ID"),
            _af("designation", "Designation"),
            _af("joining_date", "Date of Joining", "date"),
            _af("today_date", "Date", "date"),
            _af("company_name", "Company Name"),
            _uf("purpose", "Purpose", "textarea"),
        ],
        "html_template": (
            "<p>Date: {{today_date}}</p>"
            "<p>To Whom It May Concern,</p>"
            "<p>This is to confirm that <strong>{{employee_name}}</strong>"
            " (Employee ID: {{employee_id}}) is employed with"
            " <strong>{{company_name}}</strong> as <strong>{{designation}}</strong>"
            " since {{joining_date}}.</p>"
            "<p>This letter is being issued for the following purpose: <em>{{purpose}}</em>.</p>"
            "<p>{{company_name}} confirms its association with and responsibility for"
            " {{employee_name}} in the capacity described above. This letter is issued in good"
            " faith and is intended solely for the purpose stated herein.</p>"
            "<p>Should you require any additional documentation or clarification, kindly contact"
            " our Human Resources department at your earliest convenience.</p>"
            "<p>Yours faithfully,</p>"
        ),
    },
    {
        "doc_type": "relieving_letter",
        "label": "Relieving Letter",
        "requires_approval": True,
        "fields": [
            _af("employee_name", "Employee Name"),
            _af("employee_id", "Employee ID"),
            _af("department", "Department"),
            _af("designation", "Designation"),
            _af("joining_date", "Date of Joining", "date"),
            _af("today_date", "Date", "date"),
            _af("company_name", "Company Name"),
            _uf("last_working_date", "Last Working Date", "date"),
        ],
        "html_template": (
            "<p>Date: {{today_date}}</p>"
            "<p>To Whom It May Concern,</p>"
            "<p>This is to certify that <strong>{{employee_name}}</strong>"
            " (Employee ID: {{employee_id}}) was employed with"
            " <strong>{{company_name}}</strong> in the <strong>{{department}}</strong>"
            " department as <strong>{{designation}}</strong> from {{joining_date}}"
            " to {{last_working_date}}.</p>"
            "<p>{{employee_name}} has been duly relieved from all duties and responsibilities"
            " with effect from {{last_working_date}}. All organisational formalities have been"
            " completed satisfactorily and there are no outstanding obligations from the"
            " company's side.</p>"
            "<p>We sincerely appreciate the contributions made by {{employee_name}} during"
            " their tenure with us and wish them every success in their future professional"
            " endeavours.</p>"
            "<p>This letter is issued upon the request of the employee as a formal record of"
            " their service and relieving from the organisation.</p>"
            "<p>Yours faithfully,</p>"
        ),
    },
    {
        "doc_type": "internship_certificate",
        "label": "Internship Completion Certificate",
        "requires_approval": True,
        "fields": [
            _af("employee_name", "Employee Name"),
            _af("employee_id", "Employee ID"),
            _af("department", "Department"),
            _af("today_date", "Date", "date"),
            _af("company_name", "Company Name"),
            _uf("internship_duration", "Internship Duration (e.g. June 2024 – August 2024)", "text"),
        ],
        "html_template": (
            "<p>Date: {{today_date}}</p>"
            "<p>To Whom It May Concern,</p>"
            "<p>This is to certify that <strong>{{employee_name}}</strong>"
            " (ID: {{employee_id}}) has successfully completed their internship with"
            " <strong>{{company_name}}</strong> in the <strong>{{department}}</strong>"
            " department during the period <strong>{{internship_duration}}</strong>.</p>"
            "<p>During the internship, {{employee_name}} demonstrated a commendable level of"
            " enthusiasm, commitment, and willingness to learn. They contributed meaningfully"
            " to the work of the department and conducted themselves in a professional and"
            " responsible manner throughout the programme.</p>"
            "<p>We are pleased to recognise their effort and dedication, and we wish them every"
            " success in their academic pursuits and professional career ahead.</p>"
            "<p>This certificate is issued in recognition of the completion of the internship"
            " programme at {{company_name}}.</p>"
            "<p>Yours faithfully,</p>"
        ),
    },
    {
        "doc_type": "recommendation_letter",
        "label": "Recommendation Letter",
        "requires_approval": True,
        "fields": [
            _af("employee_name", "Employee Name"),
            _af("employee_id", "Employee ID"),
            _af("department", "Department"),
            _af("designation", "Designation"),
            _af("joining_date", "Date of Joining", "date"),
            _af("today_date", "Date", "date"),
            _af("company_name", "Company Name"),
            _uf("purpose", "Purpose / what the recommendation is for", "textarea"),
            _uf("recipient", "Recipient (leave blank for 'To Whom It May Concern')", "text", required=False),
        ],
        "html_template": (
            "<p>Date: {{today_date}}</p>"
            "<p>{{recipient}}</p>"
            "<p>I am writing to recommend <strong>{{employee_name}}</strong>"
            " (Employee ID: {{employee_id}}) for {{purpose}}."
            " {{employee_name}} has been serving with <strong>{{company_name}}</strong>"
            " in the <strong>{{department}}</strong> department as"
            " <strong>{{designation}}</strong> since {{joining_date}}.</p>"
            "<p>Throughout their tenure, {{employee_name}} has consistently exhibited a strong"
            " work ethic, a collaborative spirit, and a high degree of professionalism. Their"
            " contributions to the department have been notable and they have demonstrated a"
            " capacity for growth and adaptability in a fast-paced professional environment.</p>"
            "<p>On a personal level, {{employee_name}} is reliable, approachable, and maintains"
            " a positive and constructive attitude in all their interactions. These qualities,"
            " combined with their professional competence, make them a highly recommendable"
            " individual.</p>"
            "<p>I recommend {{employee_name}} without reservation and am confident that they"
            " will be an asset to any organisation or programme. Should you require any further"
            " information, please do not hesitate to reach out.</p>"
            "<p>Yours faithfully,</p>"
        ),
    },
    {
        "doc_type": "travel_support_letter",
        "label": "Travel / Visa Support Letter",
        "requires_approval": True,
        "fields": [
            _af("employee_name", "Employee Name"),
            _af("employee_id", "Employee ID"),
            _af("designation", "Designation"),
            _af("joining_date", "Date of Joining", "date"),
            _af("today_date", "Date", "date"),
            _af("company_name", "Company Name"),
            _uf("destination", "Destination Country / City", "text"),
            _uf("travel_purpose", "Purpose of Travel", "textarea"),
            _uf("travel_dates", "Travel Dates (e.g. 10 July – 20 July 2025)", "text", required=False),
        ],
        "html_template": (
            "<p>Date: {{today_date}}</p>"
            "<p>To the Visa Officer,</p>"
            "<p>This letter is issued in support of the visa application of"
            " <strong>{{employee_name}}</strong> (Employee ID: {{employee_id}}),"
            " who is currently employed with <strong>{{company_name}}</strong>"
            " as <strong>{{designation}}</strong> since {{joining_date}}.</p>"
            "<p>{{employee_name}} intends to travel to <strong>{{destination}}</strong>"
            " for the following purpose: <em>{{travel_purpose}}</em>."
            " The intended travel dates are {{travel_dates}}."
            " This travel is undertaken with the full knowledge and support of the organisation.</p>"
            "<p>We confirm that {{employee_name}} holds a permanent position with"
            " {{company_name}} and is expected to return and resume their professional"
            " responsibilities upon conclusion of the visit. Their employment, compensation,"
            " and leave arrangement remain unchanged during this period.</p>"
            "<p>We respectfully request that the appropriate authorities grant the necessary"
            " visa to facilitate this travel and assure you of our full cooperation in this"
            " matter.</p>"
            "<p>Yours faithfully,</p>"
        ),
    },
    {
        "doc_type": "project_proposal",
        "label": "Project Proposal",
        "requires_approval": False,
        "fields": [
            _af("today_date", "Date", "date"),
            _af("company_name", "Company Name"),
            _uf("project_title", "Project Title", "text"),
            _uf("client_name", "Client / Recipient Name", "text"),
            _uf("overview", "Project Overview", "textarea"),
            _uf("objectives", "Objectives", "textarea"),
            _uf("timeline", "Estimated Timeline", "text", required=False),
        ],
        "html_template": (
            "<p>Date: {{today_date}}</p>"
            "<p><strong>{{client_name}}</strong></p>"
            "<h3>Project Proposal: {{project_title}}</h3>"
            "<h4>Overview</h4>"
            "<p>{{overview}}</p>"
            "<h4>Objectives</h4>"
            "<p>{{objectives}}</p>"
            "<h4>Proposed Approach</h4>"
            "<p>{{company_name}} proposes to deliver this engagement through a structured,"
            " milestone-based approach, ensuring full alignment with the client's requirements"
            " at every stage. A dedicated project team will be assigned, with clear accountability"
            " and regular progress reporting.</p>"
            "<h4>Estimated Timeline</h4>"
            "<p>{{timeline}}</p>"
            "<h4>Next Steps</h4>"
            "<p>We invite you to review this proposal and share your feedback at your earliest"
            " convenience. Upon confirmation, we will proceed to formalise the engagement"
            " agreement and initiate the project in accordance with the agreed timeline.</p>"
            "<p>Yours faithfully,</p>"
        ),
    },
]


def seed_default_templates(db) -> None:
    """Insert built-in enabled templates ONLY when SharePoint is not the template source.

    The built-in seeds are a fallback for deployments with no SharePoint template folder.
    When SHAREPOINT_TEMPLATES_FOLDER is configured, SharePoint is the single source of
    truth: we drop any existing seed rows so they can't shadow the synced templates, and
    do not seed. Safe to call on every startup (idempotent in both branches)."""
    from app.models import DocumentTemplate  # avoid circular at module load

    sharepoint_is_source = bool(settings.SHAREPOINT_SITE_URL and settings.SHAREPOINT_TEMPLATES_FOLDER)
    if sharepoint_is_source:
        removed = (
            db.query(DocumentTemplate)
            .filter(DocumentTemplate.source_key.like("seed:%"))
            .delete(synchronize_session=False)
        )
        if removed:
            db.commit()
        return

    already = (
        db.query(DocumentTemplate)
        .filter(DocumentTemplate.source_key.like("seed:%"))
        .first()
    )
    if already is not None:
        return
    now = datetime.datetime.utcnow()
    for tpl in _SEED_TEMPLATES:
        row = DocumentTemplate(
            doc_type=tpl["doc_type"],
            label=tpl["label"],
            source_key=f"seed:{tpl['doc_type']}",
            filename=f"{tpl['doc_type']}.html",
            source_format="html",
            html_template=tpl["html_template"],
            fields=tpl["fields"],
            enabled=True,
            requires_approval=tpl["requires_approval"],
            setup_status="ready",
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    db.commit()


def _public_field(f: dict) -> dict:
    out = {
        "name": f.get("name"),
        "label": f.get("label") or (f.get("name") or "").replace("_", " ").title(),
        "type": f.get("type") or "text",
        "required": bool(f.get("required", True)),
        "source": f.get("source") or "user",
    }
    if isinstance(f.get("options"), list) and f["options"]:
        out["options"] = f["options"]
    return out


def doc_catalogue(db) -> list:
    """Public picker list — only HR-enabled templates, with their user-supplied fields.
    Auto-filled fields are omitted (the server fills them at generation time)."""
    rows = (
        db.query(DocumentTemplate)
        .filter(DocumentTemplate.enabled == True)  # noqa: E712
        .order_by(DocumentTemplate.label)
        .all()
    )
    seen: set[str] = set()
    out = []
    for r in rows:
        if r.doc_type in seen:
            continue
        seen.add(r.doc_type)
        user_fields, _ = engine.classify_fields(r.fields)
        out.append({
            "doc_type": r.doc_type,
            "label": r.label or r.doc_type,
            "requires_approval": bool(r.requires_approval),
            "fields": [_public_field(f) for f in user_fields],
        })
    return out


def get_template(db, doc_type: str) -> Optional[DocumentTemplate]:
    """First enabled template for a doc_type (used by the generate path)."""
    return (
        db.query(DocumentTemplate)
        .filter(DocumentTemplate.doc_type == doc_type, DocumentTemplate.enabled == True)  # noqa: E712
        .order_by(DocumentTemplate.id)
        .first()
    )


def get_template_any(db, doc_type: str) -> Optional[DocumentTemplate]:
    """Any template for a doc_type regardless of enabled state — used on download/render of
    an already-generated document whose template may since have been disabled."""
    return (
        db.query(DocumentTemplate)
        .filter(DocumentTemplate.doc_type == doc_type)
        .order_by(DocumentTemplate.id)
        .first()
    )


def label_for(db, doc_type: str) -> str:
    """Display label for any doc_type — DB template first, then the legacy label map."""
    from app.document_generation.generator import DOC_TYPE_LABELS
    row = (
        db.query(DocumentTemplate.label)
        .filter(DocumentTemplate.doc_type == doc_type)
        .first()
    )
    if row and row.label:
        return row.label
    return DOC_TYPE_LABELS.get(doc_type, "Document")


def _template_admin_view(r: DocumentTemplate) -> dict:
    return {
        "id": r.id,
        "doc_type": r.doc_type,
        "label": r.label or r.doc_type,
        "filename": r.filename,
        "source_format": r.source_format,
        "source_key": r.source_key,
        "enabled": bool(r.enabled),
        "requires_approval": bool(r.requires_approval),
        "setup_status": r.setup_status or "needs_review",
        "fields": [_public_field(f) for f in (r.fields or [])],
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def list_all_templates(db) -> list:
    """All templates (incl. disabled) for the HR management panel."""
    rows = db.query(DocumentTemplate).order_by(DocumentTemplate.label).all()
    return [_template_admin_view(r) for r in rows]


def update_template_config(db, template_id: int, patch: dict) -> Optional[dict]:
    """Apply HR edits: enabled / requires_approval / label, plus per-field label/type/
    required/source/options overrides (field NAMES are immutable — they map to the
    {{token}} in the HTML). Sets setup_status='ready'. Returns the admin view or None."""
    r = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id).first()
    if not r:
        return None

    if "enabled" in patch:
        r.enabled = bool(patch["enabled"])
    if "requires_approval" in patch:
        r.requires_approval = bool(patch["requires_approval"])
    if patch.get("label"):
        r.label = str(patch["label"]).strip()[:200]

    incoming = patch.get("fields")
    if isinstance(incoming, list):
        edits = {f.get("name"): f for f in incoming if isinstance(f, dict) and f.get("name")}
        merged = []
        for f in (r.fields or []):
            e = edits.get(f.get("name"))
            if e:
                nf = dict(f)
                if e.get("label"):
                    nf["label"] = str(e["label"]).strip()[:200]
                if e.get("type") in ("text", "textarea", "date", "select"):
                    nf["type"] = e["type"]
                if "required" in e:
                    nf["required"] = bool(e["required"])
                if e.get("source") in ("auto", "user"):
                    nf["source"] = e["source"]
                if isinstance(e.get("options"), list):
                    nf["options"] = [str(o) for o in e["options"]]
                merged.append(nf)
            else:
                merged.append(f)
        r.fields = merged

    r.setup_status = "ready"
    db.commit()
    db.refresh(r)
    return _template_admin_view(r)


def _legacy_doc_catalogue() -> list:
    """Old hardcoded picker list (kept for reference; not used by the live path)."""
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
        temperature=0.3,
        max_tokens=2200,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta
