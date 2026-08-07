---
name: leave-balance-csv-source
description: Leave balances now sourced from real Zoho-export CSV per user (backend/app/data/leave_balances.csv)
metadata: 
  node_type: memory
  type: project
  originSessionId: 987efecd-79ea-41f7-a7bf-6528ebe6b0ce
---

Leave balances are served from a real Zoho People export CSV at `backend/app/data/leave_balances.csv` (~200 employees, one row per employee × leave type; cols: Employee ID=AASPL-####, Employee Name, Leave Name, Leave Category, Booked, Balance). Added 2026-06-27.

- Loader: `app/services/leave_balance_data.py` — caches CSV indexed by employee code (AASPL-####) and normalised name; `balances_for(code, name)` returns the same shape as the old static demo fixture (`{type,total,used,balance}`). Skips ABSENT/COMPENSATORY_OFF and rows with booked==0 and balance==0.
- Wiring in `app/services/leave_balance_sync.py`: `get_or_refresh(email)` → `_resolve_employee(email)` looks up the `Employee` row (email→employee_id/name) → CSV. Used in BOTH the demo branch AND as fallback in the live path when there's no Zoho token / 401-403 (so it works even with [[zoho-doc-generation]]'s ZOHO_DEMO_MODE=false shared flag).
- Unmatched users fall back to config `LEAVE_BALANCE_DEMO_EMPLOYEE` (default `AASPL-1333`), then the generic static fixture in `zoho_demo_data.leave_balances()`.
- Consumers: agent leave_balance fast-path in [[centriq-replatform-status]] flow (agent.py deeplink node) + deeplink_agent.py. The DB `leave_balances` table (hr_service/skill_hr_routes/hr_portal) is a SEPARATE legacy path, not fed by this CSV.
- Email automation "Leave Balance Report" (`smart_generators.gen_leave_balance_report`) was switched 2026-07-06 from `balances_for()` (CSV) to the DB `leave_balances`/`leave_types` tables — the CSV is absent in dev (not git-tracked; prod-only) so it rendered 0. DB table is populated LAZILY (chat inits a user's rows on first query), so the generator first calls `HRService._init_employee_balances` for the whole roster (789 emps → ~4734 rows), then reads. NB: init gives entitlement with used=0 for anyone with no app-tracked approved leave (real Zoho usage isn't in the DB). `_tbl` still caps the email at 60 rows.
- `leave_details.csv` (10k+ applied-leave records) and `leave_types.csv` (Zoho ID→name map) moved to `backend/app/data/`. New loader `app/services/leave_details_data.py` indexes 733 employees by AASPL-#### code and name; resolves Zoho internal leave-type IDs via leave_types.csv; extracts AASPL code + name from `Created By` field; results sorted newest-first. The `get_my_leaves` agent tool (agent.py) now falls back to this CSV when the DB `Leave` table has no records for the user.
