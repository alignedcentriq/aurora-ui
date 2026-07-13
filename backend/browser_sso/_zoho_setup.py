"""
Standalone Zoho SSO session-setup script.
Spawned as a background process by setup_zoho_session tool.
Opens Edge non-headlessly, waits up to 3 min for the user to complete SSO,
then saves DPAPI-encrypted cookies and exits.
"""
import sys
import json
import asyncio
import traceback
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env.local", override=False)
except Exception:
    pass

import os
import win32crypt
from playwright.async_api import async_playwright

SESSIONS_DIR = Path(__file__).parent / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)
LOG = SESSIONS_DIR / "zoho_setup.log"


def _log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")
        f.flush()


async def main():
    zoho_url = os.environ.get("ZOHO_PEOPLE_URL", "").rstrip("/")
    if not zoho_url:
        _log("[zoho_setup] ERROR: ZOHO_PEOPLE_URL not configured")
        sys.exit(1)

    _log(f"[zoho_setup] starting setup for {zoho_url}")

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(SESSIONS_DIR / "zoho_profile"),
            channel="msedge",
            headless=False,
            viewport={"width": 1280, "height": 800},
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(zoho_url)

        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            pass

        _log("[zoho_setup] waiting for user to complete SSO (3 min timeout)...")

        await page.wait_for_function(
            "!window.location.href.includes('login') && "
            "!window.location.href.includes('signin') && "
            "!window.location.href.includes('accounts.zoho') && "
            "!window.location.href.includes('microsoftonline')",
            timeout=180_000,
            polling=2_000,
        )

        cookies = await context.cookies()
        plain = json.dumps(cookies).encode("utf-8")
        encrypted = win32crypt.CryptProtectData(plain, "zoho", None, None, None, 0)
        (SESSIONS_DIR / "zoho.bin").write_bytes(encrypted)

        old_json = SESSIONS_DIR / "zoho.json"
        if old_json.exists():
            old_json.unlink()

        await context.close()

    _log("[zoho_setup] session saved successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        _log(f"[zoho_setup] FATAL:\n{traceback.format_exc()}")
