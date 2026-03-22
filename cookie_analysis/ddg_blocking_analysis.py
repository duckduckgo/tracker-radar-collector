#!/usr/bin/env python3
"""
DDG Privacy Extension blocking analysis.
For each non-rejectable cookie popup site:
1. Load site with DDG extension active
2. Count requests blocked by the extension before clicking accept
3. Click accept
4. Count new requests blocked after clicking accept
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

JS_FIND_ACCEPT_BUTTON = """
() => {
    // Patterns tested against EACH text field individually (not concatenated)
    const acceptTextPatterns = [
        /^accept(\\s+(all|cookies?))?$/i,
        /^i\\s+accept$/i,
        /^agree(\\s*((&|and)\\s*(continue|dismiss))?)?$/i,
        /^i\\s+agree$/i,
        /^got\\s+it!?$/i,
        /^ok(ay)?[,!]?\\s*(thanks|thank\\s*you)?[.!]?$/i,
        /^allow(\\s+(all|cookies?))?$/i,
        /^consent$/i,
        /^continue$/i,
        /^understood$/i,
        /^i\\s+understand$/i,
        /^acknowledge$/i,
        /^dismiss$/i,
        /^close$/i,
        /^that'?s\\s+(fine|ok(ay)?)$/i,
        /^accept\\s*(&|and)\\s*dismiss$/i,
        /^accept\\s*(&|and)\\s*continue$/i,
        /^accept\\s*(&|and)\\s*close$/i,
        /^continue\\s+to\\s+browse/i,
        /^[x\\u00d7\\u2715\\u2716\\u2717\\u2718\\u2573\\u10102]$/i,
        /^✕$/,
        /^×$/,
    ];

    // Class/id patterns that indicate an accept/dismiss button
    const acceptClassPatterns = [
        /\\bagree-button\\b/i,
        /\\baccept\\b/i,
        /\\bgdpr[_-]?accept\\b/i,
        /\\bcc-allow\\b/i,
        /\\bcc-btn\\b.*\\bcc-allow\\b/i,
        /\\bprivacy[_-]?accept\\b/i,
        /\\bcookie[_-]?accept\\b/i,
        /\\bconsent[_-]?accept\\b/i,
        /\\bcookie[_-]?banner.*accept\\b/i,
        /\\bsqs-cookie-banner.*accept\\b/i,
        /\\bdismiss[_-]?button\\b/i,
        /\\bcookie.*dismiss\\b/i,
        /\\bbanner.*dismiss\\b/i,
    ];

    function matchesAcceptText(text) {
        const t = text.trim();
        if (!t || t.length > 150) return false;
        for (const p of acceptTextPatterns) {
            if (p.test(t)) return true;
        }
        return false;
    }

    function matchesAcceptClass(el) {
        const cls = (el.className || '').toString();
        const id = el.id || '';
        const combined = cls + ' ' + id;
        for (const p of acceptClassPatterns) {
            if (p.test(combined)) return true;
        }
        return false;
    }

    function isInConsentArea(el) {
        let parent = el;
        for (let i = 0; i < 15 && parent; i++) {
            const cls = (parent.className || '').toString().toLowerCase();
            const id = (parent.id || '').toLowerCase();
            if (/cookie|consent|banner|notice|popup|modal|gdpr|privacy|overlay|eu-cookie|cc-window|cc-banner|sliding-popup|cookiescript/.test(cls + ' ' + id)) {
                return true;
            }
            parent = parent.parentElement;
        }
        return false;
    }

    const candidates = [];
    const seen = new Set();

    // Broad selector: all interactive elements plus div/span with consent-related classes
    const allElements = document.querySelectorAll(
        'button, a, [role="button"], input[type="button"], input[type="submit"], ' +
        'div[class*="accept" i], div[class*="agree" i], div[class*="dismiss" i], div[class*="allow" i], ' +
        'div[class*="privacy-accept" i], div[class*="cc-allow" i], div[class*="cc-btn" i], ' +
        '[class*="cookie"] button, [class*="cookie"] a, [class*="cookie"] div[onclick], ' +
        '[class*="consent"] button, [class*="consent"] a, [class*="consent"] div, ' +
        '[id*="accept"], [id*="agree"], [id*="consent"], [id*="cookie"] button, ' +
        '[class*="banner"] button, [class*="notice"] button, [class*="popup"] button, ' +
        '[class*="modal"] button, [class*="overlay"] button, ' +
        '[class*="gdpr"] button, [class*="gdpr"] a, [class*="gdpr"] div, ' +
        '[class*="eu-cookie"] button, [class*="eu-cookie"] a, ' +
        '[class*="cc-window"] a, [class*="cc-banner"] a, ' +
        '[class*="sliding-popup"] button, ' +
        '[aria-label*="accept" i], [aria-label*="agree" i], ' +
        '[aria-label*="close" i], [aria-label*="dismiss" i], ' +
        '#cookiescript_accept, #cookiescript_reject, ' +
        '.cc-btn, .cc-allow'
    );

    for (const el of allElements) {
        if (seen.has(el)) continue;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.top < -10 || rect.left < -10) continue;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

        const text = (el.textContent || '').trim();
        const ariaLabel = (el.getAttribute('aria-label') || '').trim();
        const title = (el.getAttribute('title') || '').trim();
        const value = (el.getAttribute('value') || '').trim();

        const textMatch = matchesAcceptText(text) || matchesAcceptText(ariaLabel) ||
                          matchesAcceptText(title) || matchesAcceptText(value);
        const classMatch = matchesAcceptClass(el);

        if (!textMatch && !classMatch) continue;

        let score = 0;

        // Position scoring: cookie banners are usually at top or bottom
        if (rect.top > window.innerHeight * 0.5) score += 5;
        if (rect.top > window.innerHeight * 0.7) score += 5;
        if (rect.top < window.innerHeight * 0.15) score += 3;

        // Parent context scoring
        if (isInConsentArea(el)) score += 10;

        // Element's own classes/id
        const ownCls = (el.className || '').toString().toLowerCase();
        const ownId = (el.id || '').toLowerCase();
        if (/accept|agree|allow|gdpr.*accept|cc-allow|privacy.?accept|cookie.?accept/.test(ownCls + ' ' + ownId)) {
            score += 5;
        }
        if (/dismiss|close/.test(ownCls + ' ' + ownId)) {
            score += 2;
        }

        // Text-based scoring
        if (/accept|agree|allow/i.test(text)) score += 3;
        if (/^ok/i.test(text.trim())) score += 2;
        if (/got.it|that.s.fine|dismiss|close/i.test(text)) score += 1;

        // Standard button/a tags get priority over div
        if (el.tagName === 'BUTTON' || el.tagName === 'A') score += 1;

        // Penalize very large elements (likely containers, not buttons)
        if (rect.width > 600 && rect.height > 200) score -= 10;
        if (text.length > 200) score -= 5;

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
    }

    // Also look for close/dismiss buttons inside cookie areas
    const closeSelectors = [
        '[class*="cookie"] [class*="close"]', '[class*="consent"] [class*="close"]',
        '[class*="banner"] [class*="close"]', '[class*="notice"] [class*="close"]',
        '[class*="cookie"] .close', '[class*="consent"] .close',
        '[class*="gdpr"] [class*="close"]', '[class*="gdpr"] button',
        '[class*="cookie-banner"] [class*="dismiss"]', '[class*="cookie"] [class*="dismiss"]',
        '[class*="eu-cookie"] button', '.sliding-popup-bottom button',
    ];
    for (const sel of closeSelectors) {
        try {
            for (const el of document.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);

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
        } catch(e) {}
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


# Excluding colorsxstudios.com (false positive - has reject button)
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
    ("electricgeneratorsdirect.com", "https://www.electricgeneratorsdirect.com/"),
    ("esquire.com", "https://www.esquire.com/"),
]


async def analyze_site(context, site_name, site_url):
    """Analyze DDG extension blocking for a single site."""
    result = {
        "site": site_name,
        "url": site_url,
        "timestamp": datetime.now().isoformat(),
        "before_accept": {
            "total_requests": 0,
            "blocked_requests": 0,
            "blocked_urls": [],
        },
        "after_accept": {
            "total_new_requests": 0,
            "new_blocked_requests": 0,
            "new_blocked_urls": [],
        },
        "accept_button": None,
        "status": "pending",
    }

    page = await context.new_page()

    all_requests_before = []
    blocked_before = []
    all_requests_after = []
    blocked_after = []
    phase = {"current": "before"}
    seen_urls = set()

    def on_request(request):
        url = request.url
        if url.startswith("data:") or url.startswith("blob:") or url.startswith("chrome-extension:"):
            return
        if phase["current"] == "before":
            all_requests_before.append(url)
        else:
            if url not in seen_urls:
                all_requests_after.append(url)

    def on_request_failed(request):
        url = request.url
        if url.startswith("data:") or url.startswith("blob:") or url.startswith("chrome-extension:"):
            return
        failure = request.failure
        if failure and "net::ERR_BLOCKED_BY_CLIENT" in failure:
            domain = urlparse(url).netloc
            entry = {"url": url, "domain": domain}
            if phase["current"] == "before":
                blocked_before.append(entry)
            else:
                if url not in seen_urls:
                    blocked_after.append(entry)

    page.on("request", on_request)
    page.on("requestfailed", on_request_failed)

    try:
        print(f"  [{site_name}] Loading...", flush=True)
        try:
            await page.goto(site_url, wait_until="domcontentloaded", timeout=25000)
        except PlaywrightTimeout:
            print(f"  [{site_name}] Timeout, continuing...", flush=True)
        except Exception as e:
            if "net::ERR_" in str(e) and "BLOCKED" not in str(e):
                result["status"] = "network_error"
                result["summary"] = str(e)[:200]
                await page.close()
                return result

        await asyncio.sleep(8)

        # Record before-accept state
        seen_urls = set(all_requests_before)
        result["before_accept"]["total_requests"] = len(all_requests_before)
        result["before_accept"]["blocked_requests"] = len(blocked_before)
        result["before_accept"]["blocked_urls"] = [
            {"url": b["url"], "domain": b["domain"]} for b in blocked_before
        ]

        # Switch to after phase
        phase["current"] = "after"

        # Find and click accept button
        print(f"  [{site_name}] Looking for accept button...", flush=True)
        candidates = await page.evaluate(JS_FIND_ACCEPT_BUTTON)

        if not candidates:
            # Fallback: take screenshot and dump DOM for manual review
            fallback_dir = "/workspace/cookie_analysis/debug_screenshots"
            os.makedirs(fallback_dir, exist_ok=True)
            safe_name = site_name.replace(".", "_").replace("/", "_")
            try:
                await page.screenshot(
                    path=os.path.join(fallback_dir, f"ddg_{safe_name}.png"),
                    full_page=False, timeout=10000
                )
            except Exception:
                pass

            result["status"] = "no_accept_button_found"
            blocked_domains = set(b["domain"] for b in blocked_before)
            result["summary"] = (
                f"No accept button found. "
                f"Blocked {len(blocked_before)} of {len(all_requests_before)} requests. "
                f"Blocked domains: {', '.join(sorted(blocked_domains)[:5])}"
            )
            print(f"  [{site_name}] {result['summary'][:120]}", flush=True)
            await page.close()
            return result

        best = candidates[0]
        result["accept_button"] = {"text": best["text"][:80], "score": best["score"]}
        print(f"  [{site_name}] Clicking: '{best['text'][:50]}' (score={best['score']})", flush=True)

        try:
            await page.click(best["selector"], timeout=5000)
        except Exception:
            try:
                await page.mouse.click(best["x"], best["y"])
            except Exception as e2:
                result["status"] = "click_failed"
                result["summary"] = f"Click failed: {str(e2)[:100]}"
                await page.close()
                return result

        await asyncio.sleep(5)

        # Record after-accept state
        result["after_accept"]["total_new_requests"] = len(all_requests_after)
        result["after_accept"]["new_blocked_requests"] = len(blocked_after)
        result["after_accept"]["new_blocked_urls"] = [
            {"url": b["url"], "domain": b["domain"]} for b in blocked_after
        ]

        blocked_domains_before = set(b["domain"] for b in blocked_before)
        blocked_domains_after = set(b["domain"] for b in blocked_after)
        new_blocked_domains = blocked_domains_after - blocked_domains_before

        result["status"] = "analyzed"
        result["summary"] = (
            f"Before: {len(blocked_before)} blocked / {len(all_requests_before)} total. "
            f"After: +{len(blocked_after)} blocked / +{len(all_requests_after)} new. "
            + (f"New blocked domains: {', '.join(sorted(new_blocked_domains)[:5])}" if new_blocked_domains else "No new blocked domains.")
        )
        print(f"  [{site_name}] {result['summary'][:120]}", flush=True)

    except Exception as e:
        result["status"] = "error"
        result["summary"] = str(e)[:300]
        print(f"  [{site_name}] ERROR: {e}", flush=True)

    try:
        await page.close()
    except Exception:
        pass

    return result


async def main():
    output_dir = "/workspace/cookie_analysis/results"
    os.makedirs(output_dir, exist_ok=True)

    sites = NON_REJECTABLE_SITES

    if len(sys.argv) > 1:
        filter_args = sys.argv[1:]
        sites = [(n, u) for n, u in sites if any(f in n for f in filter_args)]

    print(f"DDG Extension blocking analysis on {len(sites)} sites...\n")

    all_results = []

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

        # Give extension time to fully initialize and download lists
        print("Waiting for DDG extension to initialize...")
        await asyncio.sleep(10)

        # Close any extension-opened tabs
        for pg in context.pages[1:]:
            try:
                await pg.close()
            except Exception:
                pass

        for i, (name, url) in enumerate(sites):
            print(f"\n[{i+1}/{len(sites)}] {name}")
            try:
                result = await analyze_site(context, name, url)
                all_results.append(result)
            except Exception as e:
                all_results.append({
                    "site": name,
                    "url": url,
                    "status": "exception",
                    "summary": str(e)[:300],
                })
                print(f"  [{name}] EXCEPTION: {e}")

            # Save intermediate results
            with open(os.path.join(output_dir, "ddg_blocking_results.json"), "w") as f:
                json.dump(all_results, f, indent=2, default=str)

        await context.close()

    # Final save
    output_path = os.path.join(output_dir, "ddg_blocking_results.json")
    with open(output_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)

    # Print summary
    print("\n" + "=" * 80)
    print("DDG EXTENSION BLOCKING ANALYSIS SUMMARY")
    print("=" * 80)

    analyzed = [r for r in all_results if r.get("status") == "analyzed"]
    no_button = [r for r in all_results if r.get("status") == "no_accept_button_found"]
    errors = [r for r in all_results if r.get("status") in ("error", "exception", "network_error", "click_failed")]

    print(f"\nTotal sites: {len(all_results)}")
    print(f"Analyzed (accept clicked): {len(analyzed)}")
    print(f"No accept button found: {len(no_button)}")
    print(f"Errors: {len(errors)}")

    # Stats
    all_with_data = analyzed + no_button
    sites_with_blocks = [r for r in all_with_data if r["before_accept"]["blocked_requests"] > 0]
    sites_with_new_blocks = [r for r in analyzed if r["after_accept"]["new_blocked_requests"] > 0]

    print(f"\nSites where DDG blocked requests on load: {len(sites_with_blocks)} / {len(all_with_data)}")
    print(f"Sites with NEW blocks after accept: {len(sites_with_new_blocks)} / {len(analyzed)}")

    # Top blocked sites
    sorted_by_blocks = sorted(all_with_data, key=lambda r: r["before_accept"]["blocked_requests"], reverse=True)
    print(f"\n--- Top 20 sites by blocked requests (before accept) ---")
    for r in sorted_by_blocks[:20]:
        bb = r["before_accept"]["blocked_requests"]
        bt = r["before_accept"]["total_requests"]
        pct = (bb / bt * 100) if bt > 0 else 0
        print(f"  {r['site']}: {bb} blocked / {bt} total ({pct:.0f}%)")

    if sites_with_new_blocks:
        print(f"\n--- Sites with new blocks after clicking accept ---")
        for r in sorted(sites_with_new_blocks, key=lambda x: x["after_accept"]["new_blocked_requests"], reverse=True):
            nb = r["after_accept"]["new_blocked_requests"]
            nt = r["after_accept"]["total_new_requests"]
            print(f"  {r['site']}: +{nb} blocked / +{nt} new requests")

    print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
