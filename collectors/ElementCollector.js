const BaseCollector = require('./BaseCollector');

/**
 * Collect page elements that a page defines, such as referrer policy meta tags.
 */
class ElementCollector extends BaseCollector {

    id() {
        return 'element';
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
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('puppeteer').TargetType}} targetInfo 
     */
    // eslint-disable-next-line no-unused-vars
    addTarget(targetInfo) {
        if (targetInfo.type !== 'page') {
            return;
        }
        this._cdpClient = targetInfo.cdpClient;
    }

    /**
     * Called when a page is loaded
     *
     * @param {import('puppeteer').Page} page
     */
    onPageLoad (page) {
        this._page = page;
    }

    /**
     * Called after the crawl to retrieve the data. Can be async, can throw errors.
     * 
     * @param {{finalUrl: string, urlFilter?: function(string):boolean}} options
     * @returns {Promise<Object>}
     */
    // eslint-disable-next-line no-unused-vars
    async getData(options) {
        let referrerPolicy = await this._page.$eval("meta[name='referrer']", el => el.getAttribute('content'));
        return {
            metaReferrer: referrerPolicy
        };
    }
}

/**
 * @typedef CollectorInitOptions
 * @property {import('puppeteer').Browser} browser
 * @property {import('puppeteer').BrowserContext} context
 * @property {URL} url
 * @property {function(...any):void} log
 */

module.exports = ElementCollector;