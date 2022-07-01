const fs = require('fs');
const path = require('path');
const BaseCollector = require('./BaseCollector');

// @ts-ignore
const baseContentScript = fs.readFileSync(
    path.join(__dirname, "../node_modules/@duckduckgo/autoconsent/dist/autoconsent.standalone.js"),
    "utf8"
);

/**
 * @param {import('@duckduckgo/autoconsent/lib/types').Config} config
 */
function generateContentScript(config) {
    return baseContentScript + `
        window.initAutoconsentStandalone(${JSON.stringify(config)});
    `;
}

const worldName = 'cmpcollector';

/**
 * @param {() => Promise<boolean> | boolean} predicate
 * @param {number} maxTimes
 * @param {number} interval
 * @returns {Promise<boolean>}
 */
async function waitFor(predicate, maxTimes, interval) {
    const result = await predicate();
    if (!result && maxTimes > 0) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(waitFor(predicate, maxTimes - 1, interval));
            }, interval);
        });
    }
    return Promise.resolve(result);
}

class CMPCollector extends BaseCollector {

    id() {
        return 'cmps';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options
     */
    init(options) {
        this.context = options.context;
        this.log = options.log;
        this.doOptOut = options.collectorFlags.runAutoconsent;
        this.contentScript = generateContentScript({
            enabled: true,
            autoAction: this.doOptOut ? 'optOut' : null,
            disabledCmps: [],
            enablePrehide: true,
            detectRetries: 20,
        });
        /** @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage[]} */
        this.receivedMsgs = [];
        this.selfTestFrame = null;
    }

    /**
     * @param {Partial<import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage>} msg
     * @returns {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage | null}
     */
    findMessage(msg, partial = true) {
        for (const m of this.receivedMsgs) {
            const keysMatch = partial || Object.keys(m).length === Object.keys(msg).length;
            // @ts-ignore
            if (keysMatch && Object.keys(msg).every(k => m[k] === msg[k])) {
                return m;
            }
        }
        return null;
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('./TargetCollector').TargetType}} targetInfo
     */
    // eslint-disable-next-line no-unused-vars
    async addTarget(targetInfo) {
        if (targetInfo.type === 'page') {
            this._cdpClient = targetInfo.cdpClient;
            await this._cdpClient.send('Page.enable');
            await this._cdpClient.send('Runtime.enable');

            this._cdpClient.on('Runtime.executionContextCreated', async ({context}) => {
                // ignore context created by puppeteer / our crawler
                if (!context.origin || context.origin === '://' || context.auxData.type === 'isolated') {
                    return;
                }
                try {
                    const {executionContextId} = await this._cdpClient.send('Page.createIsolatedWorld', {
                        frameId: context.auxData.frameId,
                        worldName
                    });
                    await this._cdpClient.send('Runtime.evaluate', {
                        expression: this.contentScript,
                        contextId: executionContextId,
                    });
                } catch (e) {
                    // ignore evaluation errors (sometimes frames reload too fast)
                    this.log(`Error evaluating content script: ${e}`);
                }
            });

            this._cdpClient.on('Runtime.bindingCalled', async ({name, payload, executionContextId}) => {
                if (name === 'autoconsentStandaloneSendMessage') {
                    try {
                        const msg = JSON.parse(payload);
                        // this.log(`received message from ${executionContextId}: ${JSON.stringify(msg)}`);
                        await this.handleMessage(msg, executionContextId);
                    } catch (e) {
                        this.log(`Could not handle autoconsent message ${payload}`);
                    }
                }
            });
            await this._cdpClient.send('Runtime.addBinding', {
                name: 'autoconsentStandaloneSendMessage',
                executionContextName: worldName,
            });
        }
    }

    /**
     * Implements autoconsent messaging protocol
     *
     * @param {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage} msg
     * @param {any} executionContextId
     * @returns {Promise<void>}
     */
    async handleMessage(msg, executionContextId) {
        this.receivedMsgs.push(msg);
        switch (msg.type) {
        case 'optInResult':
        case 'optOutResult': {
            if (msg.scheduleSelfTest) {
                this.selfTestFrame = executionContextId;
            }
            break;
        }
        case 'autoconsentDone': {
            if (this.selfTestFrame) {
                await this._cdpClient.send('Runtime.evaluate', {
                    expression: `autoconsentStandaloneReceiveMessage({ type: "selfTest" })`,
                    allowUnsafeEvalBlockedByCSP: true,
                    contextId: this.selfTestFrame,
                    silent: true
                });
            }
            break;
        }
        case 'eval': {
            let evalResult = false;
            const result = await this._cdpClient.send('Runtime.evaluate', {
                expression: msg.code,
                returnByValue: true,
                allowUnsafeEvalBlockedByCSP: true,
                contextId: executionContextId,
                silent: true
            });
            if (!result.exceptionDetails) {
                evalResult = Boolean(result.result.value);
            }

            await this._cdpClient.send('Runtime.evaluate', {
                expression: `autoconsentStandaloneReceiveMessage({ id: "${msg.id}", type: "evalResp", result: ${JSON.stringify(evalResult)} })`,
                allowUnsafeEvalBlockedByCSP: true,
                contextId: executionContextId,
                silent: true
            });
            break;
        }
        case 'autoconsentError': {
            this.log(`autoconsent error: ${msg.details}`);
            break;
        }
        default:
        }
    }

    /**
     * Called after the crawl to retrieve the data. Can be async, can throw errors.
     *
     * @param {{finalUrl: string, urlFilter?: function(string):boolean}} options
     * @returns {Promise<CMPResult[]>}
     */
    // eslint-disable-next-line no-unused-vars
    async getData(options) {
        // TODO: wait for messages, parse them

        const detected = await waitFor(() => Boolean(this.findMessage({type: 'cmpDetected'})), 20, 100);
        if (!detected) {
            return [];
        }

        // check if anything was detected at all
        const detectedMsg = /** @type {import('@duckduckgo/autoconsent/lib/messages').DetectedMessage} */ (this.findMessage({type: 'cmpDetected'}));
        /**
         * @type {CMPResult}
         */
        const result = {
            name: detectedMsg.cmp,
            isOpen: false,
            optOutRuns: false,
            optOutSucceeds: false,
            error: '',
        };

        // was there a popup?
        const found = await waitFor(() => Boolean(this.findMessage({type: 'popupFound'})), 20, 100);
        if (!found) {
            return [result];
        }

        result.isOpen = true;
        if (!this.doOptOut) {
            return [result];
        }

        result.optOutRuns = true;
        // did we opt-out?
        const done = await waitFor(() => Boolean(this.findMessage({type: 'autoconsentDone'})), 20, 100);
        if (!done) {
            return [result];
        }

        result.name = /** @type {import('@duckduckgo/autoconsent/lib/messages').DoneMessage} */ (this.findMessage({type: 'autoconsentDone'})).cmp;
        if (this.selfTestFrame === null) {
            result.optOutSucceeds = true;
        } else if (await waitFor(() => Boolean(this.findMessage({type: 'selfTestResult'})), 20, 100)) {
            // did self-test succeed?
            const selfTestRes = /** @type {import('@duckduckgo/autoconsent/lib/messages').SelfTestResultMessage} */ (this.findMessage({type: 'selfTestResult'}));
            if (selfTestRes.result) {
                result.optOutSucceeds = true;
            }
        }
        return [result];
    }
}

/**
 * @typedef CMPResult
 * @property {string} name
 * @property {boolean} isOpen
 * @property {boolean} optOutRuns
 * @property {boolean} optOutSucceeds
 * @property {string} error
 */

module.exports = CMPCollector;