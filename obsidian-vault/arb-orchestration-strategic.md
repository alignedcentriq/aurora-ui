---
name: arb-orchestration-strategic
description: ARB items 23-34 and 45-52 implementation status — orchestration, RAG, eval, and strategic layers built 2026-06-27
metadata:
  type: project
---

ARB Orchestration/AI and Strategic items batch-implemented 2026-06-27.

**What:** All 12 items from the architecture review board implemented in one session.

## Orchestration/AI (23-34)

#33 TTFT — `time_to_first_token_ms` now populated in SSE handler (main.py line ~1586).

#32 Mutable state — `_feedback_count_cache` etc. documented as worker-local TTL caches; startup warning fires if `WEB_CONCURRENCY > 1`.

#23+#24 Orchestration package scaffold:
- `backend/app/orchestration/` created: `__init__.py`, `resolver.py` (canonical home of Resolver/Decision/RouteContext), `state.py` (AgentState TypedDict reference), `pipeline.py` (SharedPipeline — Phase 3 pre/post hook engine)
- `backend/app/tools/__init__.py` scaffolded for migration
- `services/resolver.py` is now a re-export shim
- `agent.py` imports from `orchestration.resolver` (not services)
- `_active_mode_strategy` reads from skill registry (see #45)

#26 Action-safety — `pending_action_service.py` gains: `list_pending()`, `expire_session()`, `expire_stale()`, `purge_expired()`. Background scheduler in main.py runs hourly (expire_stale + purge_expired 48h).

#27+#28 Eval tiers — `backend/tests/eval/` created:
- `eval_rag_groundedness.py` — 8 cases (5 grounded + 3 abstention), keyword-overlap judge, `--live` for real LLM
- `eval_action_correctness.py` — 7 cases, routing + entity + confirm-gate checks
- `run_all.py` — combined scorecard runner

#29+#30 RAG improvements in `policy_service.py`:
- `_chunk_text_structured()` — heading/section-aware chunker; prepends section heading to every chunk
- `_rerank_chunks()` — TF-overlap reranker; blended 70% RRF + 30% rerank in `_hybrid_search`
- `_chunk_and_embed()` now uses structured chunking

#31 Citations — `search_policies_with_citations()` added; returns `{context, citations[{title,category,excerpt}]}`.

## Strategic (45-52)

#46 Employee identity — `backend/app/services/employee_identity.py`:
- `normalize_name()` — strips honorifics, normalises whitespace
- `name_similarity()` — Jaccard token overlap
- `resolve_identity()` — single lookup by code/email/name
- `resolve_identities_batch()` — one DB query for N names
- `resource_matching_service.py` updated to use `normalize_name` for candidate key + `_directory_map` enhanced

#45 Skill registry — `capability_registry.py` gains `SkillSpec` dataclass + `SKILL_REGISTRY` (analytics, training, project, resource) + `route_for_mode()`. `_active_mode_strategy` in agent.py reads registry first, falls back to legacy `_MODE_ROUTES`.

#48 Insight bus — `backend/app/services/insight_bus.py`:
- Signal types: `DeliveryRiskSignal`, `SkillGapSignal`, `AttritionRiskSignal`
- Reactors: delivery_risk_to_training (first chain), skill_gap_to_training, attrition_risk_nudge
- Persists to `InsightSignalLog` + `InsightNudgeLog` DB tables (models added to models.py)
- `InsightBus.emit()` / `flush_pending_nudges()`

#52 Learning flywheel — `techelevate_local_service._apply_verified_skills()` now emits `SkillGapSignal(gap_count=-1)` after writing verified skills → InsightBus notifies Resource Finder / managers.

**Why:** ARB recommended these as the next layer after security/migrations — de-accreting the brain, adding eval coverage, and building the cross-domain intelligence substrate.

**How to apply:** The orchestration package is the migration destination for agent.py. New skills go in `SKILL_REGISTRY`. New cross-domain chains go in `InsightBus.register_reactor()`. Eval baseline: run `python -m tests.eval.run_all` before/after routing changes.
