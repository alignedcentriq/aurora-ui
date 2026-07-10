"""
Connector Template Gallery — a static, curated catalog of popular-API starting points.

Each template's `operations` list is already in the exact shape
`openapi_importer.parse_spec()` produces (name, display_name, description, method,
path_template, params_schema, requires_confirmation, minutes_saved, response_mode,
enabled, version) — so installing a template reuses the same
ConnectorOperation-insert path as an OpenAPI import, just skipping the spec-file
upload + LLM-enrichment round trip.

These are deliberately small, hand-picked operation sets (not full API surfaces) —
the goal is a one-click, obviously-useful starting point an admin fills real
credentials into and reviews/edits before publishing, not a complete SDK. Field
names are pinned to well-known public API shapes but admins should still verify
against their own tenant/API version before publishing (surfaced via `note` below).
"""

from __future__ import annotations

from typing import Any


def _op(
    name: str,
    display_name: str,
    description: str,
    method: str,
    path_template: str,
    params_schema: list[dict],
    *,
    requires_confirmation: bool = False,
    minutes_saved: float = 3.0,
) -> dict[str, Any]:
    return {
        "name": name,
        "display_name": display_name,
        "description": description,
        "method": method,
        "path_template": path_template,
        "params_schema": params_schema,
        "response_map": None,
        "requires_confirmation": requires_confirmation,
        "minutes_saved": minutes_saved,
        "response_mode": "passthrough",
        "enabled": True,
        "version": 1,
    }


def _p(name: str, ptype: str, location: str, required: bool, description: str) -> dict:
    return {"name": name, "type": ptype, "location": location, "required": required, "description": description}


# These are picked to match apps this org actually runs (Zoho suite, ManageEngine) —
# not generic popular SaaS. Zoho templates use auth_type="connected_account" so they
# ride the SAME Microsoft/Zoho SSO connection already wired for other integrations
# (see connectors/auth.py connected_account_provider) — zero secrets for the admin to
# paste. Requires the signed-in user's Zoho OAuth grant to include the relevant API
# scope (People/Recruit) — if it doesn't, reconnect via Settings first (see `note`).
TEMPLATES: list[dict[str, Any]] = [
    {
        "key": "zoho_people",
        "name": "Zoho People",
        "category": "HR",
        "description": "Look up employee records and company holidays in Zoho People.",
        "base_url_hint": "https://people.zoho.com",
        "auth_type": "connected_account",
        "auth_mode": "per_user",
        "provider": "zoho",
        "auth_fields": [],
        "note": (
            "Uses each user's existing Zoho sign-in — no token to paste. If a user hasn't "
            "granted People-module access yet, they'll be prompted to reconnect via the "
            "in-chat connect card. This complements the built-in leave/timesheet features, "
            "not a replacement for them."
        ),
        "operations": [
            _op(
                "list_employee_records", "List employee records",
                "List employee records from Zoho People (name, department, designation).",
                "GET", "/people/api/forms/employee/getRecords",
                [_p("searchColumn", "string", "query", False, "Column to filter on, e.g. EmployeeEmailAlias")],
                minutes_saved=3,
            ),
            _op(
                "get_holidays", "Get company holidays", "List configured company holidays.",
                "GET", "/people/api/leave/getHolidays",
                [],
                minutes_saved=2,
            ),
        ],
    },
    {
        "key": "zoho_recruit",
        "name": "Zoho Recruit",
        "category": "Recruiting",
        "description": "List open job postings and add candidates in Zoho Recruit.",
        "base_url_hint": "https://recruit.zoho.com/recruit/v2",
        "auth_type": "connected_account",
        "auth_mode": "per_user",
        "provider": "zoho",
        "auth_fields": [],
        "note": (
            "Uses each user's existing Zoho sign-in — no token to paste. Requires the "
            "Recruit module scope on that user's Zoho grant; reconnect via Settings if "
            "calls come back unauthorized."
        ),
        "operations": [
            _op(
                "list_open_positions", "List open positions", "List currently open job openings.",
                "GET", "/Job_Openings",
                [_p("per_page", "integer", "query", False, "Max results (default 50)")],
                minutes_saved=3,
            ),
            _op(
                "create_candidate", "Add candidate", "Add a new candidate record.",
                "POST", "/Candidates",
                [
                    _p("First_Name", "string", "body", True, "Candidate first name"),
                    _p("Last_Name", "string", "body", True, "Candidate last name"),
                    _p("Email", "string", "body", True, "Candidate email"),
                ],
                requires_confirmation=True, minutes_saved=4,
            ),
        ],
    },
    {
        "key": "manageengine_sdp",
        "name": "ManageEngine ServiceDesk Plus",
        "category": "IT support",
        "description": "Create and list IT helpdesk requests directly via the ServiceDesk Plus API.",
        "base_url_hint": "https://sdpondemand.manageengine.com/api/v3",
        "auth_type": "bearer",
        "auth_mode": "service",
        "auth_fields": [
            {"key": "token", "label": "OAuth access token (self-client, Zoho API Console)", "secret": True},
        ],
        "note": (
            "This org's current IT-ticket flow creates ManageEngine tickets from an inbound "
            "email (see the built-in IT Support assistant) — this template is an optional "
            "direct-API path if/when IT enables the ServiceDesk Plus REST API + OAuth "
            "self-client. Verify field names against your SDP Cloud instance before publishing."
        ),
        "operations": [
            _op(
                "create_request", "Create request", "Create a new ServiceDesk Plus request/ticket.",
                "POST", "/requests",
                [
                    _p("subject", "string", "body", True, "Request subject"),
                    _p("description", "string", "body", False, "Request description"),
                ],
                requires_confirmation=True, minutes_saved=5,
            ),
            _op(
                "list_requests", "List requests", "List recent requests.",
                "GET", "/requests",
                [_p("row_count", "integer", "query", False, "Max results (default 25)")],
                minutes_saved=3,
            ),
        ],
    },
]


def list_templates() -> list[dict[str, Any]]:
    """Catalog metadata only — no secrets, safe for any admin to browse."""
    return [
        {
            "key": t["key"],
            "name": t["name"],
            "category": t["category"],
            "description": t["description"],
            "base_url_hint": t["base_url_hint"],
            "auth_type": t["auth_type"],
            "provider": t.get("provider"),
            "note": t.get("note", ""),
            "operation_count": len(t["operations"]),
            "operations": [
                {"name": o["name"], "display_name": o["display_name"], "method": o["method"]}
                for o in t["operations"]
            ],
        }
        for t in TEMPLATES
    ]


def get_template(key: str) -> dict[str, Any] | None:
    return next((t for t in TEMPLATES if t["key"] == key), None)
