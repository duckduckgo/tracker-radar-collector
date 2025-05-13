#!/usr/bin/env zx

import fs from 'fs/promises';
import path from 'path';

// Extract the system prompt from CookiePopupCollector.js
const extractSystemPrompt = async () => {
    const collectorContent = await fs.readFile(
        path.resolve('../collectors/CookiePopupCollector.js'),
        'utf8'
    );

    // Find the system prompt in the file
    const systemPromptMatch = collectorContent.match(/const systemPrompt = `([\s\S]*?)`/);
    if (!systemPromptMatch) {
        console.error('System prompt not found in CookiePopupCollector.js');
        process.exit(1);
    }

    return systemPromptMatch[1].trim();
};

// Load the labels data
const loadLabels = async () => {
    try {
        const labelsData = await fs.readFile('labels.json', 'utf8');
        return JSON.parse(labelsData);
    } catch (error) {
        console.error('Error reading labels.json:', error);
        process.exit(1);
    }
};

// Load crawl results for a domain
const loadCrawlResult = async domain => {
    try {
        const files = await glob(`results/GB/3p-crawl/${domain}*.json`);
        if (!files.length) {
            return null;
        }

        const crawlResultData = await fs.readFile(files[0], 'utf8');
        return JSON.parse(crawlResultData);
    } catch (error) {
        console.error(`Error reading crawl result for ${domain}:`, error);
        return null;
    }
};

// Generate the JSONL file for fine-tuning
async function generateTrainingData() {
    console.log('Generating training data for OpenAI fine-tuning...');

    // Extract the system prompt
    const systemPrompt = await extractSystemPrompt();
    console.log('System prompt extracted successfully.');

    // Load labels
    const labels = await loadLabels();
    console.log(`Loaded ${labels.length} labels.`);

    // Create the JSONL data
    const trainingData = [];
    let successCount = 0;
    let failureCount = 0;

    for (const label of labels) {
        const basename = path.basename(label.image);
        const [, domain] = basename.match(/^(.+)_\w+\.jpg$/) || [];

        if (!domain) {
            console.warn(`Couldn't extract domain from ${basename}`);
            failureCount++;
            continue;
        }

        const hasPopup = label.choice === "popup";
        const crawlResult = await loadCrawlResult(domain);

        if (!crawlResult) {
            console.warn(`No crawl result found for ${domain}`);
            failureCount++;
            continue;
        }

        const cookiePopups = crawlResult.data.cookiepopups;

        if (!cookiePopups || !cookiePopups.length) {
            console.warn(`No cookie popup data for ${domain}`);
            failureCount++;
            continue;
        }

        // Process each popup candidate in the domain data
        for (const popup of cookiePopups) {
            if (!popup.domText) {continue;}

            const trainingItem = {
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: popup.domText
                    },
                    {
                        role: "assistant",
                        content: JSON.stringify({
                            isCookieConsentNotice: hasPopup
                        })
                    }
                ]
            };

            trainingData.push(trainingItem);
            successCount++;
        }
    }

    // Write the JSONL file
    const outputPath = 'cookie-popup-training-data.jsonl';
    const jsonlContent = trainingData.map(item => JSON.stringify(item)).join('\n');
    await fs.writeFile(outputPath, jsonlContent, 'utf8');

    // Write a shuffled version of the JSONL file
    const shuffledOutputPath = 'cookie-popup-training-data-shuffled.jsonl';
    const shuffledContent = trainingData
        .sort(() => Math.random() - 0.5)
        .map(item => JSON.stringify(item))
        .join('\n');
    await fs.writeFile(shuffledOutputPath, shuffledContent, 'utf8');

    console.log(`Training data generation complete!`);
    console.log(`Successfully processed: ${successCount} examples`);
    console.log(`Failed to process: ${failureCount} examples`);
    console.log(`Output written to: ${outputPath}`);
    console.log(`First item: ${JSON.stringify(trainingData[0], null, 2)}`);
}

// Execute the main function
await generateTrainingData();
