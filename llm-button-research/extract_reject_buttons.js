const fs = require('fs');
const path = require('path');

const crawlDir = process.argv[2] || '/mnt/efs/shared/crawler-data/2025-05-12-cookiebuttons/GB/';
const region = crawlDir.split('/').filter(part => !!part).pop();
const dataDir = path.join(crawlDir, '3p-crawl');
const outputDir = path.join(crawlDir, 'generated-rules');
const testDir = path.join(crawlDir, 'generated-tests');
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
    let totalRules = 0;

    console.log('Cleaning up output directories...');

    if (!fs.existsSync(outputDir)) {
        await fs.promises.mkdir(outputDir, { recursive: true });
    } else {
        const files = await fs.promises.readdir(outputDir);
        await Promise.all(files.map(file => 
            fs.promises.unlink(path.join(outputDir, file))
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

                    if (!hasKnownCmp) {
                        totalUnhandled++;
                        /** @type {import('../collectors/CookiePopupCollector').CookiePopupData[]} */
                        const cookiePopups = (jsonData.data.cookiepopups || []).filter(popup => popup && popup.llmMatch === true);
                        if (cookiePopups.length > 1) {
                            console.warn('Multiple cookie popups found in', fileName);
                        }
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
                        }
                        if (siteRules.length > 0) {
                            totalSitesWithNewRules++;
                            console.log(`${fileName}: ${siteRules.length} rules`);
                            await Promise.all(siteRules.map(async (rule, i) => {
                                const outputFilePath = path.join(outputDir, `${rule.name}_${i}.json`);
                                await fs.promises.writeFile(outputFilePath, JSON.stringify({...rule, name: `${rule.name}_${i}`}, null, 2));
                                const testFilePath = path.join(testDir, `${rule.name}_${i}.spec.ts`);
                                await fs.promises.writeFile(testFilePath, `import generateCMPTests from "../playwright/runner";

generateCMPTests('${rule.name}_${i}', [ '${jsonData.finalUrl}' ], {testOptIn: false, testSelfTest: false, onlyRegions: ['${region}']});
`);
                                console.log('  ', testFilePath);
                                console.log('  ', outputFilePath);
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
    console.log(`Total files: ${totalFiles}`);
    console.log(`Total unhandled: ${totalUnhandled}`);
    console.log(`Total sites with new rules: ${totalSitesWithNewRules}`);
    console.log(`Total rules: ${totalRules}`);
}

processFiles(); 