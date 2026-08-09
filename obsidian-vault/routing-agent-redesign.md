---
name: routing-agent-redesign
description: Routing/agent/state consolidation plan + Phase 0 regression harness (started 2026-06-19)
metadata:
  type: project
---

Effort to de-accrete the conversational brain (intent_router ~14 layers + 43 keyword
regexes + 3 routing mechanisms; per-agent copy-pasted cross-cutting concerns; no
first-class conversation state). Triggered after a string of tactical fixes
(NO_CONTEXT stream leak, HR-only context gate, "show their allocation" mis-route).

**Definitive target architecture** decided 2026-06-19: `docs/target-architecture.md` — the
whole-app blueprint (channel/orchestration/services/cross-cutting layers). Key call:
ACTIONS are the irreversible layer, so priority order = action-safety BEFORE the routing
Resolver refactor. Roadmap: 0 harness ✅ → 1 ConversationState.focus ✅ → 2 action-safety
layer (NEXT: durable confirm→execute + idempotency, replaces in-memory PENDING_IT_EMAIL_
DRAFTS) → 3 Resolver strategies → 4 shared agent pipeline → 5 RAG groundedness gate → 6
online eval from ChatFeedback/escalations → 7 retire snapshot. Strangler, harness-gated.

Routing plan doc: `docs/architecture-redesign.md` (repo root `docs/`). Target = 3
abstractions: (A) typed ConversationState w/ `focus` for coref, (B) one Resolver = ordered
named strategies replacing the 14 branches, (C) shared agent pipeline (pre/post hooks) so
context-gate/prefetch/empty-recovery/hygiene exist once. Strangler migration, harness-gated.

**Phase 0 DONE (2026-06-19)**: routing regression harness, 26 cases, all green on current
code. Files: `backend/tests/routing_cases.py` (data, seeded from bug-fix comments in
agent.py) + `backend/tests/test_routing_regression.py` (runner). Covers deterministic
layers only (keyword route, _is_continuation, _needs_followup_resolution,
_try_extract_leave_params) — no DB/LLM/embeddings. Run: `venv/Scripts/python.exe -m
tests.test_routing_regression`. pytest NOT installed in venv; repo convention is the
direct `python -m tests.test_*` runner (see test_semantic_router.py).

**Phase 1 DONE (2026-06-19)**: typed `Focus` + `focus` field on AgentState (persists via
checkpointer). New `state_tracker` post-node records subject (kind people/projects/generic +
named entities parsed from the answer's list lines) — wired into ALL substantive answer
paths (summarizer, pmo/admin/it/manager/ms365/doc/connector/deeplink, + should_continue_hr/
general now return "state_tracker"). `followup_resolver` upgraded: resolves anaphora LOCALLY
from focus (zero LLM) when fresh (≤1 turn old) + has entities, else falls back to the LLM
rewrite. Helpers `_extract_focus`, `_resolve_anaphora_locally` covered by harness (now 33
cases, green). state_tracker added to main.py _SKIP_STREAMING_NODES. Verified 2-turn sim:
people list → focus → "show their allocation" resolves with names, no LLM.

**Harness grown from real traffic (2026-06-19)**: `tests/gen_routing_golden.py` snapshots
_try_keyword_route over real ai_request_logs messages → `tests/routing_golden.json` (291
distinct msgs; 140 matched, 151 deferred). `tests/test_routing_golden.py` asserts no drift,
offline. Generator flagged 36 keyword-vs-served disagreements = Phase-2 review candidates
(documented in design doc Appendix A): policy-domain splits, "salary credit date"→hr,
"cancel approved leave"→deeplink, form-builder vs form-library. Total harness = 33
hand-written + 291 golden, all green.

**Testing architecture decided (2026-06-19, design doc Appendix B)**: 4 tiers — Curated =
source of truth (human-labeled; routing_cases.py, 33 seeded + 27 real-curated); Known-gap
cases = assert CORRECT answer for real bugs (Form16/bank-details/tax-cert → HR), fail today
by design, runner ALARMS on xpass to force promotion; Characterization snapshot
(routing_golden.json, 291 msgs) = NOT truth, a Phase-2 behavior-preservation SCAFFOLD to
retire after Phase 2 (relabeled in test_routing_golden.py header); Discovery = logs +
ChatFeedback 👎/escalations → candidates for HUMAN review (gate = the user/domain owner, not
the AI). Case schema now allows expect_domain as a set (ambiguity). Rule: logs change a
case's source, never its authority. Harness = 62 green + 3 known-gaps + 291 snapshot.
Runner forces UTF-8 stdout (Windows cp1252 crash fixed).

**Phase 2 (action-safety) STARTED 2026-06-19.** Audit: `docs/action-safety-audit.md` (~40
write ops; key risks = soft/docstring confirms, in-memory draft lost on restart, zoho leave
fast-path fires with ZERO confirm, no idempotency anywhere, broadcast blast radius). Build
order in audit §5. **Steps 1-2 DONE**: new `PendingAction` model (table `pending_actions`,
auto-created via create_all) + `app/services/pending_action_service.py`
(create/get_pending/has_pending/confirm/cancel; confirm() flips pending→executed = the
idempotency guard; create() supersedes same-type pending; TTL expiry). Migrated the IT
software-install email-draft flow OFF the in-memory PENDING_IT_EMAIL_DRAFTS dict (REMOVED)
onto the durable store — intent_router gate now only hits DB on yes/no msgs; it_agent_node
confirm/cancel/create use the service. Zero behavior change, fixes restart-loss bug.
Integration test `tests/test_pending_action_service.py` (9 checks, real Postgres, green).
Routing harness still 62 green. Step 3 resolved differently per product decision (2026-06-19): **leave application is now a
pure Zoho-form handoff — NOT an internal action.** The assistant no longer creates Leave
records / sends manager emails / auto-submits for applying. apply_leave tool + submit_zoho_leave
+ zoho_leave_fastpath all now return the Zoho apply-leave deep-link + echoed dates/type (no
prefill — Zoho form takes no params, no headless browser). New `app/services/zoho_leave_links.py`
(apply_url/record_url/tracker_url). HRService.apply_leave still exists (used by skill_hr_routes.py
HTTP API — left alone, flag if "one way" must cover it). Routing harness 62 green.
**CANCEL (pending, user wants it)**: flow = list user's UPCOMING leaves → user selects → deep-link
to that leave's Zoho view-record page (ZOHO_PEOPLE_URL#leavetracker/mydata/view-recordId:<id>)
where Zoho's Cancel button is. Needs a NEW Zoho leave-RECORDS fetch (recordId per leave) — not yet
implemented; zoho_people_service has no leave-records fn (only timesheet/attendance/appraisal/
training). Zoho OAuth + API v2 DO work (leave_balance_sync hits /people/api/v2/leavetracker/
reports/bookedAndBalance). Records endpoint unverifiable without a live token — implement fail-soft
+ user verifies. **Step 5 (idempotency) PARTLY DONE 2026-06-19**: new `app/services/idempotency.py`
(find_recent_duplicate — exact-field match within a 120s window, conservative). Guards added
to 5 unguarded writes: IT create_ticket, reimbursement, facility complaint, food complaint,
accommodation (check before db.add → return existing, no duplicate). Offline test
`tests/test_idempotency.py` (real DB, green). **ALL 8 WRITES GUARDED (DONE 2026-06-21)**: added
submit_travel_request (employee_id+from+to+travel_date+status pending_rm) & submit_expense_claim
(travel_request_id+employee_id+amount+status Pending) via find_recent_duplicate; book_extension
deduped differently (HTTP-only lib API, no shared DB) by scanning list_my_extensions for a Pending
ext on same ticket_id. Phase 2 idempotency COMPLETE. **Step 4 (MS365 sends + announcement broadcast confirm
gate) NOT done** — deferred: it's an LLM-tool-flow change needing live Graph verification; best
built as the declarative gate in Phase 4 rather than bespoke+blind. Nothing live-verified yet
(backend not restarted).

**Cross-chat install dedupe (2026-06-21)**: bug — re-asking "install slack" in a NEW chat
re-drafted the email even though it was already sent. Cause: PendingActionService dedupe was
session-scoped (create() supersedes same-type only within session_key; new chat = new
session_id). Fix: new `PendingActionService.find_executed_by_key(idempotency_key,
within_minutes)` (session-INDEPENDENT lookup of an executed action by idempotency_key).
it_agent_node software_install branch now checks it before create() — if a prior executed
`software_install:{email}:{sw}` exists within 7 days (`_SOFTWARE_INSTALL_DEDUPE_MINUTES`),
refuses to re-draft and tells the user it's still in progress (email-only = no resolution
callback, so window is the only signal). Escape hatch: `_KW_IT_RESEND` regex + new router
branch routes "resend the slack request"/"resubmit slack install" → software_install w/ the
named product; `_RESEND_RE` in the branch bypasses the dedupe. Harness now 63 green
(+resend_install case). Not yet live-verified.

**Helpdesk-mail dedupe upgrade (2026-06-21)**: per user, the IT helpdesk (ManageEngine
ServiceDesk) emails the user a "Your request has been logged with request id ##RE-7735##"
acknowledgment (sender display "helpdesk"/helpdesk@alignedautomation.com; body: "created with
id 7735. The title of the request is : <subject>"). This is the AUTHORITATIVE proof a real
ticket exists (cross-session, survives DB reset, carries the real RE-#### id). New
`app/services/helpdesk_mail.py`: `find_logged_request(graph_token, software_name, within_days=7)`
reads inbox via `ms365_service.fetch_my_emails` (delegated graph_token from AgentState),
parses request_id + title, matches title-contains-software, bounded to 7d (only have the
"logged" format, NOT "resolved" — recency bound prevents an old resolved ticket's ack blocking
forever). it_agent_node software_install branch now: resend-bypass → helpdesk_mail check (block
w/ real RE-#### + `PendingActionService.attach_external_ref` saves id to payload) → else
durable-window fallback (MS365 not connected / ack not yet arrived) → else draft. New
`PendingActionService.attach_external_ref(idem_key, request_id)`. Tests: `test_helpdesk_mail.py`
(offline regex, green).

**Full lifecycle status-aware (2026-06-21, user gave all 4 email samples)**: ManageEngine sends
the user 4 mail types per request id (sample RE-7964), all sender "helpdesk": LOGGED ("logged
with request id ##RE-####"; body "created with id N. The title of the request is : <title>"),
ASSIGNED ("...id ##RE-###### has been assigned to <tech>"; body "assigned to technician - <tech>";
NB **no title, id only**), APPROVED ("Request Id ##RE-###### has been Approved"; body "Title :
<title>"), RESOLVED ("...has been Resolved."; body "Title : <title> Description :"). helpdesk_mail
rewritten: `_parse_event` → {request_id,status,title,technician,received}; `find_request_status`
correlates by request id (title from logged/approved/resolved mail; live status = id's latest
mail by received date) → {request_id,status,title,technician,received,is_open}. OPEN =
logged/assigned/approved, CLOSED = resolved/closed. it_agent_node: OPEN → block w/ id+status
label+technician; RESOLVED → fall through and draft (a new request is legitimate — fixes the
"old resolved blocks forever" gap); none → window fallback. within_days=14 bound on which mails
count. Tests cover all 4 formats + id-correlation + resolved-not-open (canned inbox, green).
Harness 63 green. Needs connected MS365 (delegated mail read); not live-verified.

**Phase 3 (Resolver) STARTED 2026-06-21 — strangler, harness-gated.** New
`app/services/resolver.py`: `Decision` dataclass (`.as_route()` → the intent_router dict shape) +
`Resolver` (ordered register()/resolve(); first non-None Decision wins = explicit precedence;
strategies sync OR async; a raising strategy is logged+skipped, never fatal). **Step 1 DONE**:
the 3 deterministic fast-paths that opened intent_router migrated to named strategies in agent.py
(`_clarify_reply_strategy`, `_pending_action_strategy`, `_leave_balance_strategy`) registered on
module-level `ROUTER_RESOLVER` in precedence order; intent_router's ~50 lines of inline blocks
replaced by `_early = await ROUTER_RESOLVER.resolve(last_human, state); if _early: return
_early.as_route()`. Hoisted `_LEAVE_BALANCE_RE` to module level. Tests: `tests/test_resolver.py`
(driver mechanics + 2 pure strategies, green). Routing harness 63 green + golden 291 UNCHANGED
(no drift). **Step 2 DONE (2026-06-21)**: established the POST-REWRITE resolver. Two resolver instances now:
`ROUTER_RESOLVER` (raw msg, pre-rewrite: clarify/pending/leave_balance) and `MAIN_RESOLVER`
(resolved msg, post-sticky). Migrated leave-params fast-path → `_leave_params_strategy` on
MAIN_RESOLVER; inline block at the leave-params position replaced by `_mid = await
MAIN_RESOLVER.resolve(last_human, state)`. test_resolver +leave_params case. Harness 63 + golden
291 unchanged. NOTE on entanglement (discovered reading full body): keyword route is NOT a clean
single slice — it sits at 3 positions (sticky-override precompute, conf>=1.0 fast-exit BEFORE
semantic-high, fallback AFTER form-library) interleaved with exact/semantic. So post-rewrite
layers must migrate into MAIN_RESOLVER IN ORDER as strategies sharing a context (precomputed
keyword_result/exact/decision). **Step 3 DONE (2026-06-21)**: introduced `RouteContext` (resolver.py) — message+state+precomputed
keyword_result/exact/decision, computed once and shared so strategies don't recompute embeddings.
Strategy signature changed `(message,state)` → `(ctx)`; Resolver.resolve now takes a RouteContext;
all strategies + test_resolver refactored. Migrated exact-dictionary layer → `_exact_dict_strategy`
(reads ctx.exact). MAIN_RESOLVER = [leave_params, exact_dict]; the inline `if exact is not None`
block removed (now covered by the same `_mid = await MAIN_RESOLVER.resolve(_ctx)` call, _ctx built
with keyword_result/exact/decision). Harness 63 + golden 291 unchanged. **Step 4 DONE
(2026-06-21)**: migrated keyword(conf==1.0) → `_keyword_high_strategy` (reads ctx.keyword_result)
and semantic-high → `_semantic_high_strategy` (reads ctx.decision); deleted both inline blocks incl.
the dead `if decision is None` recompute (proven dead: past exact_dict return, exact always None ⇒
decision always populated). MAIN_RESOLVER = [leave_params, exact_dict, keyword_high, semantic_high].
**Step 5 DONE (2026-06-21)**: migrated form-library → `_form_library_strategy` (async, reads
ctx.message; FormLibraryService.match in thread, info-no-action threshold, fail-soft) and
keyword(any) → `_keyword_fallback_strategy` (reads ctx.keyword_result). Both inline blocks deleted.
MAIN_RESOLVER = [leave_params, exact_dict, keyword_high, semantic_high, form_library,
keyword_fallback] (6). test_resolver +both. Harness 63 + golden 291 unchanged. **Step 6 DONE — PHASE 3 COMPLETE (2026-06-21)**: migrated the terminal LLM-router fallback →
`_llm_fallback_strategy` (async; ambiguous-tier candidate shortlist from ctx.decision,
classify_intent_async, APIConnectionError→general@0.5, sub-CLARIFY_CONF_THRESHOLD domain_clarify
card via llm_controls.is_domain_enabled + _CLARIFY_DOMAIN_LABELS; always returns). MAIN_RESOLVER =
[leave_params, exact_dict, keyword_high, semantic_high, form_library, keyword_fallback,
llm_fallback] (7). intent_router's entire post-rewrite tail is now ONE call: `_decision = await
MAIN_RESOLVER.resolve(_ctx)` + a general@0.5 safety net (reachable only if a strategy raises & is
skipped). test_resolver covers all 7 incl. LLM-mocked clarify/normal/conn-error paths. Full gate:
resolver + 63 regression + 291 golden (UNCHANGED) + helpdesk_mail all green. **Still inline in
intent_router (intentionally, NOT part of Resolver):** the precompute (keyword_result/exact/decision
for sticky overrides) + the sticky-domain block (it's a gate deciding whether to run the pipeline,
returns "followup" early). NOTE: ROUTER_RESOLVER (raw, pre-rewrite, 3 strategies) + MAIN_RESOLVER
(resolved, post-sticky, 7 strategies) = the two routing phases. Nothing live-verified (offline only).

**Phase 3 fully done.** Next = Phase 4 (shared agent pipeline / Abstraction C):

Phase 4 (shared agent pipeline) still after — note: announcement/broadcast confirm-gate (last
Phase 2 item) lands there as the declarative gate. Earlier compatible changes already landed: context_gate node
(shared, all domains), followup_resolver node, disable_streaming on context classifier.
See [[centriq-replatform-status]].
