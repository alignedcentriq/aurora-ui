"""
Subprocess helper for submit_zoho_leave.
Opened by server.py as an independent DETACHED_PROCESS so the browser stays
alive regardless of the MCP server's asyncio event loop lifecycle.

Usage:
  python _zoho_fill.py <start_date> <end_date> <leave_type> <reason> <sessions_dir> <zoho_leave_page>

Writes result + any errors to <sessions_dir>/zoho_fill.log.
Keeps the process alive for 10 minutes so the browser stays open.
"""
import sys
import json
import asyncio
import traceback
from datetime import datetime
from pathlib import Path

# ── Logging setup (before any imports that might fail) ────────────────────────
SESSIONS_DIR = Path(sys.argv[5]) if len(sys.argv) > 5 else Path(__file__).parent / "sessions"
LOG = SESSIONS_DIR / "zoho_fill.log"

def _log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")
        f.flush()

_log(f"[zoho_fill] started: {' '.join(sys.argv)}")

try:
    import win32crypt
    from playwright.async_api import async_playwright
    _log("[zoho_fill] imports OK")
except Exception as e:
    _log(f"[zoho_fill] IMPORT ERROR: {e}\n{traceback.format_exc()}")
    sys.exit(1)

ZOHO_LEAVE_TYPE_SEL = "#zp_field_723706000000036105-container"
ZOHO_DATE_INPUT_SEL = ".zinputfield__textbox"
ZOHO_REASON_SEL     = "textarea[name='Reasonforleave']"


def _fmt_display(iso: str) -> str:
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%d/%m/%Y")


def _is_login(url: str) -> bool:
    return any(x in url.lower() for x in [
        "accounts.zoho", "login.microsoftonline", "/signin", "/login",
    ])


async def main():
    start_date   = sys.argv[1]
    end_date     = sys.argv[2]
    leave_type   = sys.argv[3]
    reason       = sys.argv[4]
    leave_page   = sys.argv[6]

    cookie_path = SESSIONS_DIR / "zoho.bin"
    if not cookie_path.exists():
        _log("[zoho_fill] ERROR: zoho.bin not found")
        return

    _log("[zoho_fill] launching Edge...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=False)
        _log("[zoho_fill] browser launched")
        context = await browser.new_context()

        try:
            encrypted = cookie_path.read_bytes()
            _, plain = win32crypt.CryptUnprotectData(encrypted, None, None, None, 0)
            await context.add_cookies(json.loads(plain.decode("utf-8")))
            _log("[zoho_fill] cookies loaded")
        except Exception as e:
            _log(f"[zoho_fill] cookie load error: {e}")
            await browser.close()
            return

        page = await context.new_page()

        try:
            _log(f"[zoho_fill] navigating to {leave_page}")
            await page.goto(leave_page, wait_until="networkidle", timeout=30_000)
            _log(f"[zoho_fill] page loaded, url={page.url}")
        except Exception as e:
            _log(f"[zoho_fill] navigation error: {e}")
            await browser.close()
            return

        if _is_login(page.url):
            _log("[zoho_fill] redirected to login page — session expired")
            await browser.close()
            return

        fill_ok = False
        try:
            # Leave type dropdown
            await page.wait_for_selector(ZOHO_LEAVE_TYPE_SEL, timeout=15_000)
            await page.click(ZOHO_LEAVE_TYPE_SEL)
            await asyncio.sleep(0.8)

            # Try several selector strategies for dropdown options
            selected = False
            strategies = [
                page.locator(f'[role="option"]:has-text("{leave_type}")'),
                page.locator(f'.zselectbox-option:has-text("{leave_type}")'),
                page.locator(f'li:has-text("{leave_type}")'),
                page.get_by_text(leave_type, exact=False).first,
            ]
            for loc in strategies:
                try:
                    cnt = await loc.count()
                    if cnt > 0:
                        await loc.first.click(timeout=5_000)
                        selected = True
                        break
                except Exception:
                    continue

            if not selected:
                _log(f"[zoho_fill] WARNING: could not select leave type '{leave_type}' — form opened, user can select manually")
            else:
                _log("[zoho_fill] leave type selected")
            await asyncio.sleep(0.3)

            # Dates — Zoho uses a segmented date picker (dd/mm/yyyy).
            # Type each segment (day, month, year) separately with Tab between
            # them. Do NOT use slashes — after day auto-advances to month,
            # a "/" skips month entirely and jumps to year.
            from_input = page.locator(ZOHO_DATE_INPUT_SEL).nth(0)
            to_input   = page.locator(ZOHO_DATE_INPUT_SEL).nth(1)

            async def _fill_date(inp, iso_date: str):
                d = datetime.strptime(iso_date, "%Y-%m-%d")
                # Click at left edge to land on day segment
                box = await inp.bounding_box()
                if box:
                    await page.mouse.click(box["x"] + 4, box["y"] + box["height"] / 2)
                else:
                    await inp.click()
                await asyncio.sleep(0.3)
                # Type all 8 digits with no separators — Zoho auto-advances
                # from day→month→year after each 2-digit segment fills.
                # Tab skips segments (jumps day→year), slashes also skip,
                # so raw digits DDMMYYYY is the only reliable approach.
                digits = d.strftime("%d%m%Y")  # e.g. "10062026"
                await page.keyboard.type(digits, delay=120)
                await asyncio.sleep(0.3)

            await _fill_date(from_input, start_date)
            await asyncio.sleep(0.3)
            await _fill_date(to_input, end_date)
            await asyncio.sleep(0.3)
            _log("[zoho_fill] dates filled")

            if reason:
                await page.fill(ZOHO_REASON_SEL, reason)
                await asyncio.sleep(0.2)
                _log("[zoho_fill] reason filled")

            fill_ok = True

        except Exception as e:
            _log(f"[zoho_fill] form fill error: {e}\n{traceback.format_exc()}")

        # Always keep browser open for 10 min so user can review / submit manually
        _log(f"[zoho_fill] form {'ready' if fill_ok else 'partially filled (see errors above)'} — waiting for user to submit (10 min)")
        await asyncio.sleep(600)

        await browser.close()
        _log("[zoho_fill] browser closed")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        _log(f"[zoho_fill] FATAL:\n{traceback.format_exc()}")
