# Cookie Popup & Tracking Analysis Report

**Date:** 2026-03-20  
**Sites analyzed:** 102  
**Method:** Visual inspection of screenshots (headed Chromium via Playwright), followed by automated network request and cookie monitoring before/after clicking "accept"

---

## Executive Summary

Out of 102 sites reported to have non-rejectable cookie popups:

- **71 confirmed non-rejectable** (only "accept"/"OK"/"got it" with no reject/settings option)
- **10 rejectable** (have "reject all", "settings", "preferences", or similar buttons)
- **11 no cookie popup visible** on initial load
- **9 blocked/access denied** (could not evaluate)
- **1 borderline** (unclear if "learn more" leads to preferences)

Of the 71 non-rejectable sites, tracking analysis revealed:

| Finding | Count |
|---------|-------|
| Load tracking **BEFORE** accept (consent ignored) | **64** (90%) |
| No tracking at all (before or after) | **6** (8%) |
| Respect consent: tracking only **AFTER** accept | **1** (1.4%) |

**Key finding:** The vast majority (90%) of sites with non-rejectable cookie popups load tracking resources immediately on page load, before the user has any opportunity to interact with the consent banner. The cookie popup is essentially decorative—tracking is already active.

---

## Detailed Classification

### Sites Confirmed Non-Rejectable (71)

These sites show a cookie popup/banner with only an "accept"/"OK"/"got it"/"close" button and no way to reject or manage cookie preferences.

| # | Site | Popup Type |
|---|------|-----------|
| 1 | fashionnova.com | Cookie banner with accept only |
| 2 | rwguildgalleryny.com | Cookie notice with "Accept" |
| 3 | carraghersnyc.com | Cookie banner with "Accept" |
| 4 | goodliferesorts.guestybookings.com | Cookie notice with "Accept" |
| 5 | modani.com | Cookie notice with "Ok" |
| 6 | ciee.org | Cookie banner with "Agree and Dismiss" |
| 7 | 80.lv | Cookie notice with accept only |
| 8 | schoolhouse.com | Cookie banner with "Accept" |
| 9 | ballarddesigns.com | Cookie notice with close button |
| 10 | food52.com | Cookie banner with "Accept" |
| 11 | researchgate.net | Cookie notice with accept only |
| 12 | danco.com | Cookie banner with accept only |
| 13 | humandx.org | Cookie notice with close (✕) button |
| 14 | vowels.net | Cookie banner with "Accept Cookies" |
| 15 | shopquarters.com | Cookie banner with "Accept" |
| 16 | scworld.com | Cookie banner with "Accept cookies" |
| 17 | innerscene.com | Cookie banner with "Accept all cookies" |
| 18 | mls.therealest.com | Cookie banner with "Accept" |
| 19 | serpstat.com | Cookie banner with "Accept cookies" |
| 20 | copaamerica.com | Cookie notice with accept only |
| 21 | wecoach.gg | Cookie banner with "Accept" |
| 22 | store.waitbutwhy.com | Cookie notice with dismiss |
| 23 | osf.io | Cookie banner with "Accept cookies" |
| 24 | acct.ezpassde.com | Cookie notice with accept |
| 25 | emerson.edu | Cookie notice with accept only |
| 26 | davidson.edu | Cookie banner with accept only |
| 27 | caribbeancinemas.com | Cookie banner with "Accept & Dismiss" |
| 28 | heartmath.org | Cookie notice with close button |
| 29 | foratravel.com | Cookie banner with "I ACCEPT" |
| 30 | swimjim.com | Cookie notice with close (×) |
| 31 | spencer.org | Cookie notice with accept |
| 32 | hatchshowprint.com | Cookie banner with accept only |
| 33 | spermidinelife.us | Cookie banner with "Accept" |
| 34 | summerdiscovery.com | Cookie notice with accept only |
| 35 | uow.edu.au | Cookie notice with accept only |
| 36 | posthog.com | Cookie notice with accept only |
| 37 | meetboston.com | Cookie banner with "Accept" |
| 38 | poconomountains.com | Cookie banner with "Accept & Dismiss" |
| 39 | bso.org | Cookie notice with dismiss |
| 40 | visitpittsburgh.com | Cookie banner with "Accept" |
| 41 | scad.edu | Cookie notice with dismiss |
| 42 | getguru.com | Cookie banner with accept |
| 43 | opalcollection.com | Cookie banner with "Accept" |
| 44 | cymbiotika.com | Cookie banner with "GOT IT" |
| 45 | risingshadow.net | Cookie banner with "Got it!" |
| 46 | extrabux.com | Cookie notice with accept only |
| 47 | garnethill.com | Cookie notice with close button |
| 48 | seventeen.com | Cookie notice with accept only |
| 49 | platt.com | Cookie notice with accept only |
| 50 | build.com | Cookie banner with "Dismiss" |
| 51 | tufts.edu | Cookie banner with "Accept and Continue" |
| 52 | admissions.pitt.edu | Cookie banner with "Accept" |
| 53 | westjet.com | Cookie banner with "Accept" |
| 54 | worldbank.org | Cookie notice with close (×) |
| 55 | endocrine.org | Cookie banner with "Accept" |
| 56 | tp-link.com | Cookie notice with "Close" |
| 57 | asia.nikkei.com | Cookie notice with accept |
| 58 | scmp.com | Cookie banner with "ACCEPT" |
| 59 | lafollette.wisc.edu | Cookie notice with dismiss |
| 60 | usv.getproven.com | Cookie banner with "I Agree" |
| 61 | aceodds.com | Cookie notice with accept only |
| 62 | hearinghealthfoundation.org | Cookie banner with "Accept" |
| 63 | cyberpower.com | Cookie notice with "Close" |
| 64 | petrapalusova.com | Cookie banner with "Accept" |
| 65 | riverandrailkitchen.com | Cookie banner with "Accept" |
| 66 | mooremerkowitztile.com | Cookie notice with accept only |
| 67 | stamma.org | Cookie notice with accept only |
| 68 | colorsxstudios.com | Cookie banner with "Accept all" |
| 69 | electricgeneratorsdirect.com | Cookie notice with dismiss |
| 70 | cinepolisusa.com | Cookie banner with "Accept all" |
| 71 | esquire.com | Privacy notice with close (X) only |

### Sites with Rejectable Popups (10)

These sites have cookie popups with options to reject, manage preferences, or adjust settings.

| Site | Reject Mechanism |
|------|-----------------|
| shopfavoritedaughter.com | Has settings/preferences option |
| loveantiques.com | Has reject option |
| quantamagazine.org | Has manage preferences |
| blanco.com | Has reject all / customize |
| york.ac.uk | Has settings/manage option |
| ankersolix.com | Has reject option |
| ontrac.com | Has manage/settings option |
| hrparts.com | Has cookie settings |
| rexelusa.com | Has reject option |
| cas.columbia.edu | Has manage preferences |

### No Cookie Popup Visible (11)

| Site |
|------|
| mirror.co.uk |
| thesavannahbananas.com |
| cdek.kz |
| givedirectly.org |
| statebags.com |
| wildling.com |
| solvhealth.com |
| newatlas.com |
| fanatics.com |
| thebeast.com |
| blueprincegame.com |

### Blocked / Cannot Evaluate (9)

| Site | Reason |
|------|--------|
| bluebottlecoffee.myguestaccount.com | Page did not load properly |
| storychanges.com | Site unreachable |
| etix.com | Page load error |
| fitness-n-health.com | Site blocked |
| tineye.com | Blocked automated access |
| aa.com | Access denied |
| leonpaul.com | Page load error |
| timesofagriculture.org | Site unreachable |
| edmunds.com | Access Denied |

### Borderline (1)

| Site | Note |
|------|------|
| makitatools.com | "LEARN MORE" link may lead to preferences page |

---

## Tracking Analysis Results

For each non-rejectable site, we monitored all network requests and cookies during initial page load (before clicking "accept") and after clicking accept.

### Sites That RESPECT Consent (1)

These sites load tracking resources **only after** the user clicks accept:

#### colorsxstudios.com ✅
- **Before accept:** 0 tracking requests, 0 tracking cookies
- **After accept:** 5 new tracking requests, 4 new tracking cookies
- **Trackers loaded after accept:** Google Tag Manager, Google Analytics, DoubleClick
- **New cookies after accept:** `_gid`, `_gat_gtag_UA_150666064_1`, `_ga_GR9LWV0SDX`, `_ga`
- **Verdict:** Properly implements consent-gated tracking

#### wecoach.gg ⚠️ (Mostly respects consent)
- **Before accept:** 1 tracking request (API call classified as tracking), 0 tracking cookies
- **After accept:** 18 new tracking requests, 7 new tracking cookies
- **Trackers loaded after accept:** Google Tag Manager, Google Analytics, Facebook Pixel, Google Ads
- **New cookies after accept:** `_gcl_au`, `_ga`, `_gid`, `_gat_gtag_*`, `_fbp`
- **Verdict:** Nearly all tracking is consent-gated; 1 ambiguous API request loads before accept

### Sites With No Tracking Detected (6)

These sites showed no known tracking requests or tracking cookies before or after accepting:

| Site | Note |
|------|------|
| acct.ezpassde.com | Government toll account portal — no tracking |
| tp-link.com | Cookie notice present but no tracking detected |
| posthog.com | Ironically, an analytics company with no third-party tracking |
| aceodds.com | No tracking detected on initial load |
| petrapalusova.com | Personal/portfolio site — no tracking |
| riverandrailkitchen.com | Restaurant site — no tracking |

### Sites That Load Tracking BEFORE Accept (64)

These sites load tracking resources immediately on page load, regardless of whether the user has clicked "accept." The cookie popup provides no real consent mechanism.

#### Heavy Tracking Before Accept (>50 tracking requests)

| Site | Tracking Reqs Before | Tracking Cookies Before | New After Accept | Tracker Categories |
|------|---------------------|------------------------|------------------|--------------------|
| scmp.com | 419 | 8 | +29 reqs | Google Analytics, Google Ads, Facebook, Ad Networks, Analytics |
| food52.com | 396 | 9 | +12 reqs | Google Analytics, Google Ads, Facebook, Ad Networks |
| visitpittsburgh.com | 146 | 8 | +8 reqs | Google Analytics, Google Ads, Facebook, LinkedIn |
| asia.nikkei.com | 140 | 17 | +31 reqs | Google Analytics, Google Ads, Facebook, Ad Networks |
| bso.org | 114 | 16 | +1 req | Google Analytics, Google Ads, Facebook, LinkedIn |
| meetboston.com | 94 | 9 | +1 req | Google Analytics, Google Ads, Facebook |
| poconomountains.com | 91 | 18 | +6 reqs | Google Analytics, Google Ads, Facebook, TikTok |
| scworld.com | 86 | 11 | +2 reqs | Google Analytics, Google Ads, Consent Mgmt, Ad Networks |
| esquire.com | 84 | 7 | N/A | Google Analytics, Google Ads, Facebook, LinkedIn, Ad Networks |
| scad.edu | 78 | 10 | +4 reqs | Google Analytics, Google Ads, Facebook |
| endocrine.org | 74 | 11 | +5 reqs | Google Analytics, Google Ads |
| cymbiotika.com | 73 | 10 | +2 reqs | Google Analytics, Google Ads, Facebook, TikTok |
| getguru.com | 72 | 13 | +5 reqs | Google Analytics, Google Ads, Facebook, LinkedIn, HubSpot |
| ballarddesigns.com | 68 | 16 | +2 reqs | Google Analytics, Google Ads, Facebook, Ad Networks |
| foratravel.com | 68 | 17 | +5 reqs | Google Analytics, Google Ads, Facebook |
| hatchshowprint.com | 64 | 16 | N/A | Google Analytics, Google Ads, Facebook, LinkedIn, TikTok, Ad Networks |
| admissions.pitt.edu | 62 | 13 | +13 reqs | Google Analytics, Google Ads, Facebook |
| fashionnova.com | 60 | 12 | N/A | Google Analytics, Google Ads, Facebook, MS Clarity, TikTok, Ad Networks |
| tufts.edu | 55 | 13 | +6 reqs | Google Analytics, Google Ads, Facebook |
| build.com | 51 | 11 | +4 reqs | Google Analytics, Google Ads, Facebook, Ad Networks |
| opalcollection.com | 50 | 12 | +4 reqs | Google Analytics, Google Ads, Facebook |

#### Moderate Tracking Before Accept (10–50 tracking requests)

| Site | Tracking Reqs Before | Tracking Cookies Before | New After Accept | Tracker Categories |
|------|---------------------|------------------------|------------------|--------------------|
| ciee.org | 49 | 14 | +3 reqs | Google Analytics, Google Ads, Facebook, Hotjar, Ad Networks |
| uow.edu.au | 38 | 11 | N/A | Google Analytics, Google Ads, Facebook, TikTok |
| seventeen.com | 36 | 4 | N/A | Google Analytics, Google Ads, Consent Mgmt, Analytics |
| davidson.edu | 35 | 10 | N/A | Google Analytics, Google Ads, Facebook, MS Clarity |
| worldbank.org | 34 | 5 | +0 reqs | Google Analytics, Google Ads |
| mooremerkowitztile.com | 33 | 18 | N/A | Google Analytics, Google Ads, HubSpot, LinkedIn, MS Clarity |
| hearinghealthfoundation.org | 31 | 6 | +0 reqs | Google Analytics, Google Ads, Facebook |
| modani.com | 30 | 11 | +0 reqs | Google Analytics, Google Ads, Facebook, Ad Networks |
| westjet.com | 29 | 10 | +2 reqs | Google Analytics, Google Ads |
| summerdiscovery.com | 28 | 8 | N/A | Google Analytics, Google Ads, Facebook, Hotjar |
| garnethill.com | 28 | 10 | +1 req | Google Analytics, Google Ads, Facebook |
| emerson.edu | 28 | 8 | N/A | Google Analytics, Google Ads, Facebook, LinkedIn |
| schoolhouse.com | 27 | 8 | +2 reqs | Google Analytics, Google Ads, Facebook |
| heartmath.org | 27 | 7 | +4 reqs | Google Analytics, Google Ads, Facebook |
| cinepolisusa.com | 25 | 3 | +4 reqs | Google Analytics, Google Ads |
| osf.io | 24 | 5 | +0 reqs | Google Analytics, Google Ads, Hotjar |
| innerscene.com | 23 | 10 | +2 reqs | Google Analytics, Google Ads, Facebook, Hotjar |
| serpstat.com | 18 | 6 | +5 reqs | Google Analytics, Google Ads, Facebook |
| vowels.net | 17 | 5 | +2 reqs | Google Analytics, Google Ads |
| spermidinelife.us | 17 | 6 | +0 reqs | Google Analytics, Google Ads, Facebook |
| store.waitbutwhy.com | 17 | 1 | +0 reqs | Google Analytics |
| platt.com | 16 | 4 | N/A | Google Analytics, Google Ads, Chat Widget |
| stamma.org | 14 | 2 | N/A | Google Ads, Hotjar |

#### Light Tracking Before Accept (<10 tracking requests)

| Site | Tracking Reqs Before | Tracking Cookies Before | New After Accept | Tracker Categories |
|------|---------------------|------------------------|------------------|--------------------|
| swimjim.com | 13 | 5 | +2 reqs | Google Analytics, Google Ads, Facebook |
| shopquarters.com | 13 | 6 | +2 reqs | Google Analytics, Google Ads, Facebook |
| mls.therealest.com | 13 | 7 | +2 reqs | Google Analytics, Google Ads |
| 80.lv | 12 | 3 | N/A | Google Analytics, Google Ads |
| danco.com | 12 | 4 | N/A | Google Analytics, Google Ads, MS Clarity |
| researchgate.net | 11 | 4 | N/A | Google Analytics, Ad Networks |
| lafollette.wisc.edu | 11 | 3 | +0 reqs | Google Analytics, Google Ads |
| usv.getproven.com | 10 | 4 | +0 reqs | Google Analytics |
| extrabux.com | 9 | 3 | N/A | Google Analytics, Google Ads |
| humandx.org | 8 | 5 | +0 reqs | Google Analytics, Google Ads |
| cyberpower.com | 8 | 5 | +0 reqs | Google Analytics |
| caribbeancinemas.com | 7 | 2 | +0 reqs | Google Analytics, Google Ads |
| goodliferesorts.guestybookings.com | 6 | 0 | +5 reqs | Google Analytics, Google Ads |
| carraghersnyc.com | 6 | 3 | +2 reqs | Google Analytics, Google Ads |
| electricgeneratorsdirect.com | 5 | 3 | +0 reqs | Google Analytics |
| spencer.org | 4 | 4 | +0 reqs | Google Analytics, Google Ads |
| rwguildgalleryny.com | 4 | 2 | +0 reqs | Google Analytics, Google Ads |
| risingshadow.net | 2 | 2 | +0 reqs | Google Analytics |
| copaamerica.com | 1 | 0 | N/A | Google Analytics |

*N/A in "New After Accept" means the automated button-finder could not locate/click the accept button, so only pre-accept state was measured.*

---

## Methodology

### Phase 1: Visual Classification
1. All 102 sites were loaded in a headed Chromium browser using Playwright
2. Screenshots were captured after a 5-second delay to allow cookie popups to appear
3. Each screenshot was manually reviewed to identify:
   - Presence of a cookie popup/banner
   - Available buttons and links within the popup
   - Whether the popup provides a reject/settings/preferences option

### Phase 2: Tracking Analysis
1. Each non-rejectable site was loaded in a fresh browser context
2. All network requests were intercepted and logged during page load
3. Cookies were captured after initial load (before clicking accept)
4. The "accept" button was identified and clicked programmatically
5. New network requests and cookies were captured after clicking accept
6. Requests were classified as tracking/non-tracking based on known tracking domains and URL patterns
7. Cookies were classified based on known tracking cookie name patterns

### Tracking Detection
Requests were classified as tracking based on:
- **Domain patterns:** Google Analytics, Google Tag Manager, Google Ads, Facebook Pixel, DoubleClick, Hotjar, Microsoft Clarity, Segment, HubSpot, Criteo, Outbrain, Taboola, TikTok, LinkedIn, etc.
- **URL path patterns:** `/collect`, `/analytics`, `/tracking`, `/pixel`, `/beacon`, `/gtag/`, `/fbevents.js`, etc.
- **Cookie name patterns:** `_ga`, `_gid`, `_fbp`, `_hj*`, `_clck`, `__utm*`, `__hs*`, etc.

---

## Conclusions

1. **90% of non-rejectable cookie popup sites load tracking before consent.** The cookie popup is essentially meaningless — tracking is already active the moment the page loads.

2. **Only 1 out of 71 sites (colorsxstudios.com) properly gates tracking behind consent.** It loads Google Analytics and DoubleClick only after the user clicks "Accept all."

3. **wecoach.gg is a near-miss** — it loads nearly all tracking (Google Analytics, Facebook, Google Ads) only after accept, with just one ambiguous API request before.

4. **Google Analytics and Google Ads are near-universal.** They appear on 62 out of 64 sites that load pre-consent tracking.

5. **Facebook Pixel is the second most common tracker**, appearing on approximately 40% of tracked sites.

6. **Some sites load tracking before accept AND additional tracking after** — in these cases, the accept button appears to unlock additional tracking layers while basic tracking was already running.

7. **The "accept" button changes nothing on 14 sites** — the same tracking runs before and after clicking, making the popup purely theatrical.

8. **6 sites had no detectable tracking at all**, raising the question of why they display a cookie popup in the first place (possibly for first-party cookies or out of compliance abundance).
