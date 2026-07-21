# Local Embedding Backend — Design Spec

**Date:** 2026-07-21
**Status:** Draft — pending user review

## Problem

The semantic answer cache (`AnswerCacheService.lookup`) and every other embedding-dependent
feature (policy search, feedback similarity matching, semantic routing) call
`PolicyService._get_embedding()`, which — after missing an exact-text L1/L2 cache — makes a
network call to `ml01` (the shared box that also runs the main LLM). Because L1/L2 are keyed by
an exact hash of the input text, any rephrased question misses both and pays a live round-trip
to a contended, sometimes-slow shared server (client configured with `max_retries=0,
timeout=15.0`). This is the dominant source of latency on "cache hit" requests, not Postgres
(which already has an HNSW index on `cached_answers.query_embedding` and is sub-millisecond).

Root cause: embedding generation is coupled to a shared, remote, contended resource, even though
the model itself (`nomic-embed-text`, ~137M params) is small enough to run locally.

## Goal

Move embedding generation from a remote call to ml01 to an in-process local model, for every
caller of `PolicyService._get_embedding()` — not just the answer cache. No change to which model
is used conceptually (`nomic-embed-text` family), only where it executes.

Out of scope: the original "single local JSON file for policy Q&A" idea discussed earlier in this
conversation. That is a separate, not-yet-designed idea and is not addressed by this spec.

## Design

### Components

- **New local embedding module** (`app/services/local_embedding_service.py`): wraps `fastembed`'s
  `TextEmbedding` running `nomic-ai/nomic-embed-text-v1.5` (the model family Ollama's
  `nomic-embed-text` is built on). Exposes `embed_query(text)` and `embed_document(text)`,
  applying the same task-prefix convention (`search_query: ` / `search_document: `) that Ollama's
  serving path applies, so vectors stay comparable to existing stored ones.
- **`PolicyService._get_embedding()`**: L1 in-process LRU and L2 Redis cache layers are unchanged.
  Only the L3 step changes: instead of an `OpenAI`-compatible client call to
  `settings.EMBEDDING_BASE_URL`, it calls the local embedding module when
  `settings.EMBEDDING_BACKEND == "local"`.
- **Removed on full cutover**: `_try_warmup_embedding()` (background Ollama warmup thread) and
  the `ollama_residency()` pre-check in `_get_embedding` — both exist only to work around a
  remote, sometimes-unloaded model, which no longer applies once the model runs in-process.
  `is_embedding_unavailable()` is kept, but its meaning shifts to "local model failed to
  initialize" rather than "remote ml01 unreachable."
- **New setting**: `EMBEDDING_BACKEND` (env var), values `remote` (default, today's behavior) or
  `local` (new path). A single global switch — every caller of `_get_embedding()` is affected
  identically; there is no per-feature split.

### Model preload

The local model is loaded once at app startup (not lazily on first request) so the first real
request doesn't pay a cold-load cost. Hooked into the existing startup sequence
(`app/database.py` or `app/main.py` startup event, wherever other one-time warm-up work already
lives).

### Validation before cutover

Before flipping `EMBEDDING_BACKEND` to `local` in any live environment:

1. **Full-corpus comparison**: for every existing `PolicyChunk` and `CachedAnswer` row, generate
   a new embedding via the local backend and compare (cosine similarity) against the existing
   stored embedding for the same text. Expect near-identical vectors since it's the same model
   family; flag any row falling below a similarity threshold (e.g. 0.98) for manual inspection.
2. **Replay real traffic**: take a sample of real past questions (from `AiRequestLog` /
   `ChatFeedback`) and confirm they still resolve to the same cached answers / same top policy
   search results under the local backend as they did under remote.
3. If some rows fail validation, re-embed just those rows via the existing batch re-embed
   utilities (`PolicyService.embed_all_policies()`, extended to cover `CachedAnswer` rows) — a
   one-time, low-risk background job. If validation broadly passes, no re-embedding is needed;
   new embeddings are simply generated locally going forward.

### Rollout

1. Ship the local backend + `EMBEDDING_BACKEND` setting, defaulted to `remote` — no behavior
   change on deploy.
2. Run full-corpus + replay validation (above) in a non-production environment with the setting
   set to `local`.
3. Flip `EMBEDDING_BACKEND=local` in production. Rollback is instant (flip the setting back) with
   no code change or downtime if search quality or cache-hit accuracy regresses.
4. Monitor `AiRequestLog.total_latency_ms` for `route_method="cache_hit"` and general search
   quality for several days.
5. Once stable, remove the `remote` code path, the `EMBEDDING_BACKEND` setting, and the
   ml01-specific warmup/residency logic entirely, so only one embedding path remains in the
   codebase.

### Failure handling

If the local model fails to load or errors at runtime, `_get_embedding()` returns `None`, exactly
as it does today on remote failure. All existing callers already tolerate `None` gracefully:
policy search falls back to keyword/BM25 search (`PolicyService._hybrid_search` steps 4-5), and
the answer cache simply misses (falls through to the normal LLM path) rather than erroring.

## Testing

- Full-corpus embedding comparison (old vs. new) across every `Policy`/`PolicyChunk` and
  `CachedAnswer` row, per Validation section above.
- Replay of real historical questions checking cache-hit and policy-search-result parity.
- Latency measurement: before/after `total_latency_ms` for cache-hit requests, confirming the
  ml01 round-trip is eliminated.
- Confirm graceful fallback behavior when the local model is deliberately made to fail (e.g.
  missing model files) — verify keyword-search fallback still serves an answer.
