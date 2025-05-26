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
        /**
         * @type {Map<string, {executionContextId: number, session: import('puppeteer-core').CDPSession}>}
         */
        this.frameId2executionContextId = new Map();
        this.log = options.log;
    }

    /**
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo} targetInfo
     */
    async addTarget(session, targetInfo) {
        if (targetInfo.type === 'page' || targetInfo.type === 'iframe') {
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
            setTimeout(resolve, 2000);
        });
    }

    /**
     * @returns {Promise<CookiePopupData[]>}
     */
    async getData() {
        await Promise.all(Array.from(this.frameId2executionContextId.values()).map(async ({executionContextId, session}) => {
            try {
                const evalResult = await session.send('Runtime.evaluate', {
                    expression: scrapeScript,
                    contextId: executionContextId,
                    returnByValue: true,
                    allowUnsafeEvalBlockedByCSP: true,
                });
                if (evalResult.exceptionDetails) {
                    this.log(`Error evaluating content script: ${evalResult.exceptionDetails.text}`);
                    return;
                }
                /** @type {ContentScriptResult} */
                const result = evalResult.result.value;
                for (const potentialPopup of result.potentialPopups) {
                    this._data.push(potentialPopup);
                }
            } catch (e) {
                if (!isIgnoredEvalError(e)) {
                    console.error('Error evaluating content script:', e);
                    this.log(`Error evaluating content script: ${e}`);
                }
            }
        }));
        return this._data;
    }
}

module.exports = CookiePopupCollector;

/**
 * @typedef ContentScriptResult
 * @property {PopupData[]} potentialPopups
 */

/**
 * @typedef PopupData
 * @property {string} text
 * @property {ButtonData[]} buttons
 * @property {boolean} isTop
 * @property {string} origin
 */

/**
 * @typedef ButtonData
 * @property {string} text
 * @property {string} selector
 */

/**
 * @typedef CookiePopupData
 * @property {string} text
 * @property {ButtonData[]} buttons
 * @property {boolean} isTop
 * @property {string} origin
 */
