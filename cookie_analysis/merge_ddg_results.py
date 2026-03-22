#!/usr/bin/env python3
"""Merge DDG blocking results from multiple runs into one consolidated file."""

import json

# Load the full run results (70 sites)
with open("/workspace/cookie_analysis/results/ddg_blocking_results.json") as f:
    full_run = json.load(f)

# Sites from retries that we successfully analyzed
retry_sites = {
    "fashionnova.com", "researchgate.net", "danco.com", "emerson.edu",
    "davidson.edu", "hatchshowprint.com", "summerdiscovery.com", "uow.edu.au",
    "posthog.com", "extrabux.com", "seventeen.com", "platt.com",
    "build.com", "asia.nikkei.com", "aceodds.com", "mooremerkowitztile.com",
    "stamma.org", "electricgeneratorsdirect.com", "esquire.com",
}

# Build index of retry results (latest per site)
retry_results = {}
for r in full_run:
    if r["site"] in retry_sites:
        # Keep the latest (last) result for each site
        retry_results[r["site"]] = r

# Build merged list: use retry result if available and better, else original
merged = []
seen = set()
for r in full_run:
    site = r["site"]
    if site in seen:
        continue
    seen.add(site)

    if site in retry_results:
        retry_r = retry_results[site]
        # Prefer the analyzed version over no_accept_button_found
        if retry_r.get("status") == "analyzed" or r.get("status") != "analyzed":
            merged.append(retry_r)
        else:
            merged.append(r)
    else:
        merged.append(r)

# Save merged results
with open("/workspace/cookie_analysis/results/ddg_blocking_merged.json", "w") as f:
    json.dump(merged, f, indent=2, default=str)

# Summary
analyzed = [r for r in merged if r.get("status") == "analyzed"]
no_button = [r for r in merged if r.get("status") == "no_accept_button_found"]
errors = [r for r in merged if r.get("status") in ("error", "exception", "network_error")]

all_with_data = analyzed + no_button
sites_with_blocks = [r for r in all_with_data if r["before_accept"]["blocked_requests"] > 0]
sites_with_new_blocks = [r for r in analyzed if r["after_accept"]["new_blocked_requests"] > 0]

print(f"Merged results: {len(merged)} sites")
print(f"  Analyzed (accept clicked): {len(analyzed)}")
print(f"  No accept button found: {len(no_button)}")
print(f"    - {[r['site'] for r in no_button]}")
print(f"  Errors: {len(errors)}")
print(f"\nSites where DDG blocked requests on load: {len(sites_with_blocks)} / {len(all_with_data)}")
print(f"Sites with NEW blocks after accept: {len(sites_with_new_blocks)} / {len(analyzed)}")

# Detailed table
print(f"\n{'Site':<45} {'Blocked':>7} {'Total':>7} {'%':>5} {'NewBlk':>6} {'NewReq':>6} {'Status':<10}")
print("-" * 95)
for r in sorted(merged, key=lambda x: x["before_accept"]["blocked_requests"], reverse=True):
    bb = r["before_accept"]["blocked_requests"]
    bt = r["before_accept"]["total_requests"]
    pct = (bb / bt * 100) if bt > 0 else 0
    nb = r["after_accept"].get("new_blocked_requests", 0) if r.get("status") == "analyzed" else "-"
    nr = r["after_accept"].get("total_new_requests", 0) if r.get("status") == "analyzed" else "-"
    status = r.get("status", "?")[:10]
    nb_str = str(nb) if nb != "-" else "-"
    nr_str = str(nr) if nr != "-" else "-"
    print(f"{r['site']:<45} {bb:>7} {bt:>7} {pct:>4.0f}% {nb_str:>6} {nr_str:>6} {status:<10}")
