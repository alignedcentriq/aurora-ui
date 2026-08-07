---
name: live-config-needs-approval
description: Changing live/shared runtime config (LLM model tiers etc.) requires explicit user approval first
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 58529f23-cbb0-4f4b-a303-81804056b98c
---

Changing the live LLM tier config (or any shared runtime state affecting all users of the Centriq assistant) is blocked by the permission classifier until the user explicitly approves that specific change — "evaluate" does not imply "apply".

**Why:** The agent-tier model switch affects every user of the deployed assistant; the classifier denied `update_config` twice (2026-06-11) until the user picked "Yes, switch" via an explicit question.

**How to apply:** Do the diagnosis/eval first, present evidence, then ask a direct question (AskUserQuestion) for the apply step. Keep changes instantly revertible and say how (e.g. `python backend/scripts/apply_agent_model.py gpt-oss:latest`).

Related: [[ml01-llm-environment]], [[backend-runtime-setup]]
