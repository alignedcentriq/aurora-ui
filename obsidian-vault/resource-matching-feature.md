---
name: resource-matching-feature
description: Staffing/resource-matcher chat feature — ranks employees by skill+availability+experience; allocation data is disjoint from skills data
metadata:
  type: project
---

Built 2026-06-16: a chat-based resource matcher for staffing new projects. User states a
requirement ("I need 2 React devs with 3+ yrs free by July") and the assistant returns
ranked employee profiles by **skill match + availability (free capacity / roll-off date) +
experience**.

Implementation (`backend/app/services/resource_matching_service.py` →
`ResourceMatchingService.match(skills, min_years, available_by, count, user_email)`):
- **Skills source = Alchemy Skills Portal** when `ALCHEMY_SKILL_SEARCH_ENABLED` is on (user set
  it True 2026-06-17) and the requester has a token: `_gather_alchemy()` calls
  `alchemy_service.resolve_skill_id` + `get_skill_details` per term, reading name / competency /
  experience from the experts/certified/employees buckets. Token fetched per-user via
  `oauth_service.get_alchemy_token` (needs DB for the MS refresh token). Falls back to the DB
  (`_gather_db`: EmployeeSkill + Zoho skill_set/expertise) if Alchemy is unavailable.
- **Availability source = DB** always: `EmployeeAllocation`, linked to the candidate **by employee
  name** (Alchemy and the allocation feed share names, not IDs). free = 100 − Σ active
  efforts_percent; uses expected_end_date vs needed-by for roll-off.
- Candidate keyed by lowercased name; email/designation enriched from `Employee` by name.
- Exposed as a `match_resources` tool on BOTH HR (`agent.py`) and PMO (`pmo_agent.py`) agents.
  Staffing queries route to **HR** via `_KW_HR_RESOURCE_MATCH` → sub_intent `resource_match`,
  handled by a deterministic fast-path in the HR node (before the alchemy skill-expert fast-path)
  using `_extract_resource_match_args()`.

Env note: DB now points at `hackathon.alignedautomation.com:5432/optimize` (not resolvable from a
local dev shell — only from where the backend runs); Alchemy API `apps.alignedautomation.com` is
public. Could not E2E test from the dev shell for this reason — verified by compile + response-shape
review. See [[centriq-replatform-status]] and [[ml01-llm-environment]].
