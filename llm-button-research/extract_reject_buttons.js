const fs = require('fs');
const path = require('path');

const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const crawlDir = process.argv[2] || '/mnt/efs/shared/crawler-data/2025-05-12-cookiebuttons/GB/';
const region = crawlDir.split('/').filter(part => !!part).pop();
const dataDir = path.join(crawlDir, '3p-crawl');
const rulesDir = path.join(crawlDir, 'generated-rules');
const testDir = path.join(crawlDir, 'generated-tests');
const rejectButtonTextsFile = path.join(crawlDir, 'reject-button-texts.txt');
const otherButtonTextsFile = path.join(crawlDir, 'other-button-texts.txt');

function generalizeDomain(domain) {
    return domain.replace(/^www\./, '');
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

async function processFiles() {
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
        await Promise.all(files.map(file => 
            fs.promises.unlink(path.join(rulesDir, file))
        ));
    }

    if (!fs.existsSync(testDir)) {
        await fs.promises.mkdir(testDir, { recursive: true });
    } else {
        const files = await fs.promises.readdir(testDir);
        await Promise.all(files.map(file => 
            fs.promises.unlink(path.join(testDir, file))
        ));
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

                    /** @type {import('../collectors/CookiePopupCollector').CookiePopupData[]} */
                    const cookiePopups = (jsonData.data.cookiepopups || []).filter(popup => popup && popup.llmMatch === true);
                    if (cookiePopups.length > 1) {
                        console.warn('Multiple cookie popups found in', fileName);
                    }
                    if (cookiePopups.length > 0) {
                        totalSitesWithPopups += 1;
                    }

                    if (hasKnownCmp) {
                        totalSitesWithKnownCmps += 1;
                    } else if (cookiePopups.length > 0) {
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

async function verifyButtonTexts() {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    
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
            response_format: zodResponseFormat(FalseNegativeSuggestions, 'FalseNegativeSuggestions'),
        });
        const resultFalseNegative = completionFalseNegative.choices[0].message.parsed;
        console.log(resultFalseNegative);
    } catch (error) {
        console.error('Error classifying false negatives:', error);
    }
}

processFiles();
verifyButtonTexts();
