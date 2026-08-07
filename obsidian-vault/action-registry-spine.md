---
name: action-registry-spine
description: Action Registry — the shared write-side spine under planned bundles + automation hub; first slice (it_ticket, hr_query) built 2026-06-23
metadata:
  type: project
---

The **Action Registry** is the shared write-side execution spine — the write-side mirror of
the routing Resolver. Every state-changing action flows through one `dispatch(spec, ctx)`
pipeline: authorize → idempotency → dedupe → execute → emit-receipt. Handlers (`ActionSpec.execute`)
do ONLY the side effect; the registry owns the safety choreography that was previously
hand-copied into each service.

Design doc: `docs/action-registry-design.md`. Code: `backend/app/services/actions/`
(`registry.py` + `catalog/*.py`, one module per action, registered on import). First slice
built 2026-06-23: `it_ticket` + `hr_query`, wrapping existing services via extracted
`_create_ticket_core` / `_submit_hr_query_core` (public methods kept as behaviour-preserving
shims so existing callers + [[action-receipts-undo]] tests are untouched). Tested in
`backend/tests/test_action_registry.py` (16 checks green).

**Why:** it's the hinge under the two strategic "crown jewel" features — cross-domain bundles
and the no-code Automation Hub. Both are "compose typed, role-gated, receipted actions";
building the registry once means neither builds its own action layer. The agreed sequence is
**explainability → action registry → (forks into bundles + automation hub)**.

**How to apply:** add a new action = new `catalog/<key>.py` calling `register(ActionSpec(...))`;
`key` MUST match existing action_type strings so receipts/[[abstention-action-handoff]]/undo
line up. Authorize is per-action at dispatch, never inherited from a bundle/rule. Undo stays
in `receipt_service._UNDO_HANDLERS` (one authority). Migrate more actions strangler-style
(receipt emit is idempotent, so a brief dual-emit window is safe).

**Chat path cut over 2026-06-23** (option B): the 6 conversational sites for these two actions
now call `actions.run("it_ticket"/"hr_query", actor_email=…, **params).human_message` — the
`create_it_ticket`/`submit_hr_query` @tools in [[agent.py]], it_agent.py, hr_agent.py, plus the
hardware-issue and abstention-handoff deterministic paths. `run()` builds+validates params via
`ActionSpec.params_model` then dispatches; `ActionResult.summary` keeps the receipt-feed text as
the short "IT ticket: {subject}" form. The service shims (`create_ticket`/`submit_hr_query`) are
RETAINED — still used by the REST `skill_*_routes` (not yet migrated) and the receipts test.
Behaviour change to note: empty required params now reject (invalid_params) instead of creating
a junk row; the deterministic paths pass fallbacks so they never trip it.
