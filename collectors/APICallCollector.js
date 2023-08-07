const BaseCollector = require('./BaseCollector');
const URL = require('url').URL;
const apiProcessors = require('./APICalls/APIProcessor');

/**
 * @typedef {apiProcessors.APIProcessor} APIProcessor
 */

class APICallCollector extends BaseCollector {

    id() {
        return 'apis';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options
     */
    init({log}) {
        /**
         * @type {SavedCall[]}
         */
        this._calls = [];
        this._incompleteData = false;
        this._log = log;
        //this._apiProcessor = apiProcessors.APIProcessorStackHead;
        this._apiProcessor = apiProcessors.APIProcessorV8;
    }

    /**
     * @param {import('./BaseCollector').TargetInfo} targetInfo
     */
    async addTarget({cdpClient, url}) {
        const apiProcessor = new this._apiProcessor(cdpClient.send.bind(cdpClient));
        apiProcessor.setMainURL(url.toString());

        cdpClient.on('Debugger.scriptParsed', this.onScriptParsed.bind(this, apiProcessor));
        cdpClient.on('Debugger.paused', this.onDebuggerPaused.bind(this, apiProcessor));
        cdpClient.on('Runtime.executionContextCreated', this.onExecutionContextCreated.bind(this, apiProcessor, cdpClient));
        cdpClient.on('Runtime.bindingCalled', this.onBindingCalled.bind(this, apiProcessor));
        await cdpClient.send('Runtime.addBinding', {name: 'registerAPICall'});

        try {
            await apiProcessor.init({log: this._log});
        } catch(e) {
            this._log('APIProcessor init failed.');
            throw e;
        }
    }

    /**
     * @param {APIProcessor} apiProcessor
     * @param {import('puppeteer').CDPSession} cdpClient
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextCreatedEvent} params
     */
    async onExecutionContextCreated(apiProcessor, cdpClient, params) {
        // ignore context created by puppeteer / our crawler
        if ((!params.context.origin || params.context.origin === '://') && params.context.auxData.type === 'isolated') {
            return;
        }

        await apiProcessor.setupContextTracking(params.context.id);
    }

    /**
     * @param {APIProcessor} apiProcessor
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.ScriptParsedEvent} params
     */
    onScriptParsed(apiProcessor, params) {
        apiProcessor.processScriptParsed(params);
    }


    /**
     * @param {APIProcessor} apiProcessor
     * @param {{name: string, payload: string, description: string, executionContextId: number}} params
     */
    onBindingCalled(apiProcessor, params) {
        if (params.name !== 'registerAPICall') {
            return;
        }
        const breakpoint = apiProcessor.processBindingPause(params);

        const call = apiProcessor.processBreakpointToCall(breakpoint);
        if (call) {
            this._calls.push(call);
        }
    }

    // TODO: IMPORTANT! This will resume all breakpoints, including ones from `debugger` and set by other collectors. Make sure we don't use onDebuggerPaused in other places.
    /**
     * @param {APIProcessor} apiProcessor
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.PausedEvent} params
     */
    onDebuggerPaused(apiProcessor, params) {
        // resume asap
        apiProcessor.sendCommand('Debugger.resume').catch(e => {
            const error = typeof e === 'string' ? e : e.message;

            if (error.includes('Target closed.') || error.includes('Session closed.')) {
                // we don't care if tab was closed during this opperation
            } else {
                if (error.includes('Operation timed out')) {
                    this._log('Debugger got stuck.');
                }
                this._incompleteData = true;
            }
        });

        const breakpoint = apiProcessor.processDebuggerPause(params);
        if (!breakpoint) {
            // it's not a breakpoint we care about
            this._log(`Unknown breakpoint detected. ${params.hitBreakpoints}`);
        }

        const call = apiProcessor.processBreakpointToCall(breakpoint);
        if (call) {
            this._calls.push(call);
        }
    }

    /**
     * @param {string} urlString
     * @param {function(string):boolean} urlFilter
     */
    isAcceptableUrl(urlString, urlFilter) {
        let url;

        try {
            url = new URL(urlString);
        } catch (e) {
            // ignore requests with invalid URL
            return false;
        }

        // ignore inlined resources
        if (url.protocol === 'data:') {
            return false;
        }

        return urlFilter ? urlFilter(urlString) : true;
    }

    /**
     * @param {{finalUrl: string, urlFilter?: function(string):boolean}} options
     * @returns {{callStats: Object<string, APICallData>, savedCalls: SavedCall[]}}
     */
    getData({urlFilter}) {
        if (this._incompleteData) {
            throw new Error('Collected data might be incomplete because of an runtime error.');
        }

        return this._apiProcessor.produceSummary(this._calls, {
            urlFilter: u => this.isAcceptableUrl(u, urlFilter),
            options: {includePositions: false},
        });
    }
}

module.exports = APICallCollector;

/**
 * @typedef {Object<string, number>} APICallData
 */

/**
 * @typedef { import('./APICalls/APIProcessor').SavedCall } SavedCall
 */

/**
 * @typedef APICallReport
 * @property {SavedCall[]} savedCalls
 * @property {Object<string, APICallData>} callStats
 */
