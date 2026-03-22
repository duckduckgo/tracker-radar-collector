#!/usr/bin/env python3
"""
Analyze DOM snapshots from step 1 and produce a click plan.
For each site, extract the best candidate accept/dismiss button from the DOM areas.
Output a JSON file with click targets for review.
"""

import json
import os
import re

STATE_DIR = "/workspace/cookie_analysis/ddg_states"

ACCEPT_TEXT = re.compile(
    r'^(accept(\s+(all|cookies?|&\s*continue|&\s*dismiss|and\s+continue|and\s+dismiss))?'
    r'|i\s+accept|agree(\s*(and|&)\s*(continue|dismiss))?|i\s+agree'
    r'|got\s+it!?|ok(ay)?[,!]?(\s*(thanks|thank\s*you))?[.!]?'
    r'|allow(\s+(all|cookies?))?|consent|continue|understood'
    r'|i\s+understand|acknowledge|dismiss|close'
    r'|that\'?s\s+(fine|ok(ay)?)|continue\s+to\s+browse.*'
    r'|[x\u00d7\u2715\u2716✕×]'
    r'|ok,?\s+thanks'
    r')$', re.IGNORECASE
)

ACCEPT_CLASS = re.compile(
    r'(agree.button|gdpr.accept|cc-allow|privacy.accept|cookie.accept'
    r'|consent.accept|sqs-cookie-banner.*accept|dismiss.button'
    r'|cookie.*dismiss|banner.*dismiss|eu-cookie.*default-button'
    r'|cc-btn.*cc-allow|cookie-banner.*close)', re.IGNORECASE
)

CONSENT_AREA = re.compile(
    r'(cookie|consent|gdpr|privacy|eu-cookie|cc-window|cc-banner'
    r'|sliding-popup|cookiescript|notice)', re.IGNORECASE
)


def score_button(btn, area):
    text = btn.get("text", "").strip()
    cls = btn.get("classes", "")
    bid = btn.get("id", "")
    tag = btn.get("tag", "")
    y = btn.get("y", 0)
    w = btn.get("w", 0)
    h = btn.get("h", 0)

    score = 0

    # Text match
    if text and ACCEPT_TEXT.match(text):
        score += 10

    # Class match
    if ACCEPT_CLASS.search(cls + " " + bid):
        score += 8

    # In consent area
    area_cls = area.get("classes", "") + " " + area.get("id", "")
    if CONSENT_AREA.search(area_cls):
        score += 5

    # Position: bottom or top of viewport (cookie banners)
    if y > 600:
        score += 3
    elif y < 100:
        score += 1

    # Prefer button/a over div
    if tag in ("button", "a"):
        score += 1

    # Penalize very long text (likely not a button label)
    if len(text) > 100:
        score -= 5

    # Penalize very large elements (containers)
    if w > 500 and h > 100:
        score -= 3

    return score


def analyze_site(state):
    site = state["site"]
    dom_areas = state.get("dom_areas", [])

    if not dom_areas:
        return {"site": site, "action": "no_popup", "reason": "No DOM areas found"}

    # Find best button across all areas
    best = None
    best_score = -1
    best_area_text = ""

    for area in dom_areas:
        area_cls = area.get("classes", "") + " " + area.get("id", "")
        if not CONSENT_AREA.search(area_cls):
            continue

        for btn in area.get("buttons", []):
            s = score_button(btn, area)
            if s > best_score:
                best_score = s
                best = btn
                best_area_text = area.get("text", "")[:100]

    if best and best_score >= 10:
        return {
            "site": site,
            "action": "click",
            "confidence": "high",
            "score": best_score,
            "target": {
                "text": best["text"][:80],
                "tag": best["tag"],
                "x": best["x"],
                "y": best["y"],
                "classes": best["classes"][:100],
                "id": best.get("id", ""),
            },
            "area_text": best_area_text,
        }
    elif best and best_score >= 5:
        return {
            "site": site,
            "action": "click",
            "confidence": "medium",
            "score": best_score,
            "target": {
                "text": best["text"][:80],
                "tag": best["tag"],
                "x": best["x"],
                "y": best["y"],
                "classes": best["classes"][:100],
                "id": best.get("id", ""),
            },
            "area_text": best_area_text,
        }
    else:
        # Dump what we found for manual review
        all_buttons = []
        for area in dom_areas:
            area_cls = area.get("classes", "") + " " + area.get("id", "")
            for btn in area.get("buttons", []):
                all_buttons.append({
                    "text": btn["text"][:80],
                    "tag": btn["tag"],
                    "x": btn["x"],
                    "y": btn["y"],
                    "area": area_cls[:80],
                })
        return {
            "site": site,
            "action": "manual_review",
            "reason": f"No confident match (best_score={best_score})",
            "candidates": all_buttons[:10],
        }


def main():
    plans = []
    for fname in sorted(os.listdir(STATE_DIR)):
        if not fname.endswith(".json"):
            continue
        with open(os.path.join(STATE_DIR, fname)) as f:
            state = json.load(f)
        plan = analyze_site(state)
        plan["blocked_before"] = state["blocked_requests_count"]
        plan["total_before"] = state["total_requests"]
        plans.append(plan)

    with open("/workspace/cookie_analysis/ddg_click_plan.json", "w") as f:
        json.dump(plans, f, indent=2)

    # Summary
    clicks = [p for p in plans if p["action"] == "click"]
    no_popup = [p for p in plans if p["action"] == "no_popup"]
    manual = [p for p in plans if p["action"] == "manual_review"]
    high = [p for p in clicks if p["confidence"] == "high"]
    medium = [p for p in clicks if p["confidence"] == "medium"]

    print(f"Click plan for {len(plans)} sites:")
    print(f"  Auto-click (high confidence): {len(high)}")
    print(f"  Auto-click (medium confidence): {len(medium)}")
    print(f"  No popup detected: {len(no_popup)}")
    print(f"  Needs manual review: {len(manual)}")

    print(f"\n--- High confidence clicks ---")
    for p in high:
        t = p["target"]
        print(f"  {p['site']}: '{t['text'][:40]}' [{t['tag']}] at ({t['x']},{t['y']}) score={p['score']}")

    print(f"\n--- Medium confidence clicks ---")
    for p in medium:
        t = p["target"]
        print(f"  {p['site']}: '{t['text'][:40]}' [{t['tag']}] at ({t['x']},{t['y']}) score={p['score']}")

    print(f"\n--- No popup ---")
    for p in no_popup:
        print(f"  {p['site']}: {p['reason']}")

    print(f"\n--- Manual review needed ---")
    for p in manual:
        print(f"  {p['site']}: {p['reason']}")
        for c in p.get("candidates", [])[:3]:
            print(f"    '{c['text'][:50]}' [{c['tag']}] at ({c['x']},{c['y']})")


if __name__ == "__main__":
    main()
