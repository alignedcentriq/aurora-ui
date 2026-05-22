"""
Helper: opens Zoho leave form in a visible Edge window using the saved session.
Keeps the browser open for 5 minutes so you can inspect elements with F12.
Nothing is submitted — close the browser or press Ctrl+C when done.
"""
import asyncio
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
os.chdir(Path(__file__).parent)

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env.local", override=True)

import win32crypt
import json
from playwright.async_api import async_playwright

SESSIONS_DIR = Path(__file__).parent / "mcp_server" / "sessions"
ZOHO_URL = os.environ.get("ZOHO_PEOPLE_URL", "").rstrip("/") + "#leavetracker/mydata/applyleave"


async def main():
    print(f"Opening: {ZOHO_URL}")
    print("Use F12 DevTools to inspect form elements.")
    print("Press Ctrl+C here when done.\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=False)
        context = await browser.new_context()

        # Load saved session cookies
        cookie_path = SESSIONS_DIR / "zoho.bin"
        if cookie_path.exists():
            encrypted = cookie_path.read_bytes()
            _, plain = win32crypt.CryptUnprotectData(encrypted, None, None, None, 0)
            await context.add_cookies(json.loads(plain.decode("utf-8")))
            print("Session cookies loaded.")
        else:
            print("No saved session found — you may need to log in manually.")

        page = await context.new_page()
        await page.goto(ZOHO_URL, wait_until="networkidle", timeout=30_000)
        print(f"Page loaded. Current URL: {page.url}")
        print("Browser will stay open for 5 minutes. Inspect away.")

        await asyncio.sleep(300)
        await browser.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nClosed.")
