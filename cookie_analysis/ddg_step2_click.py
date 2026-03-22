#!/usr/bin/env python3
"""
Step 2: Load a site with DDG extension, click a specific element, capture post-click state.
Uses pre-recorded blocked requests from step 1 as baseline.

Usage: python3 ddg_step2_click.py <site_name> <site_url> <click_x> <click_y>
  OR: python3 ddg_step2_click.py <site_name> <site_url> --selector '<css_selector>'
  OR: python3 ddg_step2_click.py <site_name> <site_url> --text '<button_text>'
"""

import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime
from urllib.parse import urlparse
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

EXT_PATH = "/workspace/duckduckgo-privacy-extension/build/chrome/release"
STATE_DIR = "/workspace/cookie_analysis/ddg_states"
SCREENSHOT_DIR = "/workspace/cookie_analysis/ddg_screenshots"
RESULTS_DIR = "/workspace/cookie_analysis/results"


async def main():
    if len(sys.argv) < 4:
        print("Usage: python3 ddg_step2_click.py <site_name> <site_url> <click_x> <click_y>")
        print("   OR: python3 ddg_step2_click.py <site_name> <site_url> --selector '<css>'")
        print("   OR: python3 ddg_step2_click.py <site_name> <site_url> --text '<text>'")
        sys.exit(1)

    site_name = sys.argv[1]
    site_url = sys.argv[2]
    safe_name = site_name.replace(".", "_").replace("/", "_")

    click_x, click_y = None, None
    click_selector = None
    click_text = None

    if sys.argv[3] == "--selector":
        click_selector = sys.argv[4]
    elif sys.argv[3] == "--text":
        click_text = sys.argv[4]
    else:
        click_x = int(sys.argv[3])
        click_y = int(sys.argv[4])

    # Load step 1 state for baseline
    state_path = os.path.join(STATE_DIR, f"{safe_name}.json")
    if os.path.exists(state_path):
        with open(state_path) as f:
            step1_state = json.load(f)
        baseline_blocked = step1_state["blocked_requests_count"]
        baseline_total = step1_state["total_requests"]
        baseline_blocked_urls = set(b["url"] for b in step1_state["blocked_requests"])
    else:
        baseline_blocked = 0
        baseline_total = 0
        baseline_blocked_urls = set()

    os.makedirs(RESULTS_DIR, exist_ok=True)

    async with async_playwright() as p:
        user_data = tempfile.mkdtemp()
        context = await p.chromium.launch_persistent_context(
            user_data,
            headless=False,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                f"--disable-extensions-except={EXT_PATH}",
                f"--load-extension={EXT_PATH}",
            ],
            ignore_https_errors=True,
            viewport={"width": 1440, "height": 900},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            locale="en-US",
            timezone_id="America/New_York",
        )

        await asyncio.sleep(5)

        for pg in context.pages[1:]:
            try:
                await pg.close()
            except Exception:
                pass

        page = context.pages[0] if context.pages else await context.new_page()

        # Phase 1: load and record pre-click state
        pre_requests = []
        pre_blocked = []
        phase = {"current": "before"}
        post_requests = []
        post_blocked = []

        def on_request(req):
            url = req.url
            if url.startswith("data:") or url.startswith("blob:") or url.startswith("chrome-extension:"):
                return
            entry = {"url": url, "domain": urlparse(url).netloc, "type": req.resource_type}
            if phase["current"] == "before":
                pre_requests.append(entry)
            else:
                post_requests.append(entry)

        def on_request_failed(req):
            url = req.url
            if url.startswith("data:") or url.startswith("blob:") or url.startswith("chrome-extension:"):
                return
            failure = req.failure
            if failure and "net::ERR_BLOCKED_BY_CLIENT" in failure:
                entry = {"url": url, "domain": urlparse(url).netloc, "type": req.resource_type}
                if phase["current"] == "before":
                    pre_blocked.append(entry)
                else:
                    post_blocked.append(entry)

        page.on("request", on_request)
        page.on("requestfailed", on_request_failed)

        try:
            await page.goto(site_url, wait_until="domcontentloaded", timeout=25000)
        except PlaywrightTimeout:
            pass
        except Exception as e:
            print(f"Navigation error: {e}")

        await asyncio.sleep(8)

        # Switch to post-click phase
        pre_urls = set(r["url"] for r in pre_requests)
        phase["current"] = "after"

        # Perform the click
        click_success = False
        click_method = ""
        try:
            if click_selector:
                await page.click(click_selector, timeout=5000)
                click_method = f"selector: {click_selector}"
                click_success = True
            elif click_text:
                # Try to find by text content
                el = page.get_by_text(click_text, exact=True).first
                await el.click(timeout=5000)
                click_method = f"text: {click_text}"
                click_success = True
            else:
                await page.mouse.click(click_x, click_y)
                click_method = f"coords: ({click_x}, {click_y})"
                click_success = True
        except Exception as e:
            print(f"Click failed ({click_method or 'unknown'}): {e}")
            click_method = f"FAILED: {e}"

        await asyncio.sleep(5)

        # Screenshot after click
        ss_path = os.path.join(SCREENSHOT_DIR, f"{safe_name}_after.png")
        try:
            await page.screenshot(path=ss_path, full_page=False, timeout=10000)
        except Exception:
            ss_path = None

        # Calculate new blocked requests
        new_blocked = [b for b in post_blocked if b["url"] not in pre_urls]
        new_requests = [r for r in post_requests if r["url"] not in pre_urls]

        result = {
            "site": site_name,
            "url": site_url,
            "timestamp": datetime.now().isoformat(),
            "click_method": click_method,
            "click_success": click_success,
            "before_accept": {
                "total_requests": len(pre_requests),
                "blocked_requests": len(pre_blocked),
                "blocked_domains": sorted(set(b["domain"] for b in pre_blocked)),
            },
            "after_accept": {
                "total_new_requests": len(new_requests),
                "new_blocked_requests": len(new_blocked),
                "new_blocked_domains": sorted(set(b["domain"] for b in new_blocked)),
                "new_blocked_urls": [b["url"] for b in new_blocked],
            },
            "screenshot_after": ss_path,
            "status": "analyzed" if click_success else "click_failed",
        }

        result_path = os.path.join(RESULTS_DIR, f"ddg_{safe_name}.json")
        with open(result_path, "w") as f:
            json.dump(result, f, indent=2)

        print(json.dumps({
            "site": site_name,
            "click": click_method,
            "success": click_success,
            "before": {"blocked": len(pre_blocked), "total": len(pre_requests)},
            "after": {"new_blocked": len(new_blocked), "new_total": len(new_requests)},
            "new_blocked_domains": sorted(set(b["domain"] for b in new_blocked)),
        }, indent=2))

        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
