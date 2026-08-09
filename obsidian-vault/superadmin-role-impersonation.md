---
name: superadmin-role-impersonation
description: "Only shivam.sharma@alignedautomation.com can test-impersonate roles, even for other Super Admins (non-destructive overlay via x-impersonate-role header); built 2026-06-29, restricted 2026-07-02"
metadata: 
  node_type: memory
  type: project
  originSessionId: fd1542c0-33d9-4afe-87c6-46a4190941d2
---

Role test-impersonation (employee/hr/it/pmo/functional manager/admin) exists so the app
can be tested as any role. Built 2026-06-29.

**Restricted to one person, not the role.** As of 2026-07-02, the capability is pinned to
`shivam.sharma@alignedautomation.com` specifically — other accounts granted "super admin"
via a DB `UserRoleOverride` can act as Super Admin but can NEVER switch roles.
**Why:** explicit user instruction — role-switching must never be available to other
super admins, only this one account.
**How to apply:** `settings.ROLE_SWITCH_ALLOWED_EMAIL` (backend/app/config.py, defaults to
that email) gates the overlay in `get_current_user` ([backend/app/auth.py]) — the overlay
applies only when `real_role == "super admin" AND email == ROLE_SWITCH_ALLOWED_EMAIL`.
`src/components/RoleSwitcher.tsx` mirrors this client-side (hides the UI for any other
Super Admin) but the backend check is the real gate — do not rely on the frontend hide
alone if extending this. If a second person ever needs this, extend to a list/DB flag,
not a role check.

**Non-destructive overlay — the real grant is never touched.** The Super Admin's
`UserRoleOverride` row is only READ; impersonation rides on a separate
`x-impersonate-role` request header. `get_current_user` ([backend/app/auth.py]) resolves
the REAL role first (DB override > header), then applies the overlay ONLY when the real
role is `super admin` AND the email matches (so it can never escalate — a regular user
sending the header is ignored, and other super admins are ignored too). `CurrentUser`
gained `real_role` + `is_impersonating`; `role` is the effective (impersonated) role so
every existing role gate behaves as the tested role.

**Plumbing:**
- Frontend: `src/lib/impersonation.ts` patches `window.fetch` once to attach
  `x-impersonate-role` (from localStorage `centriq-impersonate-role`) to same-origin `/api`
  calls — so no component needs changing. Imported by `auth-store.tsx`.
- `/api/access/me` now returns `real_role` + `impersonating`; auth-store sets
  `user.realRole` (effective role stays `user.role`).
- `src/components/RoleSwitcher.tsx` in the header profile dropdown
  ([src/routes/_layout.tsx]) — visible only when `user.realRole === "Super Admin"` (stays
  visible while impersonating so you can exit). Selecting a role sets localStorage +
  `window.location.reload()`; "Super Admin (you)" clears it.

Verified: full app import OK, frontend typecheck clean, `is_impersonating` logic correct.
Needs the shared backend restart + frontend rebuild to go live. Related: the role system
is [[dynamic-access-management]] (AppRole/RoleCapabilityMap) and the [[allowed-emails-gate]].
