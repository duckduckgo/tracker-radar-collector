const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');
const fs = require('fs');

/**
 * Run LLM to detect potential false positives and false negatives in button detection.
 * @param {{
 *  openai: import('openai').OpenAI,
 *  rejectButtonTextsFile: string,
 *  otherButtonTextsFile: string,
 * }} params
 */
async function verifyButtonTexts({ openai, rejectButtonTextsFile, otherButtonTextsFile }) {
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

module.exports = {
    verifyButtonTexts,
};
