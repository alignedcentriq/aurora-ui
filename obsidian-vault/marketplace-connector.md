---
name: marketplace-connector
description: AI Xchange Marketplace onboarded as read-only connector (id=1); hub-as-intelligence-layer direction
metadata:
  type: project
---

centriq_ai is being positioned as a **central intelligence layer** aggregating multiple external portals through the existing `backend/app/connectors/` framework (Connector + ConnectorOperation + ConnectorAuth rows → agent tools via tool_factory). This is multi-portal by design — more portals to come.

**First portal onboarded (2026-06-18):** `ai_xchange_marketplace`, connector **id=1**, status=published, auth=none, base_url `https://ai-agents-marketplace-backend-ged3hkdbbhe2fqeu.canadacentral-01.azurewebsites.net`. This one FastAPI backend serves BOTH the marketplace UI and the AI Xchange SPA (`aixchangehub.azurewebsites.net`, which is frontend-only — no API on that host).

**READ-ONLY by explicit user requirement:** only the 12 GET ops were imported (drop all POST/PUT/PATCH/DELETE; also exclude all `/users/*` — `GET /users` leaks the user list, `/users/me` is bearer-gated). Enforced in `backend/app/scripts/seed_marketplace_connector.py` (re-runnable; method filter + `/users` exclusion + disables any stale non-GET op). Data is small/static governance content: ~5 ai-tools, 3 policies, 5 newsletters, 4 trainings, 2 platforms.

**Avoid duplication:** policy/newsletter *content* lives in SharePoint (already synced via [[centriq-replatform-status]]'s sharepoint_*_sync). Use this connector for agents/ai-tools/training catalogs; don't double-ingest policies.

**Bug found (not fixed):** `openapi_importer.enrich_with_llm()` calls `get_llm(model, streaming=False)` but get_llm() has no `streaming` kwarg → enrichment silently skipped for ALL connector imports. Op descriptions fall back to raw OpenAPI summaries. Router-utterance seeding also not run by the seed script (call `POST /api/admin/connectors/1/publish` as super-admin to seed). See [[live-config-needs-approval]].
