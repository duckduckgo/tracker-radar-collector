const fs = require('fs');
const path = require('path');

const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const crawlDir = process.argv[2] || '/mnt/efs/shared/crawler-data/2025-05-12-cookiebuttons/GB/';
const region = crawlDir.split('/').filter(part => Boolean(part)).pop();
const dataDir = path.join(crawlDir, '3p-crawl');
const rulesDir = path.join(crawlDir, 'generated-rules');
const testDir = path.join(crawlDir, 'generated-tests');
const rejectButtonTextsFile = path.join(crawlDir, 'reject-button-texts.txt');
const otherButtonTextsFile = path.join(crawlDir, 'other-button-texts.txt');

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
    return REJECT_PATTERNS.some(p => p.test(buttonText));
}

function generalizeDomain(domain) {
    return domain.replace(/^www\./, '');
}


const CookieConsentNoticeClassification = z.object({
    isCookieConsentNotice: z.boolean(),
});

/**
 * @param {OpenAI} openai
 * @param {string} text
 * @param {boolean} popup
 * @returns {Promise<boolean>}
 */
async function classifyCookieConsentNotice(openai, text, popup = true) {
    let systemPrompt;
    if (popup) {
        systemPrompt = `
          Your task is to classify text from the innerText property of HTML overlay elements.
    
          An overlay element is considered to be a "cookie consent notice" if it meets all of these criteria:
          1. it explicitly notifies the user of the site's use of cookies or other storage technology, such as: "We use cookies...", "This site uses...", etc.
          2. it offers the user choices for the usage of cookies on the site, such as: "Accept", "Reject", "Learn More", etc., or informs the user that their use of the site means they accept the usage of cookies.
    
          Note: This definition does not include adult content notices or any other type of notice that is primarily focused on age verification or content restrictions. Cookie consent notices are specifically intended to inform users about the website's use of cookies and obtain their consent for such use.
    
          Note: A cookie consent notice should specifically relate to the site's use of cookies or other storage technology that stores data on the user's device, such as HTTP cookies, local storage, or session storage. Requests for permission to access geolocation information, camera, microphone, etc., do not fall under this category.
    
          Note: Do NOT classify a website header or footer as a "cookie consent notice". Website headers or footers may contain a list of links, possibly including a privacy policy, cookie policy, or terms of service document, but their primary purpose is navigational rather than informational.
      `;
    } else {
        systemPrompt = `
          Your task is to inspect the innerText property of an HTML document and determine if a cookie consent notice is present.
          
          A cookie consent notice:
          1. explicitly notifies the user of the site's use of cookies or other storage technology, such as: "We use cookies...", "This site uses...", etc.
          2. offers the user choices for the usage of cookies on the site, such as: "Accept", "Reject", "Learn More", etc., or informs the user that their use of the site means they accept the usage of cookies.
    
          Note: This definition does not include adult content notices or any other type of notice that is primarily focused on age verification or content restrictions. Cookie consent notices are specifically intended to inform users about the website's use of cookies and obtain their consent for such use.
    
          Note: A cookie consent notice should specifically relate to the site's use of cookies or other storage technology that stores data on the user's device, such as HTTP cookies, local storage, or session storage. Requests for permission to access geolocation information, camera, microphone, etc., do not fall under this category.
      `;
    }

    // const MAX_LENGTH = 500;
    // let snippet = text.slice(0, MAX_LENGTH);
    // let ifTruncated = '';
    // if (snippet.length !== text.length) {
    //     snippet += '...';
    //     ifTruncated = `the first ${MAX_LENGTH} characters of `;
    // }

    try {
        const completion = await openai.beta.chat.completions.parse({
            // model: 'gpt-4o-mini-2024-07-18',
            model: 'gpt-4.1-nano-2025-04-14',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    // content: `The following text was captured from ${ifTruncated}the innerText of an HTML overlay element:\n\n${snippet}`,
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
 * @param {import('../crawler').CollectResult} crawlData - The crawl data object.
 * @param {import('../collectors/CookiePopupCollector').CookiePopupData} popup - The popup object.
 * @param {import('../collectors/CookiePopupCollector').ButtonData} button - The reject button object.
 * @returns {Object} The autoconsent rule.
 */
function generateAutoconsentRule(crawlData, popup, button) {
    // TODO: merge subdomain rules with matching selectors
    const frameDomain = generalizeDomain(new URL(popup.origin).hostname);
    const topDomain = generalizeDomain(new URL(crawlData.finalUrl).hostname);
    const urlPattern = `^https?://(www\\.)?${frameDomain.replace(/\./g, '\\.')}/`;
    const ruleName = `auto_${region}_${topDomain}`;
    return {
        name: ruleName,
        vendorUrl: crawlData.finalUrl,
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
        optOut: [{ waitForThenClick: button.selector, text: button.text }],
    };
}

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
        const dir = await fs.promises.opendir(dataDir);
        for await (const dirent of dir) {
            if (dirent.isFile() && path.extname(dirent.name).toLowerCase() === '.json') {
                totalFiles++;
                const fileName = dirent.name;
                const filePath = path.join(dataDir, fileName);
                try {
                    const fileContent = await fs.promises.readFile(filePath, 'utf8');
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
                        const processedCookiePopups = await Promise.all((jsonData.data.cookiepopups || []).map(async popup => {
                            const popupText = popup.text?.trim();
                            if (!popupText) {
                                return false;
                            }
                            const regexMatch = checkHeuristicPatterns(popupText);
                            const llmMatch = await classifyCookieConsentNotice(openai, popupText, true);
                            const rejectButtons = [];
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
                        }));

                        const cookiePopups = processedCookiePopups.filter(popup => popup && popup.llmMatch);
                        if (cookiePopups.length > 1) {
                            console.warn('Multiple cookie popups found in', fileName);
                        }

                        if (cookiePopups.length > 0) {
                            totalSitesWithPopups += 1;
                            totalUnhandled++;

                            const siteRules = [];
                            for (let i = 0; i < cookiePopups.length; i++) {
                                const popup = cookiePopups[i];


                                if (popup.rejectButtons.length > 1) {
                                    console.warn(`Multiple reject buttons found for popup ${i} in ${fileName}`);
                                }
                                if (popup.rejectButtons.length > 0) {
                                    const rules = popup.rejectButtons.map(button => generateAutoconsentRule(jsonData, popup, button));
                                    // console.log(`${fileName} - popup ${i} - ${rules.length} rules`);
                                    siteRules.push(...rules);
                                    totalRules += rules.length;
                                }
                                rejectButtonTexts.add(...popup.rejectButtons.map(button => button.text));
                                otherButtonTexts.add(...popup.otherButtons.map(button => button.text));
                            }
                            if (siteRules.length > 0) {
                                totalSitesWithNewRules++;
                                console.log(`${fileName}: ${siteRules.length} rules`);
                                await Promise.all(siteRules.map(async (rule, i) => {
                                    const ruleFilePath = path.join(rulesDir, `${rule.name}_${i}.json`);
                                    await fs.promises.writeFile(ruleFilePath, JSON.stringify({...rule, name: `${rule.name}_${i}`}, null, 2));
                                    const testFilePath = path.join(testDir, `${rule.name}_${i}.spec.ts`);
                                    await fs.promises.writeFile(testFilePath, `import generateCMPTests from "../playwright/runner";

    generateCMPTests('${rule.name}_${i}', [ '${jsonData.finalUrl}' ], {testOptIn: false, testSelfTest: false, onlyRegions: ['${region}']});
    `);
                                    console.log('  ', testFilePath);
                                    console.log('  ', ruleFilePath);
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

async function verifyButtonTexts(openai) {
    const FalsePositiveSuggestions = z.object({
        potentiallyIncorrectRejectButtons: z.array(z.string()),
    });
    const FalseNegativeSuggestions = z.object({
        potentiallyMissedRejectButtons: z.array(z.string()),
    });

    const systemPromptFalsePositive = `
    You are a helpful assistant that reviews a list of button texts found in cookie popups and classified as a "reject button".
    This means that clicking on those buttons will opt out of optional cookies. Reject buttons MAY accept some essential cookies that are required for the site to function.
    Your task is to identify any items that might not be a reject button.
    `;

    const systemPromptFalseNegative = `
    You are a helpful assistant that reviews a list of button texts found in cookie popups and classified as NOT a "reject button".
    This means that clicking on those buttons will NOT opt out of optional cookies. Reject buttons MAY accept some essential cookies that are required for the site to function.
    Your task is to identify any items that might be a reject button.
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
 * @typedef {import('../collectors/CookiePopupCollector').CookiePopupData & {
 *  llmMatch: boolean;
 *  regexMatch: boolean;
 *  rejectButtons: ButtonData[];
 *  otherButtons: ButtonData[];
 * }} ProcessedCookiePopup
 */