const fs = require('fs');

const BaseCollector = require('./BaseCollector');

const scrapeScript = fs.readFileSync(
    require.resolve('./CookiePopups/scrapeScript.js'),
    'utf8'
);

const ISOLATED_WORLD_PREFIX = 'cookiepopupcollector_iw_for_';

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
        error.includes('Cannot find context with specified id') ||
        error.includes('uniqueContextId not found')
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
         * maps executionContextId to CDPSession
         * @type {Map<import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription['uniqueId'], import('puppeteer-core').CDPSession>}
         */
        this.cdpSessions = new Map();
        this.log = options.log;
    }

    /**
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo} targetInfo
     */
    async addTarget(session, targetInfo) {
        if (targetInfo.type !== 'page' && targetInfo.type !== 'iframe') {
            return;
        }

        await session.send('Page.enable');
        await session.send('Runtime.enable');

        session.on('Runtime.executionContextCreated', async ({context}) => {
            // ignore context created by puppeteer / our crawler
            if (!context.origin || context.origin === '://' || context.auxData.type !== 'default') {
                if (context.auxData.type === 'isolated' && context.name.startsWith(ISOLATED_WORLD_PREFIX)) {
                    this.cdpSessions.set(context.uniqueId, session);
                }
                return;
            }
            try {
                await session.send('Page.createIsolatedWorld', {
                    frameId: context.auxData.frameId,
                    worldName: `${ISOLATED_WORLD_PREFIX}${context.uniqueId}`,
                });
            } catch (e) {
                if (!isIgnoredEvalError(e)) {
                    this.log(`Error creating isolated world: ${e}`);
                }
            }
        });
    }

    /**
     * @returns {Promise<CookiePopupData[]>}
     */
    async getData() {
        await Promise.all(Array.from(this.cdpSessions.entries()).map(async ([executionContextUniqueId, session]) => {
            try {
                const evalResult = await session.send('Runtime.evaluate', {
                    expression: scrapeScript,
                    uniqueContextId: executionContextUniqueId,
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
 * @property {string} selector
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
