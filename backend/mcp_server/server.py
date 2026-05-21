#!/usr/bin/env python3
"""
Centriq MCP Server — Playwright-based portal automation.
Runs over stdio transport. Automates Zoho People, PowerApps, and Payroll Portal
using saved SSO session cookies. No credentials stored.

First-time use: call setup_portal_session("zoho"|"powerapps"|"payroll") to
open a visible Edge window so the user can complete SSO login once.
"""
import os
import sys
import json
import asyncio
import subprocess
from pathlib import Path

# Load .env.local so portal URLs are available when spawned as a subprocess
# (the parent process env is not always forwarded by langchain-mcp-adapters)
try:
    from dotenv import load_dotenv as _load_dotenv
    _load_dotenv(Path(__file__).parent.parent.parent / ".env.local", override=False)
except Exception:
    pass

import win32crypt  # Windows DPAPI — encrypts data tied to current user account

from mcp.server.fastmcp import FastMCP
from playwright.async_api import async_playwright

mcp = FastMCP("centriq-deeplink")

# ── Session storage ────────────────────────────────────────────────────────────
SESSIONS_DIR = Path(__file__).parent / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

# ── Portal config (from env) ───────────────────────────────────────────────────
ZOHO_BASE_URL    = os.environ.get("ZOHO_PEOPLE_URL", "").rstrip("/")
POWERAPPS_URL    = os.environ.get("POWERAPPS_URL", "")
PAYROLL_URL      = os.environ.get("PAYROLL_PORTAL_URL", "").rstrip("/")

# ── Selector constants (TODO: update after inspecting each portal) ─────────────

# Zoho People — leave application form
ZOHO_LEAVE_PAGE      = ZOHO_BASE_URL + "#leavetracker/mydata/applyleave"
ZOHO_LEAVE_TYPE_SEL  = "#zp_field_723706000000036105-container"  # custom zselectbox
ZOHO_DATE_INPUT_SEL  = ".zinputfield__textbox"  # nth(0)=from-date, nth(1)=to-date
ZOHO_REASON_SEL      = "textarea[name='Reasonforleave']"
ZOHO_SUBMIT_SEL      = "#zp_forms_add_btn"
ZOHO_CONFIRM_SEL     = "TODO: selector for success message / reference number after submit"

# PowerApps complaints app
POWERAPPS_CATEGORY_SEL = "TODO: selector for category field in PowerApps complaints form"
POWERAPPS_DESC_SEL     = "TODO: selector for description field"
POWERAPPS_SUBMIT_SEL   = "TODO: selector for submit button"
POWERAPPS_CONFIRM_SEL  = "TODO: selector for confirmation/reference after submit"

# Payroll portal
PAYROLL_MONTH_SEL   = "TODO: selector for month picker/input"
PAYROLL_YEAR_SEL    = "TODO: selector for year picker/input"
PAYROLL_SEARCH_SEL  = "TODO: selector for search/go button"
PAYROLL_SLIP_SEL    = "TODO: selector for payslip link or download button"


# ── Session helpers ────────────────────────────────────────────────────────────

async def _load_cookies(context, portal: str) -> bool:
    path = SESSIONS_DIR / f"{portal}.bin"
    if path.exists():
        try:
            encrypted = path.read_bytes()
            _, plain = win32crypt.CryptUnprotectData(encrypted, None, None, None, 0)
            await context.add_cookies(json.loads(plain.decode("utf-8")))
            return True
        except Exception:
            return False
    return False


async def _save_cookies(context, portal: str) -> None:
    SESSIONS_DIR.mkdir(exist_ok=True)
    cookies = await context.cookies()
    plain = json.dumps(cookies).encode("utf-8")
    encrypted = win32crypt.CryptProtectData(plain, portal, None, None, None, 0)
    (SESSIONS_DIR / f"{portal}.bin").write_bytes(encrypted)
    # Remove legacy plain-text file if it exists
    old_json = SESSIONS_DIR / f"{portal}.json"
    if old_json.exists():
        old_json.unlink()


def _is_login_page(url: str) -> bool:
    login_indicators = [
        "accounts.zoho",
        "login.microsoftonline",
        "login.microsoft",
        "/signin",
        "/login",
        "auth/login",
    ]
    return any(indicator in url.lower() for indicator in login_indicators)


def _session_expired_response(portal: str) -> str:
    return json.dumps({
        "success": False,
        "error": "Session expired or not set up",
        "action": "run_setup",
        "instruction": f"Tell the user to type 'setup {portal} session' to open the portal in a browser and log in once via SSO.",
    })


def _not_configured_response(portal: str, var: str) -> str:
    return json.dumps({
        "success": False,
        "error": f"{var} environment variable is not configured",
        "instruction": f"Ask the admin to add {var} to the .env.local file.",
    })


# ── Tools ──────────────────────────────────────────────────────────────────────

@mcp.tool()
async def setup_portal_session(portal: str) -> str:
    """
    Open Edge non-headlessly so the user can complete SSO login for a portal.
    Saves the session cookies for headless reuse afterward.

    Args:
        portal: One of "zoho", "powerapps", or "payroll".

    Returns:
        JSON string indicating success or failure.
    """
    portal = portal.lower().strip()
    portal_map = {
        "zoho": (ZOHO_BASE_URL, "ZOHO_PEOPLE_URL"),
        "powerapps": (POWERAPPS_URL, "POWERAPPS_URL"),
        "payroll": (PAYROLL_URL, "PAYROLL_PORTAL_URL"),
    }

    if portal not in portal_map:
        return json.dumps({
            "success": False,
            "error": f"Unknown portal '{portal}'. Use 'zoho', 'powerapps', or 'payroll'.",
        })

    url, env_var = portal_map[portal]
    if not url:
        return _not_configured_response(portal, env_var)

    try:
        async with async_playwright() as p:
            context = await p.chromium.launch_persistent_context(
                user_data_dir=str(SESSIONS_DIR / f"{portal}_profile"),
                channel="msedge",
                headless=False,
                viewport={"width": 1280, "height": 800},
            )
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto(url)

            # Let the SSO redirect fully settle before polling the URL condition.
            # Without this, wait_for_function can fire true on the initial URL
            # before Zoho/Azure AD has had a chance to issue the login redirect.
            try:
                await page.wait_for_load_state("networkidle", timeout=15_000)
            except Exception:
                pass  # timeout is fine — just let the redirect happen

            # Wait until the user is on the portal home (not a login page)
            # Timeout: 3 minutes for the user to complete SSO
            await page.wait_for_function(
                "!window.location.href.includes('login') && "
                "!window.location.href.includes('signin') && "
                "!window.location.href.includes('accounts.zoho') && "
                "!window.location.href.includes('microsoftonline')",
                timeout=180_000,
                polling=2_000,
            )

            await _save_cookies(context, portal)
            await context.close()

        return json.dumps({
            "success": True,
            "message": f"Session for '{portal}' saved successfully. You can now use the portal automation.",
        })

    except Exception as e:
        return json.dumps({
            "success": False,
            "error": f"Setup failed: {str(e)}",
        })


@mcp.tool()
async def submit_zoho_leave(
    start_date: str,
    end_date: str,
    leave_type: str,
    reason: str = "",
) -> str:
    """
    Open Zoho People in a visible browser with the leave form pre-filled.
    The user reviews and clicks Submit themselves. Returns immediately after
    filling so the chat doesn't time out waiting for user interaction.

    Args:
        start_date: Leave start date in YYYY-MM-DD format.
        end_date:   Leave end date in YYYY-MM-DD format.
        leave_type: Leave type (e.g. "Casual", "Sick", "Earned", "Optional").
        reason:     Optional reason for the leave.

    Returns:
        JSON string indicating the browser was opened, or an error.
    """
    if not ZOHO_BASE_URL:
        return _not_configured_response("zoho", "ZOHO_PEOPLE_URL")

    # Quick session check before launching the browser
    if not (SESSIONS_DIR / "zoho.bin").exists():
        return _session_expired_response("zoho")

    # Fire-and-forget: spawn the fill script as an independent process.
    # DETACHED_PROCESS ensures it has no dependency on this process's
    # stdio handles, which is critical since we run over stdio transport.
    fill_script = Path(__file__).parent / "_zoho_fill.py"
    subprocess.Popen(
        [
            sys.executable, str(fill_script),
            start_date, end_date, leave_type, reason or "",
            str(SESSIONS_DIR), ZOHO_LEAVE_PAGE,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )

    from datetime import datetime as _dt
    def _fmt(iso: str) -> str:
        return _dt.strptime(iso, "%Y-%m-%d").strftime("%d %b %Y")

    return json.dumps({
        "success": True,
        "action_required": "user_submit",
        "message": (
            f"Opening Zoho leave form in Edge: {leave_type} leave "
            f"from {_fmt(start_date)} to {_fmt(end_date)}"
            + (f", reason: {reason}" if reason else "")
            + ". The browser is opening now — please review the pre-filled form "
            "and click Submit. The window closes automatically after 10 minutes."
        ),
    })


@mcp.tool()
async def submit_powerapps_complaint(
    category: str,
    description: str = "",
) -> str:
    """
    Log into the PowerApps complaints app using a saved SSO session and file a complaint.

    Args:
        category:    Complaint category (e.g. "Facility", "Food", "IT", "HR").
        description: Optional description of the complaint.

    Returns:
        JSON string with success status and reference number or error details.
    """
    if not POWERAPPS_URL:
        return _not_configured_response("powerapps", "POWERAPPS_URL")

    if "TODO" in POWERAPPS_CATEGORY_SEL:
        return json.dumps({
            "success": False,
            "error": "PowerApps selectors not yet configured",
            "instruction": "The portal selectors need to be updated in mcp_server/server.py after inspecting the PowerApps complaints app.",
        })

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel="msedge", headless=True)
            context = await browser.new_context()

            has_session = await _load_cookies(context, "powerapps")
            if not has_session:
                await browser.close()
                return _session_expired_response("powerapps")

            page = await context.new_page()
            await page.goto(POWERAPPS_URL, wait_until="networkidle", timeout=30_000)

            if _is_login_page(page.url):
                await browser.close()
                return _session_expired_response("powerapps")

            await page.wait_for_selector(POWERAPPS_CATEGORY_SEL, timeout=20_000)
            await page.select_option(POWERAPPS_CATEGORY_SEL, label=category)
            if description:
                await page.fill(POWERAPPS_DESC_SEL, description)

            await page.click(POWERAPPS_SUBMIT_SEL)
            await page.wait_for_selector(POWERAPPS_CONFIRM_SEL, timeout=15_000)

            confirmation = await page.text_content(POWERAPPS_CONFIRM_SEL)
            await _save_cookies(context, "powerapps")
            await browser.close()

        return json.dumps({
            "success": True,
            "message": f"Complaint filed in PowerApps: [{category}] {description[:60]}{'...' if len(description) > 60 else ''}",
            "confirmation": confirmation.strip() if confirmation else "",
        })

    except Exception as e:
        return json.dumps({
            "success": False,
            "error": f"PowerApps complaint submission failed: {str(e)}",
        })


@mcp.tool()
async def get_payroll_payslip(
    month: str,
    year: str,
) -> str:
    """
    Log into the payroll portal using a saved SSO session and retrieve the payslip
    for the specified month and year.

    Args:
        month: Month number as string (e.g. "6" for June, "12" for December).
        year:  Four-digit year string (e.g. "2025").

    Returns:
        JSON string with success status and payslip URL/confirmation or error details.
    """
    if not PAYROLL_URL:
        return _not_configured_response("payroll", "PAYROLL_PORTAL_URL")

    if "TODO" in PAYROLL_MONTH_SEL:
        return json.dumps({
            "success": False,
            "error": "Payroll selectors not yet configured",
            "instruction": "The portal selectors need to be updated in mcp_server/server.py after inspecting the payroll portal.",
        })

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel="msedge", headless=True)
            context = await browser.new_context()

            has_session = await _load_cookies(context, "payroll")
            if not has_session:
                await browser.close()
                return _session_expired_response("payroll")

            page = await context.new_page()
            payslip_url = f"{PAYROLL_URL}/payslip"
            await page.goto(payslip_url, wait_until="networkidle", timeout=30_000)

            if _is_login_page(page.url):
                await browser.close()
                return _session_expired_response("payroll")

            await page.wait_for_selector(PAYROLL_MONTH_SEL, timeout=15_000)
            await page.select_option(PAYROLL_MONTH_SEL, value=month)
            await page.select_option(PAYROLL_YEAR_SEL, value=year)
            await page.click(PAYROLL_SEARCH_SEL)
            await page.wait_for_selector(PAYROLL_SLIP_SEL, timeout=15_000)

            slip_element = await page.query_selector(PAYROLL_SLIP_SEL)
            slip_href = await slip_element.get_attribute("href") if slip_element else None

            await _save_cookies(context, "payroll")
            current_url = page.url
            await browser.close()

        month_names = ["", "January", "February", "March", "April", "May", "June",
                       "July", "August", "September", "October", "November", "December"]
        month_label = month_names[int(month)] if month.isdigit() and 1 <= int(month) <= 12 else month

        return json.dumps({
            "success": True,
            "message": f"Payslip for {month_label} {year} is ready.",
            "payslip_url": slip_href or current_url,
        })

    except Exception as e:
        return json.dumps({
            "success": False,
            "error": f"Payroll portal access failed: {str(e)}",
        })


if __name__ == "__main__":
    mcp.run(transport="stdio")
