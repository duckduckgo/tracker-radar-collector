#!/usr/bin/env node

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { program } = require('commander');
const { OpenAI } = require('openai');
const { z } = require('zod');
const { zodResponseFormat } = require('openai/helpers/zod');
const asyncLib = require('async');
const { isSettingsButton, cleanButtonText } = require('../post-processing/generate-autoconsent-rules/detection.js');

/**
 * Check if a button text is a settings/preferences button using LLM
 * @param {import('openai').OpenAI} openai
 * @param {string} buttonText
 * @returns {Promise<boolean>}
 */
async function checkSettingsButtonLLM(openai, buttonText) {
    const systemPrompt = `
You are an expert in web application user interfaces and cookie consent dialogs. You are given a text from a button found in a cookie popup. Your task is to determine whether this button is a "settings" or "preferences" button that would allow users to customize their cookie/privacy preferences.

A settings/preferences button typically:
- Allows users to manage or customize their cookie/privacy settings
- Opens a dialog where users can choose which types of cookies to accept/reject
- Provides access to more detailed consent options
- May be labeled with words like: "settings", "preferences", "customize", "manage", "options", "choices", "configure", etc.

Examples of settings button text:
- "Cookie Settings"
- "Manage Preferences"
- "Customize Cookies"
- "Show Purposes"
- "More Options"
- "Settings"
- "Preferences"
- "Manage Cookies"
- "Change Settings"

Examples of NON-settings button text:
- "Accept All"
- "Reject All"
- "I Agree"
- "Continue"
- "Close"
- "Learn More"
- "Privacy Policy"
- "Save"
- "Submit"

Note: Focus on whether the button opens settings/preferences, not whether it saves or applies them.
`;

    const SettingsButtonClassification = z.object({
        isSettingsButton: z.boolean(),
    });

    try {
        const completion = await openai.beta.chat.completions.parse({
            // model: 'gpt-5-nano-2025-08-07',
            model: 'gpt-4.1-nano-2025-04-14',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content: buttonText,
                },
            ],
            response_format: zodResponseFormat(SettingsButtonClassification, 'SettingsButtonClassification'),
        });

        const result = completion.choices[0].message.parsed;
        return result?.isSettingsButton ?? false;
    } catch (error) {
        console.error(`Error classifying button text "${buttonText}":`, error.message);
    }

    return false;
}

/**
 * Analyze cookie popups to find settings button opportunities
 */
class SettingsButtonAnalyzer {
    constructor(openai = null, concurrencyLimit = 10) {
        this.openai = openai;
        this.concurrencyLimit = concurrencyLimit;
        this.stats = {
            totalSites: 0,
            sitesWithLlmMatchNoReject: 0,
            sitesWithSettingsButton: 0,
            sitesWithSettingsButtonAndNoCmp: 0,
            sitesWithSettingsButtonAndCmp: 0,
            sitesWithoutAnyRejectButton: 0,
            sitesWithLlmMatch: 0,
            settingsButtonTexts: new Map(),
            cmpNamesFound: new Map(),
            potentialFalseNegatives: new Map(), // buttons that LLM thinks are settings but regex didn't match
            llmChecksPerformed: 0, // total number of LLM API calls made
            llmCacheHits: 0, // number of times we used cached results
        };
        this.detailedResults = [];
        this.llmCache = new Map(); // Cache for LLM results: cleanedText -> boolean
    }

    /**
     * Check if a site has any popup with llmMatch=true and non-empty rejectButtons
     * @param {object} data - Crawl data
     * @returns {boolean}
     */
    hasAnyRejectButton(data) {
        if (!data.data?.cookiepopups?.scrapedFrames) {
            return false;
        }

        for (const frame of data.data.cookiepopups.scrapedFrames) {
            if (!frame.potentialPopups) {
                continue;
            }

            for (const popup of frame.potentialPopups) {
                if (popup.llmMatch === true && popup.rejectButtons && popup.rejectButtons.length > 0) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Get CMP name from crawl data
     * @param {object} data - Crawl data
     * @returns {string|null}
     */
    getCmpName(data) {
        if (!data.data?.cookiepopups?.cmps) {
            return null;
        }

        // Look for a CMP with a non-empty name
        for (const cmp of data.data.cookiepopups.cmps) {
            if (cmp.name && cmp.name.trim() !== '') {
                return cmp.name;
            }
        }

        return null;
    }

    /**
     * Check multiple buttons with LLM in parallel
     * @param {Array<{originalText: string, cleanedText: string}>} buttons - Buttons to check
     * @returns {Promise<void>}
     */
    async checkButtonsWithLLMParallel(buttons) {
        // Deduplicate by cleaned text to avoid checking the same text multiple times
        const uniqueButtons = Array.from(
            new Map(buttons.map(b => [b.cleanedText, b])).values()
        );

        console.log(`Checking ${uniqueButtons.length} unique button texts with LLM (${this.concurrencyLimit} concurrent)...`);

        await asyncLib.mapLimit(
            uniqueButtons,
            this.concurrencyLimit,
            async (button) => {
                this.stats.llmChecksPerformed++;
                const matchedByLLM = await checkSettingsButtonLLM(this.openai, button.originalText);

                // Cache the result
                this.llmCache.set(button.cleanedText, matchedByLLM);

                // Update stats if it's a potential false negative
                if (matchedByLLM) {
                    // Count how many times this cleaned text appears in the original buttons array
                    const occurrences = buttons.filter(b => b.cleanedText === button.cleanedText).length;
                    this.stats.potentialFalseNegatives.set(
                        button.cleanedText,
                        (this.stats.potentialFalseNegatives.get(button.cleanedText) || 0) + occurrences
                    );
                }
            }
        );
    }

    /**
     * Process a JSON file and analyze for settings button opportunities
     * @param {string} filePath - Path to JSON file
     * @returns {Promise<void>}
     */
    async processJsonFile(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(content);

            this.stats.totalSites++;

            if (!data.data?.cookiepopups?.scrapedFrames) {
                return;
            }

            const cmpName = this.getCmpName(data);
            const hasAnyReject = this.hasAnyRejectButton(data);
            const siteUrl = data.finalUrl || data.initialUrl || path.basename(filePath, '.json');

            let siteHasLlmMatchNoReject = false;
            let siteHasSettingsButton = false;
            let siteHasLlmMatch = false;
            const settingsButtonsFound = [];
            const buttonsToCheckWithLLM = []; // Collect buttons that need LLM checking

            // Iterate through scraped frames
            for (const frame of data.data.cookiepopups.scrapedFrames) {
                if (!frame.potentialPopups) {
                    continue;
                }

                // Look for potential popups with llmMatch: true and no reject buttons
                for (const popup of frame.potentialPopups) {
                    if (popup.llmMatch === true) {
                        siteHasLlmMatch = true;

                        if (!popup.rejectButtons || popup.rejectButtons.length === 0) {
                            siteHasLlmMatchNoReject = true;

                            // Look for settings buttons in otherButtons
                            if (popup.otherButtons) {
                                let foundByRegex = false;
                                for (const button of popup.otherButtons) {
                                    if (button.text) {
                                        const matchedByRegex = isSettingsButton(button.text);

                                        if (matchedByRegex) {
                                            foundByRegex = true;
                                            siteHasSettingsButton = true;
                                            settingsButtonsFound.push({
                                                text: button.text,
                                                selector: button.selector
                                            });

                                            // Track frequency of settings button texts
                                            const text = cleanButtonText(button.text);
                                            this.stats.settingsButtonTexts.set(
                                                text,
                                                (this.stats.settingsButtonTexts.get(text) || 0) + 1
                                            );
                                        }
                                    }
                                }

                                // Collect buttons for LLM checking if no regex match found
                                if (this.openai && !foundByRegex) {
                                    for (const button of popup.otherButtons) {
                                        if (button.text) {
                                            const text = cleanButtonText(button.text);

                                            // Check cache first
                                            if (this.llmCache.has(text)) {
                                                this.stats.llmCacheHits++;
                                                const matchedByLLM = this.llmCache.get(text);
                                                if (matchedByLLM) {
                                                    this.stats.potentialFalseNegatives.set(
                                                        text,
                                                        (this.stats.potentialFalseNegatives.get(text) || 0) + 1
                                                    );
                                                }
                                            } else {
                                                // Add to list for parallel checking
                                                buttonsToCheckWithLLM.push({
                                                    originalText: button.text,
                                                    cleanedText: text
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Check all collected buttons with LLM in parallel
            if (buttonsToCheckWithLLM.length > 0) {
                await this.checkButtonsWithLLMParallel(buttonsToCheckWithLLM);
            }

            // Update site-level stats
            if (siteHasLlmMatch) {
                this.stats.sitesWithLlmMatch++;
            }

            if (siteHasLlmMatchNoReject) {
                this.stats.sitesWithLlmMatchNoReject++;

                if (siteHasSettingsButton) {
                    this.stats.sitesWithSettingsButton++;

                    // Track CMP coverage specifically for sites with settings button
                    if (!cmpName) {
                        this.stats.sitesWithSettingsButtonAndNoCmp++;
                    } else {
                        this.stats.sitesWithSettingsButtonAndCmp++;
                        this.stats.cmpNamesFound.set(cmpName, (this.stats.cmpNamesFound.get(cmpName) || 0) + 1);
                    }
                }

                if (!hasAnyReject) {
                    this.stats.sitesWithoutAnyRejectButton++;
                }

                // Store detailed result for sites we care about
                if (siteHasSettingsButton) {
                    this.detailedResults.push({
                        url: siteUrl,
                        cmpName: cmpName || '(none)',
                        hasAnyReject: hasAnyReject,
                        settingsButtons: settingsButtonsFound
                    });
                }
            }

        } catch (error) {
            const fileName = path.basename(filePath);
            if (error instanceof SyntaxError) {
                console.warn(`Warning: Skipping file ${fileName} due to JSON parsing error`);
            } else if (error.code === 'ENOENT') {
                console.warn(`Warning: File not found: ${fileName}`);
            } else {
                console.error(`Error processing file ${fileName}:`, error.message);
            }
        }
    }

    /**
     * Process all JSON files in a directory
     * @param {string} directory - Directory path
     * @returns {Promise<void>}
     */
    async processDirectory(directory) {
        console.log(`Processing JSON files in: ${directory}\n`);

        let processedCount = 0;
        let dir;

        try {
            dir = await fs.opendir(directory);

            for await (const dirent of dir) {
                if (dirent.isFile() && dirent.name.endsWith('.json')) {
                    const filePath = path.join(directory, dirent.name);
                    await this.processJsonFile(filePath);
                    processedCount++;

                    // Progress reporting for large datasets
                    if (processedCount % 500 === 0) {
                        if (this.openai) {
                            console.log(`Processed ${processedCount} files... (${this.stats.llmChecksPerformed} API calls, ${this.stats.llmCacheHits} cache hits)`);
                        } else {
                            console.log(`Processed ${processedCount} files...`);
                        }
                    }
                }
            }

            console.log(`\nCompleted processing ${processedCount} files total.`);
            if (this.openai) {
                console.log(`LLM API calls made: ${this.stats.llmChecksPerformed}`);
                console.log(`Cache hits: ${this.stats.llmCacheHits}`);
                console.log(`Total checks (API + cache): ${this.stats.llmChecksPerformed + this.stats.llmCacheHits}`);
                const cacheHitRate = this.stats.llmCacheHits + this.stats.llmChecksPerformed > 0
                    ? ((this.stats.llmCacheHits / (this.stats.llmCacheHits + this.stats.llmChecksPerformed)) * 100).toFixed(1)
                    : 0;
                console.log(`Cache hit rate: ${cacheHitRate}%\n`);
            } else {
                console.log();
            }

        } catch (error) {
            console.error(`Error reading directory ${directory}:`, error.message);
        }
    }

    /**
     * Output the collected statistics
     */
    outputResults() {
        console.log('='.repeat(70));
        console.log('STATISTICS: Settings Button Opportunities');
        console.log('='.repeat(70));
        console.log();

        console.log('OVERALL STATS:');
        console.log(`  Total sites processed: ${this.stats.totalSites}`);
        console.log();

        console.log('SITES WITH llmMatch=true AND NO REJECT BUTTONS:');
        console.log(`  Sites with llmMatch=true and empty rejectButtons: ${this.stats.sitesWithLlmMatchNoReject}`);
        console.log(`  Percentage of total: ${((this.stats.sitesWithLlmMatchNoReject / this.stats.totalSites) * 100).toFixed(2)}%`);
        console.log();

        console.log('SETTINGS BUTTON COVERAGE:');
        console.log(`  Sites with settings button found: ${this.stats.sitesWithSettingsButton}`);
        console.log(`  Percentage of llmMatch-no-reject sites: ${this.stats.sitesWithLlmMatchNoReject > 0 ? ((this.stats.sitesWithSettingsButton / this.stats.sitesWithLlmMatchNoReject) * 100).toFixed(2) : 0}%`);
        console.log();

        console.log('CMP RULE COVERAGE (for sites with settings button):');
        console.log(`  Sites with settings button WITHOUT existing CMP rule: ${this.stats.sitesWithSettingsButtonAndNoCmp}`);
        console.log(`  Sites with settings button WITH existing CMP rule: ${this.stats.sitesWithSettingsButtonAndCmp}`);
        console.log(`  Percentage without CMP rule: ${this.stats.sitesWithSettingsButton > 0 ? ((this.stats.sitesWithSettingsButtonAndNoCmp / this.stats.sitesWithSettingsButton) * 100).toFixed(2) : 0}%`);
        console.log();

        console.log('REJECT BUTTON AVAILABILITY (for llmMatch-no-reject sites):');
        console.log(`  Sites with NO reject button anywhere: ${this.stats.sitesWithoutAnyRejectButton}`);
        console.log(`  Percentage without any reject: ${this.stats.sitesWithLlmMatchNoReject > 0 ? ((this.stats.sitesWithoutAnyRejectButton / this.stats.sitesWithLlmMatchNoReject) * 100).toFixed(2) : 0}%`);
        console.log();

        // CMP names breakdown
        if (this.stats.cmpNamesFound.size > 0) {
            console.log('CMP NAMES FOUND (for sites with settings button and CMP):');
            const sortedCmps = Array.from(this.stats.cmpNamesFound.entries())
                .sort((a, b) => b[1] - a[1]);
            for (const [name, count] of sortedCmps) {
                console.log(`  ${count.toString().padStart(4)} | ${name}`);
            }
            console.log();
        }

        // Settings button texts
        if (this.stats.settingsButtonTexts.size > 0) {
            console.log('MOST COMMON SETTINGS BUTTON TEXTS (Top 20):');
            const sortedTexts = Array.from(this.stats.settingsButtonTexts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20);
            for (const [text, count] of sortedTexts) {
                console.log(`  ${count.toString().padStart(4)} | ${text}`);
            }
            if (this.stats.settingsButtonTexts.size > 20) {
                console.log(`  ... and ${this.stats.settingsButtonTexts.size - 20} more`);
            }
            console.log();
        }

        // Potential false negatives
        if (this.stats.potentialFalseNegatives.size > 0) {
            console.log('POTENTIAL FALSE NEGATIVES (LLM matched, regex didn\'t):');
            console.log(`  Total unique button texts: ${this.stats.potentialFalseNegatives.size}`);
            const sortedFN = Array.from(this.stats.potentialFalseNegatives.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20);
            for (const [text, count] of sortedFN) {
                console.log(`  ${count.toString().padStart(4)} | ${text}`);
            }
            if (this.stats.potentialFalseNegatives.size > 20) {
                console.log(`  ... and ${this.stats.potentialFalseNegatives.size - 20} more (see output file)`);
            }
            console.log();
        }

        // LLM cache statistics
        if (this.openai) {
            console.log('LLM CACHE STATISTICS:');
            console.log(`  Concurrency limit: ${this.concurrencyLimit}`);
            console.log(`  API calls made: ${this.stats.llmChecksPerformed}`);
            console.log(`  Cache hits: ${this.stats.llmCacheHits}`);
            console.log(`  Total checks: ${this.stats.llmChecksPerformed + this.stats.llmCacheHits}`);
            const cacheHitRate = this.stats.llmCacheHits + this.stats.llmChecksPerformed > 0
                ? ((this.stats.llmCacheHits / (this.stats.llmCacheHits + this.stats.llmChecksPerformed)) * 100).toFixed(1)
                : 0;
            console.log(`  Cache hit rate: ${cacheHitRate}%`);
            console.log();
        }

        console.log('='.repeat(70));
    }

    /**
     * Save detailed results to a file
     * @param {string} outputPath - Output file path
     * @returns {Promise<void>}
     */
    async saveResults(outputPath) {
        const output = [
            'Settings Button Analysis Results',
            `Generated: ${new Date().toISOString()}`,
            '',
            '='.repeat(70),
            'STATISTICS',
            '='.repeat(70),
            '',
            'OVERALL:',
            `  Total sites processed: ${this.stats.totalSites}`,
            '',
            'SITES WITH llmMatch=true AND NO REJECT BUTTONS:',
            `  Sites with llmMatch=true and empty rejectButtons: ${this.stats.sitesWithLlmMatchNoReject}`,
            `  Percentage of total: ${((this.stats.sitesWithLlmMatchNoReject / this.stats.totalSites) * 100).toFixed(2)}%`,
            '',
            'SETTINGS BUTTON COVERAGE:',
            `  Sites with settings button found: ${this.stats.sitesWithSettingsButton}`,
            `  Percentage of llmMatch-no-reject sites: ${this.stats.sitesWithLlmMatchNoReject > 0 ? ((this.stats.sitesWithSettingsButton / this.stats.sitesWithLlmMatchNoReject) * 100).toFixed(2) : 0}%`,
            '',
            'CMP RULE COVERAGE (for sites with settings button):',
            `  Sites with settings button WITHOUT existing CMP rule: ${this.stats.sitesWithSettingsButtonAndNoCmp}`,
            `  Sites with settings button WITH existing CMP rule: ${this.stats.sitesWithSettingsButtonAndCmp}`,
            `  Percentage without CMP rule: ${this.stats.sitesWithSettingsButton > 0 ? ((this.stats.sitesWithSettingsButtonAndNoCmp / this.stats.sitesWithSettingsButton) * 100).toFixed(2) : 0}%`,
            '',
            'REJECT BUTTON AVAILABILITY (for llmMatch-no-reject sites):',
            `  Sites with NO reject button anywhere: ${this.stats.sitesWithoutAnyRejectButton}`,
            `  Percentage without any reject: ${this.stats.sitesWithLlmMatchNoReject > 0 ? ((this.stats.sitesWithoutAnyRejectButton / this.stats.sitesWithLlmMatchNoReject) * 100).toFixed(2) : 0}%`,
            '',
        ];

        // Add CMP names
        if (this.stats.cmpNamesFound.size > 0) {
            output.push('CMP NAMES FOUND (for sites with settings button and CMP):');
            const sortedCmps = Array.from(this.stats.cmpNamesFound.entries())
                .sort((a, b) => b[1] - a[1]);
            for (const [name, count] of sortedCmps) {
                output.push(`  ${count.toString().padStart(4)} | ${name}`);
            }
            output.push('');
        }

        // Add settings button texts
        if (this.stats.settingsButtonTexts.size > 0) {
            output.push('SETTINGS BUTTON TEXTS (sorted by frequency):');
            const sortedTexts = Array.from(this.stats.settingsButtonTexts.entries())
                .sort((a, b) => b[1] - a[1]);
            for (const [text, count] of sortedTexts) {
                output.push(`  ${count.toString().padStart(4)} | ${text}`);
            }
            output.push('');
        }

        // Add potential false negatives
        if (this.stats.potentialFalseNegatives.size > 0) {
            output.push('POTENTIAL FALSE NEGATIVES (LLM matched, regex didn\'t):');
            output.push(`Total unique button texts: ${this.stats.potentialFalseNegatives.size}`);
            output.push('');
            const sortedFN = Array.from(this.stats.potentialFalseNegatives.entries())
                .sort((a, b) => b[1] - a[1]);
            for (const [text, count] of sortedFN) {
                output.push(`  ${count.toString().padStart(4)} | ${text}`);
            }
            output.push('');
        }

        // Add LLM cache statistics
        if (this.openai) {
            output.push('LLM CACHE STATISTICS:');
            output.push(`  Concurrency limit: ${this.concurrencyLimit}`);
            output.push(`  API calls made: ${this.stats.llmChecksPerformed}`);
            output.push(`  Cache hits: ${this.stats.llmCacheHits}`);
            output.push(`  Total checks: ${this.stats.llmChecksPerformed + this.stats.llmCacheHits}`);
            const cacheHitRate = this.stats.llmCacheHits + this.stats.llmChecksPerformed > 0
                ? ((this.stats.llmCacheHits / (this.stats.llmCacheHits + this.stats.llmChecksPerformed)) * 100).toFixed(1)
                : 0;
            output.push(`  Cache hit rate: ${cacheHitRate}%`);
            output.push('');
        }

        // Add detailed results
        if (this.detailedResults.length > 0) {
            output.push('='.repeat(70));
            output.push('DETAILED RESULTS: Sites with Settings Buttons');
            output.push('='.repeat(70));
            output.push('');

            for (const result of this.detailedResults) {
                output.push(`URL: ${result.url}`);
                output.push(`CMP: ${result.cmpName}`);
                output.push(`Has reject button elsewhere: ${result.hasAnyReject ? 'Yes' : 'No'}`);
                output.push('Settings buttons found:');
                for (const button of result.settingsButtons) {
                    output.push(`  - Text: ${button.text}`);
                    output.push(`    Selector: ${button.selector}`);
                }
                output.push('');
            }
        }

        try {
            await fs.writeFile(outputPath, output.join('\n'), 'utf8');
            console.log(`\nResults saved to: ${outputPath}`);
        } catch (error) {
            console.error(`Error saving results: ${error.message}`);
        }
    }
}

// Configure commander
program
    .name('analyze-settings-buttons')
    .description('Analyze cookie popups to find settings button opportunities')
    .version('1.0.0')
    .argument('<directory>', 'Path to directory containing JSON crawl files')
    .option('-o, --output <path>', 'Save results to file', './settings-buttons-analysis.txt')
    .option('--check-false-negatives', 'Use OpenAI to check for potential false negatives (requires OPENAI_API_KEY env var)')
    .option('-c, --concurrency <number>', 'Number of concurrent LLM API calls (default: 10)', '10')
    .helpOption('-h, --help', 'Show this help message')
    .parse();

/**
 * Main function
 */
async function main() {
    const options = program.opts();
    const directory = program.args[0];
    const outputPath = options.output;
    const checkFalseNegatives = options.checkFalseNegatives;
    const concurrency = parseInt(options.concurrency, 10);

    // Validate concurrency
    if (isNaN(concurrency) || concurrency < 1) {
        console.error('Error: Concurrency must be a positive integer.');
        process.exit(1);
    }

    // Check if directory exists
    if (!fsSync.existsSync(directory)) {
        console.error(`Error: Directory '${directory}' does not exist.`);
        process.exit(1);
    }

    if (!fsSync.statSync(directory).isDirectory()) {
        console.error(`Error: '${directory}' is not a directory.`);
        process.exit(1);
    }

    // Initialize OpenAI client if false negatives check is requested
    let openai = null;
    if (checkFalseNegatives) {
        if (!process.env.OPENAI_API_KEY) {
            console.error('Error: OPENAI_API_KEY environment variable is not set.');
            console.error('Please set it or remove the --check-false-negatives flag.');
            process.exit(1);
        }
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
        console.log('OpenAI client initialized for false negative detection.');
    }

    console.log('='.repeat(70));
    console.log('Settings Button Analyzer');
    console.log('='.repeat(70));
    console.log(`Directory: ${directory}`);
    console.log(`Output file: ${outputPath}`);
    console.log(`Check false negatives: ${checkFalseNegatives ? 'Yes' : 'No'}`);
    if (checkFalseNegatives) {
        console.log(`LLM concurrency limit: ${concurrency}`);
    }
    console.log('='.repeat(70));
    console.log();

    try {
        const analyzer = new SettingsButtonAnalyzer(openai, concurrency);
        await analyzer.processDirectory(directory);
        analyzer.outputResults();
        await analyzer.saveResults(outputPath);
    } catch (error) {
        console.trace('Fatal error during processing:', error.message, error.stack);
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = SettingsButtonAnalyzer;

