---
name: analytics-chat-mode
description: Analytics Builder chat mode now backend-authoritative — charts render inline in chat; reportee attendance pie
metadata:
  type: project
---

Built 2026-06-27. Made the chat's Analytics Builder mode (`/analytics`) actually drive backend routing instead of being a cosmetic prompt hint.

**Routing:** `_active_mode_strategy` on `ROUTER_RESOLVER` (agent.py) — when `active_mode=="analytics"`, routes every turn to `domain="analytics"` → `analytics_agent_node` → `analytics_builder_service.builder_chat`. Registered after the pending-action/clarify confirm strategies, before keyword/semantic. **Sticky until `/exit`** (slash commands are intercepted frontend-side in AssistantView, never hit backend). To keep it sticky, pre-graph short-circuits in main.py (`who is X`, semantic answer-cache lookup) are bypassed when `request.active_mode` is set.

**Chart in chat:** node emits ChartSpec inside `[CHART_START]…[CHART_END]`; `_postprocess` (main.py) extracts → `interactive {type:"chart", data: ChartSpec}`; frontend renders by reusing `ChartCanvas` (added one branch in AssistantView + `"chart"` to chat-store InteractivePayload). Non-streaming block (builder returns full JSON, not tokens).

**reportee_attendance_split** builder template: resolves logged-in `user_email` → `attendance_service.team_report` (own reporting tree, manager-gated) → pie of On-time/Late/Half-day/Absent. `late` is a subset of `present` so On-time = present − late (mutually exclusive slices). `user_email` now threaded through `builder_chat`/`_run_query` and the `/builder/chat` endpoint.

**Late rule:** check-in after **13:00** = Late. New config `ATTENDANCE_LATE_CUTOFF` (default "13:00") drives `attendance_service.LATE_THRESHOLD` globally (was hardcoded 09:30) — affects ALL attendance features, not just the pie. Half-day takes precedence over Late.

Related: [[personal-team-analytics]], [[analytics-roi-feature]]. Other chat modes (training/docs/project/resource/admin) are still prompt-hint only (`_MODE_HINTS`) — same pattern can extend them.
