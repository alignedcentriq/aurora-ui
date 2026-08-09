---
name: centriq-replatform-status
description: "Centriq AI re-architecture plan status — what's done (Phases 0-4, M1) and what's pending (M2-M6)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 58529f23-cbb0-4f4b-a303-81804056b98c
---

Centriq AI re-architecture (approved plan at `C:\Users\shivam.sharma\.claude\plans\you-know-about-this-modular-raven.md`): speed fixes + no-code connector platform. Status as of 2026-06-11:

**Done**: platform DB tables (Connector/Flow/Persona/Dashboard + migrations), `backend/app/connectors/` package (registry, auth, executor, tool_factory, openapi_importer, seeder), `connector_agent` graph node + `connector:` domain routing, ConnectorStudio admin UI, `tool_registry.py` (response_mode), context_manager off hot path, `llm_resilience.py` (circuit breaker + TTFT hedge), agent model eval + switch, **≤8 tools per request** for hr_agent (`_HR_TOOL_GROUPS` sub_intent→tool-group map in agent.py; `hr_tool_node` keeps full 38-tool list for execution).

**Done 2026-06-11 (wrong-answer-prevention sweep)**: resilience layer fully wired — `resilient_invoke`/`resilient_ainvoke` (breaker + dynamic fallback-model retry, `build=` hook for bind_tools/structured-output) now wrap ALL chat-path LLM calls (router, all 9 domain agents, summarizer, connector ReAct loop); `get_llm` set to max_retries=0 (wrapper owns retry policy). Clarification gate: LLM-router confidence < `CLARIFY_CONF_THRESHOLD` (0.6, config.py) → `domain_clarify_agent` quick_choice card; reply "Label: question" routes deterministically via `_CLARIFY_REPLY_RE`. Retrieval semantic veto in `_hybrid_search` (embeddings healthy + zero chunks < 0.65 → `RETRIEVAL_VETO_MESSAGE`, BM25/keyword word-overlap rescue suppressed; phrasing load-bearing for "No policies found"/"no results" caller checks). Reversible routing: `_reroute_card_on_empty_retrieval` in hr-summarizer/admin/it nodes (fires only when route_confidence < 0.8 AND veto sentinel in ToolMessage). `/api/health/llm` now really probes Ollama /api/tags (3s) + reports breaker states; stream connectivity errors return a friendly degraded message instead of a raw error. Also fixed latent `get_llm("agent", streaming=True)` TypeError on the connector path.

**Done 2026-06-27 (ARB items 23-34 + 45-52)**:
- TTFT metric populated — `time_to_first_token_ms` written to `AiRequestLog` in SSE handler
- Module-level mutable state documented + multi-worker warning on startup
- `backend/app/orchestration/` package: resolver.py (canonical), state.py, pipeline.py (SharedPipeline)
- `services/resolver.py` is now a re-export shim; agent.py imports from orchestration
- Action-safety: `list_pending()`, `expire_stale()`, `purge_expired()` + hourly background cleaner
- Eval tiers: `backend/tests/eval/eval_rag_groundedness.py` + `eval_action_correctness.py` + `run_all.py`
- RAG: structure-aware chunking (`_chunk_text_structured`), TF-overlap reranker (`_rerank_chunks`), `search_policies_with_citations()`
- Canonical employee identity: `employee_identity.py` (normalize_name, resolve_identity, batch)
- Skill registry: `SkillSpec` + `SKILL_REGISTRY` + `route_for_mode()` in capability_registry.py; `_active_mode_strategy` reads registry first
- Insight bus: `insight_bus.py` with 3 signal types + 3 reactors; delivery-risk→training chain working; `InsightSignalLog` + `InsightNudgeLog` models added
- Learning flywheel: `_apply_verified_skills` emits `SkillGapSignal(gap_count=-1)` on skill verification

**Pending**:
- ≤8-tool binding retrofit for the other 8 hardcoded agents (only HR done)
- M2 auto-forms + personas, M3 flow builder, M4 doc studio, M5 ROI dashboards, M6 agent→connector migration
- Connector E2E exit criterion: one real OpenAPI portal integrated with zero code
- Items 34 (retire characterization snapshot — depends on full Phase 2 Resolver completion)
- Items 49-51 (semantic analytics layer, Project Health Score, Meeting Intelligence — L/XL)

**Hard-won bug class**: Phase 3 refactor shipped `asyncio` usage without the import — killed ALL chat requests at intent_router with the generic "unable to generate a response" fallback. Always run pyflakes over touched files; bare `except:` blocks in this codebase silently swallow NameErrors.

Related: [[ml01-llm-environment]], [[backend-runtime-setup]]
