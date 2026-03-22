#!/usr/bin/env python3
"""
Debug script: For sites where accept button was not found,
take a screenshot AND dump a DOM snapshot of potential cookie/consent areas.
"""

import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

FAILED_SITES = [
    ("fashionnova.com", "https://www.fashionnova.com/"),
    ("researchgate.net", "https://www.researchgate.net/"),
    ("danco.com", "https://www.danco.com/"),
    ("emerson.edu", "https://emerson.edu/"),
    ("davidson.edu", "https://www.davidson.edu/"),
    ("hatchshowprint.com", "https://www.hatchshowprint.com/"),
    ("summerdiscovery.com", "https://www.summerdiscovery.com/"),
    ("uow.edu.au", "https://www.uow.edu.au/"),
    ("posthog.com", "https://posthog.com/"),
    ("extrabux.com", "https://www.extrabux.com/"),
    ("seventeen.com", "https://seventeen.com/"),
    ("platt.com", "https://www.platt.com/"),
    ("build.com", "https://www.build.com/"),
    ("asia.nikkei.com", "https://asia.nikkei.com/"),
    ("aceodds.com", "https://www.aceodds.com/"),
    ("mooremerkowitztile.com", "https://mooremerkowitztile.com/"),
    ("stamma.org", "https://stamma.org/"),
    ("electricgeneratorsdirect.com", "https://www.electricgeneratorsdirect.com/"),
    ("cinepolisusa.com", "https://www.cinepolisusa.com/"),
    ("esquire.com", "https://www.esquire.com/"),
]

JS_DUMP_COOKIE_AREAS = """
() => {
    const results = [];

    // Find all potential cookie/consent/banner areas
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

                // Get all clickable children
                const buttons = [];
                for (const btn of el.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')) {
                    const btnRect = btn.getBoundingClientRect();
                    if (btnRect.width === 0 || btnRect.height === 0) continue;
                    const btnStyle = window.getComputedStyle(btn);
                    if (btnStyle.display === 'none' || btnStyle.visibility === 'hidden') continue;

                    buttons.push({
                        tag: btn.tagName.toLowerCase(),
                        text: (btn.textContent || '').trim().substring(0, 150),
                        ariaLabel: (btn.getAttribute('aria-label') || '').substring(0, 100),
                        classes: (btn.className || '').toString().substring(0, 200),
                        id: (btn.id || '').substring(0, 100),
                        href: btn.tagName === 'A' ? (btn.getAttribute('href') || '').substring(0, 100) : undefined,
                        x: Math.round(btnRect.x + btnRect.width / 2),
                        y: Math.round(btnRect.y + btnRect.height / 2),
                    });
                }

                // Also look for close/X buttons
                for (const btn of el.querySelectorAll('[class*="close" i], [aria-label*="close" i], [aria-label*="dismiss" i]')) {
                    const btnRect = btn.getBoundingClientRect();
                    if (btnRect.width === 0 || btnRect.height === 0) continue;
                    buttons.push({
                        tag: btn.tagName.toLowerCase(),
                        text: (btn.textContent || '').trim().substring(0, 150),
                        ariaLabel: (btn.getAttribute('aria-label') || '').substring(0, 100),
                        classes: (btn.className || '').toString().substring(0, 200),
                        id: (btn.id || '').substring(0, 100),
                        x: Math.round(btnRect.x + btnRect.width / 2),
                        y: Math.round(btnRect.y + btnRect.height / 2),
                        isClose: true,
                    });
                }

                results.push({
                    tag: el.tagName.toLowerCase(),
                    classes: (el.className || '').toString().substring(0, 300),
                    id: (el.id || '').substring(0, 100),
                    text: (el.textContent || '').trim().substring(0, 500),
                    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                    visible: style.opacity !== '0',
                    buttons: buttons,
                    matchedSelector: sel,
                });
            }
        } catch (e) {}
    }

    return results;
}
"""


async def debug_site(browser, site_name, site_url, output_dir):
    context = await browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale="en-US",
        timezone_id="America/New_York",
        ignore_https_errors=True,
    )
    page = await context.new_page()

    try:
        print(f"  [{site_name}] Loading...", flush=True)
        try:
            await page.goto(site_url, wait_until="domcontentloaded", timeout=20000)
        except PlaywrightTimeout:
            print(f"  [{site_name}] Timeout, continuing...")
        except Exception as e:
            if "net::ERR_" in str(e):
                print(f"  [{site_name}] NETWORK ERROR")
                await context.close()
                return

        await asyncio.sleep(6)

        # Take screenshot
        safe_name = site_name.replace(".", "_").replace("/", "_")
        ss_path = os.path.join(output_dir, f"{safe_name}.png")
        await page.screenshot(path=ss_path, full_page=False, timeout=10000)
        print(f"  [{site_name}] Screenshot saved", flush=True)

        # Dump DOM areas
        areas = await page.evaluate(JS_DUMP_COOKIE_AREAS)
        dump_path = os.path.join(output_dir, f"{safe_name}_dom.json")
        with open(dump_path, "w") as f:
            json.dump(areas, f, indent=2)
        print(f"  [{site_name}] DOM dump: {len(areas)} areas found", flush=True)
        for area in areas:
            btns = area.get("buttons", [])
            txt = area["text"][:100].replace("\n", " ")
            print(f"    Area [{area['tag']}#{area['id']}.{area['classes'][:40]}]: '{txt}' ({len(btns)} buttons)")
            for btn in btns:
                print(f"      Button: '{btn['text'][:60]}' [{btn['tag']}] cls={btn['classes'][:50]}")

    except Exception as e:
        print(f"  [{site_name}] ERROR: {e}")

    try:
        await context.close()
    except Exception:
        pass


async def main():
    output_dir = "/workspace/cookie_analysis/debug_screenshots"
    os.makedirs(output_dir, exist_ok=True)

    sites = FAILED_SITES
    if len(sys.argv) > 1:
        filter_args = sys.argv[1:]
        sites = [(n, u) for n, u in sites if any(f in n for f in filter_args)]

    print(f"Debugging accept button detection on {len(sites)} sites...\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )

        for i, (name, url) in enumerate(sites):
            print(f"\n[{i+1}/{len(sites)}] {name}")
            await debug_site(browser, name, url, output_dir)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
