---
name: project-iq
description: Project IQ — Project DNA extraction + Delivery-Reuse/Lessons/Experts/Assets over the ingested project corpus
metadata: 
  node_type: memory
  type: project
  originSessionId: fff14d25-76f9-4ced-aa4f-31e22e343889
---

Project IQ first slice built 2026-06-25 (internal-only; Sales/Proposal/Estimation deferred). Turns the ingested project corpus into reusable **Project DNA** + reuse/lessons/expert/asset search.

**Data source (already existed):** `sharepoint_project_sync.sync_projects()` ingests per-project subfolders under `SHAREPOINT_PROJECTS_ROOT` (default `General/Projects`, transcripts vtt/srt included) into `Policy`/`PolicyChunk` tagged `category="Project Showcase"`, keyed `source_key LIKE 'sp:PROJECT/{slug}/%'`. That slug prefix is the DNA grouping key. Whether the folder is *populated* is an ops check — DNA is empty until content is synced.

**New backend:**
- Tables in [models.py](backend/app/models.py): `ProjectProfile` (+ `embedding` Vector(768), `confidence` verified|inferred, `review_status` draft|reviewed) and children `project_capabilities/integrations/lessons/reusable_assets/expertise`. HNSW index added in [database.py](backend/app/database.py) idx block.
- [project_iq_service.py](backend/app/services/project_iq_service.py): `extract_project_dna(slug)` / `build_all_dna()` (LLM via `llm_controls.get_llm("service")` + `invoke_json`, strict JSON, verified-only-if-explicit rule); query helpers `find_similar_projects` (pgvector cosine over profile embedding, reuses `PolicyService._get_embedding`), `lessons_for`, `find_experts`, `find_reusable_assets`; `render_*` for chat passthrough; `set_review`.
- [project_iq_routes.py](backend/app/routes/project_iq_routes.py) prefix `/api/project-iq` (browse/search = `require_non_employee`; rebuild/review = `require_pmo`). Registered in main.py.
- PMO chat tools added to [pmo_agent.py](backend/app/agents/pmo_agent.py) + tool_registry passthrough: `find_similar_projects`, `project_lessons`, `find_project_experts` (proven experience; vs `match_resources` = availability), `find_reusable_assets`.

**Frontend:** [ProjectIQPortal.tsx](src/pages/ProjectIQPortal.tsx) as a Control Hub tab `project-iq` (Management Portals, `show: role!=="Employee"`) — Find-Similar search + DNA library grid + detail drawer with verified/inferred badges + PMO rebuild/approve. Portals here are Control Hub tab components, NOT standalone routes.

**Verified-vs-inferred gate** designed in now (every fact has confidence; UI badges it; `review_status` gates) — the deferred client-facing pillars must filter to verified+reviewed. Related: [[techelevate-portal]], [[resource-matching-feature]], [[skill-supply-overlay]].
