const fs = require('fs');
const path = require('path');

const {OpenAI} = require('openai');
const { Command } = require('commander');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const program = new Command();
program
    .description(`Generate autoconsent rules from a crawl directory
Example:
    node generate-autoconsent-rules.js --crawl-dir /mnt/efs/shared/crawler-data/2025-05-12/GB/3p-crawl/ --region GB --autoconsent-dir ../autoconsent
`)
    .option('--crawl-dir <path>', 'Crawl directory')
    .option('--region <region>', 'Crawl region code')
    .option('--autoconsent-dir <path>', 'Autoconsent directory')
    .parse(process.argv);

const options = program.opts();
const crawlDir = options.crawlDir;
const region = options.region;
const autoconsentDir = options.autoconsentDir;

if (!crawlDir || !region || !autoconsentDir) {
    program.outputHelp();
    process.exit(1);
}

const rulesDir = path.join(autoconsentDir, 'rules/generated');
const testDir = path.join(autoconsentDir, 'tests');
const rejectButtonTextsFile = path.join(crawlDir, 'reject-button-texts.txt');
const otherButtonTextsFile = path.join(crawlDir, 'other-button-texts.txt');

/**
 * @param {string} allText
 * @returns {boolean}
 */
function checkHeuristicPatterns(allText) {
    const DETECT_PATTERNS = [
        /accept cookies/gi,
        /accept all/gi,
        /reject all/gi,
        /only necessary cookies/gi, // "only necessary" is probably too broad
        /by clicking.*(accept|agree|allow)/gi,
        /by continuing/gi,
        /we (use|serve)( optional)? cookies/gi,
        /we are using cookies/gi,
        /use of cookies/gi,
        /(this|our) (web)?site.*cookies/gi,
        /cookies (and|or) .* technologies/gi,
        /such as cookies/gi,
        /read more about.*cookies/gi,
        /consent to.*cookies/gi,
        /we and our partners.*cookies/gi,
        /we.*store.*information.*such as.*cookies/gi,
        /store and\/or access information.*on a device/gi,
        /personalised ads and content, ad and content measurement/gi,

        // it might be tempting to add the patterns below, but they cause too many false positives. Don't do it :)
        // /cookies? settings/i,
        // /cookies? preferences/i,
    ];

    for (const p of DETECT_PATTERNS) {
        const matches = allText.match(p);
        if (matches) {
            return true;
        }
    }
    return false;
}

/**
 * @param {string} buttonText
 * @returns {boolean}
 */
function isRejectButton(buttonText) {
    const REJECT_PATTERNS = [
        // e.g. "i reject cookies", "reject all", "reject all cookies", "reject cookies", "deny all", "deny all cookies", "refuse", "refuse all", "refuse cookies", "refuse all cookies", "deny", "reject all and close", "deny all and close", "reject non-essential cookies", "reject optional cookies", "reject additional cookies", "reject targeting cookies", "reject marketing cookies", "reject analytics cookies", "reject tracking cookies", "reject advertising cookies", "reject all and close", "deny all and close"
        /^\s*(i)?\s*(reject|deny|refuse|decline|disable)\s*(all)?\s*(non-essential|optional|additional|targeting|analytics|marketing|unrequired|non-necessary|extra|tracking|advertising)?\s*(cookies)?\s*(and\s+close)?\s*$/i,
    
        // e.g. "i do not accept", "i do not accept cookies", "do not accept", "do not accept cookies"
        /^\s*(i)?\s*do\s+not\s+accept\s*(cookies)?\s*$/i,
    
        // e.g. "continue without accepting", "continue without agreeing", "continue without agreeing →"
        /^\s*(continue|proceed|continue\s+browsing)\s+without\s+(accepting|agreeing|consent|cookies|tracking)(\s*→)?\s*$/i,
    
        // e.g. "strictly necessary cookies only", "essential cookies only", "required only", "use necessary cookies only"
        // note that "only" is required
        /^\s*(use|accept|allow|continue\s+with)?\s*(strictly)?\s*(necessary|essential|required)?\s*(cookies)?\s*only\s*$/i,
    
        // e.g. "allow essential cookies", "allow necessary",
        // note that "essential" is required
        /^\s*(use|accept|allow|continue\s+with)?\s*(strictly)?\s*(necessary|essential|required)\s*(cookies)?\s*$/i,
    
        // e.g. "accept only essential cookies", "use only necessary cookies", "allow only essential", "continue with only essential cookies"
        // note that "only" is required
        /^\s*(use|accept|allow|continue\s+with)?\s*only\s*(strictly)?\s*(necessary|essential|required)?\s*(cookies)?\s*$/i,
    
        // e.g. "do not sell or share my personal information", "do not sell my personal information"
        // often used in CCPA
        /^\s*do\s+not\s+sell(\s+or\s+share)?\s*my\s*personal\s*information\s*$/i,
    
        // These are impactful, but look error-prone
        // // e.g. "disagree"
        // /^\s*(i)?\s*disagree\s*(and\s+close)?\s*$/i,
        // // e.g. "i do not agree"
        // /^\s*(i\s+)?do\s+not\s+agree\s*$/i,
    ];
    return REJECT_PATTERNS.some(p => p.test(buttonText));
}

/**
 * @param {string} domain
 * @returns {string}
 */
function generalizeDomain(domain) {
    return domain.replace(/^www\./, '');
}

/**
 * @param {OpenAI} openai
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function classifyCookieConsentNotice(openai, text) {
    const systemPrompt = `
        Your task is to classify text from the innerText property of HTML overlay elements.

        An overlay element is considered to be a "cookie consent notice" if it meets all of these criteria:
        1. it explicitly notifies the user of the site's use of cookies or other storage technology, such as: "We use cookies...", "This site uses...", etc.
        2. it offers the user choices for the usage of cookies on the site, such as: "Accept", "Reject", "Learn More", etc., or informs the user that their use of the site means they accept the usage of cookies.

        Note: This definition does not include adult content notices or any other type of notice that is primarily focused on age verification or content restrictions. Cookie consent notices are specifically intended to inform users about the website's use of cookies and obtain their consent for such use.

        Note: A cookie consent notice should specifically relate to the site's use of cookies or other storage technology that stores data on the user's device, such as HTTP cookies, local storage, or session storage. Requests for permission to access geolocation information, camera, microphone, etc., do not fall under this category.

        Note: Do NOT classify a website header or footer as a "cookie consent notice". Website headers or footers may contain a list of links, possibly including a privacy policy, cookie policy, or terms of service document, but their primary purpose is navigational rather than informational.
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
 * Generate an autoconsent rule from a reject button.
 * @param {string} url - The URL of the site.
 * @param {CookiePopupData} popup - The popup object.
 * @param {ButtonData} button - The reject button object.
 * @returns {AutoConsentCMPRule} The autoconsent rule.
 */
function generateAutoconsentRule(url, popup, button) {
    // TODO: merge subdomain rules with matching selectors
    const frameDomain = generalizeDomain(new URL(popup.origin).hostname);
    const topDomain = generalizeDomain(new URL(url).hostname);
    const urlPattern = `^https?://(www\\.)?${frameDomain.replace(/\./g, '\\.')}/`;
    const ruleName = `auto_${region}_${topDomain}`;
    return {
        name: ruleName,
        vendorUrl: url,
        cosmetic: false,
        runContext: {
            main: popup.isTop,
            frame: !popup.isTop,
            urlPattern,
        },
        prehideSelectors: [],
        detectCmp: [{ exists: button.selector }],
        detectPopup: [{ visible: button.selector }],
        optIn: [],
        optOut: [{ waitForThenClick: button.selector, comment: button.text }],
    };
}

/**
 * @param {string} ruleName
 * @param {string[]} testUrls
 * @param {string[]} regions
 * @returns {string}
 */
function generateTestFile(ruleName, testUrls, regions) {
    return `import generateCMPTests from "../playwright/runner";
generateCMPTests('${ruleName}', ${JSON.stringify(testUrls)}, {testOptIn: false, testSelfTest: false, onlyRegions: ${JSON.stringify(regions)}});
`;
}

/**
 * Run popup through LLM and regex to identify reject buttons.
 * @param {import('../collectors/CookiePopupCollector').CookiePopupData} popup
 * @param {OpenAI} openai
 * @returns {Promise<ProcessedCookiePopup | null>}
 */
async function identifyPopup(popup, openai) {
    const popupText = popup.text?.trim();
    if (!popupText) {
        return null;
    }
    const regexMatch = checkHeuristicPatterns(popupText);
    const llmMatch = await classifyCookieConsentNotice(openai, popupText);

    /** @type {ButtonData[]} */
    const rejectButtons = [];
    /** @type {ButtonData[]} */
    const otherButtons = [];

    popup.buttons.forEach(button => {
        if (isRejectButton(button.text)) {
            rejectButtons.push(button);
        } else {
            otherButtons.push(button);
        }
    });

    return {
        ...popup,
        llmMatch,
        regexMatch,
        rejectButtons,
        otherButtons,
    };
}

/**
 * @param {string} url
 * @param {ProcessedCookiePopup[]} cookiePopups
 * @returns {AutoConsentCMPRule[]}
 */
function generateRulesForUnknownPopups(url, cookiePopups) {
    const siteRules = [];
    for (let i = 0; i < cookiePopups.length; i++) {
        const popup = cookiePopups[i];

        if (popup.rejectButtons.length > 1) {
            console.warn(`Multiple reject buttons found for popup ${i} on ${url}`);
        }
        if (popup.rejectButtons.length > 0) {
            const rules = popup.rejectButtons.map(button => generateAutoconsentRule(url, popup, button));
            siteRules.push(...rules);
        }
    }
    return siteRules;
}

/**
 * @param {OpenAI} openai
 */
async function processFiles(openai) {
    let totalFiles = 0;
    let totalUnhandled = 0;
    let totalSitesWithNewRules = 0;
    let totalSitesWithPopups = 0;
    let totalSitesWithKnownCmps = 0;
    let totalRules = 0;
    const rejectButtonTexts = new Set();
    const otherButtonTexts = new Set();

    console.log('Cleaning up output directories...');

    if (!fs.existsSync(rulesDir)) {
        await fs.promises.mkdir(rulesDir, { recursive: true });
    } else {
        const files = await fs.promises.readdir(rulesDir);
        await Promise.all(files.map(file => fs.promises.unlink(path.join(rulesDir, file))));
    }

    if (!fs.existsSync(testDir)) {
        await fs.promises.mkdir(testDir, { recursive: true });
    } else {
        const files = await fs.promises.readdir(testDir);
        await Promise.all(files.map(file => fs.promises.unlink(path.join(testDir, file))));
    }

    try {
        const dir = await fs.promises.opendir(crawlDir);
        for await (const dirent of dir) {
            if (dirent.isFile() && path.extname(dirent.name).toLowerCase() === '.json') {
                totalFiles++;
                const fileName = dirent.name;
                const filePath = path.join(crawlDir, fileName);
                try {
                    const fileContent = await fs.promises.readFile(filePath, 'utf8');
                    /** @type {CrawlData} */
                    const jsonData = JSON.parse(fileContent);

                    if (!jsonData || !jsonData.data) {
                        console.warn(`Skipping ${fileName}: no data field`);
                        continue;
                    }

                    /** @type {import('../collectors/CMPCollector').CMPResult[]} */
                    const cmps = jsonData.data.cmps;
                    const hasKnownCmp = (
                        cmps && Array.isArray(cmps) && cmps.length > 0 &&
                        cmps.some(cmp => cmp && cmp.name && cmp.name.trim() !== '')
                    );
                    if (hasKnownCmp) {
                        totalSitesWithKnownCmps += 1;
                    } else {
                        /** @type {ProcessedCookiePopup[]} */
                        const processedCookiePopups = await Promise.all((jsonData.data.cookiepopups || []).map(popup => identifyPopup(popup, openai)));

                        const cookiePopups = processedCookiePopups.filter(p => p && p.llmMatch);
                        if (cookiePopups.length > 1) {
                            console.warn('Multiple cookie popups found in', fileName);
                        }

                        if (cookiePopups.length > 0) {
                            totalSitesWithPopups += 1;
                            totalUnhandled++;
                            cookiePopups.flatMap(popup => popup.rejectButtons.map(button => button.text)).forEach(b => rejectButtonTexts.add(b));
                            cookiePopups.flatMap(popup => popup.otherButtons.map(button => button.text)).forEach(b => otherButtonTexts.add(b));

                            const siteRules = generateRulesForUnknownPopups(jsonData.finalUrl, cookiePopups);
                            totalRules += siteRules.length;
                            if (siteRules.length > 0) {
                                totalSitesWithNewRules++;
                                console.log(`${fileName}: ${siteRules.length} rules`);
                                await Promise.all(siteRules.map(async (rule, i) => {
                                    const finalRuleName = `${rule.name}_${i}`;
                                    const ruleFilePath = path.join(rulesDir, `${finalRuleName}.json`);
                                    await fs.promises.writeFile(ruleFilePath, JSON.stringify({...rule, name: finalRuleName}, null, 4));
                                    const testFilePath = path.join(testDir, `${finalRuleName}.spec.ts`);
                                    await fs.promises.writeFile(testFilePath, generateTestFile(finalRuleName, [jsonData.finalUrl], [region]));
                                    console.log('  ', ruleFilePath);
                                    console.log('  ', testFilePath);
                                }));
                        
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Error processing file ${fileName}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('Error reading directory:', err.message);
    }
    await fs.promises.writeFile(rejectButtonTextsFile, Array.from(rejectButtonTexts).join('\n'));
    await fs.promises.writeFile(otherButtonTextsFile, Array.from(otherButtonTexts).join('\n'));
    console.log(`Total crawled sites: ${totalFiles}`);
    console.log(`Sites with popups: ${totalSitesWithPopups}`);
    console.log(`Sites with known CMPs: ${totalSitesWithKnownCmps}`);
    console.log(`Total unhandled by Autoconsent: ${totalUnhandled}`);
    console.log(`Generated ${totalRules} rules for ${totalSitesWithNewRules} sites`);
    console.log(`Reject button texts (${rejectButtonTexts.size}) ${rejectButtonTextsFile}`);
    console.log(`Other button texts (${otherButtonTexts.size}) ${otherButtonTextsFile}`);
}

/**
 * Run LLM to detect potential false positives and false negatives in button detection.
 * @param {OpenAI} openai
 */
async function verifyButtonTexts(openai) {
    const FalsePositiveSuggestions = z.object({
        potentiallyIncorrectRejectButtons: z.array(z.string()),
    });
    const FalseNegativeSuggestions = z.object({
        potentiallyMissedRejectButtons: z.array(z.string()),
    });

    const systemPromptFalsePositive = `
    You are a helpful assistant that reviews the results of button text classification.
    Reject buttons are buttons that let users OPT OUT of optional cookie usage, data sharing, and tracking. Reject buttons MAY accept some essential cookies that are required for the site to function.
    You are given a list of button texts found in cookie popups and classified as a "Reject button".
    Your task is to identify any items that have been classified incorrectly and might be NOT a reject button.
    `;

    const systemPromptFalseNegative = `
    You are a helpful assistant that reviews the results of button text classification.
    Reject buttons are buttons that let users OPT OUT of optional cookie usage, data sharing, and tracking. Reject buttons MAY accept some essential cookies that are required for the site to function.
    You are given a list of button texts found in cookie popups and classified as NOT a "Reject button".
    Your task is to identify any items that have been classified incorrectly and might be a reject button.
    `;

    try {
        const completionFalsePositive = await openai.beta.chat.completions.parse({
            model: 'gpt-4.1-nano-2025-04-14',
            messages: [
                { role: 'system', content: systemPromptFalsePositive },
                {
                    role: 'user',
                    content: await fs.promises.readFile(rejectButtonTextsFile, 'utf8'),
                },
            ],
            // eslint-disable-next-line camelcase
            response_format: zodResponseFormat(FalsePositiveSuggestions, 'FalsePositiveSuggestions'),
        });
        const resultFalsePositive = completionFalsePositive.choices[0].message.parsed;
        console.log(resultFalsePositive);
    } catch (error) {
        console.error('Error classifying false positives:', error);
    }

    try {
        const completionFalseNegative = await openai.beta.chat.completions.parse({
            model: 'gpt-4.1-nano-2025-04-14',
            messages: [
                { role: 'system', content: systemPromptFalseNegative },
                {
                    role: 'user',
                    content: await fs.promises.readFile(otherButtonTextsFile, 'utf8'),
                },
            ],
            // eslint-disable-next-line camelcase
            response_format: zodResponseFormat(FalseNegativeSuggestions, 'FalseNegativeSuggestions'),
        });
        const resultFalseNegative = completionFalseNegative.choices[0].message.parsed;
        console.log(resultFalseNegative);
    } catch (error) {
        console.error('Error classifying false negatives:', error);
    }
}

async function main() {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    await processFiles(openai);
    await verifyButtonTexts(openai);
}

main();

/**
 * @typedef {{
 *  data: {
 *      cmps: import('../collectors/CMPCollector').CMPResult[];
 *      cookiepopups: import('../collectors/CookiePopupCollector').CookiePopupData[];
 *  };
 *  finalUrl: string;
 * }} CrawlData
 */

/**
 * @typedef {import('../collectors/CookiePopupCollector').ButtonData} ButtonData
 */

/**
 * @typedef {import('../collectors/CookiePopupCollector').CookiePopupData} CookiePopupData
 */

/**
 * @typedef {import('../node_modules/@duckduckgo/autoconsent/lib/rules').AutoConsentCMPRule} AutoConsentCMPRule
 */

/**
 * @typedef {CookiePopupData & {
 *  llmMatch: boolean;
 *  regexMatch: boolean;
 *  rejectButtons: ButtonData[];
 *  otherButtons: ButtonData[];
 * }} ProcessedCookiePopup
 */
