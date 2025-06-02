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
const autoconsentManifestFile = path.join(crawlDir, '..', 'autoconsent-manifest.json');

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
 * Run popup through LLM and regex to determine if it's a cookie popup and identify reject buttons.
 * @param {import('../collectors/CookiePopupCollector').CookiePopupData} popup
 * @param {OpenAI} openai
 * @returns {Promise<ProcessedCookiePopup | null>}
 */
async function applyDetectionHeuristics(popup, openai) {
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
 * Find existing rules that match a given URL/domain.
 * @param {string} url - The URL to match against.
 * @param {AutoConsentCMPRule[]} existingRules - Array of existing rules.
 * @returns {AutoConsentCMPRule[]} Array of matching existing rules.
 */
function findMatchingExistingRules(url, existingRules) {
    return existingRules.filter(rule => {
        if (rule.runContext && rule.runContext.urlPattern) {
            try {
                const pattern = new RegExp(rule.runContext.urlPattern);
                return pattern.test(url);
            } catch {
                // Invalid regex, skip
                return false;
            }
        }
        return false;
    });
}

/**
 * Compare if the same reject button is used in an existing rule.
 * @param {ButtonData} newButton - The new button.
 * @param {AutoConsentCMPRule} existingRule - The existing rule.
 * @returns {boolean} True if buttons are the same.
 */
function isSameRejectButton(newButton, existingRule) {
    if (!existingRule.optOut || existingRule.optOut.length === 0) {
        return false;
    }
    
    const existingOptOut = existingRule.optOut[0];
    
    // Compare selector
    if (existingOptOut.waitForThenClick !== newButton.selector) {
        return false;
    }

    return true;
}

/**
 * Parse rule name components.
 * @param {string} ruleName - The rule name (e.g., "auto_GB_example_com_0").
 * @returns {{region: string|null, domain: string|null, ruleIndex: number|null}} The parsed components.
 */
function parseRuleName(ruleName) {
    const match = ruleName.match(/^auto_([A-Z]{2})_(.+?)_(\d+)$/);
    if (match) {
        return {
            region: match[1],
            domain: match[2],
            ruleIndex: parseInt(match[3], 10)
        };
    }
    return {
        region: null,
        domain: null,
        ruleIndex: null
    };
}

/**
 * Analyze existing rules and generate new rules when necessary.
 * @param {string} url - The URL being processed.
 * @param {ProcessedCookiePopup[]} cookiePopups - The detected cookie popups.
 * @param {AutoConsentCMPRule[]} matchingRules - Array of existing rules.
 * @returns {{newRules: AutoConsentCMPRule[], rulesToOverride: AutoConsentCMPRule[], reviewNotes: ReviewNote[], keptCount: number}}
 */
function generateRulesForSite(url, cookiePopups, matchingRules) {
    const newRules = [];
    const rulesToOverride = [];
    const reviewNotes = [];
    let keptCount = 0;

    if (cookiePopups.length > 1 || cookiePopups[0].rejectButtons.length > 1) {
        console.warn('Multiple cookie popups or reject buttons found in', url);
        reviewNotes.push({
            note: 'Multiple popups or reject buttons found',
            url,
            region,
        });
    }

    for (const popup of cookiePopups) {
        for (const button of popup.rejectButtons) {
            // most of the time, we'll have a single popup with a single reject button


            if (matchingRules.some(rule => isSameRejectButton(button, rule))) {
                // if there is an existing rule with the same reject button, do nothing
                keptCount++;
            } else {
                const newRule = generateAutoconsentRule(url, popup, button);
                if (matchingRules.length === 0) {
                    // add the first rule for this site
                    newRules.push(newRule);
                    reviewNotes.push({
                        note: 'New rule added',
                        ruleName: newRule.name,
                    });
                } else {
                    // there were some existing rules for this site, but all of them use different selectors
                    // this can happen for several reasons: site uses different popups in different regions, or the popup has changed since last crawl
                    const existingRuleWithSameRegion = matchingRules.find(rule => parseRuleName(rule.name).region === region);
                    if (existingRuleWithSameRegion) {
                        // if there is an existing rule with the same region, override it
                        rulesToOverride.push({
                            ...newRule,
                            name: existingRuleWithSameRegion.name, // keep the existing rule name
                        });
                        reviewNotes.push({
                            note: 'Overriding existing rule',
                            ruleName: existingRuleWithSameRegion.name,
                            region,
                        });
                    } else {
                        // assume it's a new region-specific popup, but flag it for review
                        newRules.push(newRule);
                        reviewNotes.push({
                            note: 'New region-specific popup',
                            ruleName: newRule.name,
                            existingRules: matchingRules.map(rule => rule.name),
                            region,
                        });
                    }
                }
            }
        }
    }

    if (newRules.length > 1) {
        reviewNotes.push({
            note: 'Multiple new rules generated',
            ruleNames: newRules.map(rule => rule.name),
        });
    }
    return { newRules, rulesToOverride, reviewNotes, keptCount };
}

/**
 * Determine if a site should be processed for cookie popup rules based on existing CMP detection.
 * @param {import('../collectors/CMPCollector').CMPResult[]} cmps - The detected CMPs.
 * @returns {boolean} True if the site should be processed (no known CMPs found).
 */
function hasKnownCmp(cmps) {
    return (
        cmps &&
        Array.isArray(cmps) &&
        cmps.length > 0 &&
        cmps.some(cmp => cmp && cmp.name && cmp.name.trim() !== '' && !cmp.name.trim().startsWith('auto_')) // we may override existing autogenerated rules
    );
}

/**
 * Read all existing rules from the rules directory. Note that this will ALSO read rules that were generated by this script for other regions.
 * @returns {Promise<AutoConsentCMPRule[]>}
 */
async function readExistingRules() {
    const files = await fs.promises.readdir(rulesDir);
    /** @type {AutoConsentCMPRule[]} */
    const result = [];
    await Promise.all(files.map(async file => {
        try {
            const filePath = path.join(rulesDir, file);
            const content = await fs.promises.readFile(filePath, 'utf8');
            const rule = JSON.parse(content);
            result.push(rule);
        } catch (err) {
            console.warn(`Failed to parse rule file ${file}:`, err);
        }
    }));
    return result;
}

/**
 * @param {AutoConsentCMPRule} rule
 * @param {string} url
 * @returns {Promise<AutoconsentManifestFileData>}
 */
async function writeRuleFiles(rule, url) {
    const ruleFilePath = path.join(rulesDir, `${rule.name}.json`);
    const relativeRuleFilePath = path.relative(autoconsentDir, ruleFilePath);
    await fs.promises.writeFile(ruleFilePath, JSON.stringify(rule, null, 4));
    const testFilePath = path.join(testDir, `${rule.name}.spec.ts`);
    const relativeTestFilePath = path.relative(autoconsentDir, testFilePath);
    await fs.promises.writeFile(testFilePath, generateTestFile(rule.name, [url], [region]));
    return {
        ruleName: rule.name,
        rulePath: relativeRuleFilePath,
        testPath: relativeTestFilePath,
    };
}

/**
 * Process cookie popups for a single site and generate/update rules.
 * @param {{
 *  finalUrl: string, // URL of the site
 *  cookiePopupsData: import('../collectors/CookiePopupCollector').CookiePopupData[], // raw cookie popup data
 *  openai: OpenAI, // OpenAI client
 *  existingRules: AutoConsentCMPRule[], // existing Autoconsent rules
 * }} params
 * @returns {Promise<{
 * processedCookiePopups: ProcessedCookiePopup[], 
 * newRuleFiles: AutoconsentManifestFileData[],
 * updatedRuleFiles: AutoconsentManifestFileData[], 
 * keptCount: number, 
 * reviewNotes: ReviewNote[]
 * }>}
 */
async function processCookiePopupsForSite({finalUrl, cookiePopupsData, openai, existingRules}) {
    // filter out popups that are not confirmed by LLM
    /** @type {ProcessedCookiePopup[]} */
    const processedCookiePopups = (
        await Promise.all(cookiePopupsData.map(popup => applyDetectionHeuristics(popup, openai)))
    ).filter(p => p && p.llmMatch);

    /** @type {AutoconsentManifestFileData[]} */
    const newRuleFiles = [];
    /** @type {AutoconsentManifestFileData[]} */
    const updatedRuleFiles = [];

    if (processedCookiePopups.length === 0) {
        return { processedCookiePopups, newRuleFiles, updatedRuleFiles, keptCount: 0, reviewNotes: [] };
    }

    const matchingRules = findMatchingExistingRules(finalUrl, existingRules);
    const { newRules, rulesToOverride, reviewNotes, keptCount } = generateRulesForSite(finalUrl, processedCookiePopups, matchingRules);

    // Log review notes
    reviewNotes.forEach(note => {
        console.log(`${finalUrl}: ${note.note} ${JSON.stringify(note)}`);
    });

    await Promise.all(rulesToOverride.map(async rule => {
        console.log(`${finalUrl}: overriding rule ${rule.name}`);
        updatedRuleFiles.push(await writeRuleFiles(rule, finalUrl));
    }));

    // Prepare new rules with their final names before writing in parallel
    newRules.forEach((rule, index) => {
        const finalRuleName = `${rule.name}_${matchingRules.length + index}`;
        rule.name = finalRuleName;
    });

    await Promise.all(newRules.map(async ruleToWrite => {
        console.log(`${finalUrl}: new rule ${ruleToWrite.name}`);
        newRuleFiles.push(await writeRuleFiles(ruleToWrite, finalUrl));
    }));

    return {
        processedCookiePopups,
        newRuleFiles,
        updatedRuleFiles,
        keptCount,
        reviewNotes,
    };
}

/**
 * Process all crawl data files in the crawl directory.
 * @param {OpenAI} openai
 * @param {AutoConsentCMPRule[]} existingRules
 * @returns {Promise<void>}
 */
async function processFiles(openai, existingRules) {
    let totalFiles = 0;
    let totalUnhandled = 0;
    let totalSitesWithNewRules = 0;
    let totalSitesWithPopups = 0;
    let totalSitesWithKnownCmps = 0;
    let totalRules = 0;
    let totalKeptRules = 0;
    let totalOverriddenRules = 0;
    let totalSitesWithKeptRules = 0;
    let totalSitesWithOverriddenRules = 0;
    
    /** @type {Map<string, AutoconsentSiteManifest>} */
    const autoconsentManifest = new Map();
    const rejectButtonTexts = new Set();
    const otherButtonTexts = new Set();

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

                    if (jsonData.data.cookiepopups && jsonData.data.cookiepopups.length > 0) {
                        totalSitesWithPopups++;
                    }

                    if (hasKnownCmp(jsonData.data.cmps)) {
                        totalSitesWithKnownCmps++;
                    } else {
                        totalUnhandled++;
                        const { processedCookiePopups, newRuleFiles, updatedRuleFiles, keptCount, reviewNotes } = await processCookiePopupsForSite({
                            finalUrl: jsonData.finalUrl,
                            cookiePopupsData: jsonData.data.cookiepopups || [],
                            openai,
                            existingRules,
                        });
                        // Collect button texts for analysis
                        processedCookiePopups.flatMap(popup => popup.rejectButtons.map(button => button.text)).forEach(b => rejectButtonTexts.add(b));
                        processedCookiePopups.flatMap(popup => popup.otherButtons.map(button => button.text)).forEach(b => otherButtonTexts.add(b));
                        
                        if (newRuleFiles.length > 0 || updatedRuleFiles.length > 0 || reviewNotes.length > 0) {
                            autoconsentManifest.set(fileName, {
                                siteUrl: jsonData.finalUrl,
                                newlyCreatedRules: newRuleFiles,
                                updatedRules: updatedRuleFiles,
                                reviewNotes
                            });
                        }

                        if (newRuleFiles.length > 0 || keptCount > 0 || updatedRuleFiles.length > 0) {
                            if (newRuleFiles.length > 0) {
                                totalRules += newRuleFiles.length;
                                totalSitesWithNewRules++;
                            }
                            if (keptCount > 0) {
                                totalKeptRules += keptCount;
                                totalSitesWithKeptRules++;
                            }
                            if (updatedRuleFiles.length > 0) {
                                totalOverriddenRules += updatedRuleFiles.length;
                                totalSitesWithOverriddenRules++;
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

    await fs.promises.writeFile(autoconsentManifestFile, JSON.stringify(Object.fromEntries(autoconsentManifest), null, 4));

    console.log(`Total crawled sites: ${totalFiles}`);
    console.log(`Sites with popups: ${totalSitesWithPopups}`);
    console.log(`Sites with known CMPs: ${totalSitesWithKnownCmps}`);
    console.log(`Total unhandled by Autoconsent: ${totalUnhandled}`);
    console.log(`Generated ${totalRules} new rules for ${totalSitesWithNewRules} sites`);
    console.log(`Kept ${totalKeptRules} rules for ${totalSitesWithKeptRules} sites`);
    console.log(`Updated ${totalOverriddenRules} rules for ${totalSitesWithOverriddenRules} sites`);
    console.log(`Reject button texts (${rejectButtonTexts.size}) saved in ${rejectButtonTextsFile}`);
    console.log(`Other button texts (${otherButtonTexts.size}) saved in ${otherButtonTextsFile}`);
    console.log(`Actions manifest for ${autoconsentManifest.size} sites saved in ${autoconsentManifestFile}`);
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
    if (!fs.existsSync(testDir)) {
        await fs.promises.mkdir(testDir, { recursive: true });
    }
    if (!fs.existsSync(rulesDir)) {
        await fs.promises.mkdir(rulesDir, { recursive: true });
    }

    const existingRules = await readExistingRules();
    console.log(`Found ${existingRules.length} existing generated rules`);
    await processFiles(openai, existingRules);
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

/**
 * @typedef {{
 *  note: string;
 *  region?: string;
 *  ruleName?: string;
 *  ruleNames?: string[];
 * }} ReviewNote
 */

/**
 * @typedef {{
 *  ruleName: string;
 *  rulePath: string;
 *  testPath: string;
 * }} AutoconsentManifestFileData
 */

/**
 * @typedef {{
 *  siteUrl: string;
 *  newlyCreatedRules: AutoconsentManifestFileData[];
 *  updatedRules: AutoconsentManifestFileData[];
 *  reviewNotes: ReviewNote[];
 * }} AutoconsentSiteManifest
 */
