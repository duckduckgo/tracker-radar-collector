#!/usr/bin/env python3
"""
Tracking analysis: For each non-rejectable cookie popup site, compare
network requests and cookies BEFORE vs AFTER clicking "accept".
"""

import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urlparse
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

TRACKING_DOMAIN_PATTERNS = [
    r'google-analytics\.com', r'googletagmanager\.com', r'googleadservices\.com',
    r'googlesyndication\.com', r'doubleclick\.net', r'pagead2\.googlesyndication',
    r'google\.com/pagead', r'adservice\.google',
    r'facebook\.net', r'facebook\.com/tr', r'connect\.facebook',
    r'hotjar\.com', r'clarity\.ms', r'segment\.(com|io)',
    r'mixpanel\.com', r'amplitude\.com', r'heap(analytics)?\.com',
    r'fullstory\.com', r'mouseflow\.com', r'crazyegg\.com',
    r'luckyorange\.com', r'optimizely\.com', r'marketo\.',
    r'hubspot\.com', r'pardot\.com', r'adsrvr\.org',
    r'criteo\.(com|net)', r'outbrain\.com', r'taboola\.com',
    r'amazon-adsystem\.com', r'adnxs\.com', r'rubiconproject\.com',
    r'onetrust\.com', r'cookiebot\.com', r'cookielaw\.org',
    r'osano\.com', r'termly\.io', r'quantserve\.com',
    r'snapchat\.com/scevent', r'tiktok\.com', r'byteoversea\.com',
    r'linkedin\.com/(px|insight)', r'pinterest\.com/ct',
    r'bat\.bing\.com', r'ads\.linkedin', r'snap\.licdn',
    r'newrelic\.com', r'nr-data\.net', r'sentry\.io',
    r'datadoghq\.com', r'bugsnag\.com',
    r'intercom\.io', r'drift\.com', r'crisp\.chat',
    r'livechatinc\.com', r'zendesk\.com/embeddable',
    r'sharethis\.com', r'addthis\.com',
    r'demdex\.net', r'omtrdc\.net', r'2o7\.net',
    r'scorecardresearch\.com', r'imrworldwide\.com',
    r'chartbeat\.com', r'parsely\.com', r'wp\.com/g\.js',
]

TRACKING_COOKIE_PATTERNS = [
    r'^_ga$', r'^_ga_', r'^_gid$', r'^_gat', r'^_gcl_',
    r'^_fbp$', r'^_fbc$', r'^_fb_',
    r'^_hj', r'^_clck$', r'^_clsk$',
    r'^_uet', r'^_uetvid$',
    r'^IDE$', r'^NID$', r'^DSID$', r'^1P_JAR$',
    r'^fr$', r'^datr$', r'^sb$',
    r'^_pin_unauth',
    r'^_tt_', r'^_ttp$',
    r'^li_', r'^bcookie$', r'^bscookie$',
    r'^OptanonConsent', r'^OptanonAlertBoxClosed',
    r'^CookieConsent', r'^euconsent',
    r'^__utm', r'^_sp_', r'^mp_',
    r'^__hssc', r'^__hssrc', r'^__hstc', r'^hubspotutk',
    r'^_mkto_trk',
    r'^ajs_',
]

TRACKING_URL_PATH_PATTERNS = [
    r'/collect\b', r'/analytics', r'/tracking', r'/pixel',
    r'/beacon', r'/log\b', r'/event\b', r'/pageview',
    r'/gtag/', r'/gtm\.js', r'/analytics\.js', r'/ga\.js',
    r'/fbevents\.js', r'/tr\b',
]


def is_tracking_request(url):
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    path = parsed.path.lower()
    full = domain + path

    for pattern in TRACKING_DOMAIN_PATTERNS:
        if re.search(pattern, domain, re.IGNORECASE):
            return True
    for pattern in TRACKING_URL_PATH_PATTERNS:
        if re.search(pattern, path, re.IGNORECASE):
            return True
    return False


def is_tracking_cookie(name):
    for pattern in TRACKING_COOKIE_PATTERNS:
        if re.search(pattern, name, re.IGNORECASE):
            return True
    return False


def classify_request(url):
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    path = parsed.path.lower()

    categories = []
    if re.search(r'google-analytics|googletagmanager|gtag|ga\.js|analytics\.js', domain + path):
        categories.append('google_analytics')
    if re.search(r'googlesyndication|doubleclick|adservice\.google|pagead', domain + path):
        categories.append('google_ads')
    if re.search(r'facebook\.net|facebook\.com/tr|fbevents|connect\.facebook', domain + path):
        categories.append('facebook')
    if re.search(r'hotjar\.com', domain):
        categories.append('hotjar')
    if re.search(r'clarity\.ms', domain):
        categories.append('ms_clarity')
    if re.search(r'segment\.(com|io)', domain):
        categories.append('segment')
    if re.search(r'hubspot', domain):
        categories.append('hubspot')
    if re.search(r'onetrust|cookiebot|cookielaw|osano|termly', domain):
        categories.append('consent_management')
    if re.search(r'criteo|outbrain|taboola|adsrvr|adnxs|rubiconproject|amazon-adsystem', domain):
        categories.append('ad_network')
    if re.search(r'tiktok|byteoversea', domain):
        categories.append('tiktok')
    if re.search(r'linkedin|licdn', domain):
        categories.append('linkedin')
    if re.search(r'pinterest', domain):
        categories.append('pinterest')
    if re.search(r'snapchat', domain):
        categories.append('snapchat')
    if re.search(r'newrelic|nr-data|sentry|datadog|bugsnag', domain):
        categories.append('error_monitoring')
    if re.search(r'intercom|drift|crisp|livechat|zendesk', domain):
        categories.append('chat_widget')
    if re.search(r'chartbeat|parsely|scorecardresearch|imrworldwide', domain):
        categories.append('analytics')
    if re.search(r'mixpanel|amplitude|heap|fullstory|mouseflow|crazyegg|luckyorange', domain):
        categories.append('analytics')
    if not categories and is_tracking_request(domain + path):
        categories.append('other_tracking')
    return categories


JS_FIND_ACCEPT_BUTTON = """
() => {
    const acceptPatterns = [
        /accept\\s*(all)?\\s*(cookies?)?/i,
        /i\\s+accept/i,
        /agree\\s*((&|and)\\s*continue)?/i,
        /i\\s+agree/i,
        /got\\s+it/i,
        /ok(ay)?$/i,
        /allow\\s*(all)?\\s*(cookies?)?/i,
        /consent/i,
        /continue$/i,
        /understood/i,
        /acknowledge/i,
        /dismiss/i,
        /^close$/i,
        /^x$/i,
    ];

    // Look at all clickable elements
    const candidates = [];
    const allElements = document.querySelectorAll(
        'button, a, [role="button"], input[type="button"], input[type="submit"], ' +
        '[class*="accept"], [class*="agree"], [class*="consent"], [class*="cookie"] button, ' +
        '[class*="cookie"] a, [id*="accept"], [id*="agree"], [id*="consent"], ' +
        '[class*="banner"] button, [class*="notice"] button, [class*="popup"] button, ' +
        '[class*="modal"] button, [class*="overlay"] button, [aria-label*="accept" i], ' +
        '[aria-label*="agree" i], [aria-label*="close" i], [aria-label*="dismiss" i]'
    );

    for (const el of allElements) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.top < 0 || rect.left < 0) continue;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

        const text = (el.textContent || '').trim();
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const value = el.getAttribute('value') || '';
        const testStr = text + ' ' + ariaLabel + ' ' + title + ' ' + value;

        for (const pattern of acceptPatterns) {
            if (pattern.test(testStr)) {
                // Prefer elements in lower part of page (cookie banners are usually at bottom)
                // and elements with cookie-related parent classes
                let score = 0;
                if (rect.top > window.innerHeight * 0.5) score += 5;
                if (rect.top > window.innerHeight * 0.7) score += 5;

                let parent = el.parentElement;
                for (let i = 0; i < 10 && parent; i++) {
                    const cls = (parent.className || '').toString().toLowerCase();
                    const id = (parent.id || '').toLowerCase();
                    if (/cookie|consent|banner|notice|popup|modal|gdpr|privacy|overlay/.test(cls + ' ' + id)) {
                        score += 10;
                        break;
                    }
                    parent = parent.parentElement;
                }

                if (/accept|agree|allow/i.test(testStr)) score += 3;
                if (/ok|got.it|close|dismiss/i.test(testStr)) score += 1;

                candidates.push({
                    tag: el.tagName.toLowerCase(),
                    text: text.substring(0, 100),
                    ariaLabel: ariaLabel.substring(0, 100),
                    x: Math.round(rect.x + rect.width / 2),
                    y: Math.round(rect.y + rect.height / 2),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    score: score,
                    selector: buildSelector(el),
                });
                break;
            }
        }
    }

    // Also check for standalone close buttons (X) on cookie-like overlays
    const closeButtons = document.querySelectorAll(
        '[class*="cookie"] [class*="close"], [class*="consent"] [class*="close"], ' +
        '[class*="banner"] [class*="close"], [class*="notice"] [class*="close"], ' +
        '[class*="cookie"] .close, [class*="consent"] .close'
    );
    for (const el of closeButtons) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        candidates.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().substring(0, 100),
            ariaLabel: (el.getAttribute('aria-label') || '').substring(0, 100),
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            score: 8,
            selector: buildSelector(el),
        });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 5);

    function buildSelector(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        let selector = el.tagName.toLowerCase();
        if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\\s+/).slice(0, 3);
            selector += classes.map(c => '.' + CSS.escape(c)).join('');
        }
        return selector;
    }
}
"""


NON_REJECTABLE_SITES = [
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
    ("colorsxstudios.com", "https://colorsxstudios.com/"),
    ("electricgeneratorsdirect.com", "https://www.electricgeneratorsdirect.com/"),
    ("cinepolisusa.com", "https://www.cinepolisusa.com/"),
    ("esquire.com", "https://www.esquire.com/"),
]


async def analyze_site(browser, site_name, site_url, output_dir):
    """Analyze tracking before and after accepting cookie popup."""
    result = {
        "site": site_name,
        "url": site_url,
        "timestamp": datetime.now().isoformat(),
        "before_accept": {"requests": [], "tracking_requests": [], "cookies": [], "tracking_cookies": []},
        "after_accept": {"new_requests": [], "new_tracking_requests": [], "cookies": [], "new_tracking_cookies": []},
        "accept_button": None,
        "status": "pending",
        "tracking_before_accept": False,
        "new_tracking_after_accept": False,
        "summary": "",
    }

    context = await browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale="en-US",
        timezone_id="America/New_York",
        ignore_https_errors=True,
    )

    all_requests_before = []
    all_requests_after = []
    phase = {"current": "before"}

    page = await context.new_page()

    def on_request(request):
        url = request.url
        if url.startswith("data:") or url.startswith("blob:"):
            return
        entry = {
            "url": url,
            "domain": urlparse(url).netloc,
            "resource_type": request.resource_type,
            "is_tracking": is_tracking_request(url),
            "categories": classify_request(url),
        }
        if phase["current"] == "before":
            all_requests_before.append(entry)
        else:
            all_requests_after.append(entry)

    page.on("request", on_request)

    try:
        print(f"  [{site_name}] Loading...", flush=True)
        try:
            await page.goto(site_url, wait_until="domcontentloaded", timeout=25000)
        except PlaywrightTimeout:
            print(f"  [{site_name}] Timeout on load, continuing...", flush=True)
        except Exception as e:
            if "net::ERR_" in str(e):
                result["status"] = "network_error"
                result["summary"] = f"Network error: {str(e)[:200]}"
                await context.close()
                return result
            print(f"  [{site_name}] Nav issue: {e}", flush=True)

        # Wait for page and popups to load fully
        await asyncio.sleep(8)

        # Capture cookies before accept
        cookies_before = await context.cookies()
        before_cookie_names = set()
        for c in cookies_before:
            before_cookie_names.add(c["name"])
            is_track = is_tracking_cookie(c["name"])
            entry = {"name": c["name"], "domain": c["domain"], "is_tracking": is_track}
            result["before_accept"]["cookies"].append(entry)
            if is_track:
                result["before_accept"]["tracking_cookies"].append(entry)

        # Record request data for before phase
        seen_urls_before = set()
        for req in all_requests_before:
            seen_urls_before.add(req["url"])
            if req["is_tracking"]:
                result["before_accept"]["tracking_requests"].append({
                    "url": req["url"],
                    "domain": req["domain"],
                    "resource_type": req["resource_type"],
                    "categories": req["categories"],
                })
        result["before_accept"]["requests"] = [
            {"domain": r["domain"], "resource_type": r["resource_type"]}
            for r in all_requests_before
        ]

        result["tracking_before_accept"] = len(result["before_accept"]["tracking_requests"]) > 0

        # Find accept button
        print(f"  [{site_name}] Looking for accept button...", flush=True)
        candidates = await page.evaluate(JS_FIND_ACCEPT_BUTTON)

        if not candidates:
            result["status"] = "no_accept_button_found"
            result["summary"] = (
                f"No accept button found. "
                f"Tracking requests before: {len(result['before_accept']['tracking_requests'])}. "
                f"Tracking cookies before: {len(result['before_accept']['tracking_cookies'])}."
            )
            await context.close()
            return result

        best = candidates[0]
        result["accept_button"] = best
        print(f"  [{site_name}] Clicking: '{best['text']}' (score={best['score']})", flush=True)

        # Switch to "after" phase
        phase["current"] = "after"

        # Click the accept button
        try:
            await page.click(best["selector"], timeout=5000)
        except Exception:
            try:
                await page.mouse.click(best["x"], best["y"])
            except Exception as e2:
                result["status"] = "click_failed"
                result["summary"] = f"Could not click accept button: {str(e2)[:200]}"
                await context.close()
                return result

        # Wait for post-accept activity
        await asyncio.sleep(5)

        # Capture cookies after accept
        cookies_after = await context.cookies()
        after_cookie_names = set()
        for c in cookies_after:
            after_cookie_names.add(c["name"])

        new_cookie_names = after_cookie_names - before_cookie_names
        for c in cookies_after:
            if c["name"] in new_cookie_names:
                is_track = is_tracking_cookie(c["name"])
                entry = {"name": c["name"], "domain": c["domain"], "is_tracking": is_track}
                result["after_accept"]["cookies"].append(entry)
                if is_track:
                    result["after_accept"]["new_tracking_cookies"].append(entry)

        # Record new requests after accept
        for req in all_requests_after:
            if req["url"] not in seen_urls_before:
                if req["is_tracking"]:
                    result["after_accept"]["new_tracking_requests"].append({
                        "url": req["url"],
                        "domain": req["domain"],
                        "resource_type": req["resource_type"],
                        "categories": req["categories"],
                    })
        result["after_accept"]["new_requests"] = [
            {"domain": r["domain"], "resource_type": r["resource_type"]}
            for r in all_requests_after if r["url"] not in seen_urls_before
        ]

        result["new_tracking_after_accept"] = (
            len(result["after_accept"]["new_tracking_requests"]) > 0
            or len(result["after_accept"]["new_tracking_cookies"]) > 0
        )

        # Build summary
        tb = len(result["before_accept"]["tracking_requests"])
        ta = len(result["after_accept"]["new_tracking_requests"])
        cb = len(result["before_accept"]["tracking_cookies"])
        ca = len(result["after_accept"]["new_tracking_cookies"])
        total_new_req = len(result["after_accept"]["new_requests"])

        if tb == 0 and ta == 0 and cb == 0 and ca == 0:
            result["summary"] = "No tracking detected before or after accept."
        elif tb > 0 and ta == 0:
            result["summary"] = (
                f"Tracking loaded BEFORE accept ({tb} tracking requests, {cb} tracking cookies). "
                f"No NEW tracking after accept."
            )
        elif tb == 0 and ta > 0:
            result["summary"] = (
                f"NO tracking before accept. "
                f"NEW tracking AFTER accept ({ta} new tracking requests, {ca} new tracking cookies). "
                f"Site appears to respect consent."
            )
        else:
            result["summary"] = (
                f"Tracking BEFORE accept ({tb} tracking requests, {cb} tracking cookies). "
                f"Additional tracking AFTER accept ({ta} new requests, {ca} new cookies). "
                f"Total new requests after: {total_new_req}."
            )

        result["status"] = "analyzed"
        print(f"  [{site_name}] Done: {result['summary'][:120]}", flush=True)

    except Exception as e:
        result["status"] = "error"
        result["summary"] = f"Error: {str(e)[:300]}"
        print(f"  [{site_name}] ERROR: {e}", flush=True)

    try:
        await context.close()
    except Exception:
        pass

    return result


async def main():
    output_dir = "/workspace/cookie_analysis/results"
    os.makedirs(output_dir, exist_ok=True)

    sites = NON_REJECTABLE_SITES

    # Allow filtering from command line
    if len(sys.argv) > 1:
        filter_args = sys.argv[1:]
        sites = [(n, u) for n, u in sites if any(f in n for f in filter_args)]

    print(f"Analyzing tracking on {len(sites)} non-rejectable sites...\n")

    all_results = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
            ]
        )

        batch_size = 3
        for i in range(0, len(sites), batch_size):
            batch = sites[i:i + batch_size]
            batch_num = i // batch_size + 1
            total_batches = (len(sites) + batch_size - 1) // batch_size
            print(f"--- Batch {batch_num}/{total_batches} ({i+1}-{min(i+batch_size, len(sites))}) ---")

            tasks = [analyze_site(browser, name, url, output_dir) for name, url in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            for j, r in enumerate(batch_results):
                if isinstance(r, Exception):
                    all_results.append({
                        "site": batch[j][0],
                        "url": batch[j][1],
                        "status": "exception",
                        "summary": str(r)[:300],
                    })
                else:
                    all_results.append(r)

            # Save intermediate results
            with open(os.path.join(output_dir, "tracking_results.json"), "w") as f:
                json.dump(all_results, f, indent=2, default=str)

        await browser.close()

    # Final save
    output_path = os.path.join(output_dir, "tracking_results.json")
    with open(output_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)

    # Print summary
    print("\n" + "=" * 80)
    print("TRACKING ANALYSIS SUMMARY")
    print("=" * 80)

    analyzed = [r for r in all_results if r.get("status") == "analyzed"]
    no_button = [r for r in all_results if r.get("status") == "no_accept_button_found"]
    errors = [r for r in all_results if r.get("status") in ("error", "exception", "network_error", "click_failed")]

    tracking_before = [r for r in analyzed if r.get("tracking_before_accept")]
    no_tracking_before = [r for r in analyzed if not r.get("tracking_before_accept")]
    new_tracking_after = [r for r in analyzed if r.get("new_tracking_after_accept")]

    print(f"\nTotal sites: {len(all_results)}")
    print(f"Successfully analyzed: {len(analyzed)}")
    print(f"No accept button found: {len(no_button)}")
    print(f"Errors: {len(errors)}")
    print(f"\n--- Key Findings ---")
    print(f"Sites with tracking BEFORE accept: {len(tracking_before)}")
    print(f"Sites with NO tracking before accept: {len(no_tracking_before)}")
    print(f"Sites with NEW tracking AFTER accept: {len(new_tracking_after)}")

    if no_tracking_before:
        print(f"\n--- Sites that appear to RESPECT consent (no tracking before accept) ---")
        for r in no_tracking_before:
            print(f"  {r['site']}: {r.get('summary', '')[:100]}")

    if tracking_before:
        print(f"\n--- Sites that load tracking BEFORE accept ---")
        for r in tracking_before:
            print(f"  {r['site']}: {r.get('summary', '')[:100]}")

    if no_button:
        print(f"\n--- Sites where no accept button was found ---")
        for r in no_button:
            print(f"  {r['site']}")

    if errors:
        print(f"\n--- Errors ---")
        for r in errors:
            print(f"  {r['site']}: {r.get('summary', '')[:100]}")

    print(f"\nFull results saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
