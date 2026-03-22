#!/usr/bin/env python3
"""
Batch load: Run step 1 for all sites sequentially (one browser context per site
to ensure clean state), capture screenshots + DOM + blocked requests.
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
        '[class*="cookie" i]', '[class*="consent" i]',
        '[class*="notice" i]', '[class*="gdpr" i]', '[class*="privacy" i]',
        '[class*="popup" i]', '[class*="modal" i]', '[class*="overlay" i]',
        '[id*="cookie" i]', '[id*="consent" i]',
        '[id*="notice" i]', '[id*="gdpr" i]', '[id*="privacy" i]',
        '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
        '#onetrust-banner-sdk', '#CybotCookiebotDialog',
        '.cc-banner', '.cc-window', '.cc-compliance',
        '[class*="sliding-popup" i]', '[class*="cookiescript" i]',
        '[class*="eu-cookie" i]',
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
                // Skip elements fully off-screen
                if (rect.bottom < 0 || rect.right < 0) continue;

                const buttons = [];
                const clickables = el.querySelectorAll(
                    'button, a, [role="button"], input[type="button"], input[type="submit"], ' +
                    'div[onclick], span[onclick], div[class*="btn" i], div[class*="accept" i], ' +
                    'div[class*="close" i], div[class*="dismiss" i], div[class*="allow" i]'
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

# Excluding colorsxstudios.com (false positive) and cinepolisusa.com (has decline)
SITES = [
    ("fashionnova.com", "https://www.fashionnova.com/"),
    ("rwguildgalleryny.com", "https://rwguildgalleryny.com/"),
    ("carraghersnyc.com", "https://www.carraghersnyc.com/"),
    ("goodliferesorts.guestybookings.com", "https://goodliferesorts.guestybookings.com/en"),
    ("modani.com", "https://modani.com/"),
    ("ciee.org", "https://www.ciee.org/"),
    ("80.lv", "https://80.lv/"),
    ("schoolhouse.com", "https://schoolhouse.com/"),
    ("ballarddesigns.com", "https://www.ballarddesigns.com/"),
    ("food52.com", "https://food52.com/"),
    ("researchgate.net", "https://www.researchgate.net/"),
    ("danco.com", "https://www.danco.com/"),
    ("humandx.org", "https://www.humandx.org/"),
    ("vowels.net", "https://vowels.net/"),
    ("shopquarters.com", "https://shopquarters.com/"),
    ("scworld.com", "https://www.scworld.com/"),
    ("innerscene.com", "https://www.innerscene.com/"),
    ("mls.therealest.com", "https://mls.therealest.com/"),
    ("serpstat.com", "https://serpstat.com/"),
    ("copaamerica.com", "https://copaamerica.com/en/match-schedule/"),
    ("wecoach.gg", "https://wecoach.gg/coaches/valorant"),
    ("store.waitbutwhy.com", "https://store.waitbutwhy.com/"),
    ("osf.io", "https://osf.io/"),
    ("acct.ezpassde.com", "https://acct.ezpassde.com/Login.aspx"),
    ("emerson.edu", "https://emerson.edu/"),
    ("davidson.edu", "https://www.davidson.edu/"),
    ("caribbeancinemas.com", "https://home.caribbeancinemas.com/"),
    ("heartmath.org", "https://www.heartmath.org/"),
    ("foratravel.com", "https://www.foratravel.com/"),
    ("swimjim.com", "https://www.swimjim.com/"),
    ("spencer.org", "https://www.spencer.org/"),
    ("hatchshowprint.com", "https://www.hatchshowprint.com/"),
    ("spermidinelife.us", "https://spermidinelife.us/"),
    ("summerdiscovery.com", "https://www.summerdiscovery.com/"),
    ("uow.edu.au", "https://www.uow.edu.au/"),
    ("posthog.com", "https://posthog.com/"),
    ("meetboston.com", "https://www.meetboston.com/"),
    ("poconomountains.com", "https://www.poconomountains.com/"),
    ("bso.org", "https://www.bso.org/"),
    ("visitpittsburgh.com", "https://www.visitpittsburgh.com/"),
    ("scad.edu", "https://www.scad.edu/"),
    ("getguru.com", "https://www.getguru.com/"),
    ("opalcollection.com", "https://www.opalcollection.com/"),
    ("cymbiotika.com", "https://cymbiotika.com/"),
    ("risingshadow.net", "https://www.risingshadow.net/"),
    ("extrabux.com", "https://www.extrabux.com/"),
    ("garnethill.com", "https://www.garnethill.com/"),
    ("seventeen.com", "https://seventeen.com/"),
    ("platt.com", "https://www.platt.com/"),
    ("build.com", "https://www.build.com/"),
    ("tufts.edu", "https://www.tufts.edu/"),
    ("admissions.pitt.edu", "https://admissions.pitt.edu/"),
    ("westjet.com", "https://www.westjet.com/en-ca"),
    ("worldbank.org", "https://www.worldbank.org/"),
    ("endocrine.org", "https://endocrine.org/"),
    ("tp-link.com", "https://www.tp-link.com/"),
    ("asia.nikkei.com", "https://asia.nikkei.com/"),
    ("scmp.com", "https://www.scmp.com/"),
    ("lafollette.wisc.edu", "https://lafollette.wisc.edu/"),
    ("usv.getproven.com", "https://usv.getproven.com/auth"),
    ("aceodds.com", "https://www.aceodds.com/"),
    ("hearinghealthfoundation.org", "https://hearinghealthfoundation.org/"),
    ("cyberpower.com", "https://www.cyberpower.com/GLOBAL/en"),
    ("petrapalusova.com", "https://petrapalusova.com/"),
    ("riverandrailkitchen.com", "https://riverandrailkitchen.com/"),
    ("mooremerkowitztile.com", "https://mooremerkowitztile.com/"),
    ("stamma.org", "https://stamma.org/"),
    ("electricgeneratorsdirect.com", "https://www.electricgeneratorsdirect.com/"),
    ("esquire.com", "https://www.esquire.com/"),
]


async def load_site(p, site_name, site_url):
    safe_name = site_name.replace(".", "_").replace("/", "_")
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

    await asyncio.sleep(3)

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
        print(f"  [{site_name}] Nav error: {e}", flush=True)

    await asyncio.sleep(8)

    ss_path = os.path.join(SCREENSHOT_DIR, f"{safe_name}.png")
    try:
        await page.screenshot(path=ss_path, full_page=False, timeout=10000)
    except Exception:
        ss_path = None

    dom_areas = []
    try:
        dom_areas = await page.evaluate(JS_DOM_SNAPSHOT)
    except Exception:
        pass

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

    await context.close()

    # Clean up temp dir
    import shutil
    try:
        shutil.rmtree(user_data, ignore_errors=True)
    except Exception:
        pass

    return state


async def main():
    os.makedirs(STATE_DIR, exist_ok=True)
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    sites = SITES
    if len(sys.argv) > 1:
        filter_args = sys.argv[1:]
        sites = [(n, u) for n, u in sites if any(f in n for f in filter_args)]

    print(f"Loading {len(sites)} sites with DDG extension...\n", flush=True)

    async with async_playwright() as p:
        for i, (name, url) in enumerate(sites):
            print(f"[{i+1}/{len(sites)}] {name}...", end=" ", flush=True)
            try:
                state = await load_site(p, name, url)
                print(f"OK. {state['blocked_requests_count']} blocked / {state['total_requests']} total. "
                      f"DOM areas: {len(state['dom_areas'])}", flush=True)
            except Exception as e:
                print(f"ERROR: {e}", flush=True)

    print("\nDone. Screenshots in", SCREENSHOT_DIR)
    print("State files in", STATE_DIR)


if __name__ == "__main__":
    asyncio.run(main())
