"""
Subprocess helper for submit_powerapps_complaint (fire-and-forget).
Opens Edge with the PowerApps "Admin Action Tracker" app, clicks "+ New Ticket",
and pre-fills Priority, Location, and Action Item.
The user reviews, attaches files if needed, and clicks "Submit Ticket" themselves.

Usage:
  python _powerapps_fill.py <action_item> <priority> <location>
                            <sessions_dir> <powerapps_url>

Valid priority values : High, Medium, Low
Valid location values : T-1 6th Floor | T-2 10th Floor | T-3 6th Floor |
                        T-3 8th Floor | Bangalore Office | Indore Office | Other

Writes progress + errors to <sessions_dir>/powerapps_fill.log.
Keeps the browser open for 10 minutes, then closes automatically.
"""
import sys
import asyncio
import traceback
from pathlib import Path

SESSIONS_DIR = Path(sys.argv[4]) if len(sys.argv) > 4 else Path(__file__).parent / "sessions"
LOG = SESSIONS_DIR / "powerapps_fill.log"


def _log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")
        f.flush()


_log(f"[powerapps_fill] started: {' '.join(sys.argv)}")

try:
    from playwright.async_api import async_playwright, Page
    _log("[powerapps_fill] imports OK")
except Exception as e:
    _log(f"[powerapps_fill] IMPORT ERROR: {e}\n{traceback.format_exc()}")
    sys.exit(1)

VALID_LOCATIONS  = [
    "T-1 6th Floor", "T-2 10th Floor", "T-3 6th Floor",
    "T-3 8th Floor", "Bangalore Office", "Indore Office", "Other",
]
VALID_PRIORITIES = ["High", "Medium", "Low"]


def _is_login(url: str) -> bool:
    return any(x in url.lower() for x in [
        "login.microsoftonline", "login.microsoft", "/signin", "/login",
    ])


async def _click_new_ticket(page: "Page") -> bool:
    """Click the '+ New Ticket' button on the Admin Action Tracker home screen."""
    strategies = [
        page.get_by_role("button", name="New Ticket"),
        page.locator('button:has-text("New Ticket")'),
        page.locator('[aria-label*="New Ticket"]'),
        page.get_by_text("+ New Ticket", exact=False),
        page.get_by_text("New Ticket", exact=False),
    ]
    for loc in strategies:
        try:
            if await loc.count() > 0:
                await loc.first.click(timeout=8_000)
                _log("[powerapps_fill] clicked '+ New Ticket'")
                return True
        except Exception:
            continue
    _log("[powerapps_fill] WARNING: could not find '+ New Ticket' button")
    return False


async def _select_dropdown(page: "Page", label: str, value: str) -> bool:
    """
    Click a PowerApps dropdown by its visible label text and select a value.
    Tries multiple locator strategies.
    """
    if not value:
        return False

    trigger_strategies = [
        page.get_by_role("combobox", name=label),
        page.locator(f'[aria-label="{label}"]'),
        page.locator(f'[aria-label="{label} "]'),
        page.locator(f'[title="{label}"]'),
        page.get_by_label(label),
    ]
    opened = False
    for loc in trigger_strategies:
        try:
            if await loc.count() > 0:
                await loc.first.click(timeout=6_000)
                opened = True
                _log(f"[powerapps_fill] opened '{label}' dropdown")
                break
        except Exception:
            continue

    if not opened:
        _log(f"[powerapps_fill] WARNING: could not locate '{label}' dropdown")
        return False

    await asyncio.sleep(0.6)

    option_strategies = [
        page.get_by_role("option", name=value, exact=True),
        page.get_by_role("option", name=value, exact=False),
        page.locator(f'[role="option"]:has-text("{value}")'),
        page.locator(f'li:has-text("{value}")'),
        page.get_by_text(value, exact=True).first,
    ]
    for loc in option_strategies:
        try:
            if await loc.count() > 0:
                await loc.first.click(timeout=5_000)
                _log(f"[powerapps_fill] '{label}' set to '{value}'")
                return True
        except Exception:
            continue

    _log(f"[powerapps_fill] WARNING: option '{value}' not found in '{label}' — user can select manually")
    return False


async def _fill_textarea(page: "Page", label: str, value: str) -> bool:
    """Fill a PowerApps text input / textarea by its aria-label."""
    if not value:
        return False

    strategies = [
        page.get_by_label(label),
        page.locator(f'[aria-label="{label}"]'),
        page.locator(f'textarea[aria-label="{label}"]'),
        page.locator(f'[title="{label}"]'),
        page.get_by_role("textbox", name=label),
    ]
    for loc in strategies:
        try:
            if await loc.count() > 0:
                await loc.first.click(timeout=6_000)
                await asyncio.sleep(0.2)
                await loc.first.fill(value)
                _log(f"[powerapps_fill] '{label}' filled")
                return True
        except Exception:
            continue

    _log(f"[powerapps_fill] WARNING: could not locate '{label}' textarea")
    return False


async def main():
    if len(sys.argv) < 6:
        _log("[powerapps_fill] ERROR: not enough arguments")
        return

    action_item   = sys.argv[1]
    priority      = sys.argv[2]
    location      = sys.argv[3]
    powerapps_url = sys.argv[5]

    profile_dir = SESSIONS_DIR / "powerapps_profile"
    if not profile_dir.exists():
        _log("[powerapps_fill] ERROR: powerapps_profile not found — run setup_portal_session('powerapps') first")
        return

    _log("[powerapps_fill] launching Edge with persistent profile...")
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            channel="msedge",
            headless=False,
            viewport={"width": 1400, "height": 900},
        )
        page = context.pages[0] if context.pages else await context.new_page()

        try:
            _log(f"[powerapps_fill] navigating to Admin Action Tracker: {powerapps_url}")
            await page.goto(powerapps_url, wait_until="networkidle", timeout=45_000)
            _log(f"[powerapps_fill] page loaded, url={page.url}")
        except Exception as e:
            _log(f"[powerapps_fill] navigation error: {e}")
            await context.close()
            return

        if _is_login(page.url):
            _log("[powerapps_fill] redirected to login — session expired, run setup_portal_session('powerapps')")
            await context.close()
            return

        # PowerApps canvas apps need extra time to fully render all controls
        _log("[powerapps_fill] waiting for app to render...")
        await asyncio.sleep(5)

        # Step 1: Click "+ New Ticket" to open the complaint form
        if not await _click_new_ticket(page):
            _log("[powerapps_fill] could not open form — user can click '+ New Ticket' manually")

        # Wait for the form/modal to open and its controls to render
        await asyncio.sleep(2)

        filled = []

        # Step 2: Fill Priority dropdown (High / Medium / Low)
        if priority in VALID_PRIORITIES:
            if await _select_dropdown(page, "Priority", priority):
                filled.append(f"priority={priority}")
        await asyncio.sleep(0.4)

        # Step 3: Fill Location dropdown
        if location in VALID_LOCATIONS:
            if await _select_dropdown(page, "Location", location):
                filled.append(f"location={location}")
        await asyncio.sleep(0.4)

        # Step 4: Fill Action Item textarea
        if await _fill_textarea(page, "Action Item", action_item):
            filled.append("action_item")
        await asyncio.sleep(0.3)

        summary = (
            ", ".join(filled) if filled
            else "form opened — selectors may need adjustment, see powerapps_fill.log"
        )
        _log(
            f"[powerapps_fill] form ready ({summary})"
            " — user can attach files if needed and click Submit Ticket (10 min window)"
        )

        # INTENTIONALLY no Submit click — the user must review and submit manually.
        # Never add code here that clicks "Submit Ticket" automatically.
        await asyncio.sleep(600)
        await context.close()
        _log("[powerapps_fill] browser closed")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        _log(f"[powerapps_fill] FATAL:\n{traceback.format_exc()}")
