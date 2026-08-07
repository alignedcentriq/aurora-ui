---
name: hr-letters-directory
description: "Letters & Certificates tab is now DB-backed (HRLetterType) with an HR 'Manage letters' admin tab; old SharePoint template system is legacy/disconnected"
metadata: 
  node_type: memory
  type: project
  originSessionId: e4324203-f8dd-4247-907c-47eed7f167df
---

Documents page → "Letters & Certificates" tab (deep-links to Zoho People, no in-app
generation) was a hardcoded frontend array; rebuilt 2026-07-14 as DB-backed:

- `HRLetterType` model (backend/app/models.py) + `hr_letter_service.py` + `hr_letter_routes.py`
  → `GET/POST/PUT/DELETE /api/hr-letters`. Seeded once on startup (idempotent — skips if any
  row exists) from the original 9 entries, same keys/icons/categories.
- HR-only "Manage letters" tab (src/routes/_layout.documents.tsx) lets HR add/enable/disable/
  remove letters and edit label/description/category/Zoho URL slug/fields hint. `enabled` is
  forced false server-side if `zoho_path` is empty (can't have a live "Request" button with no
  destination).
- Removed the old "Manage Templates" tab entirely (SharePoint-sync UI) — it edited a completely
  different, already-disconnected backend system (see below). Don't resurrect that UI.

**Important — two unrelated systems both called "document templates" in this codebase:**
1. This one (HRLetterType) — directory-only, generation happens in Zoho People.
2. `DocumentTemplate` model / `document_service.py` / `zoho_doc_service.py` / `/api/documents/*`
   — an internal generate→approve→download engine (9 seeded HTML letter templates,
   `zoho_doc_service._BY_DOCTYPE` hardcodes which doc_types it can render). SharePoint sync is
   already disabled server-side (`admin_sync_templates` always 400s). No current frontend caller
   actually drives this engine's `/api/documents/generate|catalogue` for HR letters — it's
   legacy/orphaned. `doc_agent.py` (LLM-based, uses the even-older `DOC_TEMPLATES` dict) is also
   not wired to a live UI path. Don't assume either is what "document generation" means without
   checking — ask which system before extending.

Also modernized the Document Library tab in the same file: per-file-type accent colors
(`FILE_TYPE_ACCENT`), framer-motion stagger-in/exit on the grid, a "New" badge for docs <3 days
old, and a DropdownMenu (kebab) for secondary actions instead of a row of icon buttons.
