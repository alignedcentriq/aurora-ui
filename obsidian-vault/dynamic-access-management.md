---
name: dynamic-access-management
description: Dynamic RBAC — AppRole/RoleCapabilityMap DB models, per-user extra_capabilities, 47-capability catalogue (portals+modes+features), full Access Management UI redesign; built 2026-06-28
metadata:
  type: project
---

Dynamic access management system built 2026-06-28, replacing the hardcoded ROLE_SCOPES dict.

**Why:** Super Admin needed to create custom roles and manage every access dimension (portals, focus modes, features) per role and per user.

**How to apply:** When touching auth/access code, use the new DB-backed system; when extending capabilities (e.g. new portal), add to CAPABILITY_CATALOGUE in access_routes.py + seed DEFAULT_ROLE_CAPABILITIES.

## Key changes

### Backend models (`backend/app/models.py`)
- `AppRole` — slug PK, name, color, is_system, created_by
- `RoleCapabilityMap` — (role_slug, capability_key) pairs; replaces hardcoded ROLE_SCOPES
- `UserRoleOverride.extra_capabilities` — JSON field for additive user-level capability grants (beyond role)

### Backend routes (`backend/app/routes/access_routes.py`)
- `CAPABILITY_CATALOGUE` — 47 entries across portal / mode / feature categories (replaces old SCOPE_CATALOGUE)
- `DEFAULT_ROLE_CAPABILITIES` — seed data mapping each system role to its default cap keys
- `seed_system_roles(db)` — idempotent startup seed; called from main.py lifespan
- New endpoints:
  - `GET /api/access/capabilities` — full catalogue (category filter supported)
  - `GET /api/access/roles` — all roles with capability lists
  - `POST /api/access/roles` — create custom role
  - `PUT /api/access/roles/{slug}` — update name/description/color/capabilities
  - `DELETE /api/access/roles/{slug}` — delete custom roles only
  - `GET /api/access/users`, `PUT /api/access/users/{email}` — now accept extra_capabilities
- `/api/access/scopes` kept for backward compat

### Frontend (`src/pages/AccessManagement.tsx`)
Two-panel layout: left sidebar (Roles/Users tab) + main area.
- **Roles panel**: system roles + custom roles list, "New Role" button → create dialog, click role → capability matrix
- **Capability matrix**: Portals (grid checkboxes) | Focus Modes (grid) | Features (accordion with action pills)
- **Users panel**: search sidebar → click user → role assignment + scope restrictions + individual extra capability grants
- **Create Role dialog**: name, slug, description, colour picker from palette

### Enforcement model
- Role-based API guards (require_hr, require_it etc.) unchanged — still protect backend routes
- Capability system is **UI-level access control** (show/hide portals/modes/features)
- `extra_capabilities` = additive individual grants; `scopes` = restrictive subset of role features
- `/api/access/me` now returns `role_capabilities` + `extra_capabilities` for frontend bootstrapping
