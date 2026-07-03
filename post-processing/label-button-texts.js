const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const ProgressBar = require('progress');
const asyncLib = require('async');
const { OpenAI } = require('openai');
const { classifyButtonTextLLM } = require('./generate-autoconsent-rules/detection');
const { readButtonTextCsv, buttonTextRowsToCsv } = require('./button-text-csv');

const DEFAULT_CSV_PATH = path.join(__dirname, 'generate-autoconsent-rules/labelled-button-texts.csv');

program
    .description('Label unlabelled button texts in labelled-button-texts.csv using LLM classification')
    .option('-i, --input <path>', 'path to button text CSV', DEFAULT_CSV_PATH)
    .option('--limit <n>', 'limit number of rows to process', parseInt)
    .option('--parallel <n>', 'parallel LLM requests', '10')
    .option('--force', 're-label all rows, including those that already have a label')
    .parse(process.argv);

const opts = program.opts();

/**
 * @param {import('./button-text-csv').ButtonTextRow[]} rows
 * @returns {Record<string, number>}
 */
function countLabels(rows) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const row of rows) {
        if (!row.label) {
            continue;
        }
        counts[row.label] = (counts[row.label] ?? 0) + 1;
    }
    return counts;
}

/**
 * @param {Record<string, number>} counts
 * @returns {string}
 */
function formatLabelCounts(counts) {
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => `${label}: ${count}`)
        .join(', ');
}

async function main() {
    const inputPath = path.resolve(opts.input);
    if (!fs.existsSync(inputPath)) {
        console.error('input file does not exist:', inputPath);
        process.exit(1);
    }

    if (!process.env.OPENAI_API_KEY) {
        console.error('env variable OPENAI_API_KEY is not set');
        process.exit(1);
    }

    const rows = readButtonTextCsv(inputPath);
    if (rows.length === 0) {
        console.error('no rows found in CSV');
        process.exit(1);
    }

    const previousLabels = rows.map((row) => row.label);
    const labelCountsBefore = countLabels(rows);

    /** @type {number[]} */
    let indicesToProcess = opts.force
        ? rows.map((_, index) => index)
        : rows.map((row, index) => (row.label ? null : index)).filter((index) => index !== null);

    if (indicesToProcess.length === 0) {
        console.error(opts.force ? 'no rows found in CSV' : 'no unlabelled rows found');
        return;
    }

    if (opts.limit && indicesToProcess.length > opts.limit) {
        indicesToProcess = indicesToProcess.slice(0, opts.limit);
        console.error(`Limited to ${indicesToProcess.length} rows`);
    }

    console.error(`${opts.force ? 'Re-labelling' : 'Labelling'} ${indicesToProcess.length} rows in ${inputPath}`);

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const parallel = Number.parseInt(opts.parallel, 10);

    const progress = new ProgressBar('[:bar] :current/:total :percent', {
        total: indicesToProcess.length,
        width: 40,
    });

    await asyncLib.eachOfLimit(indicesToProcess, parallel, async (rowIndex) => {
        const row = rows[rowIndex];
        row.label = await classifyButtonTextLLM(openai, row.buttonText);
        progress.tick();
    });

    const csv = buttonTextRowsToCsv(rows);
    fs.writeFileSync(inputPath, csv);

    const labelCountsAfter = countLabels(rows);

    /** @type {{ buttonText: string, oldLabel: string, newLabel: string, occurences: number }[]} */
    const changes = [];
    for (let i = 0; i < rows.length; i++) {
        const oldLabel = previousLabels[i] ?? '';
        const newLabel = rows[i].label ?? '';
        if (oldLabel !== newLabel) {
            changes.push({
                buttonText: rows[i].buttonText,
                oldLabel,
                newLabel,
                occurences: rows[i].occurences,
            });
        }
    }

    changes.sort((a, b) => b.occurences - a.occurences);

    console.error(`\nUpdated ${indicesToProcess.length} labels in ${inputPath}`);
    console.error(`Labels changed: ${changes.length}, unchanged: ${indicesToProcess.length - changes.length}`);
    console.error(`\nLabel distribution before: ${formatLabelCounts(labelCountsBefore)}`);
    console.error(`Label distribution after:  ${formatLabelCounts(labelCountsAfter)}`);

    if (changes.length > 0) {
        console.error('\nChanged labels (sorted by occurrences):');
        for (const change of changes) {
            console.error(`  [${change.occurences}] "${change.buttonText}": ${change.oldLabel || '(empty)'} → ${change.newLabel}`);
        }
    }

    const selectionConfirmPatterns = /wybór|wybrane|selección|selecció|selection|selected/i;
    const selectionChanges = changes.filter((c) => selectionConfirmPatterns.test(c.buttonText));
    if (selectionChanges.length > 0) {
        console.error('\nSelection-confirm related changes:');
        for (const change of selectionChanges) {
            console.error(`  [${change.occurences}] "${change.buttonText}": ${change.oldLabel || '(empty)'} → ${change.newLabel}`);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
