---
name: org-hierarchy-graph
description: "Org Hierarchy visual graph REMOVED 2026-06-24 (directory covers it); KEEP the MS Graph manager-sync insight = $expand=manager($levels=1) inline; full sync ~1113 users runs in background"
metadata:
  node_type: memory
  type: project
  originSessionId: 17768633-ed18-4b0b-8a08-3cf5ffb5b7c2
---

**REMOVED 2026-06-24**: the Employee Directory now covers org/reporting needs, so the standalone graph was deleted — `src/pages/OrgHierarchy.tsx` (gone), the Control Hub "Org Hierarchy" tab, and the `GET /api/ms365/org-hierarchy` endpoint. The directory's profile modal "Org Chart" button was also dropped. Do NOT re-add without an explicit request (cf. [[removed-features]]). The MS Graph **sync** machinery below is still live and still feeds the directory's manager data + [seed_org_hierarchy.py](backend/seed_org_hierarchy.py) — that's why this memory is kept.

Originally built 2026-06-21 (MS365-sourced) as a hand-rolled org chart + list (no graph lib, React-19-safe per [[react19-frontend-constraints]]), with single-apex "my org" scoping and M365 profile photos via the still-present public proxy `GET /api/ms365/users/{email}/photo`.

**Manager-link fix (the crux — superseded $batch):** MS Graph rejects plain `$expand=manager` on the org-user list because that list uses the advanced query (`$count` + `endsWith(mail,…)` + `ConsistencyLevel: eventual`): error `Request_UnsupportedQuery … 'manager' in $expand requires $levels`. The fix the error itself names: **`$expand=manager($levels=1;$select=id,displayName,mail)`** IS accepted with the advanced query and returns the manager inline. So `sync_users_to_db`/`fetch_org_users` now use that (constant `USER_LIST_EXPAND` in [ms365_service.py](backend/app/services/ms365_service.py)). This is why managers were empty before (old sync had no manager data → flat 1-level chart; [seed_org_hierarchy.py](backend/seed_org_hierarchy.py) comment confirmed it). Do NOT resolve managers via per-user `/users/{id}/manager` (even batched) — Graph throttles that hard past ~600-800 users, stalling for 10+ min. Single-user `$expand=manager` (fetch_user_by_email) needs no $levels (not an advanced query).

**Full sync is slow + async:** org domain = **1113 enabled users** (Graph `@odata.count`). `$levels` expand pages cap at ~100 users/page at ~17s/page ⇒ full pull ~3.5-4 min ALONE, but the shared GRAPH_* app token also serves the main backend, so in practice it ran 10+ min under contention. So `POST /api/ms365/users/sync` (`limit=0` = whole domain) is **fire-and-forget** (`asyncio.create_task` → `run_sync_background`); UI polls `GET /api/ms365/users/sync-status`. Commit is one transaction at the very end (db_count stays flat until done). Verified deep multi-level tree (e.g. 5-level chain Director→Assoc Director→Sourcing Specialist→Sr Consultant→Sr Consultant) even at 602 users.

- **Verify caveat**: shared backend :8080 runs **no-reload** ([[backend-runtime-setup]]); tested on throwaway venv uvicorn :8090. To go live on :8080 it must be restarted. Cold-start quirk: first request(s) after boot 404 until routers finish registering — wait for the path in `/openapi.json` before hitting it.
