"""
Document Skill APIs — expose document generation as a clean skill endpoint.

The agent calls POST /api/skills/docs/create to trigger LLM-written
document generation. Returns a download URL once the PDF is ready.
"""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import CurrentUser, get_current_user
from app.database import SessionLocal
from app.models import Employee, EmployeeZohoProfile
from app.services.document_service import (
    DOC_TEMPLATES,
    build_messages,
    generate_stream,
)
from app.document_generation.generator import generate_pdf
from app.document_store import store_pdf

router = APIRouter(prefix="/api/skills/docs", tags=["Skills - Documents"])


# ── Request / Response bodies ──────────────────────────────────────────────────

class CreateDocRequest(BaseModel):
    doc_type: str                     # e.g. "no_objection_certificate"
    purpose: Optional[str] = ""      # Required for NOC, address proof, etc.
    additional_info: Optional[str] = ""


class DocTypeItem(BaseModel):
    id: str
    label: str
    requires_purpose: bool


# ── Helpers ────────────────────────────────────────────────────────────────────

def _resolve_employee(email: str) -> dict:
    """Pull employee details from DB for use in the document."""
    with SessionLocal() as db:
        emp = db.query(Employee).filter(Employee.email == email).first()
        if not emp:
            return {"name": email, "employee_id": "", "department": "", "designation": "", "joining_date": ""}

        profile = (
            db.query(EmployeeZohoProfile)
            .filter(EmployeeZohoProfile.employee_id == emp.id)
            .first()
        )
        joining = ""
        if profile and getattr(profile, "date_of_joining", None):
            joining = str(profile.date_of_joining)

        return {
            "name": emp.full_name or email,
            "employee_id": emp.employee_id or "",
            "department": getattr(profile, "department", "") or "",
            "designation": getattr(profile, "designation", "") or emp.role or "",
            "joining_date": joining,
        }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/types")
def list_doc_types(current_user: CurrentUser = Depends(get_current_user)):
    """List all available document types with metadata."""
    types = [
        DocTypeItem(
            id=key,
            label=tpl["label"],
            requires_purpose=tpl.get("requires_purpose", False),
        )
        for key, tpl in DOC_TEMPLATES.items()
    ]
    return {"types": [t.model_dump() for t in types]}


@router.post("/create")
async def create_document(
    body: CreateDocRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Generate a formal HR document (NOC, experience letter, etc.).

    Collects LLM-generated prose, renders a branded PDF, stores it,
    and returns a download URL.
    """
    if body.doc_type not in DOC_TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown doc_type '{body.doc_type}'. Call GET /api/skills/docs/types for valid options.",
        )

    tpl = DOC_TEMPLATES[body.doc_type]
    if tpl.get("requires_purpose") and not body.purpose:
        raise HTTPException(
            status_code=422,
            detail=f"'{tpl['label']}' requires a 'purpose' field.",
        )

    employee = _resolve_employee(current_user.email)

    # Stream LLM content and collect into a single string
    chunks: list[str] = []
    async for chunk in generate_stream(
        doc_type=body.doc_type,
        employee=employee,
        purpose=body.purpose or "",
        additional_info=body.additional_info or "",
        is_official=False,
    ):
        chunks.append(chunk)

    content = "".join(chunks)
    if not content.strip():
        raise HTTPException(status_code=500, detail="Document generation produced no content.")

    # Render to PDF
    pdf_bytes = generate_pdf(
        doc_type=body.doc_type,
        title=tpl["label"],
        content=content,
        subject_name=employee.get("name", ""),
    )

    # Store and return download URL
    safe_name = tpl["label"].replace(" ", "_")
    filename = f"{safe_name}_{employee.get('name', 'employee').replace(' ', '_')}.pdf"
    file_id = store_pdf(None, pdf_bytes, filename)

    return {
        "status": "success",
        "doc_type": body.doc_type,
        "label": tpl["label"],
        "filename": filename,
        "download_url": f"/api/documents/download/{file_id}",
    }
