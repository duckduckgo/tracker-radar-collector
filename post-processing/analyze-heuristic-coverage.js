const fs = require('fs');
const path = require('path');
const { Command } = require('commander');

const GENERATED_RULES_DIR = path.join(__dirname, '../../autoconsent/rules/generated');
const GENERATED_TESTS_DIR = path.join(__dirname, '../../autoconsent/tests/generated');
const FILENAME_REGEX = /^auto_([A-Z]{2})_(.+?)_[^_]+$/;

/**
 * @typedef {'redundant-heuristic' | 'redundant-other-cmp' | 'needs-review'} Classification
 */

/**
 * @typedef {{
 *  ruleFile: string,
 *  ruleName: string,
 *  region: string,
 *  domain: string,
 *  vendorUrl: string,
 *  cosmetic: boolean,
 *  classification: Classification,
 *  reason: string,
 *  matchedCmp: string | null,
 *  screenshotPath: string | null,
 * }} RuleAnalysisResult
 */

/**
 * Parse a generated rule filename into its components.
 * @param {string} filename - e.g. "auto_DE_example.com_xxx.json"
 * @returns {{ region: string, domain: string, ruleName: string } | null}
 */
function parseRuleFilename(filename) {
    const name = filename.replace('.json', '');
    const match = name.match(FILENAME_REGEX);
    if (!match) return null;
    return { region: match[1], domain: match[2], ruleName: name };
}

/**
 * Load all generated rules and index them by vendorUrl and urlPattern.
 * @param {string} rulesDir
 * @returns {Map<string, { ruleFile: string, ruleName: string, region: string, domain: string, vendorUrl: string, cosmetic: boolean, urlPattern: string | null }>}
 */
function loadGeneratedRules(rulesDir) {
    /** @type {Map<string, { ruleFile: string, ruleName: string, region: string, domain: string, vendorUrl: string, cosmetic: boolean, urlPattern: string | null }>} */
    const rules = new Map();
    const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
        const parsed = parseRuleFilename(file);
        if (!parsed) continue;

        let rule;
        try {
            rule = JSON.parse(fs.readFileSync(path.join(rulesDir, file), 'utf8'));
        } catch {
            continue;
        }

        const vendorUrl = rule.vendorUrl || rule._metadata?.vendorUrl || '';
        const urlPattern = rule.runContext?.urlPattern || null;
        const cosmetic = Boolean(rule.cosmetic);

        rules.set(parsed.ruleName, {
            ruleFile: file,
            ruleName: parsed.ruleName,
            region: parsed.region,
            domain: parsed.domain,
            vendorUrl,
            cosmetic,
            urlPattern,
        });
    }

    return rules;
}

/**
 * Normalize a URL for comparison: strip trailing slash and protocol prefix.
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
    try {
        const u = new URL(url);
        return u.host.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
    } catch {
        return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    }
}

/**
 * Check if a CMP name refers to a generated rule.
 * @param {string} cmpName
 * @returns {boolean}
 */
function isGeneratedCmpName(cmpName) {
    return cmpName.startsWith('auto_');
}

/**
 * @param {import('./generate-autoconsent-rules/types').AutoconsentResult} cmp
 * @returns {boolean}
 */
function cmpSucceeded(cmp) {
    return cmp.final && cmp.succeeded;
}

/**
 * Classify a generated rule based on crawl results for a specific site.
 * @param {{ cosmetic: boolean }} ruleInfo
 * @param {import('./generate-autoconsent-rules/types').AutoconsentResult[]} cmps
 * @param {string | null} screenshotPath
 * @returns {{ classification: Classification, reason: string, matchedCmp: string | null }}
 */
function classifyRule(ruleInfo, cmps, screenshotPath) {
    if (!cmps || cmps.length === 0) {
        return {
            classification: 'needs-review',
            reason: 'no CMP detected on the page',
            matchedCmp: null,
        };
    }

    // Check if a non-generated CMP successfully handled this page
    for (const cmp of cmps) {
        if (!cmp.name || cmp.name.trim() === '') continue;

        if (cmp.name === 'HEURISTIC' && cmpSucceeded(cmp)) {
            if (ruleInfo.cosmetic) {
                return {
                    classification: 'needs-review',
                    reason: 'heuristic succeeded but generated rule is cosmetic (heuristic is non-cosmetic)',
                    matchedCmp: 'HEURISTIC',
                };
            }
            return {
                classification: 'redundant-heuristic',
                reason: 'heuristic CMP succeeded',
                matchedCmp: 'HEURISTIC',
            };
        }

        if (!isGeneratedCmpName(cmp.name) && cmpSucceeded(cmp)) {
            return {
                classification: 'redundant-other-cmp',
                reason: `non-generated CMP '${cmp.name}' succeeded`,
                matchedCmp: cmp.name,
            };
        }
    }

    // Check for partial matches that need review
    const heuristicCmp = cmps.find(c => c.name === 'HEURISTIC');
    if (heuristicCmp) {
        if (heuristicCmp.open && !heuristicCmp.succeeded) {
            return {
                classification: 'needs-review',
                reason: 'heuristic detected popup but opt-out failed',
                matchedCmp: 'HEURISTIC',
            };
        }
        if (!heuristicCmp.open) {
            return {
                classification: 'needs-review',
                reason: 'heuristic detected CMP but popup was not visible',
                matchedCmp: 'HEURISTIC',
            };
        }
    }

    const nonGenCmp = cmps.find(c => c.name && !isGeneratedCmpName(c.name) && c.name !== 'HEURISTIC');
    if (nonGenCmp) {
        return {
            classification: 'needs-review',
            reason: `non-generated CMP '${nonGenCmp.name}' detected but did not succeed (open=${nonGenCmp.open}, succeeded=${nonGenCmp.succeeded})`,
            matchedCmp: nonGenCmp.name,
        };
    }

    return {
        classification: 'needs-review',
        reason: 'no applicable CMP succeeded',
        matchedCmp: null,
    };
}

/**
 * Match a crawl result to generated rule(s) using URL matching.
 * @param {string} initialUrl
 * @param {string} finalUrl
 * @param {Map<string, { ruleFile: string, ruleName: string, region: string, domain: string, vendorUrl: string, cosmetic: boolean, urlPattern: string | null }>} rules
 * @param {string} region
 * @returns {string[]} matching rule names
 */
function matchCrawlToRules(initialUrl, finalUrl, rules, region) {
    const matched = [];
    const normInitial = normalizeUrl(initialUrl);
    const normFinal = normalizeUrl(finalUrl);

    for (const [ruleName, rule] of rules) {
        if (rule.region !== region) continue;

        // Match by vendorUrl
        if (rule.vendorUrl) {
            const normVendor = normalizeUrl(rule.vendorUrl);
            if (normVendor === normInitial || normVendor === normFinal) {
                matched.push(ruleName);
                continue;
            }
        }

        // Match by urlPattern
        if (rule.urlPattern) {
            try {
                const pattern = new RegExp(rule.urlPattern);
                if (pattern.test(initialUrl) || pattern.test(finalUrl)) {
                    matched.push(ruleName);
                    continue;
                }
            } catch {
                // invalid regex
            }
        }
    }

    return matched;
}

/**
 * Process a single region's crawl data.
 * @param {string} crawlDir - Path to the region's crawl directory (e.g. data-heuristic-test/DE/3p-crawl)
 * @param {string} region
 * @param {Map<string, { ruleFile: string, ruleName: string, region: string, domain: string, vendorUrl: string, cosmetic: boolean, urlPattern: string | null }>} rules
 * @returns {RuleAnalysisResult[]}
 */
function processRegion(crawlDir, region, rules) {
    /** @type {RuleAnalysisResult[]} */
    const results = [];
    /** @type {Set<string>} */
    const matchedRuleNames = new Set();

    if (!fs.existsSync(crawlDir)) {
        console.warn(`Crawl directory not found for ${region}: ${crawlDir}`);
        return results;
    }

    const files = fs.readdirSync(crawlDir).filter(f => f.endsWith('.json') && f !== 'metadata.json');
    console.log(`Processing ${files.length} crawl files for region ${region}...`);

    for (const file of files) {
        /** @type {import('./generate-autoconsent-rules/types').CrawlData} */
        let data;
        try {
            data = JSON.parse(fs.readFileSync(path.join(crawlDir, file), 'utf8'));
        } catch {
            console.warn(`Failed to parse ${file}`);
            continue;
        }

        if (!data || !data.data) continue;

        const initialUrl = data.initialUrl;
        const finalUrl = data.finalUrl;
        const cookiepopups = data.data.cookiepopups;
        const screenshotPath = data.data.screenshots || null;

        const matchingRuleNames = matchCrawlToRules(initialUrl, finalUrl, rules, region);
        if (matchingRuleNames.length === 0) continue;

        for (const ruleName of matchingRuleNames) {
            matchedRuleNames.add(ruleName);
            const ruleInfo = rules.get(ruleName);

            if (!cookiepopups || !cookiepopups.cmps) {
                results.push({
                    ruleFile: ruleInfo.ruleFile,
                    ruleName,
                    region,
                    domain: ruleInfo.domain,
                    vendorUrl: ruleInfo.vendorUrl,
                    cosmetic: ruleInfo.cosmetic,
                    classification: 'needs-review',
                    reason: 'no cookiepopups data in crawl result (site may have failed to load)',
                    matchedCmp: null,
                    screenshotPath,
                });
                continue;
            }

            const { classification, reason, matchedCmp } = classifyRule(ruleInfo, cookiepopups.cmps, screenshotPath);
            results.push({
                ruleFile: ruleInfo.ruleFile,
                ruleName,
                region,
                domain: ruleInfo.domain,
                vendorUrl: ruleInfo.vendorUrl,
                cosmetic: ruleInfo.cosmetic,
                classification,
                reason,
                matchedCmp,
                screenshotPath,
            });
        }
    }

    // Rules that had no matching crawl result
    for (const [ruleName, ruleInfo] of rules) {
        if (ruleInfo.region !== region) continue;
        if (matchedRuleNames.has(ruleName)) continue;

        results.push({
            ruleFile: ruleInfo.ruleFile,
            ruleName,
            region,
            domain: ruleInfo.domain,
            vendorUrl: ruleInfo.vendorUrl,
            cosmetic: ruleInfo.cosmetic,
            classification: 'needs-review',
            reason: 'no matching crawl result found',
            matchedCmp: null,
            screenshotPath: null,
        });
    }

    return results;
}

function main() {
    const program = new Command();
    program
        .description(
            `Analyze heuristic coverage of generated autoconsent rules.

Processes crawl results (produced with enableGeneratedRules=false) and classifies
each generated rule as redundant (heuristic or other CMP can handle it) or needing review.

Example:
    node post-processing/analyze-heuristic-coverage.js \\
        --crawl-base ./data-heuristic-test \\
        --rules-dir ../autoconsent/rules/generated \\
        --tests-dir ../autoconsent/tests/generated \\
        -o ./heuristic-analysis-report`
        )
        .option('--crawl-base <path>', 'Base directory containing per-region crawl dirs (e.g. <base>/<REGION>/3p-crawl)', '.')
        .option('--crawl-subdir <subdir>', 'Subdirectory within each region dir containing crawl JSON files', '3p-crawl')
        .option('--rules-dir <path>', 'Path to generated rules directory', GENERATED_RULES_DIR)
        .option('--tests-dir <path>', 'Path to generated tests directory', GENERATED_TESTS_DIR)
        .option('-o, --output-dir <path>', 'Output directory for report files', '.')
        .option('--regions <regions>', 'Comma-separated list of regions to process (default: auto-detect from rules)', '')
        .parse(process.argv);

    const opts = program.opts();
    const crawlBase = path.resolve(opts.crawlBase);
    const crawlSubdir = opts.crawlSubdir;
    const rulesDir = path.resolve(opts.rulesDir);
    const testsDir = path.resolve(opts.testsDir);
    const outputDir = path.resolve(opts.outputDir);

    console.log('Loading generated rules...');
    const rules = loadGeneratedRules(rulesDir);
    console.log(`Loaded ${rules.size} generated rules`);

    // Determine regions
    let regions;
    if (opts.regions) {
        regions = opts.regions.split(',').map(r => r.trim());
    } else {
        const regionSet = new Set();
        for (const rule of rules.values()) {
            regionSet.add(rule.region);
        }
        regions = [...regionSet].sort();
    }
    console.log(`Regions to process: ${regions.join(', ')}`);

    /** @type {RuleAnalysisResult[]} */
    const allResults = [];

    for (const region of regions) {
        const crawlDir = path.join(crawlBase, region, crawlSubdir);
        const regionResults = processRegion(crawlDir, region, rules);
        allResults.push(...regionResults);
    }

    // Aggregate statistics
    const stats = {
        total: allResults.length,
        redundantHeuristic: 0,
        redundantOtherCmp: 0,
        needsReview: 0,
        byRegion: /** @type {Record<string, { total: number, redundantHeuristic: number, redundantOtherCmp: number, needsReview: number }>} */ ({}),
        otherCmpBreakdown: /** @type {Record<string, number>} */ ({}),
        reviewReasonBreakdown: /** @type {Record<string, number>} */ ({}),
    };

    for (const result of allResults) {
        if (!stats.byRegion[result.region]) {
            stats.byRegion[result.region] = { total: 0, redundantHeuristic: 0, redundantOtherCmp: 0, needsReview: 0 };
        }
        const regionStats = stats.byRegion[result.region];
        regionStats.total++;

        switch (result.classification) {
            case 'redundant-heuristic':
                stats.redundantHeuristic++;
                regionStats.redundantHeuristic++;
                break;
            case 'redundant-other-cmp':
                stats.redundantOtherCmp++;
                regionStats.redundantOtherCmp++;
                if (result.matchedCmp) {
                    stats.otherCmpBreakdown[result.matchedCmp] = (stats.otherCmpBreakdown[result.matchedCmp] || 0) + 1;
                }
                break;
            case 'needs-review':
                stats.needsReview++;
                regionStats.needsReview++;
                stats.reviewReasonBreakdown[result.reason] = (stats.reviewReasonBreakdown[result.reason] || 0) + 1;
                break;
        }
    }

    // Build deletion list: files safe to delete
    const redundantResults = allResults.filter(r => r.classification === 'redundant-heuristic' || r.classification === 'redundant-other-cmp');
    const filesToDelete = [];
    for (const result of redundantResults) {
        const ruleFilePath = path.join(rulesDir, result.ruleFile);
        const testFile = result.ruleName + '.spec.ts';
        const testFilePath = path.join(testsDir, testFile);
        filesToDelete.push({
            ruleFile: ruleFilePath,
            testFile: fs.existsSync(testFilePath) ? testFilePath : null,
            ruleName: result.ruleName,
            classification: result.classification,
            matchedCmp: result.matchedCmp,
        });
    }

    // Write outputs
    fs.mkdirSync(outputDir, { recursive: true });

    const reportPath = path.join(outputDir, 'analysis-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
        stats,
        results: allResults,
    }, null, 2));

    const deletionListPath = path.join(outputDir, 'files-to-delete.json');
    fs.writeFileSync(deletionListPath, JSON.stringify(filesToDelete, null, 2));

    const needsReviewPath = path.join(outputDir, 'needs-review.json');
    const reviewResults = allResults.filter(r => r.classification === 'needs-review');
    fs.writeFileSync(needsReviewPath, JSON.stringify(reviewResults, null, 2));

    // Print summary
    console.log('\n=== Analysis Summary ===');
    console.log(`Total generated rules analyzed: ${stats.total}`);
    console.log(`  Redundant (heuristic): ${stats.redundantHeuristic}`);
    console.log(`  Redundant (other CMP): ${stats.redundantOtherCmp}`);
    console.log(`  Needs review: ${stats.needsReview}`);
    console.log(`  Total safe to delete: ${filesToDelete.length}`);

    console.log('\n--- Per-region breakdown ---');
    for (const [region, regionStats] of Object.entries(stats.byRegion).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`  ${region}: ${regionStats.total} rules (heuristic: ${regionStats.redundantHeuristic}, other CMP: ${regionStats.redundantOtherCmp}, review: ${regionStats.needsReview})`);
    }

    if (Object.keys(stats.otherCmpBreakdown).length > 0) {
        console.log('\n--- Other CMP coverage ---');
        const sorted = Object.entries(stats.otherCmpBreakdown).sort(([, a], [, b]) => b - a);
        for (const [cmp, count] of sorted) {
            console.log(`  ${cmp}: ${count}`);
        }
    }

    if (Object.keys(stats.reviewReasonBreakdown).length > 0) {
        console.log('\n--- Review reason breakdown ---');
        const sorted = Object.entries(stats.reviewReasonBreakdown).sort(([, a], [, b]) => b - a);
        for (const [reason, count] of sorted) {
            console.log(`  ${reason}: ${count}`);
        }
    }

    console.log(`\nFull report: ${reportPath}`);
    console.log(`Deletion list: ${deletionListPath}`);
    console.log(`Needs review: ${needsReviewPath}`);
}

main();
