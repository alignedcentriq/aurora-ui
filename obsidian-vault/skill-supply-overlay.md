---
name: skill-supply-overlay
description: "PMO \"Skill Supply\" — Alchemy market skill-gap × internal allocation availability → BUY/TRAIN/REDEPLOY; built 2026-06-23"
metadata: 
  node_type: memory
  type: project
  originSessionId: 893d3120-2ee5-4e82-8c0a-b3742b43ad88
---

PMO "Skill Supply" feature: joins Alchemy's skill-gap dashboard (market demand vs internal coverage) with live EmployeeAllocation availability — the cross-reference no single portal does. Answers "what in-demand skills can't we staff?"; tags each skill **BUY / TRAIN / REDEPLOY / STAFFABLE**.

**Why:** Alchemy's `demand` = the *external job market* (postings × companies scraped), NOT our project pipeline; its dashboard can't see that a skill's holders are all billable-locked. The hub supplies that second half. This supersedes the abandoned "skills-gap → training course" loop (users watch YouTube, don't take courses; TechElevate not onboarded — see [[techelevate-portal]]).

**How to apply:**
- Alchemy skill-gap endpoints (newly wired in `alchemy_service.py`): `skills/skill-gap-analysis/{stats,charts,training-priorities}` (GET) + `/table` (POST `{page,page_size,sort_by,sort_order,search}`). Dashboard lives at `/alchemy/skill-gap`. `/table` rows carry `demand`, `coverage_count`, and a full `employee_names_preview` (holders by name).
- Overlay: `services/skill_gap_overlay_service.py` `SkillSupplyService.analyze()` — 1 Alchemy call + 1 DB pass; crosses holders against EmployeeAllocation by NAME (same key/fragility as [[resource-matching-feature]]); deployable = free ≥40%, roll-off horizon 45d.
- Surfaces: route `GET /api/portal/pmo/skill-supply` (require_pmo); PMO agent tool `analyze_skill_supply` (passthrough, prompt rule #10); dashboard tab in `src/pages/PMOPortal.tsx` (now tabbed: Skill Supply + License Requests).
- CAVEAT: in dev DB, Alchemy holder names and allocation-feed names are largely different populations → most holders read "free". Aligns in prod. No live Alchemy token in dev → analyze() returns {ok:False, connect-message}.
