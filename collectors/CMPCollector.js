/* eslint-disable max-lines */
const fs = require('fs');
const path = require('path');
const createDeferred = require('../helpers/deferred');
const waitFor = require('../helpers/waitFor');
const BaseCollector = require('./BaseCollector');

// @ts-ignore
const baseContentScript = fs.readFileSync(
    path.join(__dirname, "../node_modules/@duckduckgo/autoconsent/dist/autoconsent.playwright.js"),
    "utf8"
);

const contentScript = `
window.autoconsentSendMessage = (msg) => {
    window.cdpAutoconsentSendMessage(JSON.stringify(msg));
};
` + baseContentScript;

const worldName = 'cmpcollector';

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

const DETECT_PATTERNS = [
    /accept cookies/i,
    /accept all/i,
    /reject all/i,
    /only necessary cookies/i, // "only necessary" is probably too broad
    /by clicking.*(accept|agree|allow)/i,
    /by continuing/i,
    /we (use|serve) cookies/i,
    /we are using cookies/i,
    /use of cookies/i,
    /this (web)?site.*cookies/i,
    /cookies (and|or) .* technologies/i,
    /such as cookies/i,
    /read more about.*cookies/i,
    /consent to.*cookies/i,

    // these below cause many false positives
    // /cookies? settings/i,
    // /cookies? preferences/i,
];

class CMPCollector extends BaseCollector {
    id() {
        return 'cmps';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options
     */
    init(options) {
        this.log = options.log;
        this.shortTimeouts = options.collectorFlags.shortTimeouts; // used to speed up unit tests
        this.autoAction = /** @type {import('@duckduckgo/autoconsent/lib/types').AutoAction} */ (options.collectorFlags.autoconsentAction);
        /** @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage[]} */
        this.receivedMsgs = [];
        this.selfTestFrame = null;
        this.isolated2pageworld = new Map();
        this.pendingScan = createDeferred();
        this.context = options.context;
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
     * @param {Partial<import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage>} msg
     * @returns {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage[]}
     */
    findAllMessages(msg, partial = true) {
        return this.receivedMsgs.filter(m => {
            const keysMatch = partial || Object.keys(m).length === Object.keys(msg).length;
            // @ts-ignore
            return keysMatch && Object.keys(msg).every(k => m[k] === msg[k]);
        });
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
                    this.isolated2pageworld.set(executionContextId, context.id);
                    await this._cdpClient.send('Runtime.evaluate', {
                        expression: contentScript,
                        contextId: executionContextId,
                    });
                } catch (e) {
                    if (!isIgnoredEvalError(e)) {
                        this.log(`Error evaluating content script: ${e}`);
                    }
                }
            });

            this._cdpClient.on('Runtime.bindingCalled', async ({name, payload, executionContextId}) => {
                if (name === 'cdpAutoconsentSendMessage') {
                    try {
                        const msg = JSON.parse(payload);
                        await this.handleMessage(msg, executionContextId);
                    } catch (e) {
                        if (!isIgnoredEvalError(e)) {
                            this.log(`Could not handle autoconsent message ${payload}`, e);
                        }
                    }
                }
            });
            await this._cdpClient.send('Runtime.addBinding', {
                name: 'cdpAutoconsentSendMessage',
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
        case 'init': {
            /** @type {import('@duckduckgo/autoconsent/lib/types').Config} */
            const autoconsentConfig = {
                enabled: true,
                autoAction: null, // we request action explicitly later
                disabledCmps: [],
                enablePrehide: false,
                detectRetries: 20,
            };
            await this._cdpClient.send('Runtime.evaluate', {
                expression: `autoconsentReceiveMessage({ type: "initResp", config: ${JSON.stringify(autoconsentConfig)} })`,
                contextId: executionContextId,
            });
            break;
        }
        case 'popupFound':
            if (this.autoAction) {
                await this.pendingScan.promise; // wait for the pattern detection first
                await this._cdpClient.send('Runtime.evaluate', {
                    expression: `autoconsentReceiveMessage({ type: "${this.autoAction}" })`,
                    contextId: executionContextId,
                });
            }
            break;
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
                    expression: `autoconsentReceiveMessage({ type: "selfTest" })`,
                    allowUnsafeEvalBlockedByCSP: true,
                    contextId: this.selfTestFrame,
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
                contextId: this.isolated2pageworld.get(executionContextId), // this must be done in page world
            });
            if (!result.exceptionDetails) {
                evalResult = Boolean(result.result.value);
            }

            await this._cdpClient.send('Runtime.evaluate', {
                expression: `autoconsentReceiveMessage({ id: "${msg.id}", type: "evalResp", result: ${JSON.stringify(evalResult)} })`,
                allowUnsafeEvalBlockedByCSP: true,
                contextId: executionContextId,
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
     * @param {Partial<import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage>} msg
     * @returns {Promise<import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage>}
     */
    async waitForMessage(msg, maxTimes = 20, interval = 100) {
        if (this.shortTimeouts) {
            // eslint-disable-next-line no-param-reassign
            maxTimes = 1;
        }
        await waitFor(() => Boolean(this.findMessage(msg)), maxTimes, interval);
        return this.findMessage(msg);
    }

    /**
     * @returns {Promise<void>}
     */
    async waitForFinish() {
        // check if anything was detected at all
        const detectedMsg = /** @type {import('@duckduckgo/autoconsent/lib/messages').DetectedMessage} */ (await this.waitForMessage({type: 'cmpDetected'}));
        if (!detectedMsg) {
            return;
        }

        // was there a popup?
        const found = await this.waitForMessage({type: 'popupFound'});
        if (!found) {
            return;
        }

        if (!this.autoAction) {
            return;
        }

        // did we opt-out?
        const resultType = this.autoAction === 'optOut' ? 'optOutResult' : 'optInResult';
        const autoActionDone = /** @type {import('@duckduckgo/autoconsent/lib/messages').OptOutResultMessage|import('@duckduckgo/autoconsent/lib/messages').OptInResultMessage} */ (await this.waitForMessage({
            type: resultType,
            cmp: detectedMsg.cmp
        }));
        if (autoActionDone) {
            if (!autoActionDone.result) {
                return;
            }
        }
        const doneMsg = /** @type {import('@duckduckgo/autoconsent/lib/messages').DoneMessage} */ (await this.waitForMessage({
            type: 'autoconsentDone'
        }));
        if (!doneMsg) {
            return;
        }

        // the final name might be different than the detected name, in case of intermediate rules
        if (this.selfTestFrame) {
            // did self-test succeed?
            await this.waitForMessage({
                type: 'selfTestResult'
            });
        }
    }

    /**
     * @returns {Promise<string[]>}
     */
    async scanPatterns() {
        /**
         * @type {string[]}
         */
        const found = [];
        const pages = await this.context.pages();
        if (pages.length > 0) {
            const page = pages[0];
            /**
             * @type {Promise<string>[]}
             */
            const promises = [];
            page.frames().forEach(frame => {
                // eslint-disable-next-line no-undef
                promises.push(frame.evaluate(() => document.documentElement.innerText).catch(reason => {
                    this.log(`error retrieving text: ${reason}`);
                    // ignore exceptions
                    return '';
                }));
            });
            const texts = await Promise.all(promises);
            const allTexts = texts.join('\n');
            for (const p of DETECT_PATTERNS) {
                if (p.test(allTexts)) {
                    found.push(p.toString());
                }
            }
        }
        this.pendingScan.resolve();
        return found;
    }

    /**
     * @returns {CMPResult[]}
     */
    collectResults() {
        /**
         * @type {CMPResult[]}
         */
        const results = [];

        const doneMsg = /** @type {import('@duckduckgo/autoconsent/lib/messages').DoneMessage} */ (this.findMessage({
            type: 'autoconsentDone'
        }));

        const selfTestResult = /** @type {import('@duckduckgo/autoconsent/lib/messages').SelfTestResultMessage} */ (this.findMessage({
            type: 'selfTestResult'
        }));

        const errorMsgs = /** @type {import('@duckduckgo/autoconsent/lib/messages').ErrorMessage[]} */ (this.findAllMessages({
            type: 'autoconsentError',
        }));
        const errors = errorMsgs.map(e => JSON.stringify(e.details));

        const detectedRules = /** @type {import('@duckduckgo/autoconsent/lib/messages').DetectedMessage[]} */ (this.findAllMessages({type: 'cmpDetected'}));
        /** @type {string[]} */
        const processedCmps = [];
        for (const msg of detectedRules) {
            if (processedCmps.includes(msg.cmp)) { // prevent duplicates
                continue;
            }
            processedCmps.push(msg.cmp);
            /**
             * @type {CMPResult}
             */
            const result = {
                final: Boolean(doneMsg && doneMsg.cmp === msg.cmp),
                name: msg.cmp,
                open: false,
                started: false,
                succeeded: false,
                selfTestFail: Boolean(selfTestResult && !selfTestResult.result),
                errors,
                patterns: [],
            };

            const found = this.findMessage({type: 'popupFound', cmp: msg.cmp});
            if (found) {
                result.open = true;
                if (this.autoAction) {
                    const resultType = this.autoAction === 'optOut' ? 'optOutResult' : 'optInResult';
                    result.started = true;
                    const autoActionResult = /** @type {import('@duckduckgo/autoconsent/lib/messages').OptOutResultMessage|import('@duckduckgo/autoconsent/lib/messages').OptInResultMessage} */ (this.findMessage({
                        type: resultType,
                        cmp: msg.cmp,
                    }));
                    if (autoActionResult) {
                        result.succeeded = autoActionResult.result;
                    }
                }
            }
            results.push(result);
        }

        return results;
    }

    /**
     * Called after the crawl to retrieve the data. Can be async, can throw errors.
     *
     * @returns {Promise<CMPResult[]>}
     */
    async getData() {
        const patterns = await this.scanPatterns();
        await this.waitForFinish();
        const results = this.collectResults();
        if (patterns.length > 0) {
            if (results.length > 0) {
                results.forEach(r => {
                    r.patterns = patterns;
                });
            } else {
                results.push({
                    final: false,
                    name: '',
                    open: false,
                    started: false,
                    succeeded: false,
                    selfTestFail: false,
                    errors: [],
                    patterns,
                });
            }
        }
        return results;
    }
}

/**
 * @typedef CMPResult
 * @property {string} name
 * @property {boolean} final
 * @property {boolean} open
 * @property {boolean} started
 * @property {boolean} succeeded
 * @property {boolean} selfTestFail
 * @property {string[]} errors
 * @property {string[]} patterns
 */

module.exports = CMPCollector;