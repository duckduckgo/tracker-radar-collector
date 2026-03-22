# DuckDuckGo Privacy Extension Blocking Report

**Date:** 2026-03-22  
**Extension version:** 2026.1.12 (built from source)  
**Sites analyzed:** 69 (confirmed non-rejectable cookie popups, excluding colorsxstudios.com and cinepolisusa.com)  
**Method:** Each site loaded in fresh Chromium context with DDG extension, screenshots visually reviewed, accept buttons clicked at verified coordinates, request blocking monitored via `net::ERR_BLOCKED_BY_CLIENT` events.

---

## Summary

| Metric | Count |
|--------|-------|
| Sites analyzed (accept clicked) | 66 |
| Sites where popup not visible (DDG blocks consent script) | 3 |
| Sites where DDG blocked requests on initial load | **52 / 69** (75%) |
| Sites with **new** blocked requests after clicking accept | **27 / 66** (41%) |

**Key finding:** The DDG extension blocks tracking requests on 75% of these sites during initial page load — before the user interacts with the cookie popup at all. On 41% of sites, clicking "accept" triggers additional requests that DDG also blocks.

---

## Top Sites by Blocked Requests (Before Accept)

| # | Site | Blocked | Total | % Blocked | New Blocked After |
|---|------|---------|-------|-----------|-------------------|
| 1 | foratravel.com | 50 | 309 | 16.2% | +3 |
| 2 | bso.org | 49 | 134 | 36.6% | +1 |
| 3 | scmp.com | 43 | 250 | 17.2% | +5 |
| 4 | schoolhouse.com | 31 | 261 | 11.9% | 0 |
| 5 | ballarddesigns.com | 31 | 215 | 14.4% | 0 |
| 6 | scworld.com | 31 | 187 | 16.6% | +1 |
| 7 | poconomountains.com | 30 | 305 | 9.8% | +1 |
| 8 | getguru.com | 27 | 169 | 16.0% | +2 |
| 9 | modani.com | 25 | 540 | 4.6% | 0 |
| 10 | garnethill.com | 24 | 166 | 14.5% | 0 |
| 11 | tufts.edu | 22 | 187 | 11.8% | +3 |
| 12 | summerdiscovery.com | 21 | 189 | 11.1% | +2 |
| 13 | visitpittsburgh.com | 19 | 298 | 6.4% | 0 |
| 14 | scad.edu | 19 | 201 | 9.5% | +1 |
| 15 | admissions.pitt.edu | 17 | 86 | 19.8% | +1 |
| 16 | ciee.org | 16 | 88 | 18.2% | +4 |
| 17 | spermidinelife.us | 16 | 235 | 6.8% | 0 |
| 18 | hatchshowprint.com | 15 | 93 | 16.1% | +1 |
| 19 | asia.nikkei.com | 15 | 261 | 5.7% | 0 |
| 20 | fashionnova.com | 14 | 224 | 6.2% | +2 |

---

## Sites With New Blocked Requests After Accept

These sites loaded additional tracking after the accept button was clicked, which the DDG extension also blocked:

| Site | Blocked Before | New Blocked After | New Req After |
|------|---------------|-------------------|---------------|
| esquire.com | 10 | +15 | +102 |
| scmp.com | 43 | +5 | +69 |
| emerson.edu | 1 | +5 | +5 |
| ciee.org | 16 | +4 | +4 |
| seventeen.com | 13 | +4 | +47 |
| build.com | 1 | +4 | +7 |
| foratravel.com | 50 | +3 | +3 |
| tufts.edu | 22 | +3 | +6 |
| 80.lv | 0 | +2 | +95 |
| fashionnova.com | 14 | +2 | +39 |
| innerscene.com | 14 | +2 | +2 |
| summerdiscovery.com | 21 | +2 | +3 |
| getguru.com | 27 | +2 | +2 |
| mooremerkowitztile.com | 10 | +2 | +2 |
| worldbank.org | 13 | +2 | +2 |
| westjet.com | 2 | +2 | +2 |
| scworld.com | 31 | +1 | +1 |
| poconomountains.com | 30 | +1 | +1 |
| bso.org | 49 | +1 | +3 |
| scad.edu | 19 | +1 | +1 |
| opalcollection.com | 8 | +1 | +1 |
| hatchshowprint.com | 15 | +1 | +17 |
| admissions.pitt.edu | 17 | +1 | +1 |
| goodliferesorts.guestybookings.com | 0 | +1 | +1 |
| copaamerica.com | 0 | +1 | +1 |
| caribbeancinemas.com | 3 | +1 | +16 |
| meetboston.com | 0 | +1 | +1 |

---

## Sites With Zero Blocked Requests

These sites had no requests blocked by the DDG extension:

| Site | Total Requests | Note |
|------|---------------|------|
| researchgate.net | 71 | No popup visible (no_popup) |
| humandx.org | 109 | |
| wecoach.gg | 72 | |
| acct.ezpassde.com | 38 | Government portal |
| spencer.org | 29 | |
| posthog.com | 120 | Analytics company, no 3rd-party tracking |
| cymbiotika.com | 1 | Page barely loaded |
| risingshadow.net | 51 | |
| tp-link.com | 71 | |
| lafollette.wisc.edu | 52 | |
| petrapalusova.com | 82 | Personal site |
| riverandrailkitchen.com | 42 | Restaurant site |
| food52.com | 1447 | High traffic but DDG didn't flag |
| copaamerica.com | 103 | |
| goodliferesorts.guestybookings.com | 70 | |
| meetboston.com | 373 | |
| 80.lv | 71 | |

---

## Highest Block Rates (% of requests blocked)

| Site | % Blocked | Blocked/Total |
|------|-----------|---------------|
| bso.org | 36.6% | 49/134 |
| uow.edu.au | 20.6% | 14/68 |
| admissions.pitt.edu | 19.8% | 17/86 |
| ciee.org | 18.2% | 16/88 |
| scmp.com | 17.2% | 43/250 |
| scworld.com | 16.6% | 31/187 |
| foratravel.com | 16.2% | 50/309 |
| hatchshowprint.com | 16.1% | 15/93 |
| getguru.com | 16.0% | 27/169 |
| garnethill.com | 14.5% | 24/166 |
| ballarddesigns.com | 14.4% | 31/215 |
| serpstat.com | 14.1% | 9/64 |
| davidson.edu | 12.7% | 9/71 |
| innerscene.com | 12.6% | 14/111 |
| schoolhouse.com | 11.9% | 31/261 |
| tufts.edu | 11.8% | 22/187 |
| summerdiscovery.com | 11.1% | 21/189 |

---

## Methodology

1. **Extension build:** DuckDuckGo Privacy Extension cloned from [GitHub](https://github.com/duckduckgo/duckduckgo-privacy-extension/) and built for Chrome (`npm run release-chrome`).

2. **Per-site isolation:** Each site was loaded in a fresh `launch_persistent_context` with the extension, ensuring clean state between sites. Extension was given 3 seconds to initialize before navigation.

3. **Screenshot + DOM analysis:** After loading each site and waiting 8 seconds for popups to appear, a screenshot and DOM snapshot were captured. These were **manually reviewed** to identify the exact accept/dismiss button and its screen coordinates.

4. **Click verification:** Accept buttons were clicked using the visually-verified coordinates. For 3 sites where the DDG extension blocked the consent platform script itself, no popup was visible and they were recorded as "no_popup."

5. **Request monitoring:** All requests were intercepted via Playwright's `request` and `requestfailed` events. Requests blocked by the DDG extension return `net::ERR_BLOCKED_BY_CLIENT` as their failure reason.

6. **Pre/post comparison:** Requests and blocked counts were recorded before the click (during page load + 8s wait) and after the click (5s window). New blocked requests are those appearing only after the click and not seen before.
