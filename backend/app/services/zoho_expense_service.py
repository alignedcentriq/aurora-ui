"""
Zoho Expense Service — per-user delegated API calls.

Same contract as zoho_people_service: every function takes a valid Zoho OAuth2 access
token (from get_valid_token(email, "zoho")) and raises ValueError("not_connected") on
401/403 so callers can prompt the user to reconnect.

Note: Zoho Expense requires an organization id header (X-com-zoho-expense-organizationid)
on most endpoints. We resolve it once per call from /organizations (default org).
"""

import datetime
import requests

from app.config import settings

_BASE = settings.ZOHO_EXPENSE_BASE_URL or "https://www.zohoapis.com/expense/v1"


def _headers(token: str, org_id: str = "") -> dict:
    h = {"Authorization": f"Zoho-oauthtoken {token}"}
    if org_id:
        h["X-com-zoho-expense-organizationid"] = org_id
    return h


def _check(resp: requests.Response):
    # Zoho Expense returns 401 code 57 for scope/permission failures, 403 for role gates.
    if resp.status_code in (401, 403):
        raise ValueError("not_connected")
    resp.raise_for_status()


def _org_id(token: str) -> str:
    """Resolve the user's default Zoho Expense organization id (required header)."""
    resp = requests.get(f"{_BASE}/organizations", headers=_headers(token), timeout=15)
    _check(resp)
    orgs = resp.json().get("organizations", [])
    if not orgs:
        return ""
    default = next((o for o in orgs if o.get("is_default_org")), orgs[0])
    return str(default.get("organization_id", ""))


def get_my_expense_reports(token: str, status: str = "") -> dict:
    """
    Return the user's expense reports with their approval/reimbursement status.

    status: optional Zoho filter (e.g. "submitted", "approved", "reimbursed"). Blank = all.
    Returns: {"success": True, "reports": [{name, status, total, currency, reimbursable, submitted_date}]}
    """
    if settings.ZOHO_DEMO_MODE:
        from app.services import zoho_demo_data
        return zoho_demo_data.expense_reports(status)

    org_id = _org_id(token)
    if not org_id:
        return {"success": True, "reports": []}

    params = {"organization_id": org_id}
    if status:
        params["status"] = status

    resp = requests.get(
        f"{_BASE}/expensereports",
        params=params,
        headers=_headers(token, org_id),
        timeout=15,
    )
    _check(resp)
    data = resp.json()

    reports = []
    for r in data.get("expensereports", []):
        reports.append({
            "name":           r.get("report_name") or r.get("report_number", ""),
            "status":         r.get("status", ""),
            "total":          float(r.get("total") or 0),
            "currency":       r.get("currency_code", ""),
            "reimbursable":   float(r.get("reimbursable_total") or r.get("reimbursable_amount") or 0),
            "submitted_date": r.get("submitted_date") or r.get("date", ""),
        })
    return {"success": True, "reports": reports}


def get_reimbursement_status(token: str) -> dict:
    """
    Summarise the user's pending vs. reimbursed expense amounts.

    Returns: {"success": True, "pending": [...], "reimbursed_total": float, "pending_total": float}
    """
    if settings.ZOHO_DEMO_MODE:
        from app.services import zoho_demo_data
        return zoho_demo_data.reimbursement_status()

    all_reports = get_my_expense_reports(token).get("reports", [])

    pending = []
    pending_total = 0.0
    reimbursed_total = 0.0
    for r in all_reports:
        st = (r.get("status") or "").lower()
        if "reimbursed" in st:
            reimbursed_total += r["reimbursable"]
        elif st in ("submitted", "approved", "awaitingapproval", "pendingapproval") or "approv" in st or "submit" in st:
            pending_total += r["reimbursable"]
            pending.append(r)

    return {
        "success": True,
        "pending": pending,
        "pending_total": round(pending_total, 2),
        "reimbursed_total": round(reimbursed_total, 2),
    }
