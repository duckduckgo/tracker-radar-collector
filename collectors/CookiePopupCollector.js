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
        for (const executionContextId of this.frameId2executionContextId.values()) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const result = await this._cdpClient.send('Runtime.evaluate', {
                    expression: scrapeScript,
                    contextId: executionContextId,
                    returnByValue: true,
                    allowUnsafeEvalBlockedByCSP: true,
                });
                if (result.result.value.length > 0) {
                    this._data.push(result.result.value);
                }
            } catch (e) {
                if (!isIgnoredEvalError(e)) {
                    this.log(`Error evaluating content script: ${e}`);
                }
            }
        }
        return this._data;
    }
}

module.exports = CookiePopupCollector;

/**
 * @typedef CookiePopupData
 * @property {string} html
 * @property {string[]} buttons
 */
