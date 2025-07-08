const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const ProgressBar = require('progress');
const chalk = require('chalk');
const { OpenAI } = require('openai');
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');
const { checkHeuristicPatterns, classifyPopup } = require('./generate-autoconsent-rules/detection');
const { verifyButtonTexts } = require('./generate-autoconsent-rules/verification');

/**
 * @param {import('openai').OpenAI} openai
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function checkLLM(openai, text) {
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
                    content: text,
                },
            ],
            // eslint-disable-next-line camelcase
            response_format: zodResponseFormat(CookieConsentNoticeClassification, 'CookieConsentNoticeClassification'),
        });

        const result = completion.choices[0].message.parsed;
        return result?.isCookieConsentNotice ?? false;
    } catch (error) {
        console.error('Error classifying candidate:', error);
    }

    return false;
}

/**
 * @param {import('../collectors/CookiePopupsCollector.js').ScrapeScriptResult} frameContext
 * @param {import('openai').OpenAI} openai
 * @returns {Promise<{hasDetectedPopupLlm: boolean, hasDetectedPopupRegex: boolean, rejectButtonTexts: Set<string>, otherButtonTexts: Set<string>}>}
 */
async function classifyPotentialPopups(frameContext, openai) {
    let hasDetectedPopupLlm = false;
    let hasDetectedPopupRegex = false;
    const rejectButtonTexts = new Set();
    const otherButtonTexts = new Set();
    for (let i = 0; i < frameContext.potentialPopups.length; i++) {
        const popup = frameContext.potentialPopups[i];
        // eslint-disable-next-line no-await-in-loop
        const popupClassificationResult = await classifyPopup(popup, openai);
        // Replace the popup data in place
        frameContext.potentialPopups[i] = {
            ...popup,
            ...popupClassificationResult,
        };
        if (popupClassificationResult.llmMatch) {
            hasDetectedPopupLlm = true;
        }
        if (popupClassificationResult.regexMatch) {
            hasDetectedPopupRegex = true;
        }
        // Collect button texts for analysis
        if (popupClassificationResult.llmMatch) {
            popup.rejectButtons.flatMap(button => button.text).forEach(b => rejectButtonTexts.add(b));
            popup.otherButtons.flatMap(button => button.text).forEach(b => otherButtonTexts.add(b));
        }
    }
    return {
        hasDetectedPopupLlm,
        hasDetectedPopupRegex,
        rejectButtonTexts,
        otherButtonTexts,
    };
}

/**
 * @param {import('../collectors/CookiePopupsCollector.js').ScrapeScriptResult} frameContext
 * @param {import('openai').OpenAI} openai
 * @returns {Promise<{llmPopupDetected: boolean, regexPopupDetected: boolean}>}
 */
async function classifyDocument(frameContext, openai) {
    let llmPopupDetected = false;
    let regexPopupDetected = false;
    // ask LLM to detect cookie popups in the page text
    if (frameContext.cleanedText &&
        (frameContext.isTop || frameContext.buttons.length > 0) // simple heuristic to filter out utility iframes that often cause false positives
    ) {
        // eslint-disable-next-line no-await-in-loop
        llmPopupDetected = await checkLLM(openai, frameContext.cleanedText);
        regexPopupDetected = checkHeuristicPatterns(frameContext.cleanedText);
        // TODO: classify buttons (reject & other)
    }
    frameContext.llmPopupDetected = llmPopupDetected;
    frameContext.regexPopupDetected = regexPopupDetected;
    return {
        llmPopupDetected,
        regexPopupDetected,
    };
}

async function main() {
    const program = new Command();
    program
        .description('Detect cookie popups in a crawl')
        .requiredOption('-d, --crawldir <dir>', 'Directory of crawl output to process')
        .parse(process.argv);

    const opts = program.opts();
    const crawlDir = opts.crawldir;

    if (!process.env.OPENAI_API_KEY) {
        console.error('env variable OPENAI_API_KEY is not set');
        process.exit(1);
    }

    if (!await fs.existsSync(crawlDir)) {
        console.error('crawl directory does not exist:', crawlDir);
        process.exit(1);
    }

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const pages = fs.readdirSync(crawlDir).filter(name => name.endsWith('.json') && name !== 'metadata.json');
    const progressBar = new ProgressBar('[:bar] :percent ETA :etas :page', {
        complete: chalk.green('='),
        incomplete: ' ',
        total: pages.length,
        width: 30,
    });

    let sitesWithPopupsLlm = 0;
    let sitesWithPopupsRegex = 0;
    let sitesWithDetectedPopupLlm = 0;
    let sitesWithDetectedPopupRegex = 0;

    const rejectButtonTexts = new Set();
    const otherButtonTexts = new Set();

    // TODO: parallelize this
    for (const page of pages) {
        const filePath = path.join(crawlDir, page);
        const contents = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(contents.toString());

        if (!data.data || !data.data.cookiepopups) {
            progressBar.tick({ page });
            continue;
        }

        /** @type {import('../collectors/CookiePopupsCollector.js').CookiePopupsCollectorResult} */
        const collectorResult = data.data.cookiepopups;

        let cookiePopupDetectedLlm = false;
        let cookiePopupDetectedRegex = false;
        let hasDetectedPopupLlm = false;
        let hasDetectedPopupRegex = false;

        for (const frameContext of collectorResult.scrapedFrames) {
            // First, go over potential popups and classify them individually
            // eslint-disable-next-line no-await-in-loop
            const popupClassificationResult = await classifyPotentialPopups(frameContext, openai);
            hasDetectedPopupLlm = hasDetectedPopupLlm || popupClassificationResult.hasDetectedPopupLlm;
            hasDetectedPopupRegex = hasDetectedPopupRegex || popupClassificationResult.hasDetectedPopupRegex;
            popupClassificationResult.rejectButtonTexts.forEach(b => rejectButtonTexts.add(b));
            popupClassificationResult.otherButtonTexts.forEach(b => otherButtonTexts.add(b));

            // Then, classify based on the full document text
            // eslint-disable-next-line no-await-in-loop
            const documentClassificationResult = await classifyDocument(frameContext, openai);
            cookiePopupDetectedLlm = cookiePopupDetectedLlm || documentClassificationResult.llmPopupDetected;
            cookiePopupDetectedRegex = cookiePopupDetectedRegex || documentClassificationResult.regexPopupDetected;
        }

        if (collectorResult.scrapedFrames.length > 0) {
            if (cookiePopupDetectedLlm) {
                sitesWithPopupsLlm++;
            }
            if (cookiePopupDetectedRegex) {
                sitesWithPopupsRegex++;
            }
            if (hasDetectedPopupLlm) {
                sitesWithDetectedPopupLlm++;
            }
            if (hasDetectedPopupRegex) {
                sitesWithDetectedPopupRegex++;
            }

            // update the crawl file asynchronously
            fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
        }
        progressBar.tick({
            page,
        });
    }

    console.log('Saving button texts to files...');
    const rejectButtonTextsFile = path.join(crawlDir, '..', 'reject-button-texts.txt');
    const otherButtonTextsFile = path.join(crawlDir, '..', 'other-button-texts.txt');
    await fs.promises.writeFile(rejectButtonTextsFile, Array.from(rejectButtonTexts).join('\n'));
    await fs.promises.writeFile(otherButtonTextsFile, Array.from(otherButtonTexts).join('\n'));

    console.log('Verifying button texts...');
    await verifyButtonTexts({
        openai,
        rejectButtonTextsFile,
        otherButtonTextsFile,
    });

    console.log('Done');
    console.log(`Sites with LLM detected text (full text page): ${sitesWithPopupsLlm} (${sitesWithPopupsLlm / pages.length * 100}%)`);
    console.log(`Sites with regex detected popups (full text page): ${sitesWithPopupsRegex} (${sitesWithPopupsRegex / pages.length * 100}%)`);
    console.log(`Sites with LLM detected popups (popup elements): ${sitesWithDetectedPopupLlm} (${sitesWithDetectedPopupLlm / pages.length * 100}%)`);
    console.log(`Sites with regex detected popups (popup elements): ${sitesWithDetectedPopupRegex} (${sitesWithDetectedPopupRegex / pages.length * 100}%)`);
    console.log(`Reject button texts (${rejectButtonTexts.size}) saved in ${rejectButtonTextsFile}`);
    console.log(`Other button texts (${otherButtonTexts.size}) saved in ${otherButtonTextsFile}`);
}

main();
