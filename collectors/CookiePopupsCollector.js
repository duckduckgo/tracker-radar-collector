/* eslint-disable max-lines */
const fs = require('fs');
const waitFor = require('../helpers/waitFor');
const ContentScriptCollector = require('./ContentScriptCollector');
const { createTimer } = require('../helpers/timer');
const { wait, TimeoutError } = require('../helpers/wait');

// @ts-ignore
const baseContentScript = fs.readFileSync(
    require.resolve('../node_modules/@duckduckgo/autoconsent/dist/autoconsent.playwright.js'),
    'utf8'
);

const BINDING_NAME_PREFIX = 'cdpAutoconsentSendMessage_';
const SCRAPE_TIMEOUT = 20000;

/**
 * @param {string} bindingName
 * @returns {string}
 */
function getAutoconsentContentScript(bindingName) {
    return `
window.autoconsentSendMessage = (msg) => {
    window.${bindingName}(JSON.stringify(msg));
};
` + baseContentScript;
}

const cookiePopupScrapeScript = fs.readFileSync(
    require.resolve('./CookiePopups/scrapeScript.js'),
    'utf8'
);

class CookiePopupsCollector extends ContentScriptCollector {
    id() {
        return 'cookiepopups';
    }

    /**
     * @param {CollectorInitOptions} options
     */
    init(options) {
        super.init(options);
        this.shortTimeouts = options.collectorFlags.shortTimeouts;
        this.autoAction = options.collectorFlags.autoconsentAction;
        /** @type {ContentScriptMessage[]} */
        this.receivedMsgs = [];
        /** @type {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription['uniqueId'] | null} */
        this.selfTestFrame = null;
        /** @type {ScanResult} */
        this.scanResult = {
            snippets: new Set([]),
            patterns: new Set([]),
            filterListMatched: false,
        };
    }

    /**
     * @param {Partial<ContentScriptMessage>} msg
     * @returns {ContentScriptMessage | null}
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
     * @param {Partial<ContentScriptMessage>} msg
     * @returns {ContentScriptMessage[]}
     */
    findAllMessages(msg, partial = true) {
        return this.receivedMsgs.filter(m => {
            const keysMatch = partial || Object.keys(m).length === Object.keys(msg).length;
            // @ts-ignore
            return keysMatch && Object.keys(msg).every(k => m[k] === msg[k]);
        });
    }

    /**
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription} context
     */
    async onIsolatedWorldCreated(session, context) {
        const bindingName = `${BINDING_NAME_PREFIX}${context.uniqueId}`;
        session.on('Runtime.bindingCalled', async ({name, payload}) => {
            if (name === bindingName) {
                try {
                    const msg = JSON.parse(payload);
                    await this.handleMessage(msg, context.uniqueId);
                } catch (e) {
                    if (!this.isIgnoredCdpError(e)) {
                        this.log(`Could not handle autoconsent message ${payload}`, e);
                    }
                }
            }
        });
        try {
            await session.send('Runtime.addBinding', {
                name: bindingName,
                executionContextName: context.name,
            });
        } catch (e) {
            if (!this.isIgnoredCdpError(e)) {
                this.log(`Error adding Autoconsent binding in ${context.uniqueId}: ${e}`);
            }
        }
        try {
            await session.send('Runtime.evaluate', {
                expression: getAutoconsentContentScript(bindingName),
                uniqueContextId: context.uniqueId,
            });
        } catch (e) {
            if (!this.isIgnoredCdpError(e)) {
                this.log(`Error injecting Autoconsent in ${context.uniqueId}: ${e}`);
            }
        }
    }

    /**
     * Implements autoconsent messaging protocol
     *
     * @param {ContentScriptMessage} msg
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription['uniqueId']} executionContextUniqueId
     * @returns {Promise<void>}
     */
    async handleMessage(msg, executionContextUniqueId) {
        this.receivedMsgs.push(msg);
        switch (msg.type) {
        case 'init': {
            /** @type {Partial<AutoconsentConfig>} */
            const autoconsentConfig = {
                enabled: true,
                autoAction: this.autoAction || null, // make sure it's never undefined
                disabledCmps: [],
                enablePrehide: false,
                enableCosmeticRules: true,
                enableFilterList: false,
                enableHeuristicDetection: true,
                detectRetries: 20,
                isMainWorld: false
            };
            await this.cdpSessions.get(executionContextUniqueId)?.send('Runtime.evaluate', {
                expression: `autoconsentReceiveMessage({ type: "initResp", config: ${JSON.stringify(autoconsentConfig)} })`,
                uniqueContextId: executionContextUniqueId,
            });
            break;
        }
        case 'popupFound':
            if (msg.cmp === 'filterList') {
                this.scanResult.filterListMatched = true;
            }
            break;
        case 'report':
            msg.state.heuristicPatterns.forEach(x => this.scanResult.patterns.add(x));
            msg.state.heuristicSnippets.forEach(x => this.scanResult.snippets.add(x));
            break;
        case 'optInResult':
        case 'optOutResult': {
            if (msg.scheduleSelfTest) {
                this.selfTestFrame = executionContextUniqueId;
            }
            break;
        }
        case 'autoconsentDone': {
            if (this.selfTestFrame) {
                await this.cdpSessions.get(this.selfTestFrame)?.send('Runtime.evaluate', {
                    expression: `autoconsentReceiveMessage({ type: "selfTest" })`,
                    allowUnsafeEvalBlockedByCSP: true,
                    uniqueContextId: this.selfTestFrame,
                });
            }
            break;
        }
        case 'eval': {
            let evalResult = false;
            const session = this.cdpSessions.get(executionContextUniqueId);
            if (!session) {
                this.log(`Received eval message for executionContextUniqueId ${executionContextUniqueId} but no session found`);
                break;
            }
            const result = await session.send('Runtime.evaluate', {
                expression: msg.code,
                returnByValue: true,
                allowUnsafeEvalBlockedByCSP: true,
                uniqueContextId: this.isolated2pageworld.get(executionContextUniqueId), // this must be done in page world
            });
            if (!result.exceptionDetails) {
                evalResult = Boolean(result.result.value);
            }

            await session.send('Runtime.evaluate', {
                expression: `autoconsentReceiveMessage({ id: "${msg.id}", type: "evalResp", result: ${JSON.stringify(evalResult)} })`,
                allowUnsafeEvalBlockedByCSP: true,
                uniqueContextId: executionContextUniqueId,
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
     * @param {Partial<ContentScriptMessage>} msg
     * @returns {Promise<ContentScriptMessage>}
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
    async waitForAutoconsentFinish() {
        // check if anything was detected at all
        const detectedMsg = /** @type {DetectedMessage} */ (await this.waitForMessage({type: 'cmpDetected'}));
        if (!detectedMsg) {
            return;
        }

        // was there a popup?
        const found = await this.waitForMessage({type: 'popupFound'}, /* maxTimes: */ 10, /* interval: */ 100);
        if (!found) {
            return;
        }

        if (!this.autoAction) {
            return;
        }

        // did we opt-out?
        const resultType = this.autoAction === 'optOut' ? 'optOutResult' : 'optInResult';
        const autoActionDone = /** @type {OptOutResultMessage|OptInResultMessage} */ (await this.waitForMessage({
            type: resultType,
            cmp: detectedMsg.cmp
        }));
        if (autoActionDone) {
            if (!autoActionDone.result) {
                return;
            }
        }
        const doneMsg = /** @type {DoneMessage} */ (await this.waitForMessage({
            type: 'autoconsentDone'
        }, 10, 100));
        if (!doneMsg) {
            return;
        }

        // the final name might be different than the detected name, in case of intermediate rules
        if (this.selfTestFrame) {
            // did self-test succeed?
            await this.waitForMessage({
                type: 'selfTestResult'
            }, 10, 100);
        }
    }

    /**
     * @returns {AutoconsentResult[]}
     */
    collectCMPResults() {
        /**
         * @type {AutoconsentResult[]}
         */
        const results = [];

        const doneMsg = /** @type {DoneMessage} */ (this.findMessage({
            type: 'autoconsentDone'
        }));

        const selfTestResult = /** @type {SelfTestResultMessage} */ (this.findMessage({
            type: 'selfTestResult'
        }));

        const errorMsgs = /** @type {ErrorMessage[]} */ (this.findAllMessages({
            type: 'autoconsentError',
        }));
        const errors = errorMsgs.map(e => JSON.stringify(e.details));

        const detectedRules = /** @type {DetectedMessage[]} */ (this.findAllMessages({type: 'cmpDetected'}));
        /** @type {string[]} */
        const processedCmps = [];
        for (const msg of detectedRules) {
            if (processedCmps.includes(msg.cmp)) { // prevent duplicates
                continue;
            }
            processedCmps.push(msg.cmp);
            /**
             * @type {AutoconsentResult}
             */
            const result = {
                final: Boolean(doneMsg && doneMsg.cmp === msg.cmp),
                name: msg.cmp,
                open: false,
                started: false,
                succeeded: false,
                selfTestFail: Boolean(selfTestResult && !selfTestResult.result),
                errors,
                patterns: Array.from(this.scanResult.patterns),
                snippets: Array.from(this.scanResult.snippets),
                filterListMatched: this.scanResult.filterListMatched,
            };

            const found = this.findMessage({type: 'popupFound', cmp: msg.cmp});
            if (found) {
                result.open = true;
                if (this.autoAction) {
                    const resultType = this.autoAction === 'optOut' ? 'optOutResult' : 'optInResult';
                    result.started = true;
                    const autoActionResult = /** @type {OptOutResultMessage|OptInResultMessage} */ (this.findMessage({
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
     * @returns {Promise<PopupData[]>}
     */
    scrapePopups() {
        const scrapeScriptTimer = createTimer();
        // launch all scrape tasks in parallel
        const scrapeTasks = Array.from(this.cdpSessions.entries()).map(async ([executionContextUniqueId, session]) => {
            try {
                const evalResult = await session.send('Runtime.evaluate', {
                    expression: cookiePopupScrapeScript,
                    uniqueContextId: executionContextUniqueId,
                    returnByValue: true,
                    allowUnsafeEvalBlockedByCSP: true,
                });
                if (evalResult.exceptionDetails) {
                    this.log(`Error evaluating content script: ${evalResult.exceptionDetails.text}`);
                    return [];
                }
                /** @type {ScrapeScriptResult} */
                const result = evalResult.result.value;
                return result.potentialPopups || [];
            } catch (e) {
                if (!this.isIgnoredCdpError(e)) {
                    this.log(`Error evaluating scrape script: ${e}`);
                }
                return [];
            }
        });
        return Promise.all(scrapeTasks).then(results => {
            this.log(`Scraping ${scrapeTasks.length} frames took ${scrapeScriptTimer.getElapsedTime()}s`);
            return results.flat();
        });
    }

    /**
     * Called after the crawl to retrieve the data. Can be async, can throw errors.
     *
     * @returns {Promise<CookiePopupsCollectorResult>}
     */
    async getData() {
        // start scraping jobs early
        const potentialPopupsPromise = this.scrapePopups();

        const waitForAutoconsentTimer = createTimer();
        await this.waitForAutoconsentFinish(); // < 10s
        this.log(`Waiting for Autoconsent took ${waitForAutoconsentTimer.getElapsedTime()}s`);
        const cmps = this.collectCMPResults();

        // if no cmps were found, but there were heuristic matches, add a fake entry
        if (this.scanResult.patterns.size > 0 && cmps.length === 0) {
            cmps.push({
                final: false,
                name: '',
                open: false,
                started: false,
                succeeded: false,
                selfTestFail: false,
                errors: [],
                patterns: Array.from(this.scanResult.patterns),
                snippets: Array.from(this.scanResult.snippets),
                filterListMatched: this.scanResult.filterListMatched,
            });
        }

        /** @type {PopupData[]} */
        let potentialPopups = [];
        // wait for all scrape tasks to finish, but limit the total time
        try {
            potentialPopups = await wait(potentialPopupsPromise, SCRAPE_TIMEOUT, 'Scraping popups timed out');
        } catch (e) {
            if (e instanceof TimeoutError) {
                this.log(e.message);
            }
        }
        return {
            cmps,
            potentialPopups,
        };
    }
}

/**
 * @typedef CookiePopupsCollectorResult
 * @property {AutoconsentResult[]} cmps
 * @property {PopupData[]} potentialPopups
 */

/**
 * @typedef AutoconsentResult
 * @property {string} name
 * @property {boolean} final
 * @property {boolean} open
 * @property {boolean} started
 * @property {boolean} succeeded
 * @property {boolean} selfTestFail
 * @property {string[]} errors
 * @property {string[]} patterns
 * @property {string[]} snippets
 * @property {boolean} filterListMatched
 */

/**
 * @typedef ScrapeScriptResult
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
 * @typedef { import('./BaseCollector').CollectorInitOptions } CollectorInitOptions
 * @typedef { import('@duckduckgo/autoconsent/lib/types').AutoAction } AutoAction
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage } ContentScriptMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/types').Config } AutoconsentConfig
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').DetectedMessage } DetectedMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').SelfTestResultMessage } SelfTestResultMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').ErrorMessage } ErrorMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').OptOutResultMessage } OptOutResultMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').OptInResultMessage } OptInResultMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').DoneMessage } DoneMessage
 * @typedef { { snippets: Set<string>, patterns: Set<string>, filterListMatched: boolean } } ScanResult
 */

module.exports = CookiePopupsCollector;
