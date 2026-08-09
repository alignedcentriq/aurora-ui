---
name: adoption-mechanics
description: Capability discovery — role-aware greeting/starters, live signals, and failed-query 'nearest 3' rescue, all from a shared capability registry
metadata:
  type: project
---

Built 2026-06-23. Cold-start / discovery layer so the assistant onboards every user and turns dead ends into discovery.

**Shared spine:** `backend/app/services/capability_registry.py` — the ONE curated catalog of user-facing capabilities (`Capability`: key, title, description, category, examples, domain, `usage`=(domain,sub_intent) pairs w/ `*` wildcard for analytics, roles). NOTE: analytics mapping field is `usage` (calibrated against real logs) — NOT `sub_intents` (renamed during [[feature-adoption-analytics]] tuning). Consumed by all three of: discovery, rescue, AND adoption analytics (the denominator — its `domain`/`sub_intents` map to `AiRequestLog` usage). Functions: `all_capabilities()`, `capabilities_for_role(role)` (admin sees all; roles=None = everyone), `nearest_capabilities(query, role, domain, limit)` (deterministic token-overlap, no embeddings, pads to N).

**Wired:**
- Role-aware greeting: `agent.py _greeting_response` now leads with the role's top capabilities + a live "N things need your attention" line from `nudge_service.count_unread` (was a static menu).
- Failed-query rescue: `agent.py _abstention_handoff_card` appends the nearest-3 role-aware capabilities as tap-to-run quick-choice options alongside "raise a ticket". (Loop-proof routing still passes — test_abstention_handoff green.)
- `GET /api/capabilities` (main.py, `get_current_user`): role-aware, returns capabilities grouped by category + flat `starters` (first 6) + `live` (top nudges).
- Frontend `AssistantView.tsx` empty state: fetches `/api/capabilities`, renders role-aware `starters` (replacing the local rotating quick-queries when present) + amber pulsing `live` signal chips; fail-soft fallback to local `useQuickQueries`.

Tests: `backend/tests/test_capability_registry.py`. Related: [[abstention-action-handoff]], [[proactive-nudge-layer]], [[access-aware-answers]]. Phase 3 (undiscovered-features analytics) reuses this registry as the denominator.
