const BaseCollector = require('./BaseCollector');
const TrackerTracker = require('./APICalls/TrackerTracker');
const chalk = require('chalk').default;
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

    // TODO: make sure not to conflict with other such handlers
    /**
     * @param {TrackerTracker} trackerTracker
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.PausedEvent} params
     */
    async onDebuggerPaused(trackerTracker, params) {
        const breakpoint = trackerTracker.processDebuggerPause(params);
        if (!breakpoint) {
            // it's not a breakpoint we care about
            this._log(chalk.yellow('Unknown breakpoint detected.'), chalk.gray(`${params.hitBreakpoints}`));
            return;
        }

        if (breakpoint.source && breakpoint.description) {
            let sourceStats = null;
            if (this._stats.has(breakpoint.source)) {
                sourceStats = this._stats.get(breakpoint.source);
            } else {
                sourceStats = new Map();
                this._stats.set(breakpoint.source, sourceStats);
            }
    
            let count = 0;

            if (sourceStats.has(breakpoint.description)) {
                count = sourceStats.get(breakpoint.description);
            }
    
            sourceStats.set(breakpoint.description, count + 1);

            if (breakpoint.saveArguments && params.callFrames && params.callFrames.length) {
                try {
                    const args = /** @type {import('devtools-protocol/types/protocol').Protocol.Debugger.EvaluateOnCallFrameResponse} */ (await trackerTracker.sendCommand('Debugger.evaluateOnCallFrame', {
                        callFrameId: params.callFrames[0].callFrameId,
                        expression: 'arguments',
                        silent: true,
                        generatePreview: true
                    }));

                    // last two properties are always `callee` and `Symbol.iterator` that are useless
                    const preview = args && args.result && args.result.preview && args.result.preview.properties.slice(0, -2);

                    this._calls.push({
                        source: breakpoint.source,
                        description: breakpoint.description,
                        arguments: preview
                    });
                } catch (e) {
                    this._log(chalk.yellow('Failed to get call arguments.'), chalk.gray(e.message), chalk.gray(e.stack));
                }
            }
        }

        trackerTracker.sendCommand('Debugger.resume').catch(e => {
            const error = typeof e === 'string' ? e : e.message;

            if (error.includes('Target closed.') || error.includes('Session closed.')) {
                // we don't care if tab was closed during this opperation
            } else {
                if (error.includes('Operation timed out')) {
                    this._log(chalk.red('Debugger got stuck.'));
                }
                this._incompleteData = true;
            }
        });
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
 * @typedef SavedCall
 * @property {string} source - source script
 * @property {string} description - breakpoint description
 * @property {import('devtools-protocol/types/protocol').Protocol.Runtime.PropertyPreview[]} arguments - preview or the passed arguments
 */

/**
 * @typedef APICallReport
 * @property {SavedCall[]} savedCalls
 * @property {Object<string, APICallData>} callStats
 */