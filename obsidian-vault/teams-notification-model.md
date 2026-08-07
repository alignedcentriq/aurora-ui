---
name: teams-notification-model
description: "How Centriq routes notifications — approve/reject to Teams chat, everything else email + Teams Activity feed"
metadata: 
  node_type: memory
  type: project
  originSessionId: 730ea736-3cb8-4eb0-a835-9296f6d5dbe6
---

Notification routing in `backend/app/services/email_service.py` (set 2026-06-18):

- **Approve/reject requests** (leave, travel RM, udemy, desk-key, bookshelf request + extension) → sent to the approver's **Teams chat** with the action links, via `_send_approval_via_teams_or_email()`. Email is sent **only as a fallback** when the chat can't be delivered (approver has no connected MS365 token).
- **Everything else** (decisions, FYI, reminders, admin/PMO notices, attendance report) → **email** (the record) plus a **Teams Activity-feed** ping via `notify_teams_activity()` → `_send_activity_notification()` (Graph `sendActivityNotification`).

**Why:** User wanted the actionable approve/reject only in Teams chat, and other emails to also ring the Teams Activity bell.

**How to apply:** New approval-request emails should call `_send_approval_via_teams_or_email`; new decision/info/reminder emails should add a `notify_teams_activity(...)` after the `_send_html`. Don't re-add fire-and-forget chat (`notify_teams`) to non-approval flows.

**Gotcha — Activity feed is INERT until provisioned.** `TEAMS_ACTIVITY_NOTIFICATIONS_ENABLED` defaults `false`. Turning it on needs: `TeamsActivity.Send` scope consented (added to MICROSOFT_OAUTH_SCOPES default; users must reconnect MS365), the Centriq Teams app installed per user with AAD app id = MICROSOFT_OAUTH_CLIENT_ID, an `activityType` declared in the manifest matching `TEAMS_ACTIVITY_TYPE` (default `centriqNotification`), and tenant admin consent. Until then `_send_activity_notification` is a graceful no-op. See [[live-config-needs-approval]].

Flows deliberately NOT given Teams (portal/Power-Automate-driven): parking reminders, leave handled by portals, IT requests, reimbursement *decisions* (PA webhook), travel *decisions*. See [[removed-features]] (project-update form removed same day).
