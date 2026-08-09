---
name: analytics-roi-feature
description: ROI Dashboard + Analytics Studio + ask-your-data NL feature built 2026-06-14
metadata: 
  node_type: memory
  type: project
  originSessionId: 20adc1ee-c367-45c8-8180-9c58de383bf0
---

Built 2026-06-14 (branch dev_sharmaji): a three-surface analytics layer, all gated to
non-employee roles (`require_non_employee` backend; `show: (role) => role !== "Employee"`
Control Hub tabs in [src/routes/_layout.control-hub.tsx]).

- **ROI Dashboard** (`src/pages/RoiDashboard.tsx`) — KPIs (hours saved, value, net, infra
  cost, deflection, satisfaction), PDF export (reportlab), and a user-toggled scheduled
  ROI email. Cost model = **amortized monthly infra cost**, NOT per-token: they run
  self-hosted free models so per-token $ is always 0 and misleading. `infra_cost =
  monthly_infra_cost × period_days/30`; net = value_saved − infra_cost. Tokens shown as a
  volume count, not money. `monthly_infra_cost` lives in the `roi_assumptions` setting.
- **Analytics Studio** (`src/pages/AnalyticsStudio.tsx`) — config builder + drag/reorder
  multi-widget board + save/load. Shares `src/components/analytics/MetricChart.tsx`.
- **Ask-your-data** — NL bar → `/api/analytics/nl-query` (router LLM tier, structured
  output) back-fills the builder dropdowns.

Core = a **whitelisted metric catalog** in `backend/app/services/analytics_service.py`
(METRIC_CATALOG / DIMENSION_CATALOG); both dropdowns and NL resolve only against it — no
raw SQL. Routes in `backend/app/routes/analytics_routes.py`. New model `SavedDashboard`;
scheduled email reuses `AutomationRule` with a new `roi_digest` kind (created
`is_active=False`, off until the user enables). ROI cost model stored as a
`roi_assumptions` row in `company_settings`, admin-editable.

**Why:** user asked for ROI visibility + a non-employee chart creator + a standout feature.
**How to apply:** to add a metric, add one catalog entry — it appears in dropdowns, NL
vocab, and ROI at once. Backend needs a restart to serve the routes + run the additive
migration (`saved_dashboards` table, `automation_rules.automation_kind`/`extra_config`).
See [[react19-frontend-constraints]] for the drag-and-drop choice. [[backend-runtime-setup]]
