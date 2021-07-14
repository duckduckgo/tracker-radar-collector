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
        this._log = log;
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('./TargetCollector').TargetType}} targetInfo 
     */
    async addTarget({cdpClient, url}) {
        const trackerTracker = new TrackerTracker(cdpClient.send.bind(cdpClient));
        trackerTracker.setMainURL(url.toString());

        cdpClient.on('Runtime.bindingCalled', this.onBindingCalled.bind(this, trackerTracker));
        await cdpClient.send('Runtime.addBinding', {name: 'registerAPICall'});
        cdpClient.on('Runtime.executionContextCreated', this.onExecutionContextCrated.bind(this, trackerTracker, cdpClient));

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
     * @param {{context: {id: string, origin: string, auxData: {type: string}}}} params 
     */
    async onExecutionContextCrated(trackerTracker, cdpClient, params) {
        // ignore context created by puppeteer / our crawler
        if ((!params.context.origin || params.context.origin === '://') && params.context.auxData.type === 'isolated') {
            return;
        }

        await trackerTracker.setupContextTracking(params.context.id);
    }

    /**
     * @param {TrackerTracker} trackerTracker
     * @param {{payload: string, description: string, executionContextId: number}} params 
     */
    onBindingCalled(trackerTracker, params) {
        const breakpoint = trackerTracker.processDebuggerPause(params);

        if (breakpoint && breakpoint.source && breakpoint.description) {
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

            if (breakpoint.saveArguments) {
                this._calls.push({
                    source: breakpoint.source,
                    description: breakpoint.description,
                    arguments: breakpoint.arguments
                });
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
  * @property {object} arguments - preview or the passed arguments
  */