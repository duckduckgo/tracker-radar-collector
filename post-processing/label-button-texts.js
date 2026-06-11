const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const ProgressBar = require('progress');
const asyncLib = require('async');
const { OpenAI } = require('openai');
const { classifyButtonTextLLM } = require('./generate-autoconsent-rules/detection');

const DEFAULT_CSV_PATH = path.join(__dirname, 'generate-autoconsent-rules/labelled-button-texts.csv');

program
    .description('Label unlabelled button texts in labelled-button-texts.csv using LLM classification')
    .option('-i, --input <path>', 'path to button text CSV', DEFAULT_CSV_PATH)
    .option('--limit <n>', 'limit number of unlabelled rows to process', parseInt)
    .option('--parallel <n>', 'parallel LLM requests', '10')
    .parse(process.argv);

const opts = program.opts();

/**
 * @param {string} value
 * @returns {string}
 */
function csvEscape(value) {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
    /** @type {string[]} */
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);
    return fields;
}

/**
 * @param {string} filePath
 * @returns {Array<{ buttonText: string, occurances: number, label: string }>}
 */
function readCsvRows(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
    /** @type {Array<{ buttonText: string, occurances: number, label: string }>} */
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        if (fields.length < 2) {
            continue;
        }
        const buttonText = fields[0];
        const occurances = Number.parseInt(fields[1], 10);
        if (!buttonText || Number.isNaN(occurances)) {
            continue;
        }
        const label = fields.length >= 3 ? fields[2].trim() : '';
        rows.push({ buttonText, occurances, label });
    }

    return rows;
}

/**
 * @param {Array<{ buttonText: string, occurances: number, label: string }>} rows
 * @returns {string}
 */
function rowsToCsv(rows) {
    const lines = ['button_text,occurances,label'];
    for (const row of rows) {
        lines.push(`${csvEscape(row.buttonText)},${row.occurances},${csvEscape(row.label)}`);
    }
    return `${lines.join('\n')}\n`;
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

    const rows = readCsvRows(inputPath);
    if (rows.length === 0) {
        console.error('no rows found in CSV');
        process.exit(1);
    }

    /** @type {number[]} */
    let unlabelledIndices = rows
        .map((row, index) => (row.label ? null : index))
        .filter((index) => index !== null);

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

    await asyncLib.eachOfLimit(
        unlabelledIndices,
        parallel,
        async (rowIndex) => {
            const row = rows[rowIndex];
            row.label = await classifyButtonTextLLM(openai, row.buttonText);
            progress.tick();
        },
    );

    const csv = rowsToCsv(rows);
    const tempPath = `${inputPath}.tmp`;
    fs.writeFileSync(tempPath, csv);
    fs.renameSync(tempPath, inputPath);

    console.error(`Updated ${unlabelledIndices.length} labels in ${inputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
