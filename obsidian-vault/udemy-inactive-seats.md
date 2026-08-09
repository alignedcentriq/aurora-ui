---
name: udemy-inactive-seats
description: Udemy "Inactive Seats" tab — read-only idle-learner list + deep-link to Udemy admin for manual deactivation (no auto-revoke)
metadata:
  type: project
---

Udemy Business seat-hygiene feature, built 2026-06-29. PMO/HR sees learners idle
past a threshold and clicks through to Udemy admin to deactivate the seat
**manually** — deliberately NOT auto-revoke.

**Why no auto-revoke:** the live Udemy credential is the read-only Reporting API
(no deprovision endpoint); the real seat deactivation lives in Udemy admin /
Entra SCIM, which isn't set up (same Azure gap as [[teams-notification-model]] /
[[techelevate-portal]]). User explicitly chose navigate-and-deactivate-manually
over auto-revoke after weighing it.

**How it works:**
- `get_inactive_users(min_idle_days, include_deactivated=False)` in
  `udemy_business_service.py` — paginates the `user-activity` report (~859
  learners), idle days = today − `last_date_visit` (or − `user_joined_date` if
  never visited), skips `user_is_deactivated`. Joins `/users/list/` for numeric
  id + role + groups (see below). Both pulls cached 1h (`_activity_cache`,
  `_user_dir_map`); idle recomputed per request so threshold changes need no refetch.
- `GET /api/portal/udemy/analytics/inactive-users?days=N` (default
  `UDEMY_INACTIVE_DEFAULT_DAYS`=30), gated to `_REPORT_ROLES` (hr/pmo/admin).
- "Inactive Seats" tab in `UdemyBusinessPortal.tsx` (report roles only): 30/60/90/180
  presets; columns Learner/Role/Groups/Last active/Idle/Activity + "Open in Udemy".
  Each row deep-links **straight to the learner's detail page** (has the Deactivate
  control), falling back to the list page if id unknown.

**Seat-utilisation pills** (top of Inactive Seats tab): Purchased / Used / Available /
Utilised% / Idle≥Nd. The Reporting API **cannot reproduce Udemy's live seat count** —
org/subscription endpoints 403/404, invitations 403 (pending invites consume a seat but
are unreadable), `users/list` ignores deactivation filters, and the activity report's
active count (≈225) ≠ billing. So the ledger is **PMO-managed**, not API-derived:
- `purchased` + `available` are read off the Udemy admin dashboard and saved by PMO.
- `used` = purchased − available (so pills MATCH Udemy, incl. pending invites).
- `Idle≥Nd` pill = reclaimable count (our computed value-add).
Store: `get_license_config()`/`set_license_config()` persist to
`backend/app/data/udemy_license_config.json` (disk, survives restart); env
`UDEMY_LICENSE_TOTAL`/`UDEMY_LICENSE_AVAILABLE` (230/1) are only the initial seed.
The **inactivity threshold default is also PMO-managed** (same store, key `inactive_days`,
seed env `UDEMY_INACTIVE_DEFAULT_DAYS`=30): `get_inactive_default_days()` →
inactive-users route + `udemy_inactive_seats` chat tool (days=None) + UI tab initial
threshold all read it. Manage form has a 3rd field "Inactive threshold (days)"; saving it
re-points the list (SeatPills `onDefaultDays` → tab `days`). NOT hardcoded anywhere —
30/60/90/180 are just quick-pick presets over the configurable default.
`GET …/analytics/license-summary` (report roles) + `PUT …/analytics/license-config`
(pmo/admin/super admin) wired; UI "Manage" button → inline purchased/available form.
Current real numbers: 230 purchased / 1 available / 229 used / 99.6% — basically maxed,
which is exactly why idle-seat reclaim matters.

**Course Insights tab** (built 2026-06-29): `get_course_insights()` +
`GET …/analytics/course-insights` (report roles) + "Insights" tab. Totals (learners
engaged, enrollments, completions, completion-rate, hours, courses-in-use), most-enrolled
courses, category mix, low-engagement courses (enrolled≥5 & avg<10%). Computed in the
SAME cached pagination pass as `get_org_stats` (extended `_build_org_stats` → also writes
`_insights_cache`; no extra API load). user-course-activity = ~15k rows/152 pages →
full pull is slow (~minutes), cached 1h. Field handling: `completion_ratio` is 0..1 here
(×100), completion via `course_completion_date`, `course_category` (sometimes comma-joined
multi-cat), `num_video_consumed_minutes`, `user_email`.

**Assign-courses-to-groups = BLOCKED (probed 2026-06-29):** `/assignments/`,
`/users/assignments/`, `/groups/`, `/groups/list/` all **403** (no permission);
`/course-assignments/`, `/learning-paths/` 404. Our catalog/reporting credential is
read-only for management. Group course-assignment would need either an elevated Udemy
API key OR SCIM group membership + Udemy admin auto-assign rules. NOT built.

**Copilot chat tools — BUILT 2026-06-29:** the Udemy portal sidebar chat (PMO domain)
now exposes 6 new tools in `pmo_agent.py` (added to `pmo_tools`, `_PASSTHROUGH_TOOLS`, and
`tool_registry` as passthrough; PMO_SYSTEM_PROMPT rule 13; router.py pmo description
extended so seat-admin NL routes to PMO): `udemy_inactive_seats(days)`,
`udemy_seat_utilization`, `udemy_course_insights` (read, gated to hr/pmo/admin), and
`deactivate_udemy_user`/`reactivate_udemy_user`/`provision_udemy_user` (SCIM writes, gated
to pmo/admin/super-admin). Role comes from `user_role` (added to PMOState; main graph already
passes it into pmo_agent_node). Verified: employee→"restricted", pmo→runs (writes say
"SCIM not connected" while dormant), reads return live data. Avoid the `≥` glyph in tool
strings (Windows cp1252 console/log crash) — use `>=`/`+`.

**SCIM provisioning — BUILT (dormant) 2026-06-29:** full SCIM 2.0 client in
`backend/app/services/udemy_scim_service.py` + 14 routes under `/api/portal/udemy/scim/*`
(pmo/admin/super-admin via `_SCIM_ROLES`). Covers Udemy's whole SCIM list: provision,
deactivate (deprovision), reactivate, update user (name/email), create/rename/delete group,
add/remove/move group members, add-to-license-pool, assign-pro-license (pools modelled as
SCIM groups). SEPARATE Udemy app from the catalog/reporting Basic-auth cred — its own
`UDEMY_SCIM_BASE_URL` + `UDEMY_SCIM_TOKEN` (+ `UDEMY_SCIM_ENABLED`) in config; Azure AD is
the IdP (user handles provisioning + token). DORMANT until both set: `configured()` False →
every op short-circuits `{ok:False, error:"not_configured"}` (all 14 verified), `_request`
never raises. UI: Inactive Seats rows show a red **Deactivate** button (inline 2-step
confirm → POST /scim/users/deactivate) ONLY when status.scim_configured && can_provision;
else the manual "Open in Udemy" link stays. Portal /status now returns scim_configured +
can_provision (no network probe); GET /scim/status does a live reachability probe.
License-pool/Pro ops assume Udemy models a pool as a SCIM Group (swap to a custom extension
attr if the live tenant differs). Not yet runtime-verified against a real SCIM endpoint.

**Admin deep-link (confirmed by user 2026-06-29):** list page =
`{portal}/organization-manage-v2/users/` (search + three-dots→Deactivate);
per-user detail = `{…/users/}detail/{user_id}/`. `UDEMY_ADMIN_USERS_URL` config
holds the list base (must end with `/`); env-overridable.

**Useful field facts (verified live):**
- `analytics/user-activity` rows: `user_email`, `user_name`/`user_surname`,
  `user_role`, `user_joined_date`, `user_is_deactivated`, `last_date_visit`
  (YYYY-MM-DD), `num_video_consumed_minutes`, `num_completed_courses`. NO numeric id.
- `users/list/` (`/organizations/{org}/users/list/`): `id`, `email`, `role`
  (student=Member / admin / group_admin), `groups` (e.g. ["PMO"],["HR"]). This is
  the source for per-user id + group membership. (`/users/` without `/list/` → 403.)
- `user-course-activity` also has numeric `user_id`/`lms_user_id`.
- `analytics/user-progress` 404s for this org (existing `get_user_progress` is dead).

Needs a backend restart to serve the new route (shared no-reload runtime). NOT
yet exposed as a chat tool or nudge — UI-only for now.
