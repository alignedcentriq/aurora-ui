---
name: project-iq-search-resilience
description: Project IQ search keyword fallback + degraded-mode UI + embedding backfill; why "no match" happened
metadata:
  type: project
---

Project IQ "Find Similar" search silently returned "no match within seconds" whenever the embedding model (ml01 `nomic-embed-text`) was unavailable. Two compounding causes: (1) ml01 returns 503 "maximum pending requests exceeded" — a GLOBAL Ollama queue cap shared across all apps, NOT per-Centriq-user (a single client back-to-back gets instant 503s), and (2) all 20 `project_profiles.embedding` were NULL (built while ml01 was down), so even a working query-embed filtered to 0 rows.

Fixes built 2026-07-08 (dev_shivam):
- **A** `search_projects(query, limit, reviewed_only)` in [project_iq_service.py] returns `{"results","mode"}` (semantic|keyword). Strong keyword fallback = term-overlap across name/dna_summary/problem/solution/outcomes/arch/industry/tech_stack/complexity_drivers (stopword-filtered), used when embed unavailable OR no profile vectors exist. `find_similar_projects` kept as thin wrapper. `/api/project-iq/search` now returns `search_mode` + `degraded`.
- **C** ProjectIQPortal.tsx: `searchMode` state; amber "showing keyword matches" banner + mode-aware empty state.
- **B** `backend/backfill_project_iq_embeddings.py` — embeds each profile's `dna_summary`, idempotent (only NULL embeddings unless `--all`), per-profile commit, exponential backoff on 503. MUST run during a quiet ml01 window (all 20 still NULL as of build — ml01 was saturated). Re-run: `venv/Scripts/python.exe backfill_project_iq_embeddings.py --retries 8`.

Gotcha: local backend on :8080 runs uvicorn WITHOUT `--reload` (despite start.ps1 having it) + a supervisor parent; code edits need a restart to go live. See [[backend-runtime-setup]]. Related: [[project-iq]], [[ml01-llm-environment]].
