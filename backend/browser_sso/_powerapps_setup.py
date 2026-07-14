"""
Standalone PowerApps SSO session-setup script.
Spawned as a background process by setup_powerapps_session tool.

Opens Edge with a persistent profile, waits for Azure AD SSO to complete,
then keeps the browser on the app for 5 seconds to confirm login before exiting.
The persistent profile directory IS the session — no separate .bin file needed.
"""
import os
import sys
import asyncio
import traceback
from pathlib import Path

SESSIONS_DIR = Path(__file__).parent / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)
LOG = SESSIONS_DIR / "powerapps_setup.log"


def _log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")
        f.flush()


_log(f"[powerapps_setup] script started")

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env.local", override=False)
    _log("[powerapps_setup] .env.local loaded")
except Exception as e:
    _log(f"[powerapps_setup] .env.local load skipped: {e}")

try:
    from playwright.async_api import async_playwright
    _log("[powerapps_setup] playwright imported OK")
except Exception as e:
    _log(f"[powerapps_setup] IMPORT ERROR: {e}\n{traceback.format_exc()}")
    sys.exit(1)


def _is_login(url: str) -> bool:
    return any(x in url.lower() for x in [
        "login.microsoftonline", "login.microsoft", "/signin", "/login",
    ])


async def main():
    powerapps_url = os.environ.get("POWERAPPS_URL", "")
    if not powerapps_url:
        _log("[powerapps_setup] ERROR: POWERAPPS_URL not set in .env.local")
        print("ERROR: POWERAPPS_URL not configured. Add it to .env.local and restart.")
        sys.exit(1)

    _log(f"[powerapps_setup] target URL: {powerapps_url}")

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(SESSIONS_DIR / "powerapps_profile"),
            channel="msedge",
            headless=False,
            viewport={"width": 1400, "height": 900},
        )
        page = context.pages[0] if context.pages else await context.new_page()

        _log("[powerapps_setup] navigating to PowerApps...")
        try:
            await page.goto(powerapps_url, timeout=30_000)
        except Exception as e:
            _log(f"[powerapps_setup] navigation error (continuing): {e}")

        # Allow redirects (Azure AD login page) to fully settle before polling
        await asyncio.sleep(4)
        _log(f"[powerapps_setup] current url after settle: {page.url}")

        if _is_login(page.url):
            _log("[powerapps_setup] on Azure AD login page — waiting up to 3 min for user to sign in...")
            try:
                # Poll every 2s until we land on a non-login URL
                await page.wait_for_function(
                    "(function() {"
                    "  var h = window.location.href.toLowerCase();"
                    "  return !h.includes('login.microsoftonline')"
                    "      && !h.includes('login.microsoft')"
                    "      && !h.includes('/signin')"
                    "      && !h.includes('/login');"
                    "})()",
                    timeout=180_000,
                    polling=2_000,
                )
                _log(f"[powerapps_setup] login complete, url: {page.url}")
            except Exception as e:
                _log(f"[powerapps_setup] login wait timed out or failed: {e}")
                await context.close()
                return
        else:
            _log(f"[powerapps_setup] already logged in at: {page.url}")

        # Let the app fully render before we close
        _log("[powerapps_setup] waiting for app to render...")
        await asyncio.sleep(5)

        await context.close()
        _log("[powerapps_setup] session profile saved — setup complete")
        print("PowerApps session saved. You can now raise complaints via the assistant.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        _log(f"[powerapps_setup] FATAL:\n{traceback.format_exc()}")
