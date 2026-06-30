"""
AI-powered automation composer.

Accepts a natural-language description and returns a pre-filled RuleFormState
compatible with the frontend wizard. Uses the configured Ollama endpoint.
"""

from __future__ import annotations
import json
import logging
import re
from typing import Optional

import requests

from app.config import Config

log = logging.getLogger(__name__)

# ── Catalog mirror (must stay in sync with src/lib/automation-catalog.ts) ────

CATALOG_SUMMARY = """
Available automation types (id → label, description):
1. leave_balance_report — Leave Balance Report: Per-employee leave quota and usage snapshot.
   params: include_zero_balance(toggle), department_filter(text)
2. attendance_summary — Attendance Summary: Punctuality and absenteeism for your workforce.
   params: period(select: last_week/last_month/current_month), late_threshold_min(number)
3. it_ticket_digest — IT Ticket Digest: Open tickets grouped by priority and category.
   params: include_closed(toggle), max_age_days(number)
4. bench_utilization_report — Bench Utilization Report: Who is unallocated and for how long.
   params: bench_days_threshold(number)
5. training_compliance_report — Training Compliance Report: Course completion rates and overdue assignments.
   (no params)
6. inactive_udemy_digest — Inactive Udemy Seats Digest: Learners who haven't logged in recently.
   params: inactive_days(number)
7. project_status_report — Project Status Report: Active project list with headcount.
   (no params)
8. leave_approval_reminder — Leave Approval Reminder: Remind managers of pending leave requests.
   params: pending_days_threshold(number)
9. expense_cutoff_reminder — Expense Cutoff Reminder: Nudge staff before month-end expense deadline.
   params: cutoff_day(number)
10. onboarding_pending_reminder — Onboarding Pending Reminder: Flag new hires with stalled onboarding.
    params: stall_days(number)
11. training_due_reminder — Training Due Reminder: Alert learners about courses due within a window.
    params: due_within_days(number)
12. team_learning_digest — Team Learning Digest: Training and course progress for managers.
    params: include_udemy(toggle)
13. workforce_readiness_digest — Workforce Readiness Digest: Bench vs billable ratio with skills gap.
    (no params)
14. it_overdue_tickets_alert — IT Overdue Tickets Alert: Escalate stale high-priority tickets.
    params: overdue_days(number), min_priority(select: Low/Medium/High/Critical)
15. custom_email — Custom Email: Write your own email content.
    params: (you compose subject + body)
"""

# Default schedules per category
_DEFAULTS = {
    "leave_balance_report":        {"frequency": "monthly", "day_of_month": 1,  "hour": 8},
    "attendance_summary":          {"frequency": "weekly",  "day_of_week": 0,   "hour": 8},
    "it_ticket_digest":            {"frequency": "daily",                        "hour": 9},
    "bench_utilization_report":    {"frequency": "weekly",  "day_of_week": 0,   "hour": 8},
    "training_compliance_report":  {"frequency": "monthly", "day_of_month": 1,  "hour": 9},
    "inactive_udemy_digest":       {"frequency": "monthly", "day_of_month": 1,  "hour": 8},
    "project_status_report":       {"frequency": "weekly",  "day_of_week": 0,   "hour": 8},
    "leave_approval_reminder":     {"frequency": "daily",                        "hour": 9},
    "expense_cutoff_reminder":     {"frequency": "monthly", "day_of_month": 20, "hour": 9},
    "onboarding_pending_reminder": {"frequency": "weekly",  "day_of_week": 0,   "hour": 9},
    "training_due_reminder":       {"frequency": "weekly",  "day_of_week": 0,   "hour": 9},
    "team_learning_digest":        {"frequency": "weekly",  "day_of_week": 4,   "hour": 8},
    "workforce_readiness_digest":  {"frequency": "weekly",  "day_of_week": 0,   "hour": 8},
    "it_overdue_tickets_alert":    {"frequency": "daily",                        "hour": 9},
    "custom_email":                {"frequency": "weekly",  "day_of_week": 0,   "hour": 9},
}

VALID_KINDS = set(_DEFAULTS.keys())

_SYSTEM = f"""You are an automation configurator for a workplace AI platform.
Given a user's description of what they want automated, output ONLY a single JSON object.

{CATALOG_SUMMARY}

Rules:
- Pick the best matching automation_kind from the list above.
- If nothing fits, use "custom_email" and fill email_subject + email_body.
- For custom_email, write a real subject and 3–5 sentence body based on the description.
- Fill extra_config with sensible values for the chosen kind's params.
- Set name (max 60 chars), description (max 120 chars).
- Set frequency: "daily" | "weekly" | "monthly".
- Set day_of_week (0=Mon..6=Sun) if weekly, day_of_month (1–28) if monthly.
- Set hour (0–23, default 9).
- Respond ONLY with valid JSON, no markdown fences, no commentary.

JSON shape:
{{
  "automation_kind": "<id>",
  "name": "<short name>",
  "description": "<short description>",
  "frequency": "daily|weekly|monthly",
  "day_of_week": null,
  "day_of_month": null,
  "hour": 9,
  "minute": 0,
  "extra_config": {{}},
  "email_subject": "",
  "email_body": "",
  "confidence": "high|medium|low",
  "reasoning": "<one sentence why you chose this>"
}}"""


def compose_automation(description: str, portal_id: Optional[str] = None) -> dict:
    """Call the LLM to map a natural-language description → automation config."""
    prompt = f"User request: {description.strip()}"
    if portal_id:
        prompt += f"\nContext portal: {portal_id}"

    payload = {
        "model": Config.ROUTER_MODEL_NAME,  # fast model, structured output
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "temperature": 0,
        "max_tokens": 512,
    }

    try:
        base = Config.ROUTER_BASE_URL.rstrip("/")
        url = f"{base}/chat/completions"
        resp = requests.post(url, json=payload, timeout=30,
                             headers={"Authorization": f"Bearer {Config.ROUTER_API_KEY}"})
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        log.warning("LLM compose failed: %s", exc)
        return {"success": False, "error": str(exc)}

    # Strip markdown fences if the model wrapped it anyway
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw.strip())

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.warning("LLM compose: JSON parse error — %s\nRaw: %s", exc, raw[:400])
        return {"success": False, "error": "invalid_llm_response"}

    kind = data.get("automation_kind", "custom_email")
    if kind not in VALID_KINDS:
        kind = "custom_email"

    defaults = _DEFAULTS.get(kind, _DEFAULTS["custom_email"])

    result = {
        "success": True,
        "automation_kind": kind,
        "name": str(data.get("name", "") or "")[:60] or description[:60],
        "description": str(data.get("description", "") or "")[:120],
        "frequency": data.get("frequency") or defaults.get("frequency", "weekly"),
        "day_of_week": data.get("day_of_week") if data.get("day_of_week") is not None else defaults.get("day_of_week", None),
        "day_of_month": data.get("day_of_month") if data.get("day_of_month") is not None else defaults.get("day_of_month", None),
        "hour": int(data.get("hour") or defaults.get("hour", 9)),
        "minute": int(data.get("minute") or 0),
        "extra_config": data.get("extra_config") or {},
        "email_subject": data.get("email_subject") or "",
        "email_body": data.get("email_body") or "",
        "confidence": data.get("confidence", "medium"),
        "reasoning": data.get("reasoning", ""),
    }
    return result
