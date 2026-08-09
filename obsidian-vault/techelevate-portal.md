---
name: techelevate-portal
description: "External TechElevate Training Portal — REMOVED 2026-06-27; local LMS (te-lms tab) still active"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7d361e5e-918f-45bb-913e-a89f1f98b449
---

The **external** TechElevate portal (training.alignedautomation.com) was **removed 2026-06-27**.

**What was removed:**
- `src/pages/TechElevatePortal.tsx`
- `backend/app/routes/techelevate_routes.py`
- `backend/app/services/techelevate_service.py`
- `oauth_service.get_techelevate_token / get_techelevate_service_token / exchange_techelevate_id_token`
- `src/lib/api-token.ts:getIdToken()` (was only used for TE SSO pre-warm)
- `auth-store.tsx` TechElevate session pre-warm block
- `config.py` TECHELEVATE_BASE_URL / TECHELEVATE_ENABLED / TECHELEVATE_SA_* / TECHELEVATE_DEV_JWT settings
- "techelevate" tab from Control Hub

**What is KEPT (the in-house LMS):**
- `src/pages/TechElevateLocalPortal.tsx` — "te-lms" tab in Control Hub
- `backend/app/routes/techelevate_local_routes.py`
- `backend/app/services/techelevate_local_service.py`
- DB models: `TeTraining, TeTrainingLevel, TeMcqQuestion, TeAssignment, TeGroup`
- `config.py` TECHELEVATE_LOCAL / TECHELEVATE_SEED_ASSIGNMENTS settings
- `bench_upskill_service.py` and `team_readiness_service.py` (both use te local service)
- PMO agent tools: `recommend_training`, `get_my_trainings`
