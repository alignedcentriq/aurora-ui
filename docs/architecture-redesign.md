# Centriq AI — Routing & Agent Layer Redesign

Status: **proposal / design plan** (no code changes in this doc)
Author: architecture pass, 2026-06-18
Scope: the conversational brain — `backend/app/agent.py`, `backend/app/router.py`,
`backend/app/agents/*`, `backend/app/services/semantic_router_service.py`,
the `/api/chat` entrypoint in `backend/app/main.py`.

---

## 1. Why this doc exists

The system works, but recent bugs (a classifier sentinel leaking to the UI, the
custom-context gate existing only in HR, follow-ups like "show their allocation"
mis-routing) were all fixed _tactically_. This doc steps back and asks whether the
architecture itself is the problem, and proposes a consolidation that removes whole
**classes** of these bugs instead of instances.

Verdict: the design is not broken, but it shows **accretion** — heuristics layered on
heuristics, and cross-cutting concerns copy-pasted per agent. The fix is consolidation
behind three abstractions, done as a **strangler migration** (never a big-bang rewrite),
because the existing heuristics encode real production learnings we must not discard.

---

## 2. Current-state map (the evidence)

### 2.1 Routing layer — `intent_router` (`agent.py:2453-2722`, ~269 lines)

A single function with **~14 ordered early-return layers**, sitting on top of
`_try_keyword_route` (`agent.py:1886-2266`, **43+ regex patterns**), the
`SemanticRouterService` (4 tiers: exact / high / ambiguous / low), and an LLM router
(`router.py`). Three independent routing mechanisms coexist; stickiness adds **4 more
override gates** (`keyword_overrides_sticky`, `semantic_overrides_sticky`,
`topic_switch`, `_is_continuation` + decay).

The accretion is documented in the code itself. Representative comments:

- `agent.py:2313` — _"Length-based stickiness was the rogue rule that pinned an IT
  question to a stale HR thread."_
- `agent.py:2562` — _"an HR query from yesterday leaves the session sticky to 'hr', and
  today's 'what's the status?' gets misrouted … require explicit continuation signals."_
- `agent.py:2083` — _"must precede IT install to avoid 'I need to request a visitor
  pass' → software_install misroute."_
- `agent.py:2040` — _"checked before the sticker keyword so '… parking charges …' doesn't
  fall through to the semantic router (which used to mis-match it to a PF query)."_

Each comment is a real incident encoded as another branch. That knowledge is valuable —
but it lives as control flow, not as data, so it can't be tested or reasoned about as a set.

### 2.2 Agent layer — per-domain nodes (`agent.py` + `agents/*`)

Every domain agent node carries **bespoke pre-logic** before its LLM call, and the
_same_ cross-cutting patterns are re-implemented in each:

| Agent                     | Pre-logic  | Notable bespoke branches                                                                      |
| ------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| HR (`hr_agent` 2860-3003) | ~143 lines | policy pre-fetch, resource-match fast-path, `_looks_like_people` skill search, tool-narrowing |
| MS365 (3483-3575)         | ~92 lines  | execute-first pre-fetch for email/calendar/teams/yammer/community                             |
| Admin (3325-3391)         | ~67 lines  | parking-charges answer, policy pre-fetch, follow-up re-search, `[SUB_INTENT:]` tag            |
| IT (3394-3451)            | ~57 lines  | install confirm/cancel, hardware fast-path, draft into `PENDING_IT_EMAIL_DRAFTS`              |
| General (3609-3655)       | ~46 lines  | greeting / off-topic / salary-date fast-paths                                                 |

**Duplicated cross-cutting concerns** (each re-coded per agent):

- "pre-fetch data then let the LLM only format" (`[PRE-FETCHED …]` injection) — HR, Admin, MS365.
- "empty LLM response → re-inject last ToolMessage" — HR, Admin, IT, General.
- tool-narrowing by sub-intent — HR (`_hr_tools_for`, 20 groups), Admin (`_TOOL_GROUPS`, 17 groups).
- passthrough of display-ready tool output — PMO, Admin, IT (but HR uses a `summarizer` instead — inconsistent).
- `_location_prefix`, role instructions, guardrail injection — sprinkled across 4-7 agents.

Sub-agent structure is also inconsistent: PMO is a **nested StateGraph**
(`smart_dispatcher → tools | passthrough → llm`); Admin/IT/Manager are dual-layer
sub-graphs; others are thin wrappers. Same idea, three shapes.

### 2.3 State layer — no first-class conversation state

There is **no unified conversation-state object**. Cross-turn context is carried by
**five parallel mechanisms** (per the state exploration):

1. `messages` list — checkpointer (Redis/`MemorySaver`), append-only reducer (`agent.py:154`).
2. `conversation_summary` — Postgres `ConversationSummary`, durable across Redis restarts.
3. sticky `domain` / `sub_intent` / `entities` — checkpointer, reused heuristically.
4. `PENDING_IT_EMAIL_DRAFTS` — **in-memory dict, lost on restart** (a correctness risk).
5. `resolved_query` — checkpointer + surfaced via `feedback_context`.

There is no representation of **what the conversation is currently about** (active
subject/entities — e.g. "the React developers just listed"). That absence is the direct
cause of the "show their allocation" failure: the pronoun had nothing typed to resolve
against, so coref had to be bolted on as its own LLM node.

---

## 3. Root diagnosis (one sentence)

> Every turn is handled as **stateless classification**, every agent is a **bespoke
> node**, and cross-cutting concerns (coref, entity carry-over, the context gate,
> internal-vs-user-facing LLM hygiene, empty-response recovery) are **sprinkled as
> heuristics wherever a bug last appeared** — so each new edge case becomes another
> branch instead of data behind a stable contract.

Three missing abstractions follow directly.

---

## 4. Target architecture

### 4.1 Abstraction A — typed `ConversationState`

A single typed object, persisted per `thread_id`, that represents _what the conversation
is about_ — not just its message log.

```
ConversationState:
  active_domain: str | None            # replaces ad-hoc sticky `domain`
  active_task:   TaskRef | None        # the in-flight intent (e.g. staffing, leave-apply)
  focus:         Focus | None          # the current SUBJECT: {kind, entities, source_turn}
                                       #   e.g. kind="people", entities=[<react devs>]
  pending_action: PendingAction | None # replaces PENDING_IT_EMAIL_DRAFTS (now durable)
  turn_count, last_domain_set_turn     # replaces the >6-turn decay bookkeeping
```

- `focus` is what "their / them / those / that one" resolves against — **no LLM needed**
  for the common case; coref becomes a lookup, with the LLM rewrite as fallback only.
- `pending_action` makes confirmations (IT email draft, etc.) durable and uniform instead
  of an in-memory dict that dies on restart.
- Stickiness becomes _reading `active_domain` + `focus`_ instead of four override gates.

### 4.2 Abstraction B — one routing decision (the Resolver)

Collapse the 14 layers + 3 mechanisms into one **tiered resolver** with a single explicit
contract: `(message, ConversationState) -> RouteDecision`.

```
RouteDecision: { domain, sub_intent, entities, resolved_query, confidence, source }
```

Internally still tiered (this is good design, keep it), but as an ordered **strategy
list**, not inline branches:

```
strategies = [
  ClarifyReplyStrategy,        # deterministic user choice
  PendingActionStrategy,       # confirm/cancel an in-flight action
  ContinuationStrategy,        # uses ConversationState.focus — resolves "their/those"
  ExactDictStrategy,           # O(1) phrase map
  KeywordStrategy,             # the 43 regexes — now DATA, registered, testable
  SemanticStrategy,            # pgvector k-NN tiers
  FormLibraryStrategy,
  LlmRouterStrategy,           # fallback
]
# first strategy to return a confident decision wins; else ClarifyCard
```

Why this matters: each "bug-fix comment" from §2.1 becomes a **named strategy with a unit
test**, not a comment on a branch. The ordering that encodes "visitor pass before install"
becomes declared precedence, regression-tested, instead of fragile line-order.

### 4.3 Abstraction C — shared agent pipeline

One pipeline wraps every domain agent so cross-cutting concerns exist **once**:

```
run_agent(domain, state):
   pre  = [ context_gate, role/location/guardrail inject, prefetch(domain,sub_intent),
            tool_narrowing(domain,sub_intent) ]
   body = domain_strategy(state)        # the only domain-specific part
   post = [ empty_response_recovery, passthrough_or_summarize, output_hygiene ]
```

- `context_gate` (already lifted to one node this session) becomes a pre-hook — same place
  every domain gets it.
- "pre-fetch then format", "empty → re-inject ToolMessage", tool-narrowing, passthrough vs
  summarize: each becomes **one** hook with a per-domain config table, not 5 copies.
- Domain agents shrink to their genuinely unique logic (HR's resource matcher, MS365's
  Graph calls), typically a fraction of today's 50-140 lines.

---

## 5. Migration plan (strangler — incremental, reversible)

No big-bang. Each phase ships independently, behind the existing graph, and is revertible.

**Phase 0 — Safety net (do first).**
Build a routing/eval harness: a fixture set of (message, prior-state) → expected
(domain, sub_intent). Seed it from the bug-fix comments in §2.1 (each is a known case) and
from `ai_request_logs`. This is what lets us refactor the router without regressing the
hard-won edge cases. _Risk: low. Pure addition._

**Phase 1 — Introduce `ConversationState` alongside existing fields.**
Add the typed object to `AgentState`; populate `focus` from each turn's result (e.g. the
people list an agent returned). Keep the old fields working in parallel. Wire
`ContinuationStrategy` to read `focus` so the _common_ "their/those" case resolves without
the LLM `followup_resolver`. _Risk: medium. New field, no removals yet._

**Phase 2 — Extract the Resolver (Abstraction B).**
Move the 14 layers into named strategy objects behind the `(message, state) ->
RouteDecision` contract, **preserving current precedence exactly** (verified by the Phase-0
harness). Delete nothing semantically — just relocate. `intent_router` becomes a thin
driver over the strategy list. _Risk: medium; harness-gated._

**Phase 3 — Shared agent pipeline (Abstraction C).**
Introduce `run_agent` with pre/post hooks; migrate agents one at a time (start with the
thinnest — Manager/Doc — then IT, Admin, MS365, HR last). Each migration moves a domain's
bespoke pre-logic into config + hooks. _Risk: medium, per-agent and reversible._

**Phase 4 — Retire the parallel mechanisms.**
Once `focus`/`pending_action` are proven, fold `PENDING_IT_EMAIL_DRAFTS` (durable now) and
the sticky-override gates into `ConversationState`. Remove the now-dead heuristics. The LLM
`followup_resolver` stays only as a fallback for cases `focus` can't resolve. _Risk: low by
this point; mostly deletion._

Phases 1-3 are independently valuable — stopping after any one leaves the system better,
not half-migrated.

---

## 6. What to KEEP (explicitly not rewriting)

- **The tiered routing idea** — exact → keyword → semantic → LLM is sound; we're
  re-housing it, not replacing it.
- **`SemanticRouterService`** (pgvector k-NN, closed-set, fail-soft) — good component.
- **The 43 keyword patterns** — they encode real precedence knowledge; they become
  registered, testable data, not deleted.
- **The resilience layer** (`llm_resilience`, circuit breaker, fallback tiers) — solid.
- **Checkpointer + Postgres summary** durability model — keep.
- **Execute-first / zero-LLM fast-paths** — keep as pipeline pre-hooks; they're a real
  latency win on the local 8B model.

---

## 7. Success criteria

- A new domain agent requires **no** new cross-cutting code (context gate, prefetch,
  empty-recovery come free from the pipeline).
- A routing edge case is fixed by **adding a strategy + a test**, not a branch in a
  269-line function.
- Follow-ups resolve from typed `focus` (no LLM) in the common case; the coref LLM is a
  fallback, not the mechanism.
- Internal LLM calls (classifier, resolver, summarizer) **cannot** reach the user stream —
  enforced by the pipeline, not per-node skip-lists.
- `pending_action` survives a restart.

## 8. Risks & non-goals

- **Risk: regressing encoded edge cases.** Mitigation: Phase 0 harness is a hard
  prerequisite; no router relocation merges without it green.
- **Risk: scope creep into a rewrite.** Non-goal: we are _not_ changing the LLM tiers, the
  domains, the tools, or the frontend contract. Only the routing/agent/state _structure_.
- **Non-goal:** replacing LangGraph or the checkpointer.

---

## Appendix A — Phase 0/1 status & harness coverage (2026-06-19)

**Delivered:**

- Phase 0 harness — `backend/tests/test_routing_regression.py` + `routing_cases.py`:
  **33 hand-written cases** seeded from the bug-fix comments, covering the deterministic
  layers (`_try_keyword_route`, `_is_continuation`, `_needs_followup_resolution`,
  `_try_extract_leave_params`) plus Phase-1's `_extract_focus` / `_resolve_anaphora_locally`.
- Real-traffic golden — `backend/tests/test_routing_golden.py` + `routing_golden.json`
  (generated by `gen_routing_golden.py` from `ai_request_logs`): **291 distinct real
  messages**, snapshotting current keyword-layer behavior (140 matched, 151 deferred).
  Offline, asserts no routing drift — the gate for the Phase-2 Resolver extraction.
- Phase 1 — typed `Focus` + `state_tracker` post-node + zero-LLM coref in
  `followup_resolver` (see §4.1). Additive, harness-green.

**Real-traffic findings (NOT asserted — Phase-2 review candidates).** The golden generator
flagged **36 messages** where the keyword layer disagrees with the domain the live pipeline
actually served. Most are _legitimate_ (a different tier — form-library, sticky, cache —
won), but several are genuine precedence questions the Resolver should settle explicitly:

- policy phrasings split across domains: _"what is parent health insurance policy"_
  (keyword→hr, served→general), _"How to obtain Form 16"_ (keyword→admin, served→hr).
- _"When is the salary credit date?"_ / _"update my bank account details"_ (keyword→general,
  served→hr).
- _"Can I cancel an approved leave request?"_ (keyword→hr, served→deeplink).
- form-builder vs form-library tension: _"i want to create form"_, _"Parking Request"_
  (keyword→form_builder/admin, served→dynamic_form).

These are exactly the ambiguities that today are resolved by fragile layer-ordering; in the
Phase-2 Resolver each becomes a named strategy with explicit precedence + a test.

## Appendix B — Testing architecture (decided 2026-06-19)

Four tiers, distinct purposes. The load-bearing rule: **everything that asserts
correctness is human-labeled; logs only change a case's _source_, never its authority.**

| Tier                                                          | Purpose                                  | Source                                      | Authority                                                         |
| ------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| **Curated cases**                                             | business correctness                     | human-written + log-discovered-then-labeled | **source of truth**                                               |
| **Known-gap cases**                                           | prove the suite checks correctness       | real bugs found in logs                     | assert the _correct_ answer; fail today (xfail); alarm when fixed |
| **Characterization snapshot** (`routing_golden.json`)         | behaviour-preservation during a refactor | logs                                        | **NOT truth — scaffold only**, retire after Phase 2               |
| **Discovery** (`gen_routing_golden.py`, feedback/escalations) | find new phrasings                       | logs / 👎 / escalations                     | candidates for **human** review, never auto-truth                 |

Rulings:

- **Curated is the authority.** Routing is a business rule; a curated case catches
  "visitor pass → software_install" immediately. (`routing_cases.py`: 33 seeded +
  27 real-curated.)
- **The snapshot is a refactor instrument, not a tier.** It expects "whatever the code
  did," bugs included — fine for proving Phase-2 changed nothing, dangerous as standing
  truth. Relabeled in-file; retire after Phase 2. (291 real messages.)
- **Known-gap cases keep the suite honest** — they assert the _correct_ route for inputs
  the code gets wrong now (Form 16 / bank details / tax certificate → HR), fail today by
  design, and the runner ALARMS (xpass) if one starts passing so it gets promoted.
- **Routing eval allows ambiguity** — a case may accept a _set_ of domains (classification,
  not exact-match-forever).
- **Human is the promotion gate** — the `source` field names who should confirm (e.g.
  "CONFIRM: HR owner"); the AI proposes, a human approves.
- **Discovery uses feedback too**, not just log volume — `ChatFeedback` 👎 and
  escalations are the highest-signal radar and already exist in the schema.

Harness today: **62 curated/derived checks green + 3 known-gaps (expected-fail) + 291
snapshot**. Curated/known-gap are the durable assets; the snapshot is temporary.

## 9. Recommended first step

Phase 0 only: build the routing eval harness from the existing bug-fix comments and
request logs. It's low-risk, immediately useful (catches regressions today), and is the
gate that makes the rest safe. Decide on Phases 1-4 after seeing the harness green on
current behavior.
