const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { isSettingsButton, isRejectButton, cleanButtonText } = require('../post-processing/generate-autoconsent-rules/detection');

const CRAWL_BASE = '/mnt/efs/shared/crawler-data/autoconsent-coverage-crawls/2026-03-04';
const REGION = process.argv[2] || 'US';
const INPUT_DIR = path.join(CRAWL_BASE, REGION, '3p-crawl');
const OUTPUT_FILE = path.join(__dirname, `report-${REGION}.txt`);
const CONCURRENCY = parseInt(process.argv[3], 10) || 100;

/**
 * @typedef {{text: string, selector: string}} ButtonData
 * @typedef {{text: string, selector: string, buttons: ButtonData[], llmMatch: boolean, regexMatch: boolean, rejectButtons: ButtonData[], otherButtons: ButtonData[]}} PopupData
 */

function hasSettingsButton(otherButtons) {
    return otherButtons.some(b => isSettingsButton(b.text));
}

function processFile(data, file, results) {
    const frames = data?.data?.cookiepopups?.scrapedFrames;
    if (!frames) return;

    for (const frame of frames) {
        const popups = frame.potentialPopups;
        if (!popups || popups.length === 0) continue;
        results.filesWithPopups++;

        for (const popup of popups) {
            results.totalPopups++;

            if (!popup.llmMatch) continue;
            results.llmMatchPopups++;

            if (popup.rejectButtons && popup.rejectButtons.length > 0) continue;
            const otherButtons = popup.otherButtons || [];
            if (otherButtons.some(b => isRejectButton(b.text))) continue;
            results.noRejectPopups++;

            if (hasSettingsButton(otherButtons)) continue;
            results.noSettingsPopups++;
            results.matchingPopups++;

            const buttonTexts = otherButtons.map(b => b.text ? cleanButtonText(b.text) : '').filter(Boolean);
            results.buttonCountDist.set(buttonTexts.length, (results.buttonCountDist.get(buttonTexts.length) || 0) + 1);
            for (const text of buttonTexts) {
                results.buttonTextCounts.set(text, (results.buttonTextCounts.get(text) || 0) + 1);
            }

            if (results.matchingExamples.length < 20) {
                results.matchingExamples.push({
                    file,
                    popupTextSnippet: (popup.text || '').slice(0, 120),
                    buttons: buttonTexts,
                });
            }
        }
    }
}

async function main() {
    const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${files.length} JSON files in ${INPUT_DIR} (concurrency: ${CONCURRENCY})`);

    const results = {
        buttonTextCounts: new Map(),
        filesWithPopups: 0,
        matchingPopups: 0,
        totalPopups: 0,
        llmMatchPopups: 0,
        noRejectPopups: 0,
        noSettingsPopups: 0,
        matchingExamples: [],
        buttonCountDist: new Map(),
    };

    let processed = 0;
    const startTime = Date.now();

    async function readAndProcess(file) {
        try {
            const raw = await fsp.readFile(path.join(INPUT_DIR, file), 'utf8');
            const data = JSON.parse(raw);
            processFile(data, file, results);
        } catch {
            // skip unreadable/unparseable files
        }
        processed++;
        if (processed % 5000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const rate = (processed / (Date.now() - startTime) * 1000).toFixed(0);
            console.log(`  processed ${processed}/${files.length} (${elapsed}s, ${rate} files/s)...`);
        }
    }

    // Process in batches with bounded concurrency
    for (let i = 0; i < files.length; i += CONCURRENCY) {
        const batch = files.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(f => readAndProcess(f)));
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  done in ${totalElapsed}s (${(files.length / (Date.now() - startTime) * 1000).toFixed(0)} files/s)`);

    const { buttonTextCounts, filesWithPopups, matchingPopups, totalPopups, llmMatchPopups, noRejectPopups, noSettingsPopups, matchingExamples, buttonCountDist } = results;

    const sorted = [...buttonTextCounts.entries()].sort((a, b) => b[1] - a[1]);

    // Build report
    const lines = [];
    lines.push('=== Non-Rejectable Cookie Popup Button Analysis ===');
    lines.push(`Input directory: ${INPUT_DIR}`);
    lines.push(`Date: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('--- Summary ---');
    lines.push(`Total JSON files: ${files.length}`);
    lines.push(`Files with potential popups: ${filesWithPopups}`);
    lines.push(`Total potential popups: ${totalPopups}`);
    lines.push(`  └─ AI-confirmed cookie popups: ${llmMatchPopups}`);
    lines.push(`      └─ No reject buttons: ${noRejectPopups}`);
    lines.push(`          └─ No settings buttons: ${noSettingsPopups} (aka non-rejectable cookie notices)`);
    lines.push('');

    lines.push(`--- Button Text Distribution (cleaned, all ${sorted.length} entries) ---`);
    lines.push('Count | Button Text');
    lines.push('------+------------');
    for (const [text, count] of sorted) {
        lines.push(`${String(count).padStart(5)} | ${text}`);
    }
    lines.push('');

    lines.push('--- Buttons Per Popup Distribution ---');
    lines.push('Button Count | Popups');
    lines.push('-------------+-------');
    const sortedBCD = [...buttonCountDist.entries()].sort((a, b) => a[0] - b[0]);
    for (const [btnCount, popupCount] of sortedBCD) {
        lines.push(`${String(btnCount).padStart(12)} | ${popupCount}`);
    }
    lines.push('');

    lines.push('--- Sample Matching Popups (first 20) ---');
    for (const ex of matchingExamples) {
        lines.push(`File: ${ex.file}`);
        lines.push(`  Popup: ${ex.popupTextSnippet}...`);
        lines.push(`  Buttons: ${JSON.stringify(ex.buttons)}`);
        lines.push('');
    }

    const report = lines.join('\n');
    fs.writeFileSync(OUTPUT_FILE, report, 'utf8');
    console.log(`\nReport written to ${OUTPUT_FILE}`);
    console.log(`\nQuick summary:`);
    console.log(`  Matching popups: ${matchingPopups}`);
    console.log(`  Unique button texts: ${sorted.length}`);
    if (sorted.length > 0) {
        console.log(`  Top 10 button texts:`);
        for (const [text, count] of sorted.slice(0, 10)) {
            console.log(`    ${count}x "${text}"`);
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
