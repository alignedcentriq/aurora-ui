---
name: focus-mode-routing
description: focus chat modes (analytics/training/project/resource) now pin backend routing + bypass frontend heuristics
metadata:
  type: project
---

Focus chat modes are now genuinely sticky/focused (built 2026-06-27), not just prompt-hint.

- **Frontend** (`AssistantView.tsx` `send`): when `activeMode` is set, ALL local heuristic interceptors (doc-gen, my-requests, parking, travel, book, edit/create-form, leave, URL/Form library) are wrapped in `if (!activeMode){…}` and skipped. The role-gate security check still runs. Message goes straight to `/api/chat` with `active_mode`. This fixed the bug where "find a React dev" in Resource Finder opened the form editor.
- **Backend** (`agent.py`): `_active_mode_strategy` + new `_MODE_ROUTES` pin each mode to a fixed (domain, sub_intent), short-circuiting the keyword/semantic classifier cascade:
  - analytics → ("analytics","builder")
  - training → ("pmo","training") — falls through PMO smart_dispatcher to the LLM w/ full toolset
  - project → ("pmo","project_iq") — same
  - resource → ("hr","resource_match") — triggers the deterministic `ResourceMatchingService.match()` path in hr_agent_node (zero-LLM)
- `pmo_agent_node` now injects `_get_mode_hint(state)` into feedback_context (it previously didn't), so training-vs-project tool emphasis is nudged.

The two removed modes (admin/docs) are gone from CHAT_MODES + `_MODE_HINTS` (see [[removed-features]]). Related: [[analytics-chat-mode]], [[resource-matching-feature]].
