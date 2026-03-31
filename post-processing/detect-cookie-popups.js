const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const ProgressBar = require('progress');
const chalk = require('chalk');
const { OpenAI } = require('openai');
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');
const asyncLib = require('async');
const { checkHeuristicPatterns, classifyPopup, classifyButtons } = require('./generate-autoconsent-rules/detection');

const MAX_TEXT_LENGTH = 10_000;

/**
 * @param {string} errorMessage
 * @returns {string}
 */
function classifyError(errorMessage) {
    const msg = String(errorMessage).toLowerCase();
    if (msg.includes('guardrail') || msg.includes('unsafe')) return 'guardrail';
    if (msg.includes('context') || msg.includes('exceeded') || msg.includes('4096')) return 'context_overflow';
    if (msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('fetch failed') || msg.includes('connection error')) return 'network';
    return 'other';
}

/**
 * @param {import('openai').OpenAI} openai
 * @param {string} text
 * @param {{guardrail: number, context_overflow: number, network: number, other: number}} errorCounts
 * @returns {Promise<boolean>}
 */
async function checkLLM(openai, text, errorCounts) {
    const systemPrompt = `
You are an expert in web application user interfaces. You are given a text extracted from an HTML page. Your task is to determine whether this page contains a cookie popup.

A "cookie popup", also known as "consent management dialog", is a notification that informs users about the use of cookies (or other storage technologies), and seeks their consent. It typically includes information about cookies, consent options, privacy policy links, and action buttons.

While cookie popups are primarily focused on obtaining consent for the use of cookies, they often encompass broader data privacy and tracking practices. Therefore, cookie popups may also include information about:
- other tracking technologies: popups may address other tracking technologies such as web beacons, pixels, and local storage that websites use to collect data about user behavior.
- data collection and usage: the popups may provide information about what types of data are collected, how it is used, and with whom it is shared, extending beyond just cookies.
- consent for other technologies: some popups may also seek consent for other technologies that involve data processing, such as analytics tools, advertising networks, and social media plugins.
- user preferences: they often allow users to manage their preferences regarding different types of data collection and processing activities.

Note: If the provided text contains only code, it indicates the problem with data collection. Do not classify such cases as cookie popups.

Examples of cookie popup text:
- "This site uses cookies to improve your experience. By continuing to use our site, you agree to our cookie policy."
- "We and our partners process data to provide and improve our services, including advertising and personalized content. This may include data from other companies and the public. [Accept All] [Reject All] [Show Purposes]"

Examples of NON-cookie popup text:
- "This site is for adults only. By pressing continue, you confirm that you are at least 18 years old."
- "Help Contact Pricing Company Jobs Research Program Sitemap Privacy Settings Legal Notice Cookie Policy"
- "Would you like to enable notifications to stay up to date?"
- "function rn(){return"EU"===tn()}var on={};return{require:o,getLookUpTable:c,getListOfCookiesForDeletion:a,getGDPRFlag:g,getGDPRConsent:f,getGDPRConsentString:l,isCouplingMode:s"
    `;

    const trimmedText = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;

    const CookieConsentNoticeClassification = z.object({
        isCookieConsentNotice: z.boolean(),
    });

    try {
        const completion = await openai.beta.chat.completions.parse({
            model: 'gpt-4.1-nano-2025-04-14',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content: trimmedText,
                },
            ],

            response_format: zodResponseFormat(CookieConsentNoticeClassification, 'CookieConsentNoticeClassification'),
        });

        const result = completion.choices[0].message.parsed;
        return result?.isCookieConsentNotice ?? false;
    } catch (error) {
        console.error('Error classifying candidate:', error);
        const errorText = [error?.message, error?.cause?.message, error?.cause?.code].filter(Boolean).join(' ');
        const category = classifyError(errorText);
        errorCounts[category] = (errorCounts[category] || 0) + 1;
    }

    return false;
}

/**
 * @param {import('../collectors/CookiePopupsCollector.js').ScrapeScriptResult} frameContext
 * @param {import('openai').OpenAI} openai
 * @param {{guardrail: number, context_overflow: number, network: number, other: number}} errorCounts
 * @returns {Promise<{hasDetectedPopupAfm: boolean, hasDetectedPopupRegex: boolean, rejectButtonTexts: Set<string>, otherButtonTexts: Set<string>}>}
 */
async function classifyPotentialPopups(frameContext, openai, errorCounts) {
    let hasDetectedPopupAfm = false;
    let hasDetectedPopupRegex = false;
    const rejectButtonTexts = new Set();
    const otherButtonTexts = new Set();
    for (let i = 0; i < frameContext.potentialPopups.length; i++) {
        const popup = frameContext.potentialPopups[i];

        const popupClassificationResult = await classifyPopup(popup, openai, errorCounts);

        frameContext.potentialPopups[i] = {
            ...popup,
            ...popupClassificationResult,
        };
        if (popupClassificationResult.afmMatch) {
            hasDetectedPopupAfm = true;
        }
        if (popupClassificationResult.regexMatch) {
            hasDetectedPopupRegex = true;
        }
        if (popupClassificationResult.afmMatch) {
            popupClassificationResult.rejectButtons.flatMap((button) => button.text).forEach((b) => rejectButtonTexts.add(b));
            popupClassificationResult.otherButtons.flatMap((button) => button.text).forEach((b) => otherButtonTexts.add(b));
        }
    }
    return {
        hasDetectedPopupAfm,
        hasDetectedPopupRegex,
        rejectButtonTexts,
        otherButtonTexts,
    };
}

/**
 * @param {import('../collectors/CookiePopupsCollector.js').ScrapeScriptResult} frameContext
 * @param {import('openai').OpenAI} openai
 * @param {{guardrail: number, context_overflow: number, network: number, other: number}} errorCounts
 * @returns {Promise<{afmPopupDetected: boolean, regexPopupDetected: boolean}>}
 */
async function classifyDocument(frameContext, openai, errorCounts) {
    let afmPopupDetected = false;
    let regexPopupDetected = false;
    // ask LLM to detect cookie popups in the page text
    if (
        frameContext.cleanedText &&
        (frameContext.isTop || frameContext.buttons.length > 0) // simple heuristic to filter out utility iframes that often cause false positives
    ) {
        if (frameContext.potentialPopups?.some((p) => p.afmMatch)) {
            afmPopupDetected = true;
        } else {
            afmPopupDetected = await checkLLM(openai, frameContext.cleanedText, errorCounts);
        }
        regexPopupDetected = checkHeuristicPatterns(frameContext.cleanedText);
        const { rejectButtons, otherButtons } = classifyButtons(frameContext.buttons);
        frameContext.rejectButtons = rejectButtons;
        frameContext.otherButtons = otherButtons;
    }
    frameContext.afmPopupDetected = afmPopupDetected;
    frameContext.regexPopupDetected = regexPopupDetected;
    return {
        afmPopupDetected,
        regexPopupDetected,
    };
}

async function main() {
    const program = new Command();
    program
        .description('Detect cookie popups in a crawl (Apple FM batch testing variant)')
        .requiredOption(
            '-d, --crawldir <dir>',
            'Directory of crawl output to process, e.g. "/mnt/efs/shared/crawler-data/autoconsent-coverage-crawls/2025-05-12/US/3p-crawl/"',
        )
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
    let sitesWithPopupsAfm = 0;
    let sitesWithPopupsRegex = 0;
    let sitesWithDetectedPopupAfm = 0;
    let sitesWithDetectedPopupRegex = 0;
    let popupLevelAgree = 0;
    let popupLevelDisagree = 0;
    let frameLevelAgree = 0;
    let frameLevelDisagree = 0;
    const errorCounts = { guardrail: 0, context_overflow: 0, network: 0, other: 0 };

    const rejectButtonTexts = new Set();
    const otherButtonTexts = new Set();

    const reportFile = path.join(crawlDir, '..', 'detection-report.json');

    async function writeReport() {
        const report = {
            processed,
            total: pages.length,
            sitesWithPopupsAfm,
            sitesWithPopupsRegex,
            sitesWithDetectedPopupAfm,
            sitesWithDetectedPopupRegex,
            popupLevelAgree,
            popupLevelDisagree,
            frameLevelAgree,
            frameLevelDisagree,
            errors: { ...errorCounts },
            timestamp: new Date().toISOString(),
        };
        await fs.promises.writeFile(reportFile, JSON.stringify(report, null, 2));
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

        let cookiePopupDetectedAfm = false;
        let cookiePopupDetectedRegex = false;
        let hasDetectedPopupAfm = false;
        let hasDetectedPopupRegex = false;

        for (const frameContext of collectorResult.scrapedFrames) {
            // Save pre-existing OpenAI results before classifyPotentialPopups runs
            const existingPopupLlmFlags = (frameContext.potentialPopups || []).map((p) => p.llmMatch);
            const existingFrameLlm = !!frameContext.llmPopupDetected;

            const popupClassificationResult = await classifyPotentialPopups(frameContext, openai, errorCounts);
            hasDetectedPopupAfm = hasDetectedPopupAfm || popupClassificationResult.hasDetectedPopupAfm;
            hasDetectedPopupRegex = hasDetectedPopupRegex || popupClassificationResult.hasDetectedPopupRegex;
            popupClassificationResult.rejectButtonTexts.forEach((b) => rejectButtonTexts.add(b));
            popupClassificationResult.otherButtonTexts.forEach((b) => otherButtonTexts.add(b));

            // Popup-level comparison: compare each popup's llmMatch vs afmMatch
            for (let i = 0; i < (frameContext.potentialPopups || []).length; i++) {
                const oldLlm = existingPopupLlmFlags[i];
                const newAfm = !!frameContext.potentialPopups[i].afmMatch;
                if (oldLlm !== undefined) {
                    if (oldLlm === newAfm) {
                        popupLevelAgree++;
                    } else {
                        popupLevelDisagree++;
                    }
                }
            }

            const documentClassificationResult = await classifyDocument(frameContext, openai, errorCounts);
            cookiePopupDetectedAfm = cookiePopupDetectedAfm || documentClassificationResult.afmPopupDetected;
            cookiePopupDetectedRegex = cookiePopupDetectedRegex || documentClassificationResult.regexPopupDetected;

            // Frame-level comparison: compare llmPopupDetected vs afmPopupDetected
            if (existingFrameLlm === documentClassificationResult.afmPopupDetected) {
                frameLevelAgree++;
            } else {
                frameLevelDisagree++;
            }
        }

        if (collectorResult.scrapedFrames.length > 0) {
            if (cookiePopupDetectedAfm) {
                sitesWithPopupsAfm++;
            }
            if (cookiePopupDetectedRegex) {
                sitesWithPopupsRegex++;
            }
            if (hasDetectedPopupAfm) {
                sitesWithDetectedPopupAfm++;
            }
            if (hasDetectedPopupRegex) {
                sitesWithDetectedPopupRegex++;
            }

            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
        }

        processed++;
        progressBar?.tick({ page });

        if (processed % reportInterval === 0) {
            await writeReport();
        }
    });

    await writeReport();

    console.log('Saving button texts to files...');
    const rejectButtonTextsFile = path.join(crawlDir, '..', 'reject-button-texts.txt');
    const otherButtonTextsFile = path.join(crawlDir, '..', 'other-button-texts.txt');
    await fs.promises.writeFile(rejectButtonTextsFile, Array.from(rejectButtonTexts).join('\n'));
    await fs.promises.writeFile(otherButtonTextsFile, Array.from(otherButtonTexts).join('\n'));

    console.log('Done');
    console.log(`Sites with AFM detected text (full text page): ${sitesWithPopupsAfm} (${((sitesWithPopupsAfm / pages.length) * 100).toFixed(1)}%)`);
    console.log(
        `Sites with regex detected popups (full text page): ${sitesWithPopupsRegex} (${((sitesWithPopupsRegex / pages.length) * 100).toFixed(1)}%)`,
    );
    console.log(
        `Sites with AFM detected popups (popup elements): ${sitesWithDetectedPopupAfm} (${((sitesWithDetectedPopupAfm / pages.length) * 100).toFixed(1)}%)`,
    );
    console.log(
        `Sites with regex detected popups (popup elements): ${sitesWithDetectedPopupRegex} (${((sitesWithDetectedPopupRegex / pages.length) * 100).toFixed(1)}%)`,
    );
    console.log(`Popup-level comparison with OpenAI: agree=${popupLevelAgree}, disagree=${popupLevelDisagree}`);
    console.log(`Frame-level comparison with OpenAI: agree=${frameLevelAgree}, disagree=${frameLevelDisagree}`);
    console.log(`Errors: ${JSON.stringify(errorCounts)}`);
    console.log(`Report saved to ${reportFile}`);
    console.log(`Reject button texts (${rejectButtonTexts.size}) saved in ${rejectButtonTextsFile}`);
    console.log(`Other button texts (${otherButtonTexts.size}) saved in ${otherButtonTextsFile}`);
}

main();
