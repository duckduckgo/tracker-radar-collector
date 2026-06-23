const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const ProgressBar = require('progress');
const chalk = require('chalk');
const asyncLib = require('async');
const { cleanButtonText } = require('./generate-autoconsent-rules/detection');
const { readButtonTextCsv, buttonTextRowsToCsv } = require('./button-text-csv');

const METADATA_FILE_NAME = 'metadata.json';

program
    .description('Collect normalized button texts from potentialPopups in crawl output (one count per site per button text)')
    .requiredOption('-i, --input <path>', 'path to folder with crawl JSON output')
    .option('-o, --output <path>', 'path to write CSV output (defaults to stdout)')
    .option('-p, --parallel <n>', 'Number of pages to process in parallel', '50')
    .parse(process.argv);

const opts = program.opts();
const inputDir = opts.input;

/**
 * @param {string} filePath
 * @returns {Map<string, { occurences: number, label: string }>}
 */
function readExistingData(filePath) {
    /** @type {Map<string, { occurences: number, label: string }>} */
    const data = new Map();
    for (const row of readButtonTextCsv(filePath)) {
        data.set(row.buttonText, { occurences: row.occurences, label: row.label });
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
        if (typeof button === 'object' && button !== null && typeof (/** @type {{ text?: unknown }} */ (button).text) === 'string') {
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
    const potentialPopups = /** @type {{ potentialPopups?: import('./generate-autoconsent-rules/types').ProcessedCookiePopup[] }} */ (node)
        .potentialPopups;
    if (!Array.isArray(potentialPopups)) {
        return [];
    }
    /** @type {string[]} */
    const texts = [];
    for (const popup of potentialPopups) {
        // skip not matching popups
        if (!popup.regexMatch && !popup.llmMatch) {
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
    const scrapedFrames = /** @type {import('./generate-autoconsent-rules/types').CrawlData} */ (crawlData)?.data?.cookiepopups
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
 * @param {Map<string, { occurences: number, label: string }>} data
 * @returns {Array<{ buttonText: string, occurences: number, label: string }>}
 */
function buildRows(data) {
    return [...data.entries()]
        .filter(([, { occurences }]) => occurences > 1)
        .sort((a, b) => b[1].occurences - a[1].occurences || a[0].localeCompare(b[0]))
        .map(([buttonText, { occurences, label }]) => ({
            buttonText,
            occurences,
            label,
        }));
}

async function main() {
    const parallel = parseInt(opts.parallel, 10);

    if (!fs.existsSync(inputDir)) {
        console.error('input directory does not exist:', inputDir);
        process.exit(1);
    }

    const pages = fs.readdirSync(inputDir).filter((name) => name.endsWith('.json') && name !== METADATA_FILE_NAME);
    const progressBar = process.env.IS_CI
        ? null
        : new ProgressBar('[:bar] :current/:total :percent ETA :etas rate :rate/s :page', {
              complete: chalk.green('='),
              incomplete: ' ',
              total: pages.length,
              width: 30,
          });

    /** @type {Map<string, { occurences: number, label: string }>} */
    const data = opts.output && fs.existsSync(opts.output) ? readExistingData(opts.output) : new Map();

    if (opts.output && data.size > 0) {
        console.error(`Loaded ${data.size} existing button texts from ${opts.output}`);
    }

    await asyncLib.eachOfLimit(pages, parallel, async (page, /** @type {number} */ index) => {
        if (!progressBar) {
            console.error(`${index + 1}/${pages.length} : ${page}`);
        }
        const filePath = path.join(inputDir, page);

        let crawlData;
        try {
            const contents = await fs.promises.readFile(filePath, 'utf-8');
            crawlData = JSON.parse(contents);
        } catch (error) {
            console.error(`failed to parse ${filePath}:`, error);
            progressBar?.tick({ page });
            return;
        }

        for (const normalized of collectDistinctButtonTextsFromCrawl(crawlData)) {
            const existing = data.get(normalized);
            if (existing) {
                existing.occurences += 1;
            } else {
                data.set(normalized, { occurences: 1, label: '' });
            }
        }
        progressBar?.tick({ page });
    });

    const rows = buildRows(data);
    const csv = buttonTextRowsToCsv(rows);

    if (opts.output) {
        fs.writeFileSync(opts.output, csv);
        console.error(`Wrote ${rows.length} button texts to ${opts.output}`);
    } else {
        process.stdout.write(csv);
    }
}

main();
