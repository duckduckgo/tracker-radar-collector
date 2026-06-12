const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const chalk = require('chalk');
const { classifyButtonTextRegex } = require('./generate-autoconsent-rules/detection');
const { readButtonTextCsv } = require('./button-text-csv');

const DEFAULT_CSV_PATH = path.join(__dirname, 'generate-autoconsent-rules/labelled-button-texts.csv');
const TOP_FAILURES = 25;

/** @type {readonly string[]} */
const VALID_LABELS = ['settings', 'accept', 'reject', 'acknowledge', 'other'];

/** @type {readonly string[]} */
const BENCHMARK_LABELS = ['settings', 'accept', 'reject', 'acknowledge'];

program
    .description(
        'Benchmark classifyButtonTextRegex against labelled button texts (exact label match, occurrence-weighted)',
    )
    .option('-i, --input <path>', 'path to labelled button text CSV', DEFAULT_CSV_PATH)
    .option('-o, --output <path>', 'path to write benchmark results JSON')
    .option('--limit <n>', 'limit number of labelled rows to evaluate', parseInt)
    .parse(process.argv);

const opts = program.opts();

/**
 * @param {Array<{ buttonText: string, occurances: number, label: string }>} rows
 * @returns {Array<{ buttonText: string, occurances: number, label: string, predicted: string }>}
 */
function classifyRows(rows) {
    return rows.map((row) => ({
        ...row,
        predicted: classifyButtonTextRegex(row.buttonText),
    }));
}

/**
 * @typedef {Object} LabelBenchmark
 * @property {string} label
 * @property {number} rowSupport
 * @property {number} weightedSupport
 * @property {number} rowCorrect
 * @property {number} weightedCorrect
 * @property {number|null} rowCorrectRate
 * @property {number|null} weightedCorrectRate
 * @property {number} rowFalsePositives
 * @property {number} weightedFalsePositives
 * @property {number|null} rowFalsePositiveRate
 * @property {number|null} weightedFalsePositiveRate
 * @property {number} rowMissed
 * @property {number} weightedMissed
 * @property {Array<{ buttonText: string, label: string, predicted: string, occurances: number }>} falsePositiveExamples
 * @property {Array<{ buttonText: string, label: string, predicted: string, occurances: number }>} missedExamples
 */

/**
 * @param {Array<{ buttonText: string, occurances: number, label: string, predicted: string }>} allResults
 * @param {string} targetLabel
 * @param {number} rowTotal
 * @param {number} weightedTotal
 * @returns {LabelBenchmark}
 */
function buildLabelBenchmark(allResults, targetLabel, rowTotal, weightedTotal) {
    const support = allResults.filter((result) => result.label === targetLabel);
    const rowSupport = support.length;
    const weightedSupport = support.reduce((sum, result) => sum + result.occurances, 0);

    const correct = support.filter((result) => result.predicted === targetLabel);
    const rowCorrect = correct.length;
    const weightedCorrect = correct.reduce((sum, result) => sum + result.occurances, 0);

    const missed = support.filter((result) => result.predicted !== targetLabel);
    const rowMissed = missed.length;
    const weightedMissed = missed.reduce((sum, result) => sum + result.occurances, 0);

    const falsePositives = allResults.filter(
        (result) => result.predicted === targetLabel && result.label !== targetLabel,
    );
    const rowFalsePositives = falsePositives.length;
    const weightedFalsePositives = falsePositives.reduce((sum, result) => sum + result.occurances, 0);

    const sortByOccurrence = (a, b) =>
        b.occurances - a.occurances || a.buttonText.localeCompare(b.buttonText);

    /** @type {Array<{ buttonText: string, label: string, predicted: string, occurances: number }>} */
    const falsePositiveExamples = falsePositives
        .map((result) => ({
            buttonText: result.buttonText,
            label: result.label,
            predicted: result.predicted,
            occurances: result.occurances,
        }))
        .sort(sortByOccurrence);

    /** @type {Array<{ buttonText: string, label: string, predicted: string, occurances: number }>} */
    const missedExamples = missed
        .map((result) => ({
            buttonText: result.buttonText,
            label: result.label,
            predicted: result.predicted,
            occurances: result.occurances,
        }))
        .sort(sortByOccurrence);

    return {
        label: targetLabel,
        rowSupport,
        weightedSupport,
        rowCorrect,
        weightedCorrect,
        rowCorrectRate: rowSupport === 0 ? null : rowCorrect / rowSupport,
        weightedCorrectRate: weightedSupport === 0 ? null : weightedCorrect / weightedSupport,
        rowFalsePositives,
        weightedFalsePositives,
        rowFalsePositiveRate: rowTotal === 0 ? null : rowFalsePositives / rowTotal,
        weightedFalsePositiveRate: weightedTotal === 0 ? null : weightedFalsePositives / weightedTotal,
        rowMissed,
        weightedMissed,
        falsePositiveExamples,
        missedExamples,
    };
}

/**
 * @param {Array<{ buttonText: string, occurances: number, label: string, predicted: string }>} results
 * @param {number} rowTotal
 * @param {number} weightedTotal
 * @returns {Record<string, LabelBenchmark>}
 */
function buildBenchmarkByLabel(results, rowTotal, weightedTotal) {
    /** @type {Record<string, LabelBenchmark>} */
    const byLabel = {};
    for (const label of BENCHMARK_LABELS) {
        byLabel[label] = buildLabelBenchmark(results, label, rowTotal, weightedTotal);
    }
    return byLabel;
}

/**
 * @param {number|null} rate
 * @returns {string}
 */
function pct(rate) {
    return rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
}

/**
 * @param {LabelBenchmark} benchmark
 */
function printLabelBenchmark(benchmark) {
    console.log(chalk.bold(`\n  ${benchmark.label}`));
    console.log(
        `    correctly labelled: ${benchmark.rowCorrect}/${benchmark.rowSupport} rows (${pct(benchmark.rowCorrectRate)}), ${benchmark.weightedCorrect}/${benchmark.weightedSupport} weighted (${pct(benchmark.weightedCorrectRate)})`,
    );
    console.log(
        chalk.red(
            `    false positives (labelled as ${benchmark.label}, should be another label): ${benchmark.rowFalsePositives} rows (${pct(benchmark.rowFalsePositiveRate)} of all rows), ${benchmark.weightedFalsePositives} weighted (${pct(benchmark.weightedFalsePositiveRate)} of all weighted)`,
        ),
    );

    const topFalsePositives = benchmark.falsePositiveExamples.slice(0, TOP_FAILURES);
    if (topFalsePositives.length === 0) {
        console.log('    top false positives: (none)');
    } else {
        console.log(`    top false positives (up to ${TOP_FAILURES}, by occurrence):`);
        for (const example of topFalsePositives) {
            console.log(
                `      [${example.label} -> ${example.predicted}] ${JSON.stringify(example.buttonText)} (x${example.occurances})`,
            );
        }
    }

    const topMissed = benchmark.missedExamples.slice(0, TOP_FAILURES);
    if (topMissed.length === 0) {
        console.log(`    missed (should be ${benchmark.label}, not labelled as ${benchmark.label}): (none)`);
    } else {
        console.log(
            `    missed (should be ${benchmark.label}, not labelled as ${benchmark.label}) (up to ${TOP_FAILURES}, by occurrence):`,
        );
        for (const example of topMissed) {
            console.log(
                `      [${example.label} -> ${example.predicted}] ${JSON.stringify(example.buttonText)} (x${example.occurances})`,
            );
        }
    }
}

/**
 * @param {Record<string, LabelBenchmark>} byLabel
 */
function printBenchmark(byLabel) {
    const benchmarks = BENCHMARK_LABELS.map((label) => byLabel[label]).filter(
        (benchmark) => benchmark.rowSupport > 0,
    );

    const rowTotal = benchmarks.reduce((sum, benchmark) => sum + benchmark.rowSupport, 0);
    const weightedTotal = benchmarks.reduce((sum, benchmark) => sum + benchmark.weightedSupport, 0);
    const rowCorrect = benchmarks.reduce((sum, benchmark) => sum + benchmark.rowCorrect, 0);
    const weightedCorrect = benchmarks.reduce((sum, benchmark) => sum + benchmark.weightedCorrect, 0);
    const weightedFalsePositives = benchmarks.reduce(
        (sum, benchmark) => sum + benchmark.weightedFalsePositives,
        0,
    );
    const weightedMissed = benchmarks.reduce((sum, benchmark) => sum + benchmark.weightedMissed, 0);

    console.log(chalk.bold('\nclassifyButtonTextRegex benchmark (excluding other)\n'));
    console.log(`  labelled rows: ${rowTotal}`);
    console.log(`  occurrence weight total: ${weightedTotal}`);
    console.log(
        `  correctly labelled: ${rowCorrect}/${rowTotal} rows (${pct(rowTotal === 0 ? null : rowCorrect / rowTotal)}), ${weightedCorrect}/${weightedTotal} weighted (${pct(weightedTotal === 0 ? null : weightedCorrect / weightedTotal)})`,
    );
    console.log(
        chalk.red(
            `  false positives (weighted total across labels): ${weightedFalsePositives}`,
        ),
    );
    console.log(`  missed (weighted total across labels): ${weightedMissed}`);

    console.log(chalk.bold('\n  by label:'));
    for (const label of BENCHMARK_LABELS) {
        if (byLabel[label].rowSupport === 0) {
            continue;
        }
        printLabelBenchmark(byLabel[label]);
    }
}

function main() {
    const inputPath = path.resolve(opts.input);
    if (!fs.existsSync(inputPath)) {
        console.error('input file does not exist:', inputPath);
        process.exit(1);
    }

    let rows = readButtonTextCsv(inputPath).filter(
        (row) => row.label && VALID_LABELS.includes(row.label.trim().toLowerCase()),
    );
    rows = rows.map((row) => ({ ...row, label: row.label.trim().toLowerCase() }));

    if (opts.limit && rows.length > opts.limit) {
        rows = rows.slice(0, opts.limit);
        console.error(`Limited to ${rows.length} labelled rows`);
    }

    if (rows.length === 0) {
        console.error('no labelled rows found in CSV');
        process.exit(1);
    }

    rows.sort((a, b) => b.occurances - a.occurances || a.buttonText.localeCompare(b.buttonText));

    console.error(`Loaded ${rows.length} labelled rows from ${inputPath}`);

    const results = classifyRows(rows);
    const benchmarkResults = results.filter((result) => result.label !== 'other');
    const rowTotal = benchmarkResults.length;
    const weightedTotal = benchmarkResults.reduce((sum, result) => sum + result.occurances, 0);
    const byLabel = buildBenchmarkByLabel(benchmarkResults, rowTotal, weightedTotal);

    console.log(`Input: ${inputPath}`);
    printBenchmark(byLabel);

    if (opts.output) {
        const output = {
            input: inputPath,
            classifier: 'classifyButtonTextRegex',
            byLabel,
        };
        fs.writeFileSync(opts.output, `${JSON.stringify(output, null, 2)}\n`);
        console.log(chalk.green(`\nWrote benchmark results to ${opts.output}`));
    }
}

main();
