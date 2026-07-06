const assert = require('assert');
const path = require('path');
const { classifyButtonTextRegex } = require('../../post-processing/generate-autoconsent-rules/detection');
const { readButtonTextCsv } = require('../../post-processing/button-text-csv');

const CSV_PATH = path.join(__dirname, '../../post-processing/generate-autoconsent-rules/labelled-button-texts.csv');

/** @type {readonly string[]} */
const VALID_LABELS = ['settings', 'accept', 'reject', 'acknowledge', 'other'];

/** @type {readonly string[]} */
const BENCHMARK_LABELS = ['settings', 'accept', 'reject', 'acknowledge'];

// Minimum weighted accuracy required per label (occurrence-weighted correct predictions).
const MIN_WEIGHTED_ACCURACY = 0.9;

/**
 * Loads the labelled button texts and classifies each row, mirroring the methodology of
 * post-processing/benchmark-classify-button-text-regex.js: labels are normalised, rows with
 * unknown labels are dropped, and every row is scored against classifyButtonTextRegex.
 * @returns {Array<{ buttonText: string, occurences: number, label: string, predicted: string }>}
 */
function loadClassifiedRows() {
    const rows = readButtonTextCsv(CSV_PATH)
        .filter((row) => row.label && VALID_LABELS.includes(row.label.trim().toLowerCase()))
        .map((row) => ({ ...row, label: row.label.trim().toLowerCase() }));

    assert.ok(rows.length > 0, 'expected at least one labelled row in the CSV');

    return rows.map((row) => ({
        ...row,
        predicted: classifyButtonTextRegex(row.buttonText),
    }));
}

describe('classifyButtonTextRegex', () => {
    /** @type {Array<{ buttonText: string, occurences: number, label: string, predicted: string }>} */
    let allRows;

    // Rows whose ground-truth label is one of the benchmark labels (i.e. excluding 'other'),
    // matching the set the benchmark evaluates.
    /** @type {Array<{ buttonText: string, occurences: number, label: string, predicted: string }>} */
    let benchmarkRows;

    before(() => {
        allRows = loadClassifiedRows();
        benchmarkRows = allRows.filter((row) => row.label !== 'other');
        assert.ok(benchmarkRows.length > 0, 'expected labelled rows for the benchmark labels');
    });

    describe('no false positives', () => {
        for (const label of BENCHMARK_LABELS) {
            it(`never predicts "${label}" for a button that should be a different label`, () => {
                const falsePositives = benchmarkRows.filter((row) => row.predicted === label && row.label !== label);
                const weighted = falsePositives.reduce((sum, row) => sum + row.occurences, 0);

                const examples = falsePositives
                    .slice()
                    .sort((a, b) => b.occurences - a.occurences)
                    .slice(0, 10)
                    .map((row) => `[${row.label} -> ${row.predicted}] ${JSON.stringify(row.buttonText)} (x${row.occurences})`)
                    .join('\n      ');

                assert.strictEqual(
                    falsePositives.length,
                    0,
                    `expected 0 false positives for "${label}", found ${falsePositives.length} rows (${weighted} weighted):\n      ${examples}`,
                );
            });
        }
    });

    describe('weighted accuracy', () => {
        for (const label of BENCHMARK_LABELS) {
            it(`classifies >${MIN_WEIGHTED_ACCURACY * 100}% of weighted "${label}" buttons correctly`, () => {
                const support = benchmarkRows.filter((row) => row.label === label);
                const weightedSupport = support.reduce((sum, row) => sum + row.occurences, 0);
                assert.ok(weightedSupport > 0, `expected labelled rows for "${label}"`);

                const weightedCorrect = support.filter((row) => row.predicted === label).reduce((sum, row) => sum + row.occurences, 0);
                const accuracy = weightedCorrect / weightedSupport;

                assert.ok(
                    accuracy > MIN_WEIGHTED_ACCURACY,
                    `weighted accuracy for "${label}" was ${(accuracy * 100).toFixed(1)}% (${weightedCorrect}/${weightedSupport}), expected > ${(MIN_WEIGHTED_ACCURACY * 100).toFixed(0)}%`,
                );
            });
        }
    });
});
