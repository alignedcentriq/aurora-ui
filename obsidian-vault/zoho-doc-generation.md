---
name: zoho-doc-generation
description: Document generation now uses Zoho People API style — dual-mode service (demo/live); PDF via reportlab; switch by setting ZOHO_DEMO_MODE=false + OAuth scopes
metadata: 
  node_type: memory
  type: project
  originSessionId: 83ab5f11-bc1b-4aba-b31f-7ea703ce531d
---

Document generation is wired through `zoho_doc_service.py` (Zoho People API style).

**Why:** User wants document generation to behave exactly like Zoho People's letter generation API, so switching to real Zoho requires minimal change.

**How to apply:** When modifying document generation, always go through `zoho_doc_service.py` — do not add new PDF/Word generation logic directly in routes.

## Architecture

Two generation paths in `POST /api/documents/generate`:
- **Path A** (Word .docx template_blob present): docxtpl fill → mammoth HTML preview → Word COM PDF on download
- **Path B** (no template_blob, default for seed templates): `zoho_doc_service.generate_letter()` → PDF bytes stored directly in `rendered_docx` field (starts with `%PDF`)

Download endpoint detects PDF vs .docx by magic bytes: `doc.rendered_docx[:4] == b"%PDF"`.

## Mode switch

- `ZOHO_DEMO_MODE=true` (default): `_demo_generate()` → fill seed HTML → `generate_pdf()` (reportlab) → real PDF
- `ZOHO_DEMO_MODE=false`: calls `GET /people/api/v2/forms/P_EmployeeView/lettertemplate` + `POST /people/api/v2/forms/P_EmployeeView/generateLetter`

## To go live with real Zoho API (3 steps)
1. Add scopes `ZohoPeople.documents.READ` + `ZohoPeople.documents.CREATE` to the Zoho OAuth app; re-authorise
2. Set `ZOHO_DEMO_MODE=false` in `backend/.env`
3. Set env vars `ZOHO_TEMPLATE_<doc_type>=<real zoho template id>` for each letter type

## Key files
- `backend/app/services/zoho_doc_service.py` — dual-mode service; `_TEMPLATES` list has env-var-overridable Template_Ids
- `backend/app/routes/document_routes.py` — generate/approve/download handle both paths
- `backend/app/services/document_service.py` — `doc_catalogue()` falls back to zoho_doc_service when DB has no enabled templates

## Template IDs (demo defaults)
10001=NOC, 10002=Experience, 10003=Employment Verification, 10004=Address Proof,
10005=Relieving, 10006=Internship, 10007=Recommendation, 10008=Travel/Visa, 10009=Project Proposal
