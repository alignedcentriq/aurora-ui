"""
Tool Registry — single source of truth for per-tool response_mode configuration.

Replaces the hardcoded `_PASSTHROUGH_TOOLS` / `_POLICY_SEARCH_TOOLS` sets in agent.py.
Connector operations extend this registry dynamically at publish time.

response_mode values:
  passthrough  — tool result is already formatted; skip the summarizer LLM entirely
  policy       — answer via strong-grounding prompt (policy / insurance Q&A)
  agent        — standard ReAct loop; the agent model streams the final answer
                 from ToolMessages (this is the "delete separate summarizer" path)
  template     — Jinja2 render of ConnectorOperation.template, 0 LLM (connector ops only)

Usage:
    from app.services.tool_registry import ToolRegistry
    mode = ToolRegistry.get_mode("search_employee_directory")  # → "passthrough"
"""

from __future__ import annotations

from typing import Literal

ResponseMode = Literal["passthrough", "policy", "agent", "template"]


# ── Static registry (hardcoded agents) ───────────────────────────────────────

_STATIC_REGISTRY: dict[str, ResponseMode] = {
    # HR domain — display-ready structured results, no LLM needed
    "search_employee_directory":    "passthrough",
    "get_employee_profile":         "passthrough",
    "get_org_chart":                "passthrough",
    "get_team_roster":              "passthrough",
    "find_skills_expert":           "passthrough",
    "get_department_headcount":     "passthrough",
    "search_people_directory":      "passthrough",
    "get_leave_balance":            "passthrough",
    "get_announcements":            "passthrough",
    "get_team_absence":             "passthrough",
    "get_team_absence_for":         "passthrough",
    "get_my_timesheet":             "passthrough",
    "get_my_attendance":            "passthrough",
    "get_my_appraisal_status":      "passthrough",
    "get_my_training_records":      "passthrough",
    "get_my_expense_reports":       "passthrough",
    "get_my_reimbursement_status":  "passthrough",
    "get_open_positions":           "passthrough",
    "get_candidate_status":         "passthrough",
    "get_my_alchemy_skills":        "passthrough",
    "get_alchemy_skills_overview":  "passthrough",
    "search_alchemy_skill_experts": "passthrough",
    "get_employee_availability":    "passthrough",
    # Live Udemy Business catalog results — formatted with course links, no re-read
    "search_udemy_courses":         "passthrough",
    # Udemy seat administration — reporting lists + SCIM action confirmations, display-ready
    "udemy_inactive_seats":         "passthrough",
    "udemy_seat_utilization":       "passthrough",
    "udemy_course_insights":        "passthrough",
    "deactivate_udemy_user":        "passthrough",
    "reactivate_udemy_user":        "passthrough",
    "provision_udemy_user":         "passthrough",
    # Local TechElevate LMS — display-ready training recommendations + personal list
    "recommend_training":           "passthrough",
    "get_my_trainings":             "passthrough",
    # Document generation — already contains the download tag, don't re-process
    "generate_hr_document":         "passthrough",
    # Project IQ — ranked similar projects / lessons / experts / reusable assets, pre-formatted
    "find_similar_projects":        "passthrough",
    "project_lessons":              "passthrough",
    "find_project_experts":         "passthrough",
    "find_reusable_assets":         "passthrough",
    # Policy / insurance Q&A — grounded strong-model answer
    "search_hr_policies":           "policy",
}

# ── Dynamic registry (connector ops, set at publish time) ────────────────────

_DYNAMIC_REGISTRY: dict[str, ResponseMode] = {}


class ToolRegistry:

    @staticmethod
    def get_mode(tool_name: str) -> ResponseMode:
        """Return the response_mode for a tool name. Defaults to 'agent'."""
        if tool_name in _STATIC_REGISTRY:
            return _STATIC_REGISTRY[tool_name]
        if tool_name in _DYNAMIC_REGISTRY:
            return _DYNAMIC_REGISTRY[tool_name]
        return "agent"

    @staticmethod
    def is_passthrough(tool_name: str) -> bool:
        return ToolRegistry.get_mode(tool_name) == "passthrough"

    @staticmethod
    def is_policy(tool_name: str) -> bool:
        return ToolRegistry.get_mode(tool_name) == "policy"

    @staticmethod
    def register(tool_name: str, mode: ResponseMode) -> None:
        """Register (or override) a dynamic tool's response_mode. Thread-safe for reads."""
        _DYNAMIC_REGISTRY[tool_name] = mode

    @staticmethod
    def register_connector_ops(ops: list[dict]) -> None:
        """Bulk-register connector operations from a list of ConnectorOperation dicts."""
        for op in ops:
            name = op.get("name", "")
            raw_mode = op.get("response_mode", "passthrough")
            mode: ResponseMode = raw_mode if raw_mode in ("passthrough", "policy", "agent", "template") else "passthrough"
            if name:
                _DYNAMIC_REGISTRY[name] = mode

    @staticmethod
    def unregister_connector(connector_slug: str, op_names: list[str]) -> None:
        for name in op_names:
            _DYNAMIC_REGISTRY.pop(name, None)

    @staticmethod
    def all_passthrough_tools() -> frozenset[str]:
        """Return the union of all passthrough tool names (for use in agent.py guard)."""
        static = {k for k, v in _STATIC_REGISTRY.items() if v == "passthrough"}
        dynamic = {k for k, v in _DYNAMIC_REGISTRY.items() if v == "passthrough"}
        return frozenset(static | dynamic)

    @staticmethod
    def all_policy_tools() -> frozenset[str]:
        static = {k for k, v in _STATIC_REGISTRY.items() if v == "policy"}
        dynamic = {k for k, v in _DYNAMIC_REGISTRY.items() if v == "policy"}
        return frozenset(static | dynamic)
