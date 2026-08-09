---
name: manager-portal-team-capabilities
description: Manager Portal onboarding/VDI tabs now assignable capabilities, not hardcoded FM
metadata:
  type: project
---

Manager Portal (`src/pages/ManagerPortal.tsx`) Onboarding + PMO Requests tabs were hardcoded to Functional Manager / Super Admin (`require_functional_manager`). Made them assignable access capabilities 2026-07-09 so Super Admin can grant to any role/user via Access Management.

Three new **feature** capabilities in `CAPABILITY_CATALOGUE` (`backend/app/routes/access_routes.py`): `team_onboarding` (Onboarding tab: drug/bg/client), `team_vdi_provision` (PMO Requests → Request VDI = user's "onboarding"), `team_vdi_revoke` (PMO Requests → Revoke VDI = user's "offboarding"). **User's vocabulary: onboarding=request VDI, offboarding=revoke VDI.** Seeded to Functional Manager only (user chose no other default roles); Super Admin unrestricted.

Enforcement helper: `access_routes.effective_capabilities(user, db)` / `user_has_capability(user, key, db)` (super admin → all; else role map ∪ extra_capabilities, with DEFAULT fallback when role map unseeded). `manager_routes.py`: `require_team_onboarding`, `require_pmo_requests` (either VDI cap), plus per-request_type check in POST /pmo-requests. New `GET /api/portal/manager/access` returns `{can_onboarding, can_vdi_provision, can_vdi_revoke, can_pmo_requests}`; frontend gates tabs + per-action buttons on these (fail-closed until loaded). FM default seed applied via idempotent startup `seed_system_roles`. Related: [[dynamic-access-management]], [[superadmin-role-impersonation]].
