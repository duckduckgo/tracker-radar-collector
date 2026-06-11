const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { cleanButtonText } = require('./generate-autoconsent-rules/detection');

const METADATA_FILE_NAME = 'metadata.json';

program
    .description('Collect normalized button texts from potentialPopups in crawl output (one count per site per button text)')
    .requiredOption('-i, --input <path>', 'path to folder with crawl JSON output')
    .option('-o, --output <path>', 'path to write CSV output (defaults to stdout)')
    .parse(process.argv);

const opts = program.opts();
const inputDir = opts.input;

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
 * @returns {Map<string, { occurances: number, label: string }>}
 */
function readExistingData(filePath) {
    /** @type {Map<string, { occurances: number, label: string }>} */
    const data = new Map();
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length <= 1) {
        return data;
    }

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
        const label = fields.length >= 3 ? fields[2] : '';
        data.set(buttonText, { occurances, label });
    }
    return data;
}

/**
 * @param {unknown} popup
 * @returns {string[]}
 */
function readPopupButtonTexts(popup) {
    if (typeof popup !== 'object' || popup === null) {
        return [];
    }
    const buttons = /** @type {{ buttons?: unknown }} */ (popup).buttons;
    if (!Array.isArray(buttons)) {
        return [];
    }
    /** @type {string[]} */
    const texts = [];
    for (const button of buttons) {
        if (typeof button === 'object' && button !== null && typeof /** @type {{ text?: unknown }} */ (button).text === 'string') {
            texts.push(/** @type {{ text: string }} */ (button).text);
        }
    }
    return texts;
}

/**
 * @param {unknown} node
 * @returns {string[]}
 */
function collectButtonTextsFromNode(node) {
    if (typeof node !== 'object' || node === null) {
        return [];
    }
    const potentialPopups = /** @type {{ potentialPopups?: import('./generate-autoconsent-rules/types').ProcessedCookiePopup[] }} */ (node).potentialPopups;
    if (!Array.isArray(potentialPopups)) {
        return [];
    }
    /** @type {string[]} */
    const texts = [];
    for (const popup of potentialPopups) {
        // skip not matching popups
        if (!popup.regexMatch) {
            continue;
        }
        texts.push(...readPopupButtonTexts(popup));
    }
    return texts;
}

/**
 * @param {unknown} crawlData
 * @returns {string[]}
 */
function collectButtonTextsFromCrawl(crawlData) {
    /** @type {string[]} */
    const texts = [];
    const scrapedFrames =
        /** @type {import('./generate-autoconsent-rules/types').CrawlData} */ (crawlData)?.data?.cookiepopups
            ?.scrapedFrames;
    if (!Array.isArray(scrapedFrames)) {
        return texts;
    }
    for (const frame of scrapedFrames) {
        texts.push(...collectButtonTextsFromNode(frame));
    }
    return texts;
}

/**
 * @param {unknown} crawlData
 * @returns {Set<string>}
 */
function collectDistinctButtonTextsFromCrawl(crawlData) {
    /** @type {Set<string>} */
    const texts = new Set();
    for (const buttonText of collectButtonTextsFromCrawl(crawlData)) {
        const normalized = cleanButtonText(buttonText);
        if (normalized) {
            texts.add(normalized);
        }
    }
    return texts;
}

/**
 * @param {Map<string, { occurances: number, label: string }>} data
 * @returns {Array<{ buttonText: string, occurances: number, label: string }>}
 */
function buildRows(data) {
    return [...data.entries()]
        .filter(([, { occurances }]) => occurances > 1)
        .sort((a, b) => b[1].occurances - a[1].occurances || a[0].localeCompare(b[0]))
        .map(([buttonText, { occurances, label }]) => ({
            buttonText,
            occurances,
            label,
        }));
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

function main() {
    if (!fs.existsSync(inputDir)) {
        console.error('input directory does not exist:', inputDir);
        process.exit(1);
    }

    const dataFiles = fs
        .readdirSync(inputDir)
        .filter((file) => file.endsWith('.json') && file !== METADATA_FILE_NAME)
        .map((file) => path.join(inputDir, file));

    /** @type {Map<string, { occurances: number, label: string }>} */
    const data =
        opts.output && fs.existsSync(opts.output) ? readExistingData(opts.output) : new Map();

    if (opts.output && data.size > 0) {
        console.error(`Loaded ${data.size} existing button texts from ${opts.output}`);
    }

    for (const filePath of dataFiles) {
        let crawlData;
        try {
            crawlData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            console.error(`failed to parse ${filePath}:`, error);
            continue;
        }

        for (const normalized of collectDistinctButtonTextsFromCrawl(crawlData)) {
            const existing = data.get(normalized);
            if (existing) {
                existing.occurances += 1;
            } else {
                data.set(normalized, { occurances: 1, label: '' });
            }
        }
    }

    const rows = buildRows(data);
    const csv = rowsToCsv(rows);

    if (opts.output) {
        fs.writeFileSync(opts.output, csv);
        console.error(`Wrote ${rows.length} button texts to ${opts.output}`);
    } else {
        process.stdout.write(csv);
    }
}

main();
