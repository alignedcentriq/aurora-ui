---
name: automation-hierarchy-scoping
description: Automation Hub people-data reports now hierarchy-scoped; Super Admin only org-wide
metadata:
  type: project
---

Email Automation Hub smart reports (`backend/app/services/smart_generators.py`) leaked EVERY employee's data regardless of who created the rule. Fixed 2026-07-09: added `_resolve_scope(rule)` / `_Scope` / `_scope_note` helpers; all 12 people-data generators (attendance_summary, leave_balance_report, leave_approval_reminder, onboarding_pending_reminder, bench_utilization, project_status, workforce_readiness, training_compliance, training_due, team_learning, it_ticket_digest, it_overdue_tickets_alert) now filter to the rule owner's reporting tree (creator + `attendance_service.descendants`).

**Decisions (user, 2026-07-09):** scope = whole reporting tree; **Super Admin is the ONLY org-wide role** (even HR/PMO/IT get scoped to their own tree); coverage = all people-data reports (HR + PMO/L&D + IT). Unresolvable owner → **fail closed** (empty report). id-based tables filter on `employee_id.in_(scope.ids)`; allocation reports match by `employee_name` (no FK); training matches id/email/name. Each email footer states its scope. `expense_cutoff_reminder`, `custom_email`, `roi_digest` (already role-scoped), `udemy_inactive` (own filters) unchanged. Frontend `leave_balance_report` inert "All employees/My department" selector removed. Related: [[access-aware-answers]], [[feedback-sensitive-data]].
