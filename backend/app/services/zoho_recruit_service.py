"""
Zoho Recruit Service — per-user delegated API calls.

Same contract as zoho_people_service: every function takes a valid Zoho OAuth2 access
token (from get_valid_token(email, "zoho")) and raises ValueError("not_connected") on
401/403 so callers can prompt the user to reconnect.

Recruit's data API base is recruit.zoho.com/recruit/v2 (the www.zohoapis.com/recruit
form returns a CRM error page). Standard Recruit response shape: {"data": [...], "info": {...}}.
"""

import requests

from app.config import settings

_BASE = settings.ZOHO_RECRUIT_BASE_URL or "https://recruit.zoho.com/recruit/v2"


def _headers(token: str) -> dict:
    return {"Authorization": f"Zoho-oauthtoken {token}"}


def _check(resp: requests.Response):
    # Recruit returns 401 OAUTH_SCOPE_MISMATCH for missing scope, 403 for role gates.
    if resp.status_code in (401, 403):
        raise ValueError("not_connected")
    resp.raise_for_status()


def get_open_positions(token: str) -> dict:
    """
    Return currently open job openings.

    Returns: {"success": True, "positions": [{title, status, city, openings, date_opened}]}
    """
    if settings.ZOHO_DEMO_MODE:
        from app.services import zoho_demo_data
        return zoho_demo_data.open_positions()

    resp = requests.get(
        f"{_BASE}/Job_Openings",
        params={"per_page": 50, "sort_by": "Date_Opened", "sort_order": "desc"},
        headers=_headers(token),
        timeout=15,
    )
    # Recruit returns 204 (no content) when a module has zero records.
    if resp.status_code == 204:
        return {"success": True, "positions": []}
    _check(resp)
    data = resp.json()

    positions = []
    for j in data.get("data", []):
        status = j.get("Job_Opening_Status") or j.get("Status", "")
        # Only surface genuinely open roles.
        if status and status.lower() in ("closed", "filled", "cancelled", "on-hold"):
            continue
        positions.append({
            "title":       j.get("Posting_Title") or j.get("Job_Opening_Name", ""),
            "status":      status,
            "city":        j.get("City", ""),
            "openings":    j.get("Number_of_Positions", ""),
            "date_opened": j.get("Date_Opened", ""),
        })
    return {"success": True, "positions": positions}


def get_candidate_status(token: str, email: str = "") -> dict:
    """
    Look up a candidate's current pipeline status by email.

    email: candidate email to search for. Blank returns an empty result.
    Returns: {"success": True, "candidates": [{name, email, status, applied_for}]}
    """
    if settings.ZOHO_DEMO_MODE:
        from app.services import zoho_demo_data
        return zoho_demo_data.candidate_status(email)

    if not email:
        return {"success": True, "candidates": []}

    resp = requests.get(
        f"{_BASE}/Candidates/search",
        params={"email": email},
        headers=_headers(token),
        timeout=15,
    )
    if resp.status_code == 204:
        return {"success": True, "candidates": []}
    _check(resp)
    data = resp.json()

    candidates = []
    for c in data.get("data", []):
        candidates.append({
            "name":        c.get("Full_Name") or f"{c.get('First_Name','')} {c.get('Last_Name','')}".strip(),
            "email":       c.get("Email", ""),
            "status":      c.get("Candidate_Status", ""),
            "applied_for": c.get("Associated_Tags") or c.get("Source", ""),
        })
    return {"success": True, "candidates": candidates}
