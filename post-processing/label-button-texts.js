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
    .option('--limit <n>', 'limit number of unlabelled rows to process', parseInt)
    .option('--parallel <n>', 'parallel LLM requests', '10')
    .parse(process.argv);

const opts = program.opts();

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

    /** @type {number[]} */
    let unlabelledIndices = rows.map((row, index) => (row.label ? null : index)).filter((index) => index !== null);

    if (unlabelledIndices.length === 0) {
        console.error('no unlabelled rows found');
        return;
    }

    if (opts.limit && unlabelledIndices.length > opts.limit) {
        unlabelledIndices = unlabelledIndices.slice(0, opts.limit);
        console.error(`Limited to ${unlabelledIndices.length} unlabelled rows`);
    }

    console.error(`Labelling ${unlabelledIndices.length} unlabelled rows in ${inputPath}`);

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const parallel = Number.parseInt(opts.parallel, 10);

    const progress = new ProgressBar('[:bar] :current/:total :percent', {
        total: unlabelledIndices.length,
        width: 40,
    });

    await asyncLib.eachOfLimit(unlabelledIndices, parallel, async (rowIndex) => {
        const row = rows[rowIndex];
        row.label = await classifyButtonTextLLM(openai, row.buttonText);
        progress.tick();
    });

    const csv = buttonTextRowsToCsv(rows);
    fs.writeFileSync(inputPath, csv);

    console.error(`Updated ${unlabelledIndices.length} labels in ${inputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
