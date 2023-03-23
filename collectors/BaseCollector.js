class BaseCollector {

    id() {
        return 'base';
    }

    /**
     * Called before the crawl begins. Can be async, can throw errors.
     * 
     * @param {CollectorInitOptions} options 
     */
    // eslint-disable-next-line no-unused-vars
    init(options) {
    }

    /**
     * Called whenever new target becomes available (e.g. main page, iframe, web worker). Can be async, can throw errors.
     * 
     * @param {TargetInfo} targetInfo 
     */
    // eslint-disable-next-line no-unused-vars
    addTarget(targetInfo) {
    }

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
    // eslint-disable-next-line no-unused-vars
    getData(options) {
        return Promise.resolve();
    }
}

/**
 * @typedef CollectorInitOptions
 * @property {import('../browser/LocalChrome').BrowserConnection} browserConnection
 * @property {URL} url
 * @property {function(...any):void} log
 * @property {Object.<string, string>} collectorFlags
 */

/**
 * @typedef {Object} TargetInfo
 * @property {import('devtools-protocol/types/protocol').Protocol.Target.TargetID} id
 * @property {string} type
 * @property {string} url
 * @property {import('puppeteer-core/lib/cjs/puppeteer/common/Connection').CDPSession} session
 */


module.exports = BaseCollector;