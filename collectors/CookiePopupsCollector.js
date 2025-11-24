const { OpenAI } = require('openai');
const fs = require('fs');
const { classifyPopup } = require('../post-processing/generate-autoconsent-rules/detection');
const waitFor = require('../helpers/waitFor');
const ContentScriptCollector = require('./ContentScriptCollector');
const { createTimer } = require('../helpers/timer');
const { wait, TimeoutError } = require('../helpers/wait');
const createDeferred = require('../helpers/deferred');
const rules = require('@duckduckgo/autoconsent/rules/rules.json');
const stringifiedRules = JSON.stringify(rules);

// @ts-ignore
const baseContentScript = fs.readFileSync(
    require.resolve('../node_modules/@duckduckgo/autoconsent/dist/autoconsent.playwright.js'),
    'utf8',
);

const STUB_IMAGE =
    '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';
const INITIAL_PROMPT = `
You are a helpful assistant that can help with cookie popup handling.
Your job is to detect the presence of a cookie popup on the page and set the most private settings while still allowing the page to function.
If there is no cookie popup visible in the viewport, or if the popup does not provide ways to opt-out, you should respond with "FINISHED" and stop.
NEVER use "Accept All" or similar buttons.
DO NOT enable marketing and analytics cookies.
When in doubt, give up immediately and respond with "FINISHED".
If there is a "reject all" button or similar, you should use it.
You should reject all optional cookies and tracking technologies. If some cookies are strictly required for the page to function, it is okay to accept them. For example, you should reject cookies for analytics, advertising, and social media, but it's okay to accept functional cookies.
If there is no "reject" button in the cookie popup, but there is a "cookie settings" button (or similar), you should use it to open the cookie settings dialog.
When present with a list of toggles, disable all optional items before saving the settings.
`;

const BINDING_NAME_PREFIX = 'cdpAutoconsentSendMessage_';
const SCRAPE_TIMEOUT = 120000;
const OPTOUT_TIMEOUT = 30000;
const DETECT_TIMEOUT = 5000;
const FOUND_TIMEOUT = 5000;
const WAIT_FOR_SETTINGS_LOAD_MS = 2000;

/**
 * @param {string} bindingName
 * @returns {string}
 */
function getAutoconsentContentScript(bindingName) {
    return (
        `
window.autoconsentSendMessage = (msg) => {
    window.${bindingName}(JSON.stringify(msg));
};
` + baseContentScript
    );
}

const cookiePopupScrapeScript = fs.readFileSync(require.resolve('./CookiePopups/scrapeScript.js'), 'utf8');
const agentHelpersScript = fs.readFileSync(require.resolve('./CookiePopups/agentHelpers.js'), 'utf8');

if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is not set.');
    console.error('Please set it or remove the --check-false-negatives flag.');
    process.exit(1);
}
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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
        this.options = options;
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

        /** @type {import('../node_modules/@duckduckgo/autoconsent/lib/rules').AutoConsentCMPRule | undefined} */
        this.multiClickAutoconsentRule = undefined;
        this.autoconsentRuleReady = false;
        /** @type {import('puppeteer-core').CDPSession | null} */
        this.pageSession = null;
        this.lastCallId = null;
        this.screenshotCounter = 0;
    }

    /**
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo} targetInfo
     */
    addTarget(session, targetInfo) {
        if (targetInfo.type === 'page') {
            this.pageSession = session;
        }
        super.addTarget(session, targetInfo);
    }

    /**
     * @param {Partial<ContentScriptMessage>} msg
     * @returns {ContentScriptMessage | null}
     */
    findMessage(msg, partial = true) {
        for (const m of this.receivedMsgs) {
            const keysMatch = partial || Object.keys(m).length === Object.keys(msg).length;
            // @ts-ignore
            if (keysMatch && Object.keys(msg).every((k) => m[k] === msg[k])) {
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
        return this.receivedMsgs.filter((m) => {
            const keysMatch = partial || Object.keys(m).length === Object.keys(msg).length;
            // @ts-ignore
            return keysMatch && Object.keys(msg).every((k) => m[k] === msg[k]);
        });
    }

    /**
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription} context
     */
    async onIsolatedWorldCreated(session, context) {
        const bindingName = `${BINDING_NAME_PREFIX}${context.uniqueId.replace(/\W/g, '_')}`;
        session.on('Runtime.bindingCalled', async ({ name, payload }) => {
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
                    isMainWorld: false,
                };
                await this.cdpSessions.get(executionContextUniqueId)?.send('Runtime.evaluate', {
                    expression: `autoconsentReceiveMessage({ type: "initResp", config: ${JSON.stringify(autoconsentConfig)}, rules: ${stringifiedRules} })`,
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
                msg.state.heuristicPatterns.forEach((x) => this.scanResult.patterns.add(x));
                msg.state.heuristicSnippets.forEach((x) => this.scanResult.snippets.add(x));
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
    async waitForMessage({ msg, maxTimes = 20, interval = 100 }) {
        if (this.shortTimeouts) {
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
        const detectedMsg = /** @type {DetectedMessage | null} */ (
            await this.waitForMessage({
                msg: { type: 'cmpDetected' },
                maxTimes: DETECT_TIMEOUT / 200,
                interval: 200,
            })
        );
        if (!detectedMsg) {
            return null;
        }

        // was there a popup?
        const found = /** @type {FoundMessage | null} */ (
            await this.waitForMessage({
                msg: { type: 'popupFound' },
                maxTimes: FOUND_TIMEOUT / 200,
                interval: 200,
            })
        );
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
                    cmp: popupFoundMsg.cmp,
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
        const doneMsg = /** @type {DoneMessage} */ (
            await this.waitForMessage({
                msg: { type: 'autoconsentDone' },
                maxTimes: 10,
                interval: 100,
            })
        );
        if (!doneMsg) {
            return;
        }

        // the final name might be different than the detected name, in case of intermediate rules
        if (this.selfTestFrame) {
            // did self-test succeed?
            await this.waitForMessage({
                msg: { type: 'selfTestResult' },
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

        const doneMsg = /** @type {DoneMessage} */ (
            this.findMessage({
                type: 'autoconsentDone',
            })
        );

        const selfTestResult = /** @type {SelfTestResultMessage} */ (
            this.findMessage({
                type: 'selfTestResult',
            })
        );

        const errorMsgs = /** @type {ErrorMessage[]} */ (
            this.findAllMessages({
                type: 'autoconsentError',
            })
        );
        const errors = errorMsgs.map((e) => JSON.stringify(e.details));

        const detectedRules = /** @type {DetectedMessage[]} */ (this.findAllMessages({ type: 'cmpDetected' }));
        /** @type {string[]} */
        const processedCmps = [];
        for (const msg of detectedRules) {
            if (processedCmps.includes(msg.cmp)) {
                // prevent duplicates
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

            const found = this.findMessage({ type: 'popupFound', cmp: msg.cmp });
            if (found) {
                result.open = true;
                if (this.autoAction) {
                    const resultType = this.autoAction === 'optOut' ? 'optOutResult' : 'optInResult';
                    result.started = true;
                    const autoActionResult = /** @type {OptOutResultMessage|OptInResultMessage} */ (
                        this.findMessage({
                            type: resultType,
                            cmp: msg.cmp,
                        })
                    );
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
     * Classify all popups and buttons with LLM/regex (in-place)
     * @param {ScrapeScriptResult} result
     * @param {import('openai').OpenAI} openai
     * @returns {Promise<{rejectButtons: ButtonData[], saveButtons: ButtonData[], settingsButtons: ButtonData[]}>}
     */
    async classifyPopupsInScrapeResult(result, openai) {
        let llmPopupDetected = false;
        let regexPopupDetected = false;
        const rejectButtons = [];
        const saveButtons = [];
        const settingsButtons = [];
        if (result.potentialPopups.length > 0) {
            // classify popups and buttons with LLM/regex
            for (const popup of result.potentialPopups) {
                const popupClassificationResult = await classifyPopup(popup, openai);
                popup.llmMatch = popupClassificationResult.llmMatch;
                popup.regexMatch = popupClassificationResult.regexMatch;
                popup.rejectButtons = popupClassificationResult.rejectButtons;
                popup.saveButtons = popupClassificationResult.saveButtons;
                popup.settingsButtons = popupClassificationResult.settingsButtons;
                rejectButtons.push(...popupClassificationResult.rejectButtons);
                settingsButtons.push(...popupClassificationResult.settingsButtons);
                saveButtons.push(...popupClassificationResult.saveButtons);
                popup.otherButtons = popupClassificationResult.otherButtons;
                if (popupClassificationResult.llmMatch) {
                    llmPopupDetected = true;
                }
                if (popupClassificationResult.regexMatch) {
                    regexPopupDetected = true;
                }
            }
        }
        result.llmPopupDetected = llmPopupDetected;
        result.regexPopupDetected = regexPopupDetected;
        this.log(`result.llmPopupDetected: ${result.llmPopupDetected}, rejectButtons.length: ${rejectButtons.length}, saveButtons.length: ${saveButtons.length}, settingsButtons.length: ${settingsButtons.length}`);
        return { rejectButtons, saveButtons, settingsButtons };
    }

    bootstrapAutoconsentRule() {
        this.multiClickAutoconsentRule = {
            name: `auto_REGION_${this.options.url.hostname}_${Math.random().toString(36).substring(2, 5)}`,
            cosmetic: false,
            _metadata: {
                vendorUrl: this.options.url.toString(),
            },
            runContext: {
                main: true,
                frame: false,
                urlPattern: `^https?://(www\\.)?${this.options.url.hostname.replace(/\./g, '\\.')}/`,
            },
            "prehideSelectors": [],
            detectCmp: [],
            detectPopup: [],
            optIn: [],
            optOut: [],
            test: [],
        };
    }

    /**
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription['uniqueId']} executionContextUniqueId
     * @param {ButtonData[]} settingsButtons
     * @param {ScrapeScriptResult} result
     * @returns {Promise<ScrapeScriptResult>}
     */
    async settingsFlow(session, executionContextUniqueId, settingsButtons, result) {
        this.bootstrapAutoconsentRule();
        // FIXME: handle case of multiple settings buttons
        const settingsButton = settingsButtons[0];

        // add the settings button to the autoconsent rule
        this.multiClickAutoconsentRule.detectCmp.push({ exists: settingsButton.selector });
        this.multiClickAutoconsentRule.detectPopup.push({ visible: settingsButton.selector });
        this.multiClickAutoconsentRule.optOut.push({ waitForThenClick: settingsButton.selector, comment: settingsButton.text });
        this.multiClickAutoconsentRule.test.push({ waitForVisible: settingsButton.selector, timeout: 1000, check: 'none' });

        this.log(`Triggering settings flow for ${executionContextUniqueId} with button ${settingsButton.selector}`);
        await session.send('Runtime.evaluate', {
            expression: `document.querySelector('${settingsButton.selector}').click()`,
            allowUnsafeEvalBlockedByCSP: true,
            uniqueContextId: executionContextUniqueId,
        });
        // give the settings a couple seconds to load
        await (new Promise((resolve) => setTimeout(resolve, WAIT_FOR_SETTINGS_LOAD_MS)));
        // scrape the new page state, disallow recursive settings flow
        const settingsResult = await this.scrapeSingleContext(executionContextUniqueId, session, false);
        if (settingsResult) {
            settingsResult.beforeSettings = result;
            const { rejectButtons, saveButtons } = await this.classifyPopupsInScrapeResult(settingsResult, openai);
            for (const popup of settingsResult.potentialPopups) {
                for (const toggle of popup.toggles) {
                    if (toggle.isDisabled) {
                        continue;
                    }
                    if (toggle.type === 'checkbox' && toggle.isChecked || toggle.type === 'radio' && !toggle.isChecked) {
                        // add the toggle to the autoconsent rule
                        this.multiClickAutoconsentRule.optOut.push({ waitForThenClick: toggle.selector, comment: toggle.labelApprox });

                        this.log(`Clicking ${toggle.type} "${toggle.labelApprox}" in the settings page: ${toggle.selector} in ${executionContextUniqueId} document.querySelector('${toggle.selector}').click()`);
                        const clickResult = await session.send('Runtime.evaluate', {
                            expression: `document.querySelector('${toggle.selector}').click()`,
                            allowUnsafeEvalBlockedByCSP: true,
                            uniqueContextId: executionContextUniqueId,
                        });
                        this.log(`Click result: ${JSON.stringify(clickResult)}`);
                    }
                }
            }
            if (rejectButtons.length > 0) {
                // FIXME: handle case of multiple reject buttons
                const rejectButton = rejectButtons[0];

                // add the reject button to the autoconsent rule
                this.multiClickAutoconsentRule.optOut.push({ waitForThenClick: rejectButton.selector, comment: rejectButton.text });
                this.multiClickAutoconsentRule.test.push({ waitForVisible: rejectButton.selector, timeout: 1000, check: 'none' });
                // there's a chance that the reject button will finish the flow
                this.autoconsentRuleReady = true;

                this.log(`Clicking reject button in the settings page: ${rejectButton.selector} in ${executionContextUniqueId}`);
                // if there is a reject button in the settings page, click it
                await session.send('Runtime.evaluate', {
                    expression: `document.querySelector('${rejectButton.selector}').click()`,
                    allowUnsafeEvalBlockedByCSP: true,
                    uniqueContextId: executionContextUniqueId,
                });
            }
            if (saveButtons.length > 0) {
                // FIXME: handle case of multiple save buttons
                const saveButton = saveButtons[0];

                // add the save button to the autoconsent rule
                this.multiClickAutoconsentRule.optOut.push({ waitForThenClick: saveButton.selector, comment: saveButton.text });
                this.multiClickAutoconsentRule.test.push({ waitForVisible: saveButton.selector, timeout: 1000, check: 'none' });
                // the save button will finish the flow
                this.autoconsentRuleReady = true;

                this.log(`Clicking save button in the settings page: ${saveButton.selector} in ${executionContextUniqueId}`);
                // if there is a save button in the settings page, click it
                await session.send('Runtime.evaluate', {
                    expression: `document.querySelector('${saveButton.selector}').click()`,
                    allowUnsafeEvalBlockedByCSP: true,
                    uniqueContextId: executionContextUniqueId,
                });
            }
        }

        return settingsResult;
    }


    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription['uniqueId']} executionContextUniqueId
     * @param {import('puppeteer-core').CDPSession} session
     * @param {boolean} canTriggerSettingsFlow
     * @returns {Promise<ScrapeScriptResult | null>}
     */
    async scrapeSingleContext(executionContextUniqueId, session, canTriggerSettingsFlow) {
        try {
            const evalResult = await session.send('Runtime.evaluate', {
                expression: cookiePopupScrapeScript,
                uniqueContextId: executionContextUniqueId,
                returnByValue: true,
                allowUnsafeEvalBlockedByCSP: true,
            });
            if (evalResult.exceptionDetails) {
                this.log(
                    `Error evaluating scrape script: ${evalResult.exceptionDetails.text} ${evalResult.exceptionDetails.exception?.description}`,
                );
                return null;
            }
            /** @type {ScrapeScriptResult} */
            const result = evalResult.result.value;
            if (result.cleanedText || result.potentialPopups.length > 0) {
                const { rejectButtons, settingsButtons } = await this.classifyPopupsInScrapeResult(result, openai);
                if (canTriggerSettingsFlow && result.llmPopupDetected && rejectButtons.length === 0 && settingsButtons.length > 0) {
                    // if there's no one-click reject button, try to click the settings button
                    return await this.settingsFlow(session, executionContextUniqueId, settingsButtons, result);
                }
                return result;
            }
            return null;
        } catch (e) {
            if (!this.isIgnoredCdpError(e)) {
                this.log(`Error evaluating scrape script: ${e}`);
            }
            return null;
        }
    }

    /**
     * @returns {Promise<string>}
     */
    async getScreenshot() {
        let screenshot = STUB_IMAGE;
        try {
            const result = await wait(
                this.pageSession.send('Page.captureScreenshot', { format: 'png' }),
                20000,
                'Screenshot timed out',
            );
            screenshot = result.data;
        } catch (e) {
            this.log('Screenshot error', e.message);
        }
        fs.writeFileSync(`./screenshot-${this.screenshotCounter++}.png`, Buffer.from(screenshot, 'base64'));
        return screenshot;
    }

    async handleComputerCall(action) {
        console.log('(computer_call)', action);
        const actionType = action.type;

        if (action.pending_safety_checks?.length > 0) {
            console.log('Pending safety checks:', JSON.stringify(action.pending_safety_checks));
            return false;
        }

        try {
            switch (actionType) {
                case "click": {
                    const { x, y, button = "left" } = action;
                    console.log(`Action: click at (${x}, ${y}) with button '${button}'`);

                    const clickResult = await this.pageSession.send('Runtime.evaluate', {
                        expression: `{
                        ${agentHelpersScript}
                        clickElement(${x}, ${y});
                        }`,
                        allowUnsafeEvalBlockedByCSP: true,
                        returnByValue: true,
                    });
                    if (clickResult.exceptionDetails) {
                        this.log(
                            `Error evaluating agent helpers script: ${clickResult.exceptionDetails.text} ${clickResult.exceptionDetails.exception?.description}`,
                        );
                        return false;
                    }
                    console.log('Click result:', clickResult.result.value);
                    // wait for the click to take effect
                    await (new Promise((resolve) => setTimeout(resolve, 2000)));
                    return true;
                }

                case "scroll": {
                    const { x, y, scroll_x, scroll_y } = action;
                    console.log(`Action: scroll by (${scroll_x}, ${scroll_y}) from (${x}, ${y})`);
                    await this.pageSession.send('Input.synthesizeScrollGesture', {
                        x: 10,
                        y: 10,
                        xDistance: scroll_x,
                        yDistance: scroll_y,
                    });
                    return true;
                }

                case "wait": {
                    console.log(`Waiting...`);
                    await (new Promise((resolve) => setTimeout(resolve, 2000)));
                    return true;
                }

                case "screenshot": {
                    // Nothing to do as screenshot is taken at each turn
                    console.log(`Action: screenshot`);
                    return true;
                }

                default:
                    console.log("Unrecognized action:", action);
                    return false;
              }
        } catch (e) {
            console.error("Error handling action", action, ":", e);
            return false;
        }
    }

    /**
     *
     * @param {import('openai').OpenAI.Responses.ResponseInput} input
     * @returns
     */
    async callComputerUseModel(input) {
        return await openai.responses.create({
            model: "computer-use-preview",
            tools: [
                {
                    type: "computer_use_preview",
                    display_width: 1440,
                    display_height: 812,
                    environment: "browser",
                },
            ],

            input: input,

            reasoning: {
                summary: "concise",
            },
            truncation: "auto",
        });
    }

    async handleAgentResponse(response) {
        let finished = false;

        while (!finished) {
            // console.log('OPENAI RESPONSE:', JSON.stringify(response, null, 4));
            console.log('OPENAI output:', JSON.stringify(response.output, null, 4));
            if (response.error) {
                this.log('Error from OpenAI:', JSON.stringify(response.error));
                finished = true;
                break;
            }
            this.lastCallId = null;
            for (const item of response.output) {
                if (item.type === 'reasoning') {
                    item.summary?.forEach(summaryItem => {
                        console.log('(reasoning)', summaryItem.text);
                        if (summaryItem.text.includes('FINISHED')) {
                            finished = true;
                        }
                    });
                } else if (item.type === 'message') {
                    item.content?.forEach(contentItem => {
                        console.log('(message)', contentItem.text);
                        if (contentItem.text.includes('FINISHED')) {
                            finished = true;
                        }
                    });
                } else if (item.type === 'computer_call') {
                    this.lastCallId = item.call_id;
                    const success = await this.handleComputerCall(item.action);
                    if (!success) {
                        this.log('Error handling computer call', JSON.stringify(item));
                        finished = true;
                    }
                } else {
                    console.log('Unrecognized item type:', JSON.stringify(item));
                    finished = true;
                    break;
                }
            }
            if (!finished) {
                const newScreenshot = await this.getScreenshot();
                /** @type {import('openai/resources/responses/responses.js').ResponseInput} */
                const input = [];
                if (this.lastCallId) {
                    input.push(
                        {
                            role: "user",
                            content: [
                                {
                                    type: "input_text",
                                    text: INITIAL_PROMPT,
                                },
                            ]
                        },
                        ...response.output,
                        {
                            call_id: this.lastCallId,
                            type: "computer_call_output",
                            output: {
                                type: "computer_screenshot",
                                image_url: `data:image/png;base64,${newScreenshot}`,
                            }
                        }
                    );
                } else {
                    console.log('no computer calls detected');
                    input.push({
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: INITIAL_PROMPT,
                            },
                            {
                                type: "input_image",
                                image_url: `data:image/png;base64,${newScreenshot}`,
                                detail: 'auto'
                            }
                        ]
                    });
                }
                response = await this.callComputerUseModel(input);
            }
        }
    }

    /**
     * Run a computer use model loop to handle the popups
     * @returns {Promise<CookiePopupsCollectorResult>}
     */
    async agentLoop() {
        const firstScreenshot = await this.getScreenshot();
        const input = [{
            role: "user",
            content: [
                {
                    type: "input_text",
                    text: INITIAL_PROMPT,
                },
                {
                    type: "input_image",
                    image_url: `data:image/png;base64,${firstScreenshot}`,
                    detail: 'auto'
                }
            ]
        }];
        const response = await this.callComputerUseModel(input);
        await this.handleAgentResponse(response);
    }

    async scrapePopups() {
        const scrapeScriptTimer = createTimer();

        const result = await this.agentLoop();
        this.log(`Handling popups took ${scrapeScriptTimer.getElapsedTime()}s`);
        return result;
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
            (scrapedFrames) => {
                this.scrapeJobDeferred.resolve(scrapedFrames);
                return scrapedFrames;
            },
            (e) => {
                if (e instanceof TimeoutError) {
                    // do not fail the whole crawl on timeout
                    this.log(e.message);
                    const emptyResult = /** @type {ScrapeScriptResult[]} */ ([]);
                    this.scrapeJobDeferred.resolve(emptyResult);
                    return emptyResult;
                }
                this.scrapeJobDeferred.reject(e);
                throw e;
            },
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
            autoconsentRule: this.multiClickAutoconsentRule,
            autoconsentRuleReady: this.autoconsentRuleReady,
        };
    }
}

/**
 * @typedef CookiePopupsCollectorResult
 * @property {AutoconsentResult[]} cmps
 * @property {ScrapeScriptResult[]} scrapedFrames
 * @property {import('../node_modules/@duckduckgo/autoconsent/lib/rules').AutoConsentCMPRule} autoconsentRule
 * @property {boolean} autoconsentRuleReady
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
 * @property {ButtonData[]} [settingsButtons]
 * @property {ButtonData[]} [saveButtons]
 * @property {ButtonData[]} [otherButtons]
 * @property {ScrapeScriptResult} [beforeSettings]
 */

/**
 * @typedef PopupData
 * @property {string} text
 * @property {string} selector
 * @property {ButtonData[]} buttons
 * @property {ToggleData[]} toggles
 * @property {boolean} [llmMatch]
 * @property {boolean} [regexMatch]
 * @property {ButtonData[]} [rejectButtons]
 * @property {ButtonData[]} [settingsButtons]
 * @property {ButtonData[]} [saveButtons]
 * @property {ButtonData[]} [otherButtons]
 */

/**
 * @typedef ButtonData
 * @property {string} text
 * @property {string} selector
 */

/**
 * @typedef ToggleData
 * @property {'checkbox' | 'radio'} type
 * @property {string} labelApprox
 * @property {boolean} isChecked
 * @property {boolean} isDisabled
 * @property {string} selector
 */

/**
 * @typedef { import('./BaseCollector').CollectorInitOptions } CollectorInitOptions
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/types').AutoAction } AutoAction
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/messages').ContentScriptMessage } ContentScriptMessage
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/types').Config } AutoconsentConfig
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/messages').DetectedMessage } DetectedMessage
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/messages').FoundMessage } FoundMessage
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/messages').SelfTestResultMessage } SelfTestResultMessage
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/messages').ErrorMessage } ErrorMessage
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/messages').OptOutResultMessage } OptOutResultMessage
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/messages').OptInResultMessage } OptInResultMessage
 * @typedef { import('../node_modules/@duckduckgo/autoconsent/lib/messages').DoneMessage } DoneMessage
 * @typedef { { snippets: Set<string>, patterns: Set<string>, filterListMatched: boolean } } ScanResult
 */

module.exports = CookiePopupsCollector;
