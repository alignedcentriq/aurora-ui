"""
Subprocess helper for get_zoho_leave_balance.
Runs headlessly (no visible browser window) — scrapes live leave balance
from Zoho People and writes the result to a JSON file, then exits.

Usage:
  python _zoho_balance.py <sessions_dir> <zoho_balance_page> <result_file>

Writes result JSON to <result_file>.
Writes log to <sessions_dir>/zoho_balance.log.
"""
import sys
import json
import asyncio
import traceback
from pathlib import Path

# ── Logging setup ──────────────────────────────────────────────────────────────
SESSIONS_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "sessions"
LOG = SESSIONS_DIR / "zoho_balance.log"


def _log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")
        f.flush()


_log(f"[zoho_balance] started: {' '.join(sys.argv)}")

try:
    import win32crypt
    from playwright.async_api import async_playwright
    _log("[zoho_balance] imports OK")
except Exception as e:
    _log(f"[zoho_balance] IMPORT ERROR: {e}\n{traceback.format_exc()}")
    sys.exit(1)


def _is_login(url: str) -> bool:
    return any(x in url.lower() for x in [
        "accounts.zoho", "login.microsoftonline", "/signin", "/login",
    ])


async def main():
    balance_page = sys.argv[2] if len(sys.argv) > 2 else ""
    result_file  = Path(sys.argv[3]) if len(sys.argv) > 3 else SESSIONS_DIR / "zoho_balance_result.json"

    cookie_path = SESSIONS_DIR / "zoho.bin"
    if not cookie_path.exists():
        _log("[zoho_balance] ERROR: zoho.bin not found")
        result_file.write_text(json.dumps({
            "success": False,
            "error": "Session not set up",
            "action": "run_setup",
        }), encoding="utf-8")
        return

    _log("[zoho_balance] launching headless Edge...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        _log("[zoho_balance] browser launched (headless)")
        context = await browser.new_context()

        try:
            encrypted = cookie_path.read_bytes()
            _, plain = win32crypt.CryptUnprotectData(encrypted, None, None, None, 0)
            await context.add_cookies(json.loads(plain.decode("utf-8")))
            _log("[zoho_balance] cookies loaded")
        except Exception as e:
            _log(f"[zoho_balance] cookie load error: {e}")
            await browser.close()
            result_file.write_text(json.dumps({
                "success": False,
                "error": f"Cookie load failed: {e}",
                "action": "run_setup",
            }), encoding="utf-8")
            return

        page = await context.new_page()

        try:
            _log(f"[zoho_balance] navigating to {balance_page}")
            await page.goto(balance_page, wait_until="networkidle", timeout=30_000)
            _log(f"[zoho_balance] page loaded, url={page.url}")
        except Exception as e:
            _log(f"[zoho_balance] navigation error: {e}")
            await browser.close()
            result_file.write_text(json.dumps({
                "success": False,
                "error": f"Navigation failed: {e}",
            }), encoding="utf-8")
            return

        if _is_login(page.url):
            _log("[zoho_balance] redirected to login — session expired")
            await browser.close()
            result_file.write_text(json.dumps({
                "success": False,
                "error": "Session expired",
                "action": "run_setup",
            }), encoding="utf-8")
            return

        # Wait for the leave balance section to render (Zoho SPA)
        balance_selectors = [
            ".zp-leave-balance-list",
            ".zplisticonview-data",
            "[class*='leavebalance']",
            "[class*='leave-balance']",
            ".zp-lb-container",
            "#leavebalancecontent",
            ".zp-leavebalance",
        ]
        rendered = False
        for sel in balance_selectors:
            try:
                await page.wait_for_selector(sel, timeout=15_000)
                _log(f"[zoho_balance] found selector: {sel}")
                rendered = True
                break
            except Exception:
                continue

        if not rendered:
            # Give the page a bit more time to settle even without a known selector
            _log("[zoho_balance] no known selector found — waiting extra 5s")
            await asyncio.sleep(5)

        # ── Scrape structured data ─────────────────────────────────────────────
        balances = []

        # Strategy 1: try to find leave type cards / rows with numeric data
        # Zoho People typically renders leave balance as a list of cards with:
        # leave type name + total / used / balance numbers
        try:
            # Try table-based layout first
            rows = await page.query_selector_all("tr")
            for row in rows:
                cells = await row.query_selector_all("td, th")
                if len(cells) >= 3:
                    texts = []
                    for cell in cells:
                        t = (await cell.inner_text()).strip()
                        texts.append(t)
                    # Heuristic: if first cell looks like a leave type name and others are digits
                    if texts[0] and not texts[0].isdigit():
                        nums = []
                        for t in texts[1:]:
                            try:
                                nums.append(float(t))
                            except ValueError:
                                pass
                        if len(nums) >= 2:
                            entry = {"type": texts[0]}
                            if len(nums) >= 3:
                                entry["total"]   = nums[0]
                                entry["used"]    = nums[1]
                                entry["balance"] = nums[2]
                            else:
                                entry["used"]    = nums[0]
                                entry["balance"] = nums[1]
                            balances.append(entry)
        except Exception as e:
            _log(f"[zoho_balance] table strategy error: {e}")

        # Strategy 2: Zoho People card/tile layout — look for named leave type containers
        if not balances:
            try:
                containers = await page.query_selector_all(
                    ".zp-leave-balance-list > *, .zplisticonview-data > *, [class*='leavebalance'] > *"
                )
                for container in containers:
                    text = (await container.inner_text()).strip()
                    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
                    if not lines:
                        continue
                    entry = {"type": lines[0]}
                    nums = []
                    for line in lines[1:]:
                        try:
                            nums.append(float(line))
                        except ValueError:
                            pass
                    if len(nums) >= 2:
                        if len(nums) >= 3:
                            entry["total"]   = nums[0]
                            entry["used"]    = nums[1]
                            entry["balance"] = nums[2]
                        else:
                            entry["used"]    = nums[0]
                            entry["balance"] = nums[1]
                        balances.append(entry)
            except Exception as e:
                _log(f"[zoho_balance] card strategy error: {e}")

        # Always capture raw page text as fallback for LLM parsing
        raw_text = ""
        try:
            raw_text = await page.inner_text("body")
            # Trim to relevant section — find "leave balance" heading and take next 2000 chars
            lower = raw_text.lower()
            idx = lower.find("leave balance")
            if idx == -1:
                idx = lower.find("casual")
            if idx != -1:
                raw_text = raw_text[max(0, idx - 50): idx + 2000]
        except Exception as e:
            _log(f"[zoho_balance] raw text error: {e}")

        await browser.close()
        _log(f"[zoho_balance] browser closed. Found {len(balances)} entries.")

    result = {
        "success": True,
        "balances": balances,
        "raw_text": raw_text,
    }
    result_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    _log(f"[zoho_balance] result written to {result_file}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception:
        _log(f"[zoho_balance] FATAL:\n{traceback.format_exc()}")
        result_file = Path(sys.argv[3]) if len(sys.argv) > 3 else (
            (Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "sessions")
            / "zoho_balance_result.json"
        )
        try:
            result_file.write_text(json.dumps({
                "success": False,
                "error": "Script crashed — see zoho_balance.log",
            }), encoding="utf-8")
        except Exception:
            pass
