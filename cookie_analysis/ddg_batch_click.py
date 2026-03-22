#!/usr/bin/env python3
"""
Batch step 2: For each site, load with DDG extension, record pre-click blocked requests,
click the visually-verified accept button, record post-click blocked requests.
Uses clean browser context per site.
"""

import asyncio
import json
import os
import sys
import tempfile
import shutil
from datetime import datetime
from urllib.parse import urlparse
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

EXT_PATH = "/workspace/duckduckgo-privacy-extension/build/chrome/release"
RESULTS_DIR = "/workspace/cookie_analysis/results/ddg_per_site"
SCREENSHOT_DIR = "/workspace/cookie_analysis/ddg_screenshots"

# Load site list and click targets
with open("/workspace/cookie_analysis/ddg_click_targets.json") as f:
    targets = json.load(f)

SITE_URLS = {
    "fashionnova.com": "https://www.fashionnova.com/",
    "rwguildgalleryny.com": "https://rwguildgalleryny.com/",
    "carraghersnyc.com": "https://www.carraghersnyc.com/",
    "goodliferesorts.guestybookings.com": "https://goodliferesorts.guestybookings.com/en",
    "modani.com": "https://modani.com/",
    "ciee.org": "https://www.ciee.org/",
    "80.lv": "https://80.lv/",
    "schoolhouse.com": "https://schoolhouse.com/",
    "ballarddesigns.com": "https://www.ballarddesigns.com/",
    "food52.com": "https://food52.com/",
    "researchgate.net": "https://www.researchgate.net/",
    "danco.com": "https://www.danco.com/",
    "humandx.org": "https://www.humandx.org/",
    "vowels.net": "https://vowels.net/",
    "shopquarters.com": "https://shopquarters.com/",
    "scworld.com": "https://www.scworld.com/",
    "innerscene.com": "https://www.innerscene.com/",
    "mls.therealest.com": "https://mls.therealest.com/",
    "serpstat.com": "https://serpstat.com/",
    "copaamerica.com": "https://copaamerica.com/en/match-schedule/",
    "wecoach.gg": "https://wecoach.gg/coaches/valorant",
    "store.waitbutwhy.com": "https://store.waitbutwhy.com/",
    "osf.io": "https://osf.io/",
    "acct.ezpassde.com": "https://acct.ezpassde.com/Login.aspx",
    "emerson.edu": "https://emerson.edu/",
    "davidson.edu": "https://www.davidson.edu/",
    "caribbeancinemas.com": "https://home.caribbeancinemas.com/",
    "heartmath.org": "https://www.heartmath.org/",
    "foratravel.com": "https://www.foratravel.com/",
    "swimjim.com": "https://www.swimjim.com/",
    "spencer.org": "https://www.spencer.org/",
    "hatchshowprint.com": "https://www.hatchshowprint.com/",
    "spermidinelife.us": "https://spermidinelife.us/",
    "summerdiscovery.com": "https://www.summerdiscovery.com/",
    "uow.edu.au": "https://www.uow.edu.au/",
    "posthog.com": "https://posthog.com/",
    "meetboston.com": "https://www.meetboston.com/",
    "poconomountains.com": "https://www.poconomountains.com/",
    "bso.org": "https://www.bso.org/",
    "visitpittsburgh.com": "https://www.visitpittsburgh.com/",
    "scad.edu": "https://www.scad.edu/",
    "getguru.com": "https://www.getguru.com/",
    "opalcollection.com": "https://www.opalcollection.com/",
    "cymbiotika.com": "https://cymbiotika.com/",
    "risingshadow.net": "https://www.risingshadow.net/",
    "extrabux.com": "https://www.extrabux.com/",
    "garnethill.com": "https://www.garnethill.com/",
    "seventeen.com": "https://seventeen.com/",
    "platt.com": "https://www.platt.com/",
    "build.com": "https://www.build.com/",
    "tufts.edu": "https://www.tufts.edu/",
    "admissions.pitt.edu": "https://admissions.pitt.edu/",
    "westjet.com": "https://www.westjet.com/en-ca",
    "worldbank.org": "https://www.worldbank.org/",
    "endocrine.org": "https://endocrine.org/",
    "tp-link.com": "https://www.tp-link.com/",
    "asia.nikkei.com": "https://asia.nikkei.com/",
    "scmp.com": "https://www.scmp.com/",
    "lafollette.wisc.edu": "https://lafollette.wisc.edu/",
    "usv.getproven.com": "https://usv.getproven.com/auth",
    "aceodds.com": "https://www.aceodds.com/",
    "hearinghealthfoundation.org": "https://hearinghealthfoundation.org/",
    "cyberpower.com": "https://www.cyberpower.com/GLOBAL/en",
    "petrapalusova.com": "https://petrapalusova.com/",
    "riverandrailkitchen.com": "https://riverandrailkitchen.com/",
    "mooremerkowitztile.com": "https://mooremerkowitztile.com/",
    "stamma.org": "https://stamma.org/",
    "electricgeneratorsdirect.com": "https://www.electricgeneratorsdirect.com/",
    "esquire.com": "https://www.esquire.com/",
}

# Build click map: site -> (x, y)
CLICK_MAP = {}
for t in targets.get("auto_click", []):
    CLICK_MAP[t["site"]] = (t["x"], t["y"])
for t in targets.get("visual_click", []):
    CLICK_MAP[t["site"]] = (t["x"], t["y"])

NO_POPUP = set(t["site"] for t in targets.get("no_popup", []))


async def analyze_site(p, site_name, site_url, click_x, click_y):
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
        try: await pg.close()
        except: pass

    page = context.pages[0] if context.pages else await context.new_page()

    pre_blocked = []
    post_blocked = []
    pre_requests = []
    post_requests = []
    phase = {"current": "before"}

    def on_request(req):
        url = req.url
        if url.startswith(("data:", "blob:", "chrome-extension:")): return
        entry = {"url": url, "domain": urlparse(url).netloc, "type": req.resource_type}
        if phase["current"] == "before":
            pre_requests.append(entry)
        else:
            post_requests.append(entry)

    def on_request_failed(req):
        url = req.url
        if url.startswith(("data:", "blob:", "chrome-extension:")): return
        failure = req.failure
        if failure and "net::ERR_BLOCKED_BY_CLIENT" in failure:
            entry = {"url": url, "domain": urlparse(url).netloc}
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
        if "net::ERR_" in str(e) and "BLOCKED" not in str(e):
            await context.close()
            shutil.rmtree(user_data, ignore_errors=True)
            return {"site": site_name, "status": "network_error", "error": str(e)[:200]}

    await asyncio.sleep(8)

    pre_urls = set(r["url"] for r in pre_requests)
    phase["current"] = "after"

    # Click
    try:
        await page.mouse.click(click_x, click_y)
    except Exception as e:
        pass

    await asyncio.sleep(5)

    # Calculate new blocked
    new_blocked = [b for b in post_blocked if b["url"] not in pre_urls]
    new_requests = [r for r in post_requests if r["url"] not in pre_urls]

    result = {
        "site": site_name,
        "url": site_url,
        "timestamp": datetime.now().isoformat(),
        "click": {"x": click_x, "y": click_y},
        "before_accept": {
            "total_requests": len(pre_requests),
            "blocked_requests": len(pre_blocked),
            "blocked_domains": sorted(set(b["domain"] for b in pre_blocked)),
        },
        "after_accept": {
            "total_new_requests": len(new_requests),
            "new_blocked_requests": len(new_blocked),
            "new_blocked_domains": sorted(set(b["domain"] for b in new_blocked)),
        },
        "status": "analyzed",
    }

    await context.close()
    shutil.rmtree(user_data, ignore_errors=True)
    return result


async def analyze_no_popup(p, site_name, site_url):
    """For sites with no popup, just record the blocked requests during load."""
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
        try: await pg.close()
        except: pass

    page = context.pages[0] if context.pages else await context.new_page()

    all_requests = []
    blocked = []

    def on_request(req):
        url = req.url
        if url.startswith(("data:", "blob:", "chrome-extension:")): return
        all_requests.append({"url": url, "domain": urlparse(url).netloc})

    def on_request_failed(req):
        url = req.url
        if url.startswith(("data:", "blob:", "chrome-extension:")): return
        failure = req.failure
        if failure and "net::ERR_BLOCKED_BY_CLIENT" in failure:
            blocked.append({"url": url, "domain": urlparse(url).netloc})

    page.on("request", on_request)
    page.on("requestfailed", on_request_failed)

    try:
        await page.goto(site_url, wait_until="domcontentloaded", timeout=25000)
    except PlaywrightTimeout:
        pass
    except Exception:
        pass

    await asyncio.sleep(8)

    result = {
        "site": site_name,
        "url": site_url,
        "timestamp": datetime.now().isoformat(),
        "before_accept": {
            "total_requests": len(all_requests),
            "blocked_requests": len(blocked),
            "blocked_domains": sorted(set(b["domain"] for b in blocked)),
        },
        "after_accept": {
            "total_new_requests": 0,
            "new_blocked_requests": 0,
            "new_blocked_domains": [],
        },
        "status": "no_popup",
        "note": "No cookie popup visible with DDG extension active",
    }

    await context.close()
    shutil.rmtree(user_data, ignore_errors=True)
    return result


async def main():
    os.makedirs(RESULTS_DIR, exist_ok=True)

    # Build task list
    all_sites = []
    for site_name, site_url in SITE_URLS.items():
        if site_name in NO_POPUP:
            all_sites.append((site_name, site_url, None, None, True))
        elif site_name in CLICK_MAP:
            x, y = CLICK_MAP[site_name]
            all_sites.append((site_name, site_url, x, y, False))
        else:
            all_sites.append((site_name, site_url, None, None, True))

    # Filter if command line args
    if len(sys.argv) > 1:
        filter_args = sys.argv[1:]
        all_sites = [s for s in all_sites if any(f in s[0] for f in filter_args)]

    print(f"Processing {len(all_sites)} sites...\n", flush=True)
    all_results = []

    async with async_playwright() as p:
        for i, (name, url, cx, cy, is_no_popup) in enumerate(all_sites):
            print(f"[{i+1}/{len(all_sites)}] {name}...", end=" ", flush=True)
            try:
                if is_no_popup:
                    result = await analyze_no_popup(p, name, url)
                else:
                    result = await analyze_site(p, name, url, cx, cy)

                all_results.append(result)
                bb = result["before_accept"]["blocked_requests"]
                bt = result["before_accept"]["total_requests"]
                nb = result["after_accept"]["new_blocked_requests"]
                nt = result["after_accept"]["total_new_requests"]
                status = result["status"]
                print(f"{status}. Before: {bb}/{bt} blocked. After: +{nb}/{nt}", flush=True)

            except Exception as e:
                print(f"ERROR: {e}", flush=True)
                all_results.append({"site": name, "status": "error", "error": str(e)[:200]})

            # Save per-site result
            safe = name.replace(".", "_").replace("/", "_")
            with open(os.path.join(RESULTS_DIR, f"{safe}.json"), "w") as f:
                json.dump(all_results[-1], f, indent=2)

            # Save running totals
            with open("/workspace/cookie_analysis/results/ddg_final_results.json", "w") as f:
                json.dump(all_results, f, indent=2, default=str)

    # Final summary
    print("\n" + "=" * 80)
    print("FINAL DDG EXTENSION BLOCKING RESULTS")
    print("=" * 80)

    analyzed = [r for r in all_results if r["status"] == "analyzed"]
    no_popup = [r for r in all_results if r["status"] == "no_popup"]

    all_with_data = [r for r in all_results if "before_accept" in r]
    with_blocks = [r for r in all_with_data if r["before_accept"]["blocked_requests"] > 0]
    with_new_blocks = [r for r in analyzed if r["after_accept"]["new_blocked_requests"] > 0]

    print(f"\nTotal: {len(all_results)} | Analyzed: {len(analyzed)} | No popup: {len(no_popup)}")
    print(f"Sites with blocks on load: {len(with_blocks)}/{len(all_with_data)}")
    print(f"Sites with NEW blocks after accept: {len(with_new_blocks)}/{len(analyzed)}")

    for r in sorted(all_with_data, key=lambda x: x["before_accept"]["blocked_requests"], reverse=True):
        bb = r["before_accept"]["blocked_requests"]
        bt = r["before_accept"]["total_requests"]
        nb = r["after_accept"]["new_blocked_requests"]
        nt = r["after_accept"]["total_new_requests"]
        pct = (bb/bt*100) if bt > 0 else 0
        print(f"  {r['site']:<45} {bb:>3}/{bt:<4} ({pct:4.1f}%)  +{nb}/{nt} after")


if __name__ == "__main__":
    asyncio.run(main())
