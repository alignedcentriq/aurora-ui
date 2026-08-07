---
name: workforce-capability-loop
description: Allocation×Skills×Training closed-loop features + the allocation data-shape gotchas every consumer must respect
metadata: 
  node_type: memory
  type: project
  originSessionId: 82476232-ec56-4e4e-bee9-6bb7b198183d
---

Built 2026-06-25 on the reloaded `employee_allocations` table (26,846 rows from "Admin Allocation Details - 25 June.xlsx", 1,262 people, 68 MONTHLY snapshots Jan-2024 → Aug-2026). Four pillars, all **deterministic SQL, no LLM** (user was emphatic: "sql easy thing like a sql agent... not llm"):

- **Phase 0 — `allocation_snapshot_service.py`**: the one source of truth for "current" capacity. `current_load_map`/`availability_for`/`pipeline_demand`/`rolloff_map`. Refactored `resource_matching_service._availability`, `skill_gap_overlay_service._availability_map`, and `agent.py get_employee_availability` onto it.
- **Phase 1**: allocation metrics in `analytics_service.METRIC_CATALOG` (utilization_pct, billable_pct, bench_headcount, allocation_headcount) via new `no_period` + `base_filter` opt-out; configurator path only (NL box NOT wired).
- **Phase 2 — Bench-to-Upskill** (`bench_upskill_service.py`): bench/rolloff → in-house demand → TE course → manager-approved assign. PMO Portal "Bench → Upskill" tab + `GET/POST /api/portal/pmo/bench-upskill`.
- **Phase 3 — Leadership Capability Command** (`capability_command_service.py` + `capability_command_routes.py`): heatmap, pipeline readiness, SPOF, bench cost. New `LeadershipPortal.tsx`, registered in Control Hub as `leadership-command`.
- **Phase 4 — Team Readiness + Digest** (`team_readiness_service.py`): Manager Portal "Readiness" tab + `/api/portal/manager/team/digest` & `/team/readiness`; new `nudge_service.detect_bench_reports` manager nudge.

**CRITICAL allocation data-shape rules (verified) — every new consumer MUST follow:**
1. Data is MONTHLY snapshots; never sum efforts across rows. Use the LATEST snapshot per employee (`allocation_snapshot_service`). Raw sum gives ~1700% load; latest-snapshot median ≈100%.
2. Project completion = **`project_status`** ("Ongoing"/"Completed"), NOT `completion_status` (which is a "Done/Not Done" record flag — the OLD `_is_current` keyed off it and was a no-op).
3. **`expected_end_date` = LWD = attrition/exit date**, NOT project rolloff. Only ~6.3k populated. Real rolloff = next-snapshot project diff (`rolloff_map`).
4. Pipeline/bench live in `billing`: "Pipeline" + "For Allocation" = bench; future-dated snapshots (>latest month ≤ today) = planned demand.
5. Join key allocation↔directory↔skills is **employee NAME** (case-insensitive), no shared ID.

**Local-env limitation:** this dev DB has only ~4 `Employee` rows + 10 `EmployeeSkill` (directory is MS365/Zoho-synced; TE-local not on shared Postgres yet), so skill-join panels (heatmap, SPOF, bench course suggestions) return thin/empty locally though the SQL is correct. Allocation-only panels (utilization, pipeline readiness, bench cost) work fully on this DB. Related: [[techelevate-local-lms]], [[resource-matching-feature]], [[skill-supply-overlay]], [[proactive-nudge-layer]].
