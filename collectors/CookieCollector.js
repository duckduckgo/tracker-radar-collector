const BaseCollector = require('./BaseCollector');

class CookieCollector extends BaseCollector {

    id() {
        return 'cookies';
    }

    /**
     * CDP returns the date in a weird format (e.g. 1577836800.325027), here we fix it
     * 
     * @param {number} cdpDate 
     * @returns {number} 
     */
    normalizeDate(cdpDate) {
        if (cdpDate === -1) {
            return undefined;
        }

        return Math.floor(cdpDate * 1000);
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('./TargetCollector').TargetType}} targetInfo 
     */
    addTarget({cdpClient, type}) {
        if (type === 'page') {
            this._cdpClient = cdpClient;
        }
    }

    /**
     * @returns {Promise<CookieData[]>}
     */
    async getData() {
        await this._cdpClient.send('Page.enable');
        /**
         * @type {{cookies: CDPCookie[]}}
         */
        // @ts-ignore oversimplified .send signature
        const result = await this._cdpClient.send('Network.getAllCookies');

        return result.cookies
            .map(cookie => ({
                name: cookie.name,
                domain: cookie.domain,
                path: cookie.path,
                expires: this.normalizeDate(cookie.expires),
                session: cookie.session,
                sameSite: cookie.sameSite
            }));
    }
}

module.exports = CookieCollector;

/**
 * @typedef CookieData
 * @property {string} name
 * @property {string} domain
 * @property {string} path
 * @property {number=} expires
 * @property {boolean} session
 * @property {('Strict' | 'Lax' | 'Extended' | 'None')=} sameSite
 */

/**
 * @typedef CDPCookie
 * @property {string} name
 * @property {string} value
 * @property {string} domain
 * @property {string} path
 * @property {number} expires
 * @property {number} size
 * @property {boolean} httpOnly
 * @property {boolean} secure
 * @property {boolean} session
 * @property {'Strict' | 'Lax' | 'Extended' | 'None'} sameSite
 */
