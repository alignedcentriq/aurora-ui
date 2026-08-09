---
name: feature-adoption-analytics
description: 'Undiscovered features' view — per-capability adoption % across staff in Observability, denominator = capability_registry
metadata:
  type: project
---

Built 2026-06-23. Makes growth measurable: surfaces which capabilities are undiscovered ("80% of staff have never used X") so internal nudge campaigns can target blind spots.

**Service:** `backend/app/services/adoption_service.py` → `feature_adoption(window_days=90)`. Denominator = `capability_registry.all_capabilities()`; numerator = distinct `AiRequestLog.user_email` whose normalized (domain, sub_intent) maps to each capability (match by domain + sub_intent set; domain-only for coarse capabilities). Exact distinct-user counts via Python set-union (not summed approximations). Returns per-feature: users, requests, last_used, adoption_pct_staff, adoption_pct_active, never_used_staff — sorted most-undiscovered first. Plus `unmapped`: (domain, sub_intent) buckets with real traffic that NO capability claims — so wrong sub_intent guesses show as unmapped usage rather than silently making a capability look undiscovered (self-correcting).

**Endpoint:** `GET /api/observability/adoption?window_days=` (super-admin via `_require_super_admin`).

**Frontend:** new 4th tab "Feature Adoption" in `ObservabilityDashboard.tsx` → `src/pages/AdoptionTab.tsx`: KPI cards (staff/active/capabilities/undiscovered), reach bars, never-used counts, window selector (30/90/180d), and an Unmapped-traffic table to drive registry expansion.

Calibrated 2026-06-23 against real `ai_request_logs` traffic (not guesses): registry now maps each capability via explicit `(domain, sub_intent)` `usage` pairs (with `*` wildcard), incl. cross-domain (leave → hr+deeplink, HR docs → `document/*`, room booking → `ms365/room_availability`, `admin/policy_query` folded into hr_policy). Added capabilities for high-traffic intents: payslip, holidays, visitor_pass, facility_issue, company_info, udemy_license. Live result: undiscovered 13→5 (the 5 are genuinely zero-traffic: cancel_leave, reimbursement, team_absence, approvals, resource_match); 21 capabilities show real reach.

REMAINING ISSUE (source-side, not registry): ~246 reqs have NULL `sub_intent` (general 110, hr 67, ms365 31, pmo 14, ...) so they can't be attributed — they show as `(none)` in the Unmapped table. To raise attribution, populate `sub_intent` more consistently in the router/logging path (`main.py` AiRequestLog write + router). Re-check the Unmapped table to retune. Tests: `backend/tests/test_adoption_service.py`. Built on [[adoption-mechanics]] (shared registry). Related: [[feedback-triage-flywheel]], [[analytics-roi-feature]].
