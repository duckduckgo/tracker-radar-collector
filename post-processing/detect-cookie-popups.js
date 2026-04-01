const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const ProgressBar = require('progress');
const chalk = require('chalk');
const { OpenAI } = require('openai');
const asyncLib = require('async');
const { checkHeuristicPatterns, classifyPopup, classifyButtons, PROMPTS } = require('./generate-autoconsent-rules/detection');

function classifyError(errorMessage) {
    const msg = String(errorMessage).toLowerCase();
    if (msg.includes('guardrail') || msg.includes('unsafe')) return 'guardrail';
    if (msg.includes('context') || msg.includes('exceeded') || msg.includes('4096')) return 'context_overflow';
    if (msg.includes('unsupported language') || msg.includes('locale')) return 'unsupported_locale';
    if (msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('fetch failed') || msg.includes('connection error')) return 'network';
    return 'other';
}

const promptNames = Object.keys(PROMPTS);

function makePromptCounters() {
    const counters = {};
    for (const name of promptNames) {
        counters[name] = { detected: 0, agreeWithLlm: 0, disagreeWithLlm: 0, agreeWithRegex: 0, disagreeWithRegex: 0 };
    }
    return counters;
}

async function main() {
    const program = new Command();
    program
        .description('Detect cookie popups in a crawl (Apple FM batch testing variant, popup-level only)')
        .requiredOption('-d, --crawldir <dir>', 'Directory of crawl output to process')
        .option('-p, --parallel <n>', 'Number of pages to process in parallel', '1')
        .option('--report-interval <n>', 'Write intermediate report every N pages', '100')
        .parse(process.argv);

    const opts = program.opts();
    const crawlDir = opts.crawldir;
    const parallel = parseInt(opts.parallel, 10);
    const reportInterval = parseInt(opts.reportInterval, 10);

    const afmBaseUrl = process.env.AFM_BASE_URL;
    if (!afmBaseUrl && !process.env.OPENAI_API_KEY) {
        console.error('Set OPENAI_API_KEY or AFM_BASE_URL (e.g. http://localhost:8000/v1)');
        process.exit(1);
    }

    if (!(await fs.existsSync(crawlDir))) {
        console.error('crawl directory does not exist:', crawlDir);
        process.exit(1);
    }

    const openai = new OpenAI({
        baseURL: afmBaseUrl || undefined,
        apiKey: afmBaseUrl ? 'unused' : process.env.OPENAI_API_KEY,
    });

    const pages = fs.readdirSync(crawlDir).filter((name) => name.endsWith('.json') && name !== 'metadata.json');
    const progressBar = process.env.IS_CI
        ? null
        : new ProgressBar('[:bar] :current/:total :percent ETA :etas rate :rate/s :page', {
              complete: chalk.green('='),
              incomplete: ' ',
              total: pages.length,
              width: 30,
          });

    let processed = 0;
    let totalPopups = 0;
    let regexDetected = 0;
    const promptCounters = makePromptCounters();
    const errorCounts = { guardrail: 0, context_overflow: 0, unsupported_locale: 0, network: 0, other: 0 };
    /** @type {Array<Object>} */
    const disagreements = [];

    const reportFile = path.join(crawlDir, '..', 'detection-report.json');
    const disagreementsFile = path.join(crawlDir, '..', 'detection-disagreements.jsonl');

    async function writeReport() {
        const report = {
            processed,
            total: pages.length,
            totalPopups,
            regexDetected,
            prompts: { ...promptCounters },
            errors: { ...errorCounts },
            timestamp: new Date().toISOString(),
        };
        await fs.promises.writeFile(reportFile, JSON.stringify(report, null, 2));
        if (disagreements.length > 0) {
            await fs.promises.writeFile(disagreementsFile, disagreements.map((d) => JSON.stringify(d)).join('\n') + '\n');
        }
    }

    await asyncLib.eachOfLimit(pages, parallel, async (page, /** @type {number} */ index) => {
        if (!progressBar) {
            console.log(`${index + 1}/${pages.length} : ${page}`);
        }
        const filePath = path.join(crawlDir, page);

        let contents;
        let data;
        try {
            contents = await fs.promises.readFile(filePath, 'utf-8');
            data = JSON.parse(contents.toString());
        } catch (error) {
            console.error(`Error reading or parsing file ${page}:`, error.message);
            progressBar?.tick({ page });
            processed++;
            return;
        }

        if (!data.data || !data.data.cookiepopups) {
            progressBar?.tick({ page });
            processed++;
            return;
        }

        /** @type {import('../collectors/CookiePopupsCollector.js').CookiePopupsCollectorResult} */
        const collectorResult = data.data.cookiepopups;
        let changed = false;

        for (const frameContext of collectorResult.scrapedFrames) {
            for (let i = 0; i < (frameContext.potentialPopups || []).length; i++) {
                const popup = frameContext.potentialPopups[i];
                const existingLlm = !!popup.llmMatch;

                const result = await classifyPopup(popup, openai, errorCounts);

                frameContext.potentialPopups[i] = {
                    ...popup,
                    ...result,
                };
                changed = true;
                totalPopups++;

                if (result.regexMatch) {
                    regexDetected++;
                }

                for (const name of promptNames) {
                    const afmField = `afm${name.charAt(0).toUpperCase() + name.slice(1)}`;
                    const afmValue = result[afmField];
                    if (afmValue === null) {
                        continue;
                    }
                    if (afmValue) {
                        promptCounters[name].detected++;
                    }
                    if (existingLlm === afmValue) {
                        promptCounters[name].agreeWithLlm++;
                    } else {
                        promptCounters[name].disagreeWithLlm++;
                        disagreements.push({
                            file: page,
                            site: data.finalUrl || page,
                            prompt: name,
                            llm: existingLlm,
                            afm: afmValue,
                            text: (popup.text || '').slice(0, 500),
                        });
                    }
                    if (result.regexMatch === afmValue) {
                        promptCounters[name].agreeWithRegex++;
                    } else {
                        promptCounters[name].disagreeWithRegex++;
                    }
                }
            }
        }

        if (changed) {
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
        }

        processed++;
        progressBar?.tick({ page });

        if (processed % reportInterval === 0) {
            await writeReport();
        }
    });

    await writeReport();

    console.log('Done');
    console.log(`Processed ${processed} sites, ${totalPopups} popups`);
    console.log(`Regex detected: ${regexDetected}`);
    for (const name of promptNames) {
        const c = promptCounters[name];
        console.log(`Prompt "${name}": detected=${c.detected} vs_llm=${c.agreeWithLlm}/${c.disagreeWithLlm} vs_regex=${c.agreeWithRegex}/${c.disagreeWithRegex}`);
    }
    console.log(`Errors: ${JSON.stringify(errorCounts)}`);
    console.log(`Disagreements: ${disagreements.length} (saved to ${disagreementsFile})`);
    console.log(`Report saved to ${reportFile}`);
}

main();
