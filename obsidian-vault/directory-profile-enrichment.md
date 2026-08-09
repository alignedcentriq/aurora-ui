---
name: directory-profile-enrichment
description: Directory profile-card click-throughs for skills/projects + allocation-based project search; backend endpoints + employee_allocations source
metadata: 
  node_type: memory
  type: project
  originSessionId: 4b9e3ea3-d555-4c31-ac11-ab706f3c78a5
---

Employee Directory profile-card enhancements (built 2026-06-29, dev_shivam):

- **Allocation-based project search**: directory now bundles per-person `allocation_projects` + `allocation_clients` (distinct, from `employee_allocations` keyed by `employee_id` == directory `employee_code`, ~1338 people vs only ~209 with Alchemy `projects`). `_attach_allocations()` in employee_routes.py, wired into both zoho + ms365 directory paths. Grid project filter (EmployeeDirectory.tsx) now partial-matches allocations + clients + Alchemy projects.
- **Availability filter (allocation-aware)**: `_attach_allocations` also bundles `allocated_percent` / `availability_percent` / `available` from the LATEST allocation snapshot (sum efforts excl. 'No Allocation'; available = free>0 or on bench). parseDirectoryFilter (AssistantView) parses "available/free/bench/unallocated" → `available:true`; grid filters on `e.available`; teal "Available now" chip + per-card "X% free" badge. Fixes "which React developer is available" only doing a skill filter and ignoring allocation.
- **Skill pill click-through** → `GET /api/employees/skill-detail?name=` → Alchemy `get_skill_details(skill_id)` (resolve_skill_id maps name→id): returns skill description/category/image, counts, and peer list (employees who have it, capped 100 by experience). Popup shows this person's proficiency + "About this skill" + "Others with this skill".
- **Project row click-through** → `GET /api/employees/project-detail?name=` → `employee_allocations` grouped by project_name: client/status/lead/delivery_manager/type + team members (distinct employee, efforts/billability/done). Matches by exact project_name (Alchemy project names may not always match allocation names → "No members found" fallback).
- Peers/members are clickable → open that person's profile via `onOpenPerson(code)` lookup in the loaded `all` roster.
- **Modal scroll fix**: profile + hierarchy popups switched from Radix `ScrollArea` to native `flex-1 min-h-0 overflow-y-auto` (Radix viewport didn't get bounded height in the flex-col/max-h dialog → wasn't scrolling).

Needs backend restart to go live (uvicorn :8080, no reload). Related: [[directory-sidebar-filter]], [[workforce-capability-loop]], [[resource-matching-feature]]
