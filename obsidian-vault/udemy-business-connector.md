---
name: udemy-business-connector
description: Udemy Business catalog connector — org-level Basic-auth REST API, chat course rec tool + Control Hub portal; built 2026-06-24
metadata:
  type: project
---

Udemy Business onboarded as a learning source (built 2026-06-24). Distinct from the
existing [[marketplace-connector]] / [[techelevate-portal]] auth models:

- **Auth = org-level HTTP Basic** (`base64(client_id:client_secret)`), NOT per-user OAuth — so no `connected_accounts`/refresh-token blocker like TechElevate. Credentials live in `backend/.env`: `UDEMY_CLIENT_ID`, `UDEMY_CLIENT_SECRET`, `UDEMY_SUBDOMAIN=alignedautomation`, `UDEMY_ORG_ID=178490`, `UDEMY_ENABLED`. Base = `https://{subdomain}.udemy.com/api-2.0`.
- **API**: `GET /organizations/{org}/courses/list/` (search/browse, `fields[course]=...`), `/courses/{id}/`, `/analytics/user-activity/` (admin reporting). Enterprise-only API; 401/403 → "not_configured".
- **Files**: `services/udemy_business_service.py` (client, defensive `.get()` field mapping), `routes/udemy_routes.py` (`/api/portal/udemy/*`), `pages/UdemyBusinessPortal.tsx` (Catalog grid + Learner Activity tab, role-gated), Control Hub tab `udemy-business` (show all).
- **Chat tool**: `search_udemy_courses` added to PMO agent (`agents/pmo_agent.py`) — passthrough in `tool_registry.py`; PMO `DOMAIN_REGISTRY` desc extended for "what course to learn X". Ties into existing `request_training_license` (license-request flow lives in the separate `udemy_service.py` — do NOT conflate the two Udemy modules).
- Docs (`alignedautomation.udemy.com/developers/...`) are login-gated → couldn't auto-verify exact field names; `_simplify()` is defensive. Re-check field names if catalog cards render blank.
