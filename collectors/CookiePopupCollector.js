const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');
const fs = require('fs');

const BaseCollector = require('./BaseCollector');

// @ts-ignore
const scrapeScript = fs.readFileSync(
    require.resolve('./CookiePopups/scrapeScript.js'),
    'utf8'
);

/**
 * @param {String|Error} e
 */
function isIgnoredEvalError(e) {
    // ignore evaluation errors (sometimes frames reload too fast)
    const error = (typeof e === 'string') ? e : e.message;
    return (
        error.includes('No frame for given id found') ||
        error.includes('Target closed.') ||
        error.includes('Session closed.') ||
        error.includes('Cannot find context with specified id')
    );
}

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const CookieConsentNoticeClassification = z.object({
    isCookieConsentNotice: z.boolean(),
});

async function classifyCookieConsentNotice(text) {
    const systemPrompt = `
      Your task is to classify text from the innerText property of HTML overlay elements.

      An overlay element is considered to be a "cookie consent notice" if it meets all of these criteria:
      1. it explicitly notifies the user of the site's use of cookies or other storage technology, such as: "We use cookies...", "This site uses...", etc.
      2. it offers the user choices for the usage of cookies on the site, such as: "Accept", "Reject", "Learn More", etc., or informs the user that their use of the site means they accept the usage of cookies.

      Note: This definition does not include adult content notices or any other type of notice that is primarily focused on age verification or content restrictions. Cookie consent notices are specifically intended to inform users about the website's use of cookies and obtain their consent for such use.

      Note: A cookie consent notice should specifically relate to the site's use of cookies or other storage technology that stores data on the user's device, such as HTTP cookies, local storage, or session storage. Requests for permission to access geolocation information, camera, microphone, etc., do not fall under this category.

      Note: Do NOT classify a website header or footer as a "cookie consent notice". Website headers or footers may contain a list of links, possibly including a privacy policy, cookie policy, or terms of service document, but their primary purpose is navigational rather than informational.
  `;

    const MAX_LENGTH = 500;
    let snippet = text.slice(0, MAX_LENGTH);
    let ifTruncated = '';
    if (snippet.length !== text.length) {
        snippet += '...';
        ifTruncated = `the first ${MAX_LENGTH} characters of `;
    }

    try {
        const completion = await openai.beta.chat.completions.parse({
            // model: 'gpt-4o-mini-2024-07-18',
            model: 'gpt-4.1-nano-2025-04-14',
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `The following text was captured from ${ifTruncated}the innerText of an HTML overlay element:\n\n${snippet}`,
                },
            ],
            response_format: zodResponseFormat(CookieConsentNoticeClassification, 'CookieConsentNoticeClassification'),
        });

        const result = completion.choices[0].message.parsed;
        return result?.isCookieConsentNotice ?? false;
    } catch (error) {
        console.error('Error classifying candidate:', error);
    }

    return false;
}

class CookiePopupCollector extends BaseCollector {

    id() {
        return 'cookiepopups';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options
     */
    init(options) {
        /**
         * @type {CookiePopupData[]}
         */
        this._data = [];
        this.frameId2executionContextId = new Map();
        this.log = options.log;
    }

    /**
     * @param {import('./BaseCollector').TargetInfo} targetInfo
     */
    async addTarget(targetInfo) {
        if (targetInfo.type === 'page') {
            this._cdpClient = targetInfo.session;
            await this._cdpClient.send('Page.enable');
            await this._cdpClient.send('Runtime.enable');
            this._cdpClient.on('Runtime.executionContextCreated', async ({context}) => {
                // ignore context created by puppeteer / our crawler
                if (!context.origin || context.origin === '://' || context.auxData.type !== 'default') {
                    return;
                }
                try {
                    const {executionContextId} = await this._cdpClient.send('Page.createIsolatedWorld', {
                        frameId: context.auxData.frameId,
                        worldName: 'crawlercookiepopupcollector',
                    });
                    this.frameId2executionContextId.set(context.auxData.frameId, executionContextId);
                } catch (e) {
                    if (!isIgnoredEvalError(e)) {
                        this.log(`Error creating isolated world: ${e}`);
                    }
                }
            });
        }
    }

    async postLoad() {
        await new Promise(resolve => {
            setTimeout(resolve, 2000);
        });
    }

    /**
     * @returns {Promise<CookiePopupData[]>}
     */
    async getData() {
        await Promise.all(Array.from(this.frameId2executionContextId.values()).map(async executionContextId => {
            try {
                // eslint-disable-next-line no-await-in-loop
                const evalResult = await this._cdpClient.send('Runtime.evaluate', {
                    expression: scrapeScript,
                    contextId: executionContextId,
                    returnByValue: true,
                    allowUnsafeEvalBlockedByCSP: true,
                });
                const result = evalResult.result.value;
                if (result.length > 0) {
                    this.log(`Found ${result.length} cookie consent notices`);
                    await Promise.all(result.map(async (r) => {
                        if (r.text && r.text.trim()) {
                            this.log(`Sending to LLM: ${r.text.slice(0, 100)}`);
                            r.llmMatch = await classifyCookieConsentNotice(r.text);
                        }
                    }));
                    this._data.push(result);
                }
            } catch (e) {
                if (!isIgnoredEvalError(e)) {
                    this.log(`Error evaluating content script: ${e}`);
                }
            }
        }));
        return this._data;
    }
}

module.exports = CookiePopupCollector;

/**
 * @typedef CookiePopupData
 * @property {string} html
 * @property {string} text
 * @property {string[]} buttons
 * @property {boolean} regexMatch
 * @property {boolean} llmMatch
 */
