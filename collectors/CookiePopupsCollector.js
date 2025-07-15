/* eslint-disable max-lines */
const fs = require('fs');
const waitFor = require('../helpers/waitFor');
const ContentScriptCollector = require('./ContentScriptCollector');
const { createTimer } = require('../helpers/timer');
const { wait, TimeoutError } = require('../helpers/wait');
const createDeferred = require('../helpers/deferred');

// @ts-ignore
const baseContentScript = fs.readFileSync(
    require.resolve('../node_modules/@duckduckgo/autoconsent/dist/autoconsent.playwright.js'),
    'utf8'
);

const BINDING_NAME_PREFIX = 'cdpAutoconsentSendMessage_';
const SCRAPE_TIMEOUT = 20000;
const OPTOUT_TIMEOUT = 30000;
const DETECT_TIMEOUT = 5000;
const FOUND_TIMEOUT = 5000;

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
    collectorExtraTimeMs = SCRAPE_TIMEOUT + DETECT_TIMEOUT + FOUND_TIMEOUT + OPTOUT_TIMEOUT; // Autoconsent opt-out/opt-in and scraping can take a while

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

        /** @type {import('../helpers/deferred').Deferred<ScrapeScriptResult[]>} */
        this.scrapeJobDeferred = createDeferred();
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
        const bindingName = `${BINDING_NAME_PREFIX}${context.uniqueId.replace(/\W/g, '_')}`;
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
            const evalResult = await session.send('Runtime.evaluate', {
                expression: getAutoconsentContentScript(bindingName),
                uniqueContextId: context.uniqueId,
            });
            if (evalResult.exceptionDetails) {
                throw new Error(`Content script injection failed: ${evalResult.exceptionDetails.text}`);
            }
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
                // we need to pass an explicit null here so that autoconsent doesn't use the default value ('optOut').
                // Note that the opt-in/opt-out may still be triggered later based on this.autoAction.
                autoAction: null,
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
            if (this.autoAction) {
                // wait for the scrape job to finish first
                await this.scrapeJobDeferred.promise;
                // trigger the autoconsent action (optOut/optIn)
                this.log(`Starting ${this.autoAction} for ${msg.cmp} in ${executionContextUniqueId} (${msg.url})`);
                await this.cdpSessions.get(executionContextUniqueId)?.send('Runtime.evaluate', {
                    expression: `autoconsentReceiveMessage({ type: "${this.autoAction}" })`,
                    uniqueContextId: executionContextUniqueId,
                });
            }
            break;
        case 'report':
            msg.state.heuristicPatterns.forEach(x => this.scanResult.patterns.add(x));
            msg.state.heuristicSnippets.forEach(x => this.scanResult.snippets.add(x));
            break;
        case 'optInResult':
        case 'optOutResult': {
            this.log(`${msg.type} ${msg.cmp} ${msg.result ? 'succeeded' : 'failed'} in ${executionContextUniqueId} (${msg.url})`);
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
     * @param {{msg: Partial<ContentScriptMessage>, maxTimes?: number, interval?: number}} params
     * @returns {Promise<ContentScriptMessage>}
     */
    async waitForMessage({msg, maxTimes = 20, interval = 100}) {
        if (this.shortTimeouts) {
            // eslint-disable-next-line no-param-reassign
            maxTimes = 1;
        }
        await waitFor(() => Boolean(this.findMessage(msg)), maxTimes, interval);
        return this.findMessage(msg);
    }

    /**
     * @returns {Promise<FoundMessage | null>}
     */
    async waitForPopupFound() {
        // check if anything was detected at all
        const detectedMsg = /** @type {DetectedMessage | null} */ (await this.waitForMessage({
            msg: {type: 'cmpDetected'},
            maxTimes: DETECT_TIMEOUT / 200,
            interval: 200,
        }));
        if (!detectedMsg) {
            return null;
        }

        // was there a popup?
        const found = /** @type {FoundMessage | null} */ (await this.waitForMessage({
            msg: {type: 'popupFound'},
            maxTimes: FOUND_TIMEOUT / 200,
            interval: 200,
        }));
        return found;
    }

    /**
     * @param {FoundMessage} popupFoundMsg
     * @returns {Promise<void>}
     */
    async waitForAutoconsentFinish(popupFoundMsg) {
        const resultType = this.autoAction === 'optOut' ? 'optOutResult' : 'optInResult';

        // some cmps take a while to opt-out/opt-in, allow up to 30s here
        const autoActionResult = /** @type {OptOutResultMessage|OptInResultMessage} */ (
            await this.waitForMessage({
                msg: {
                    type: resultType,
                    cmp: popupFoundMsg.cmp
                },
                maxTimes: OPTOUT_TIMEOUT / 1000,
                interval: 1000,
            })
        );
        if (autoActionResult) {
            if (!autoActionResult.result) {
                return;
            }
        }
        const doneMsg = /** @type {DoneMessage} */ (await this.waitForMessage({
            msg: {type: 'autoconsentDone'},
            maxTimes: 10,
            interval: 100,
        }));
        if (!doneMsg) {
            return;
        }

        // the final name might be different than the detected name, in case of intermediate rules
        if (this.selfTestFrame) {
            // did self-test succeed?
            await this.waitForMessage({
                msg: {type: 'selfTestResult'},
                maxTimes: 10,
                interval: 100,
            });
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
     * @returns {Promise<ScrapeScriptResult[]>}
     */
    scrapePopups() {
        const scrapeScriptTimer = createTimer();
        // launch all scrape tasks in parallel
        /** @type {Promise<ScrapeScriptResult | null>[]} */
        const scrapeTasks = Array.from(this.cdpSessions.entries()).map(async ([executionContextUniqueId, session]) => {
            try {
                const evalResult = await session.send('Runtime.evaluate', {
                    expression: cookiePopupScrapeScript,
                    uniqueContextId: executionContextUniqueId,
                    returnByValue: true,
                    allowUnsafeEvalBlockedByCSP: true,
                });
                if (evalResult.exceptionDetails) {
                    this.log(`Error evaluating scrape script: ${evalResult.exceptionDetails.text} ${evalResult.exceptionDetails.exception?.description}`);
                    return null;
                }
                /** @type {ScrapeScriptResult} */
                const result = evalResult.result.value;
                if (result.cleanedText || result.potentialPopups.length > 0) {
                    return result;
                }
                return null;
            } catch (e) {
                if (!this.isIgnoredCdpError(e)) {
                    this.log(`Error evaluating scrape script: ${e}`);
                }
                return null;
            }
        });

        // filter out null results
        return Promise.all(scrapeTasks).then(results => {
            this.log(`Scraping ${scrapeTasks.length} frames took ${scrapeScriptTimer.getElapsedTime()}s`);
            return results.filter(Boolean);
        });
    }

    /**
     * Called after the crawl to retrieve the data. Can be async, can throw errors.
     *
     * @returns {Promise<CookiePopupsCollectorResult>}
     */
    async getData() {
        // start scraping jobs early
        const timeboxedScrapeJob = wait(this.scrapePopups(), SCRAPE_TIMEOUT, 'Scraping popups timed out').then(
            // hook up this promise to the Deferred
            scrapedFrames => {
                this.scrapeJobDeferred.resolve(scrapedFrames);
                return scrapedFrames;
            },
            e => {
                if (e instanceof TimeoutError) {
                    // do not fail the whole crawl on timeout
                    this.log(e.message);
                    const emptyResult = /** @type {ScrapeScriptResult[]} */ ([]);
                    this.scrapeJobDeferred.resolve(emptyResult);
                    return emptyResult;
                }
                this.scrapeJobDeferred.reject(e);
                throw e;
            }
        );

        const popupFoundTimer = createTimer();
        const popupFound = await this.waitForPopupFound();
        this.log(`Waiting for popupFound took ${popupFoundTimer.getElapsedTime()}s`);
        if (popupFound && this.autoAction) {
            // make sure we start waiting only after the scrape job is done
            await this.scrapeJobDeferred.promise;
            const autoconsentFinishTimer = createTimer();
            await this.waitForAutoconsentFinish(popupFound);
            this.log(`Waiting for autoconsent finish took ${autoconsentFinishTimer.getElapsedTime()}s`);
        }

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

        const scrapedFrames = await timeboxedScrapeJob;
        return {
            cmps,
            scrapedFrames,
        };
    }
}

/**
 * @typedef CookiePopupsCollectorResult
 * @property {AutoconsentResult[]} cmps
 * @property {ScrapeScriptResult[]} scrapedFrames
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
 * @property {boolean} isTop
 * @property {string} origin
 * @property {string} cleanedText
 * @property {ButtonData[]} buttons
 * @property {PopupData[]} potentialPopups
 * @property {boolean} [llmPopupDetected]
 * @property {boolean} [regexPopupDetected]
 * @property {ButtonData[]} [rejectButtons]
 * @property {ButtonData[]} [otherButtons]
 */

/**
 * @typedef PopupData
 * @property {string} text
 * @property {string} selector
 * @property {ButtonData[]} buttons
 * @property {boolean} [llmMatch]
 * @property {boolean} [regexMatch]
 * @property {ButtonData[]} [rejectButtons]
 * @property {ButtonData[]} [otherButtons]
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
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').FoundMessage } FoundMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').SelfTestResultMessage } SelfTestResultMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').ErrorMessage } ErrorMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').OptOutResultMessage } OptOutResultMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').OptInResultMessage } OptInResultMessage
 * @typedef { import('@duckduckgo/autoconsent/lib/messages').DoneMessage } DoneMessage
 * @typedef { { snippets: Set<string>, patterns: Set<string>, filterListMatched: boolean } } ScanResult
 */

module.exports = CookiePopupsCollector;
