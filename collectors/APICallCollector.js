const BaseCollector = require('./BaseCollector');
const TrackerTracker = require('./APICalls/TrackerTracker');
const URL = require('url').URL;

class APICallCollector extends BaseCollector {

    id() {
        return 'apis';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options
     */
    init({log}) {
        /**
         * @type {Map<string, Map<string, number>>}
         */
        this._stats = new Map();
        /**
         * @type {SavedCall[]}
         */
        this._calls = [];
        this._incompleteData = false;
        this._log = log;
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('./TargetCollector').TargetType}} targetInfo 
     */
    async addTarget({cdpClient, url}) {
        const trackerTracker = new TrackerTracker(cdpClient.send.bind(cdpClient));
        trackerTracker.setMainURL(url.toString());

        cdpClient.on('Debugger.scriptParsed', this.onScriptParsed.bind(this, trackerTracker));
        cdpClient.on('Debugger.paused', this.onDebuggerPaused.bind(this, trackerTracker));
        cdpClient.on('Runtime.executionContextCreated', this.onExecutionContextCreated.bind(this, trackerTracker, cdpClient));
        cdpClient.on('Runtime.bindingCalled', this.onBindingCalled.bind(this, trackerTracker));
        await cdpClient.send('Runtime.addBinding', {name: 'registerAPICall'});

        try {
            await trackerTracker.init({log: this._log});
        } catch(e) {
            this._log('TrackerTracker init failed.');
            throw e;
        }
    }

    /**
     * @param {TrackerTracker} trackerTracker
     * @param {import('puppeteer').CDPSession} cdpClient
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextCreatedEvent} params
     */
    async onExecutionContextCreated(trackerTracker, cdpClient, params) {
        // ignore context created by puppeteer / our crawler
        if ((!params.context.origin || params.context.origin === '://') && params.context.auxData.type === 'isolated') {
            return;
        }

        await trackerTracker.setupContextTracking(params.context.id);
    }

    /**
     * @param {TrackerTracker} trackerTracker
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.ScriptParsedEvent} params
     */
    async onScriptParsed(trackerTracker, params) {
        await trackerTracker.processScriptParsed(params);
    }


    /**
     * @param {{source: string, description: string}} breakpointInfo
     */
    _updateCallStats(breakpointInfo) {
        let sourceStats = null;
        if (this._stats.has(breakpointInfo.source)) {
            sourceStats = this._stats.get(breakpointInfo.source);
        } else {
            sourceStats = new Map();
            this._stats.set(breakpointInfo.source, sourceStats);
        }

        let count = 0;

        if (sourceStats.has(breakpointInfo.description)) {
            count = sourceStats.get(breakpointInfo.description);
        }

        sourceStats.set(breakpointInfo.description, count + 1);
    }

    /**
     * @param {TrackerTracker} trackerTracker
     * @param {{name: string, payload: string, description: string, executionContextId: number}} params
     */
    onBindingCalled(trackerTracker, params) {
        if (params.name !== 'registerAPICall') {
            return;
        }
        const breakpoint = trackerTracker.processBindingPause(params);

        if (breakpoint && breakpoint.source && breakpoint.description) {
            this._updateCallStats(breakpoint);

            if (breakpoint.saveArguments) {
                this._calls.push({
                    source: breakpoint.source,
                    description: breakpoint.description,
                    arguments: breakpoint.arguments
                });
            }
        }
    }

    // TODO: IMPORTANT! This will resume all breakpoints, including ones from `debugger` and set by other collectors. Make sure we don't use onDebuggerPaused in other places.
    /**
     * @param {TrackerTracker} trackerTracker
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.PausedEvent} params
     */
    onDebuggerPaused(trackerTracker, params) {
        // resume asap
        trackerTracker.sendCommand('Debugger.resume').catch(e => {
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

        const breakpoint = trackerTracker.processDebuggerPause(params);
        if (!breakpoint) {
            // it's not a breakpoint we care about
            this._log(`Unknown breakpoint detected. ${params.hitBreakpoints}`);
        }

        if (breakpoint && breakpoint.source && breakpoint.description) {
            this._updateCallStats(breakpoint);

            if (breakpoint.saveArguments) {
                // the corresponding call arguments should already be stored

                const call = trackerTracker.retrieveCallArguments(breakpoint.id);
                if (call) {
                    this._calls.push({
                        ...call,
                        source: breakpoint.source,
                    });
                } else {
                    this._log(`Missing call arguments for breakpoint ${breakpoint.id}`);
                }
            }
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

        /**
         * @type {Object<string, APICallData>}
         */
        const callStats = {};

        this._stats
            .forEach((calls, source) => {
                if (!this.isAcceptableUrl(source, urlFilter)) {
                    return;
                }

                callStats[source] = Array.from(calls)
                    .reduce((/** @type {Object<string, number>} */result, [script, number]) => {
                        result[script] = number;
                        return result;
                    }, {});
            });
    
        return {
            callStats,
            savedCalls: this._calls.filter(call => this.isAcceptableUrl(call.source, urlFilter))
        };
    }
}

module.exports = APICallCollector;

/**
 * @typedef {Object<string, number>} APICallData
 */

/**
 * @typedef { import('./APICalls/TrackerTracker').SavedCall } SavedCall
 */

/**
 * @typedef APICallReport
 * @property {SavedCall[]} savedCalls
 * @property {Object<string, APICallData>} callStats
 */
