---
name: personal-team-analytics
description: Analytics Studio extended with person-scoped HR metrics (me/my-team/org) from local Leave data (item 9); built 2026-06-22
metadata:
  type: project
---

Roadmap item 9, built 2026-06-22. Extends the whitelisted Analytics Studio catalog from org AI-ops metrics to personal/team HR analytics, sourced from the LOCAL `leaves` table (real data — NOT Zoho/demo; Leave.leave_type & status are string columns so they fit the single-table catalog with no join).

- New metrics in analytics_service METRIC_CATALOG: `leaves_taken` (count) + `leave_days` (sum of `(end_date - start_date)+1`, Postgres date arithmetic). Both `category:"personal"`, `person_col:"employee_id"`, `scopes:["me","my-team","org"]`, dims = leave_type/status/day/week/month.
- Person scoping in `run_query(..., person_scope, user_email)`: "me" → caller's own employee id, "my-team" → direct reports via `Employee.manager_id`, "org" → unrestricted. The id allow-list is derived SERVER-SIDE from the caller (never client-supplied); an empty list filters to id=-1 (no data) rather than widening to all. Renamed the local domain-scope var to `dom_scope` to avoid clashing with the new `person_scope` param.
- `personal_catalog(db, email)` returns personal metrics + only the scopes the caller can use ("my-team" only when they have reports).
- Routes (analytics_routes.py): `/api/analytics/me/catalog` + `/api/analytics/me/query` gated by get_current_user (ANY role incl employee — the existing org /query stays require_non_employee). me/query clamps scope to me|my-team and rejects non-personal metrics.
- UI: `src/components/analytics/MyAnalytics.tsx` (Me / My team toggle + metric/dim/period selects, reuses MetricChart), mounted at the top of AnalyticsStudio.
- Tests: tests/test_personal_analytics.py (9 checks: me vs my-team vs outsider isolation, inclusive day sums, scope/dim whitelist).

Follow-ups: balance-distribution + "who's out next week" need a LeaveType join / list-style query (not added). Relates to [[analytics-roi-feature]], [[org-hierarchy-graph]].
