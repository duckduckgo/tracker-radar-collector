const OpenAI = require('openai');
const {zodResponseFormat} = require('openai/helpers/zod');
const {z} = require('zod');
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

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function classifyCookieConsentNotice(text) {
    const systemPrompt = `
        Your task is to inspect an HTML document and determine if a *cookie consent notice popup* is present.

        A cookie consent notice popup must:
        1. Explicitly notify the user of the site's use of cookies or other storage technology ("We use cookies...", "This site uses cookies...", etc.); AND
        2. Offer the user a way to accept or reject the use of cookies on the site.

        Note: The HTML document provided is a simplified representation containing only text, buttons, and links.

        Note: This definition does not include adult content notices or any other type of notice that is primarily focused on age verification or content restrictions. Cookie consent notices are specifically intended to inform users about the website's use of cookies and obtain their consent for such use.

        Note: A cookie consent notice should specifically relate to the site's use of cookies or other storage technology that stores data on the user's device, such as HTTP cookies, local storage, or session storage. Requests for permission to access geolocation information, camera, microphone, etc., do not fall under this category.
    `;

    try {
        const completion = await openai.beta.chat.completions.parse({
            // model: 'gpt-4o-mini-2024-07-18',
            model: 'gpt-4.1-nano-2025-04-14',
            messages: [
                {role: 'system', content: systemPrompt},
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
        if (targetInfo.type === 'page' || targetInfo.type === 'iframe') {
            // Store CDP client for the main page if not already set
            if (targetInfo.type === 'page') {
                this._cdpClient = targetInfo.session;
            }

            const session = targetInfo.session;
            await session.send('Page.enable');
            await session.send('Runtime.enable');

            session.on('Runtime.executionContextCreated', async ({context}) => {
                // ignore context created by puppeteer / our crawler
                if (!context.origin || context.origin === '://' || context.auxData.type !== 'default') {
                    return;
                }
                try {
                    const {executionContextId} = await session.send('Page.createIsolatedWorld', {
                        frameId: context.auxData.frameId,
                        worldName: 'crawlercookiepopupcollector',
                    });
                    this.frameId2executionContextId.set(
                        context.auxData.frameId,
                        {executionContextId, session}
                    );
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
            setTimeout(resolve, 5000);
        });
    }

    /**
     * @returns {Promise<CookiePopupData[]>}
     */
    async getData() {
        await Promise.all(Array.from(this.frameId2executionContextId.values()).map(async contextInfo => {
            try {
                const {executionContextId, session} = contextInfo;
                const targetSession = session || this._cdpClient;
                const evalResult = await targetSession.send('Runtime.evaluate', {
                    expression: scrapeScript,
                    contextId: executionContextId,
                    returnByValue: true,
                    allowUnsafeEvalBlockedByCSP: true,
                });
                const domText = evalResult.result.value;
                if (domText) {
                    this._data.push({
                        domText,
                        llmMatch: await classifyCookieConsentNotice(domText),
                    });
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
 * @property {string} domText
 * @property {boolean} llmMatch
 */
