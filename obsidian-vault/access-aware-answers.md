---
name: access-aware-answers
description: Answer-layer RBAC — sensitive HR-data tools enforce self/manager/HR before returning another person's data
metadata:
  type: project
---

Built 2026-06-23. Closed the answer-layer access gap: `x-user-role`/`user_email` reached `AgentState` but were only prose hints to the LLM, so a regular employee could ask "what's Priya's leave balance" and the tool would answer (tools were identity-blind).

Shared guard: `backend/app/services/access_control.py` → `check_personal_data_access(requester_email, requester_role, target_query)` returns an `AccessDecision`. Policy mirrors the existing `attendance_service.summary_for_manager` (self or direct report via `Employee.manager_id`) plus an HR/admin role override. Empty target = self.

Wired into `agent.py` tools: `get_leave_balance` (manager/HR may pass a target name/email; guard enforces), `generate_hr_document` (gained a `state` param — previously fell back to DEFAULT_USER_EMAIL and couldn't ID the requester). `get_my_leaves`/`cancel_leave` are now hard-bound to the requester's own identity (ignore any LLM-supplied email). HR system prompt updated so managers can name a person for leave balance.

Left open intentionally: `get_employee_profile` (non-sensitive directory data) and `get_employee_availability` (staffing). Flagged but NOT done: `get_candidate_status` (candidate PII — needs a recruiter/HR role gate, different policy from self/manager).

Note: `agents/hr_agent.py` is dead (not imported by `agent.py`) and already self-only. Tests: `backend/tests/test_access_control.py`. Related: [[abstention-action-handoff]], [[action-registry-spine]].
