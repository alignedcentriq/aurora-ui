---
name: integration-access-status
description: "Ground-truth live-vs-mock status per external integration (per user, overrides config-flag inference)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 20ea1b10-7620-4bf6-89a6-a423fc541097
---

Confirmed by user 2026-07-10, correcting my own config-flag-based guesses — **don't infer
"live" from env flags like `ZOHO_DEMO_MODE=false` alone; ask or confirm with user.** A flag
being set to the "live" value doesn't mean real API access/credentials actually work.

**Pending real API access (mock/local data only right now), despite code paths existing:**
- **Zoho** — no Zoho API access yet, even though `backend/.env` has `ZOHO_DEMO_MODE=false`
  and a `ZOHO_REFRESH_TOKEN` set. Don't trust that flag as proof of live status.
- **Tech Elevate** — no TechElevate API access; the in-house LMS (`te-lms` tab, own DB —
  see [[techelevate-local-lms]]) is what's actually usable, but the row still needs the
  "pending API access" caveat per user.
- **ManageEngine** — confirmed pointed at `mock_manage_engine_server.py` (`MANAGE_ENGINE_BASE_URL`
  defaults `localhost:8091`, `MANAGE_ENGINE_API_KEY="mock-api-key"`). No override found anywhere.
- **Udemy Business** — read/reporting API is real and live; SCIM write (activate/deactivate/
  provision/groups/license-pool) is fully built but dormant pending Azure AD SCIM credentials.
  See [[udemy-inactive-seats]].
- **Admin Portals** (facility complaint, food complaint, parking sticker, desk-key requests) —
  entirely mock: writes go straight to Centriq's own local DB (`ParkingSticker` etc. in
  `models.py`, via `admin_service.py`), no real external Admin Portal/facilities system
  connected at all yet.

**Confirmed genuinely live (real API, both read and write):**
- **Microsoft 365** — real Graph OAuth (mail, calendar, Teams chat, SharePoint sync);
  only the narrower Teams Activity-feed ping sub-feature is dormant (see [[teams-notification-model]]).
- **Alchemy** — Read AND Write (user corrected doc from Read-only to Read/Write 2026-07-10).
- **SharePoint** — Read only (unchanged, accurate as documented).
- **AI Xchange Marketplace** — Read-only (unchanged, accurate).

**How to apply:** `docs/Centriq Technical Architecture Document.docx` §8.1 integrations
table now reflects all of the above (Access column carries the "pending X API access"
caveats; new "Admin Portals" row added). When editing this doc or reasoning about what
Centriq can actually do end-to-end (not just what code exists for), default to this list
over config-file inspection, and re-confirm with the user before asserting a system is
"live" if it matters for a decision.
