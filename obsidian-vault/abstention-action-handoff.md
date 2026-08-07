---
name: abstention-action-handoff
description: Knowledge-miss abstain path now offers to raise a ticket/HR query (item 3); built 2026-06-21
metadata:
  type: project
---

Item 3 of the "next asks" roadmap, built 2026-06-21. When a domain agent genuinely abstains (the policy semantic-veto fires — `RETRIEVAL_VETO_SENTINEL`), instead of a dead-end "not found" it offers a quick-choice action handoff: convert the knowledge miss into a raised ticket. Measurable as deflection-rate lift.

Built on the existing groundedness gate in agent.py:
- `_abstention_handoff_card()` complements `_reroute_card_on_empty_retrieval()` — callers try the reroute (offer other knowledge areas, fires on low route confidence) FIRST, then fall back to the handoff. Wired at the HR summarizer, admin, and IT agent nodes.
- Mapping (`_ABSTENTION_HANDOFF`): hr → HR query, admin → HR query (admin policy misses are HR-adjacent), it_support → IT ticket.
- Loop-proof by design: the card's button value routes via deterministic `_try_keyword_route` overrides (`_KW_HANDOFF_HR`/`_KW_HANDOFF_IT`) to sub_intents `hr_query_handoff` / `it_ticket_handoff`, which create the ticket DIRECTLY (HRService.submit_hr_query / ITService.create_ticket) — never re-running the search that just abstained. Tested in tests/test_abstention_handoff.py (incl. the round-trip).

Remaining roadmap asks (held): manager morning digest (blocked — leave/expense live in Zoho People/Expense, which is per-user READ-only + demo-mode, no approvals API/write scope; see chat), item 6 action receipts + undo, item 8 feedback triage UI, item 9 personal/team analytics. Relates to [[proactive-nudge-layer]] and [[centriq-replatform-status]].
