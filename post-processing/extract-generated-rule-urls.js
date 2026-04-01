const fs = require('fs');
const path = require('path');
const { Command } = require('commander');

const GENERATED_TESTS_DIR = path.join(__dirname, '../../autoconsent/tests/generated');
const GENERATED_RULES_DIR = path.join(__dirname, '../../autoconsent/rules/generated');
const FILENAME_REGEX = /^auto_([A-Z]{2})_(.+?)_[^_]+$/;
const SPEC_CONTENT_REGEX = /generateCMPTests\(\s*'[^']+'\s*,\s*\[([^\]]+)\]/;

/**
 * Extract URLs and region from a generated test spec file.
 * @param {string} content - File content
 * @returns {{urls: string[], region: string|null}}
 */
function parseSpec(content) {
    const urlMatch = content.match(SPEC_CONTENT_REGEX);
    const regionMatch = content.match(/onlyRegions:\s*\[([^\]]+)\]/);

    const urls = urlMatch
        ? urlMatch[1].match(/'([^']+)'/g)?.map(s => s.slice(1, -1)) || []
        : [];
    const region = regionMatch
        ? regionMatch[1].match(/'([^']+)'/)?.[1] || null
        : null;

    return { urls, region };
}

/**
 * Add a URL entry to the region/domain maps.
 * @param {Map<string, string[]>} byRegion
 * @param {Map<string, Set<string>>} domainRegions
 * @param {string} region
 * @param {string} domain
 * @param {string[]} urls
 */
function addEntry(byRegion, domainRegions, region, domain, urls) {
    if (!byRegion.has(region)) {
        byRegion.set(region, []);
    }
    byRegion.get(region).push(...urls);

    if (!domainRegions.has(domain)) {
        domainRegions.set(domain, new Set());
    }
    domainRegions.get(domain).add(region);
}

function main() {
    const program = new Command();
    program
        .option('--tests-dir <path>', 'Path to generated tests directory', GENERATED_TESTS_DIR)
        .option('--rules-dir <path>', 'Path to generated rules directory', GENERATED_RULES_DIR)
        .option('-o, --output-dir <path>', 'Output directory for URL list files', '.')
        .parse(process.argv);

    const opts = program.opts();
    const testsDir = path.resolve(opts.testsDir);
    const rulesDir = path.resolve(opts.rulesDir);
    const outputDir = path.resolve(opts.outputDir);

    /** @type {Map<string, string[]>} region -> urls */
    const byRegion = new Map();
    /** @type {Map<string, Set<string>>} domain -> regions */
    const domainRegions = new Map();
    const coveredRuleNames = new Set();

    let skipped = 0;
    let fromSpecs = 0;
    let fromRules = 0;

    // Phase 1: read spec files (preferred source of URLs)
    if (fs.existsSync(testsDir)) {
        const specFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.spec.ts'));
        for (const file of specFiles) {
            const ruleName = file.replace('.spec.ts', '');
            const filenameMatch = ruleName.match(FILENAME_REGEX);
            if (!filenameMatch) {
                console.warn(`Skipping spec with unexpected name format: ${file}`);
                skipped++;
                continue;
            }

            const filenameRegion = filenameMatch[1];
            const domain = filenameMatch[2];
            const content = fs.readFileSync(path.join(testsDir, file), 'utf8');
            const { urls, region } = parseSpec(content);

            if (urls.length === 0) {
                console.warn(`No URLs found in ${file}`);
                skipped++;
                continue;
            }

            addEntry(byRegion, domainRegions, region || filenameRegion, domain, urls);
            coveredRuleNames.add(ruleName);
            fromSpecs++;
        }
    }

    // Phase 2: fill in rules that have no spec, using vendorUrl from the rule JSON
    if (fs.existsSync(rulesDir)) {
        const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.json'));
        for (const file of ruleFiles) {
            const ruleName = file.replace('.json', '');
            if (coveredRuleNames.has(ruleName)) {
                continue;
            }

            const filenameMatch = ruleName.match(FILENAME_REGEX);
            if (!filenameMatch) {
                console.warn(`Skipping rule with unexpected name format: ${file}`);
                skipped++;
                continue;
            }

            const region = filenameMatch[1];
            const domain = filenameMatch[2];

            let rule;
            try {
                rule = JSON.parse(fs.readFileSync(path.join(rulesDir, file), 'utf8'));
            } catch (e) {
                console.warn(`Failed to parse ${file}: ${e.message}`);
                skipped++;
                continue;
            }

            const url = rule.vendorUrl || rule._metadata?.vendorUrl;
            if (!url) {
                console.warn(`No vendorUrl in ${file}, skipping`);
                skipped++;
                continue;
            }

            addEntry(byRegion, domainRegions, region, domain, [url]);
            fromRules++;
        }
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const regionSummary = [];
    for (const [region, urls] of [...byRegion.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const unique = [...new Set(urls)];
        const outFile = path.join(outputDir, `urls-${region}.txt`);
        fs.writeFileSync(outFile, unique.join('\n') + '\n');
        regionSummary.push({ region, urls: unique.length });
        console.log(`Wrote ${outFile} (${unique.length} URLs)`);
    }

    const multiRegionDomains = [...domainRegions.entries()].filter(([, regions]) => regions.size > 1);
    console.log('\n--- Summary ---');
    console.log(`From spec files: ${fromSpecs}`);
    console.log(`From rule files (no spec): ${fromRules}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Unique domains: ${domainRegions.size}`);
    console.log(`Multi-region domains: ${multiRegionDomains.length}`);
    console.log('\nPer-region breakdown:');
    for (const { region, urls } of regionSummary) {
        console.log(`  ${region}: ${urls} URLs`);
    }
}

main();
