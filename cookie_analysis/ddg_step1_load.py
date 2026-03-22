#!/usr/bin/env python3
"""
Step 1: Load a site with DDG extension, wait, take screenshot + DOM snapshot.
Records all requests and blocked requests during load.
Saves state to a JSON file for the next step.

Usage: python3 ddg_step1_load.py <site_name> <site_url>
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

JS_DOM_SNAPSHOT = """
() => {
    const results = [];
    const selectors = [
        '[class*="cookie" i]', '[class*="consent" i]', '[class*="banner" i]',
        '[class*="notice" i]', '[class*="gdpr" i]', '[class*="privacy" i]',
        '[class*="popup" i]', '[class*="modal" i]', '[class*="overlay" i]',
        '[id*="cookie" i]', '[id*="consent" i]', '[id*="banner" i]',
        '[id*="notice" i]', '[id*="gdpr" i]', '[id*="privacy" i]',
        '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
        '#onetrust-banner-sdk', '#CybotCookiebotDialog',
        '.cc-banner', '.cc-window', '.cc-compliance',
        '[class*="CookieConsent" i]', '[class*="cookie-banner" i]',
        '[class*="cookie_banner" i]', '[class*="cookieBanner" i]',
        '[class*="sliding-popup" i]', '[class*="cookiescript" i]',
    ];

    const seen = new Set();
    for (const sel of selectors) {
        try {
            for (const el of document.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);
                const rect = el.getBoundingClientRect();
                if (rect.width < 50 || rect.height < 20) continue;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') continue;

                const buttons = [];
                const clickables = el.querySelectorAll(
                    'button, a, [role="button"], input[type="button"], input[type="submit"], ' +
                    'div[onclick], span[onclick], div[class*="btn" i], div[class*="accept" i], ' +
                    'div[class*="close" i], div[class*="dismiss" i]'
                );
                for (const btn of clickables) {
                    const br = btn.getBoundingClientRect();
                    if (br.width === 0 || br.height === 0) continue;
                    const bs = window.getComputedStyle(btn);
                    if (bs.display === 'none' || bs.visibility === 'hidden') continue;
                    buttons.push({
                        tag: btn.tagName.toLowerCase(),
                        text: (btn.textContent || '').trim().substring(0, 200),
                        ariaLabel: (btn.getAttribute('aria-label') || '').substring(0, 100),
                        classes: (btn.className || '').toString().substring(0, 300),
                        id: (btn.id || '').substring(0, 100),
                        x: Math.round(br.x + br.width / 2),
                        y: Math.round(br.y + br.height / 2),
                        w: Math.round(br.width),
                        h: Math.round(br.height),
                    });
                }

                results.push({
                    tag: el.tagName.toLowerCase(),
                    classes: (el.className || '').toString().substring(0, 300),
                    id: (el.id || '').substring(0, 100),
                    text: (el.textContent || '').trim().substring(0, 500),
                    rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)},
                    buttons: buttons,
                });
            }
        } catch (e) {}
    }
    return results;
}
"""


async def main():
    if len(sys.argv) < 3:
        print("Usage: python3 ddg_step1_load.py <site_name> <site_url>")
        sys.exit(1)

    site_name = sys.argv[1]
    site_url = sys.argv[2]
    safe_name = site_name.replace(".", "_").replace("/", "_")

    os.makedirs(STATE_DIR, exist_ok=True)
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

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

        # Close extension tabs
        for pg in context.pages[1:]:
            try:
                await pg.close()
            except Exception:
                pass

        page = context.pages[0] if context.pages else await context.new_page()

        all_requests = []
        blocked_requests = []

        def on_request(req):
            url = req.url
            if url.startswith("data:") or url.startswith("blob:") or url.startswith("chrome-extension:"):
                return
            all_requests.append({"url": url, "domain": urlparse(url).netloc, "type": req.resource_type})

        def on_request_failed(req):
            url = req.url
            if url.startswith("data:") or url.startswith("blob:") or url.startswith("chrome-extension:"):
                return
            failure = req.failure
            if failure and "net::ERR_BLOCKED_BY_CLIENT" in failure:
                blocked_requests.append({"url": url, "domain": urlparse(url).netloc, "type": req.resource_type})

        page.on("request", on_request)
        page.on("requestfailed", on_request_failed)

        try:
            await page.goto(site_url, wait_until="domcontentloaded", timeout=25000)
        except PlaywrightTimeout:
            pass
        except Exception as e:
            print(f"Navigation error: {e}")

        await asyncio.sleep(8)

        # Screenshot
        ss_path = os.path.join(SCREENSHOT_DIR, f"{safe_name}.png")
        await page.screenshot(path=ss_path, full_page=False, timeout=10000)

        # DOM snapshot
        dom_areas = await page.evaluate(JS_DOM_SNAPSHOT)

        # Save state
        state = {
            "site": site_name,
            "url": site_url,
            "timestamp": datetime.now().isoformat(),
            "screenshot": ss_path,
            "total_requests": len(all_requests),
            "blocked_requests_count": len(blocked_requests),
            "blocked_requests": [{"url": b["url"], "domain": b["domain"]} for b in blocked_requests],
            "blocked_domains": sorted(set(b["domain"] for b in blocked_requests)),
            "dom_areas": dom_areas,
        }

        state_path = os.path.join(STATE_DIR, f"{safe_name}.json")
        with open(state_path, "w") as f:
            json.dump(state, f, indent=2)

        print(json.dumps({
            "site": site_name,
            "screenshot": ss_path,
            "total_requests": len(all_requests),
            "blocked": len(blocked_requests),
            "blocked_domains": state["blocked_domains"],
            "dom_areas_count": len(dom_areas),
            "dom_summary": [
                {
                    "text": a["text"][:120],
                    "buttons": [{"text": b["text"][:60], "tag": b["tag"], "x": b["x"], "y": b["y"]} for b in a["buttons"]],
                }
                for a in dom_areas
                if a["buttons"]  # only show areas with clickable elements
            ][:5],
        }, indent=2))

        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
