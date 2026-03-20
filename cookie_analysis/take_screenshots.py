#!/usr/bin/env python3
"""
Take a screenshot of each site using a real Chromium browser.
No heuristic popup detection - just load and screenshot for visual review.
"""

import asyncio
import os
import sys
import time
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout


async def screenshot_site(browser, site_name, site_url, output_dir):
    """Visit a site and take a screenshot."""
    safe_name = site_name.replace(".", "_").replace("/", "_")
    screenshot_path = os.path.join(output_dir, f"{safe_name}.png")

    context = await browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale="en-US",
        timezone_id="America/New_York",
        ignore_https_errors=True,
    )
    page = await context.new_page()

    try:
        print(f"  Loading {site_name}...", flush=True)
        try:
            await page.goto(site_url, wait_until="domcontentloaded", timeout=20000)
        except PlaywrightTimeout:
            print(f"  {site_name}: timeout on load, taking screenshot anyway")
        except Exception as e:
            if "net::ERR_" in str(e):
                print(f"  {site_name}: NETWORK ERROR - {e}")
                await context.close()
                return site_name, "ERROR", str(e)
            print(f"  {site_name}: navigation issue: {e}")

        # Wait for cookie popups to appear
        await asyncio.sleep(5)

        await page.screenshot(path=screenshot_path, full_page=False, timeout=10000)
        print(f"  {site_name}: screenshot saved", flush=True)
        await context.close()
        return site_name, "OK", screenshot_path

    except Exception as e:
        print(f"  {site_name}: ERROR - {e}")
        try:
            await context.close()
        except Exception:
            pass
        return site_name, "ERROR", str(e)


async def main():
    output_dir = "/workspace/cookie_analysis/screenshots"
    os.makedirs(output_dir, exist_ok=True)

    sites = []
    with open("/workspace/cookie_analysis/sites.txt") as f:
        for line in f:
            line = line.strip()
            if line and "|" in line:
                name, url = line.split("|", 1)
                sites.append((name.strip(), url.strip()))

    if len(sys.argv) > 1:
        filter_args = sys.argv[1:]
        sites = [(n, u) for n, u in sites if any(f in n for f in filter_args)]

    print(f"Taking screenshots of {len(sites)} sites...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
            ]
        )

        # Process in batches of 5
        batch_size = 5
        results = []
        for i in range(0, len(sites), batch_size):
            batch = sites[i:i + batch_size]
            print(f"\nBatch {i//batch_size + 1} ({i+1}-{min(i+batch_size, len(sites))})")
            tasks = [screenshot_site(browser, name, url, output_dir) for name, url in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in batch_results:
                if isinstance(r, Exception):
                    results.append(("unknown", "EXCEPTION", str(r)))
                else:
                    results.append(r)

        await browser.close()

    # Print summary
    print(f"\nDone. {sum(1 for _, s, _ in results if s == 'OK')} OK, "
          f"{sum(1 for _, s, _ in results if s != 'OK')} errors")
    for name, status, info in results:
        if status != "OK":
            print(f"  ERROR: {name}: {info[:100]}")


if __name__ == "__main__":
    asyncio.run(main())
