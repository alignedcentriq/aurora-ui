# Centriq AI — Target Architecture (definitive blueprint)

Status: **architectural decision** — the target we migrate toward (strangler, not rewrite).
Author: architecture pass (acting as principal AI engineer), 2026-06-19.
Companion: `docs/architecture-redesign.md` (routing deep-dive), Appendix B (testing).

This document makes the calls. Where there's a choice, I pick one and say why. The
guiding judgement: **this is an enterprise assistant that takes real actions on real
systems (Zoho, Teams, tickets). The irreversible layer is actions, not routing — so the
architecture is organised to make actions safe, answers grounded, and every model call
observable, with routing as a solved, tested sub-problem rather than the main event.**

---

## 1. Context & hard constraints (what the architecture must respect)

- **Local, modest LLMs** (Ollama; agent tier ~llama3.1:8b). The design must minimise LLM
  calls, prefer deterministic paths, and degrade gracefully — not assume GPT-4-class reasoning.
- **Enterprise, multi-domain**: HR, IT, Admin, PMO, MS365, Manager, General + connectors.
- **Three capability classes**, in ascending order of blast radius:
  1. *Inform* (policy/RAG Q&A) — wrong answer is recoverable.
  2. *Look up* (my leaves, tickets, attendance) — read-only, per-user.
  3. *Act* (apply leave, send email/Teams, raise ticket, cancel leave) — **irreversible**.
- **Integrations** with independent auth/availability: Zoho, Alchemy, SharePoint, M365, marketplace.
- **Stack to keep**: FastAPI, LangGraph, Redis checkpointer + Postgres, the resilience layer.

## 2. Principles (the rules that drive every decision below)

1. **Actions are sacred.** Every state-changing tool goes through an explicit
   confirm→execute contract with durable pending state and idempotency. No write happens
   on an inferred intent without confirmation.
2. **Ground or abstain.** RAG answers are built only from retrieved, cited content. "I
   don't have that" is a valid, preferred answer over a hallucination — enforced
   structurally, not by prompt-wishing.
3. **One brain, layered.** A single orchestration pipeline; cross-cutting concerns live
   once as hooks, never copy-pasted per agent.
4. **Conversation has state.** What the conversation is *about* is a typed object, not
   re-derived per turn from heuristics.
5. **Deterministic first, LLM last.** Exact/keyword/semantic resolve before any generative
   call; the small model is the fallback, not the front door.
6. **Internal model calls are invisible.** Classifiers/resolvers/summarisers can never
   reach the user stream — enforced by the pipeline, not per-node skip-lists.
7. **Logs ≠ eval.** Observability is operational telemetry. Correctness is human-labelled
   curated cases. Logs feed *discovery*, never *truth*, and only via a human gate.
8. **Data-driven extensibility.** New domains/forms/connectors/skills are data + config,
   not new control-flow branches.

## 3. Target layered architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ CHANNEL / API            FastAPI /api/chat (SSE). Transport only:          │
│                          auth headers, thread_id, stream framing,          │
│                          post-process markers → widgets. No business logic.│
├──────────────────────────────────────────────────────────────────────────┤
│ ORCHESTRATION (LangGraph) — the brain, one pipeline:                       │
│                                                                            │
│   1 Ingest        load ConversationState for thread_id                     │
│   2 Resolve       Resolver: coref (from focus) + route  → RouteDecision    │
│   3 Pre-hooks     context-gate · guardrails · prefetch · tool-narrowing    │
│   4 Agent         domain-UNIQUE logic only (thin)                          │
│   5 Act           Action layer: confirm→execute contract (write tools)     │
│   6 Post-hooks    state_tracker(focus) · output hygiene · summarise/passthru│
│                                                                            │
├──────────────────────────────────────────────────────────────────────────┤
│ CAPABILITY / SERVICES    Pure, reusable, NO LLM:                           │
│                          HRService, ITService, Zoho*, Alchemy, RAG         │
│                          retrievers, document gen, notification service.   │
├──────────────────────────────────────────────────────────────────────────┤
│ CROSS-CUTTING (used by all layers)                                         │
│   • LLM Gateway   tiers · fallback · circuit breaker · internal/user split │
│   • RAG engine    uniform retriever + groundedness gate                    │
│   • Control plane IT-tunable params · prompts · flags · kill-switches      │
│   • Observability traces/logs/metrics  (READ-ONLY w.r.t. behaviour)        │
│   • Eval          curated · known-gap · discovery · online-from-feedback   │
└──────────────────────────────────────────────────────────────────────────┘
```

## 4. Core orchestration abstractions (the redesign — summary)

(Full detail: `architecture-redesign.md`.)

- **`ConversationState`** — typed per-thread object: `active_domain`, `active_task`,
  `focus` (subject + entities for coref), `pending_action`. Replaces the 5 ad-hoc
  carry-over mechanisms. *(Phase 1 landed: `focus` + `state_tracker`.)*
- **Resolver** — `(message, ConversationState) → RouteDecision`, implemented as an ordered
  list of **named, individually-tested strategies** (clarify-reply, pending-action,
  continuation/coref, exact, keyword, semantic, form-library, LLM-fallback). Replaces the
  ~14 inline branches. Precedence is declared + regression-tested, not line-ordering.
- **Shared agent pipeline** — `pre-hooks → agent body → post-hooks`. Context-gate,
  guardrails, prefetch, tool-narrowing, empty-recovery, output-hygiene, focus-tracking
  exist **once**. Domain agents shrink to their unique logic.

## 5. Action layer  ← the highest-value decision

Today: actions are scattered in agents; the IT email draft lives in an in-memory dict
(`PENDING_IT_EMAIL_DRAFTS`) that dies on restart. That is the most dangerous part of the
system. Target:

- **Tool contract.** Every tool declares `kind: read | write` and (for writes)
  `risk: low | high`, `idempotency_key`, and a `confirm_template`.
- **Confirmation state machine.** A write intent creates a `pending_action` in
  ConversationState (durable — Postgres-backed, survives restart), renders a confirmation,
  and executes only on an explicit confirm. Cancel/expiry are first-class.
- **Idempotency.** Each execution carries a key so a retry/double-confirm can't double-book
  leave or send a message twice.
- **Effect isolation.** The agent *decides*; the action layer *executes* and owns
  side-effect logging. One audit trail for every write.

This is what turns "an assistant that sometimes does the wrong thing" into one safe to
give 3,000 employees.

## 6. RAG subsystem

- **Uniform retriever interface** over the existing sources (HR policies, projects, PMO
  docs, app directory) — one `retrieve(query, scope) → chunks[]` contract; today each is
  bespoke.
- **Groundedness gate.** The answer node must produce content traceable to retrieved
  chunks; if retrieval is empty/weak, the system abstains ("not available") rather than
  free-generates. The existing "execute-first / pre-fetch then format" pattern (HR/Admin/
  MS365) is the right instinct — generalise it into the pipeline as the default for inform
  intents, not a per-agent special case.
- **Citations** carried through to the UI where useful (policy name/section), never raw
  metadata.

## 7. LLM Gateway

- **Single boundary** for every model call (extends `llm_resilience`): tier selection,
  fallback chain, per-tier circuit breaker (already present — keep).
- **Internal vs user-facing split is structural.** Internal calls (router, resolver,
  classifier, summariser) run with streaming disabled and are never forwarded to the SSE
  stream — a property of the gateway/pipeline, not a hand-maintained node skip-list. (This
  is the permanent fix for the `NO_CONTEXT` leak class.)
- **Token/latency budget** surfaced per request for the SLO metrics already being collected.

## 8. Eval & observability (decided — Appendix B)

Strict separation. Four eval tiers: **curated** (truth, human-labelled), **known-gap**
(asserts correct answer for known bugs; alarms when fixed), **characterization snapshot**
(refactor scaffold only — retire after use), **discovery** (logs + 👎/escalations →
candidates for human review). Observability (`ai_request_logs`, traces, SLO metrics) is
operational only and **never** a behaviour dependency. Online eval = mine `ChatFeedback`
👎 + escalations, the highest-signal radar, already in the schema.

Extend eval beyond routing to the layers that matter more: **action correctness +
confirmation safety**, and **RAG groundedness/abstention**.

## 9. Control plane

Keep and consolidate: IT-tunable LLM params, prompt configs, feature flags, per-domain
kill-switches, semantic-router seeds, form library, connectors. This data-driven control
plane is a genuine strength — it lets non-engineers extend the assistant. Target: one
coherent admin surface over these, with change audit.

## 10. What to KEEP (explicitly not rewriting)

Semantic router (pgvector, closed-set, fail-soft); the resilience/circuit-breaker layer;
checkpointer + Postgres-summary durability; zero-LLM fast-paths (become pipeline hooks);
data-driven seeds/forms/connectors; the SSE streaming + marker→widget post-processing.
This is a consolidation, not a teardown.

## 11. Migration roadmap (ordered by value × safety)

Each step ships independently and is reversible; all gated by the eval harness.

| # | Step | Why this order | Status |
|---|------|----------------|--------|
| 0 | Routing eval harness | safety net for all router work | **DONE** |
| 1 | `ConversationState.focus` + tracker | kills the follow-up bug class | **DONE** |
| 2 | **Action safety layer** | highest blast radius; do before more refactor | **NEXT** |
| 3 | Resolver extraction (strategies) | de-accretes routing; harness-gated | planned |
| 4 | Shared agent pipeline (pre/post hooks) | removes per-agent duplication | planned |
| 5 | RAG uniform retriever + groundedness gate | correctness of inform answers | planned |
| 6 | Online eval from feedback/escalations | continuous quality signal | planned |
| 7 | Retire characterization snapshot | scaffold no longer needed | after 3 |

I deliberately put **Action safety (2) before the routing Resolver (3)**: a mis-route is
recoverable, a mis-action is not, and the in-memory pending-draft is a live correctness/
durability risk today. Routing is already protected by the harness; actions are not yet
protected by anything.

## 12. Non-goals & risks

- **Non-goals**: replacing LangGraph/FastAPI/Redis; changing domains/tools wholesale;
  swapping the LLM provider; a big-bang rewrite.
- **Risk — regressing encoded edge cases**: mitigated by the harness (every router change
  gated; snapshot proves behaviour-preservation).
- **Risk — over-engineering the action layer**: start with the two real write paths
  (leave, IT email/ticket, Teams send) and the durable `pending_action`; don't build a
  generic workflow engine.
- **Risk — RAG groundedness on a weak model**: prefer abstention + retrieval quality over
  clever prompting; measure with the eval tier.

## 13. One-paragraph verdict

Keep the stack and the data-driven control plane; consolidate the brain into one layered
pipeline with typed `ConversationState`, an ordered-strategy `Resolver`, and shared
pre/post hooks; and **invest first in an action-safety layer (durable confirm→execute with
idempotency) and RAG groundedness**, because those are the irreversible, trust-defining
layers for an enterprise assistant. Routing — the thing the recent bugs were about — is
already the most-tested part and is a solved sub-problem under this design. Migrate via the
strangler roadmap above, gated by the eval harness, never as a rewrite.
