class BaseCollector {
    /**
     * Override this to increase the total crawl time when this collector is enabled.
     */
    collectorExtraTimeMs = 0;

    id() {
        return 'base';
    }

    /**
     * Called before the crawl begins. Can be async, can throw errors.
     *
     * @param {CollectorInitOptions} options
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    init(options) {}

    /**
     * Called whenever new target becomes available (e.g. main page, iframe, web worker). Can be async, can throw errors.
     *
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo} targetInfo
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    addTarget(session, targetInfo) {}

    /**
     * Called after the page has loaded. Can be async, can throw errors.
     *
     * @returns {Promise<void>|Object}
     */
    postLoad() {
        return Promise.resolve();
    }

    /**
     * Called after the crawl to retrieve the data. Can be async, can throw errors.
     *
     * @param {{finalUrl: string, urlFilter?: function(string):boolean}} options
     * @returns {Promise<Object>|Object}
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getData(options) {
        return Promise.resolve();
    }
}

/**
 * @typedef CollectorInitOptions
 * @property {import('../browser/LocalChrome').BrowserConnection} browserConnection
 * @property {URL} url
 * @property {function(...any):void} log
 * @property {CollectorFlags} collectorFlags
 */

/**
 * @typedef CollectorFlags
 * @property {boolean=} enableAsyncStacktraces
 * @property {import('@duckduckgo/autoconsent/lib/types').AutoAction=} autoconsentAction
 * @property {boolean=} shortTimeouts  // used to speed up unit tests
 */

module.exports = BaseCollector;
