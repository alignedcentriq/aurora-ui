---
name: proactive-nudge-layer
description: Proactive/push nudge layer (v1) — in-app feed, deterministic detectors, Teams push gated OFF
metadata:
  type: project
---

Built 2026-06-21: a proactive/push layer that makes Centriq initiate, not just react.
Deterministic (zero LLM) — detectors are pure DB look-ups; messages are templated.

- Backend: `ProactiveNudge` model; `nudge_service.py` (detectors + feed + one-click `act`);
  scanned by `proactive_nudge_scheduler` in `main.py` startup every `NUDGE_SCAN_INTERVAL_MIN`
  (30). Endpoints: `GET/POST /api/nudges*`. Dedup via unique `dedup_key` (dismissals stick).
- v1 detectors: `leave_expiring` (non-carry-forward balance near `FISCAL_YEAR_END`, default
  03-31 = Indian financial year-end; LeaveBalance is calendar-year-bucketed but the 45-day
  window before 31 Mar lands in the same calendar year so the lookup lines up), within
  `LEAVE_EXPIRY_WINDOW_DAYS`=45 — so it only fires in Feb–Mar) and
  `approval_stale` (Leave Pending > `STALE_APPROVAL_DAYS`=3 → one-click "nudge manager"
  re-sends approval email with 24h cooldown).
- Actions reuse existing infra: `zoho_leave_links.apply_url()` (apply) and
  `send_leave_approval_request()` (nudge). No schema fiscal-year concept existed — defined in config.
- Frontend: self-contained `ProactiveNudgeFeed.tsx` (bell + badge + popover, polls 60s),
  wired into the `_layout.tsx` header. No separate Zustand store (matches AnnouncementBanner).

**Constraint:** `NUDGE_PUSH_ENABLED` (best-effort Teams/email push of new nudges) is OFF by
default. In-app feed is the source of truth and works regardless. Do NOT enable push or change
the scan cadence on the shared runtime without explicit approval — see [[live-config-needs-approval]]
and [[teams-notification-model]] (Teams path is inert until Azure setup). Part of [[centriq-replatform-status]].
