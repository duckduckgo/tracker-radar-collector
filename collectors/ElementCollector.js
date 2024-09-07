const fs = require('fs').promises;
const BaseCollector = require('./BaseCollector');

class ElementCollector extends BaseCollector {

    id() {
        return 'elements';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options 
     */
    init(options) {
        this.context = options.context;
        this.log = options.log;
        /**
         * @type {import('puppeteer').Frame[]}
         */
        this.frames = [];
        this.cookieSelectors = this._loadCookieMonsterRules();
    }

    async _loadCookieMonsterRules() {
        const contents = String(await fs.readFile('./fanboy-cookiemonster.txt', {encoding: 'utf-8'}));
        return contents.split('\n').filter(line => line.startsWith('##')).map(line => line.slice(2));
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('./TargetCollector').TargetType}} targetInfo 
     */
    // eslint-disable-next-line no-unused-vars
    addTarget(targetInfo) {
        if (targetInfo.type === 'page') {
            this.context.pages().then(pages => {
                this.page = pages[0];
                this.check = new Promise(resolve => {
                    this.page.on('load', async () => {
                        // check CSS rule matches
                        const selectors = await this.cookieSelectors;
                        const isMatched = await Promise.all(selectors.map(async selector => (await this.page.$(selector)) !== null));
                        const present = selectors.filter((_, i) => isMatched[i]);
                        const visible = await this.page.evaluate(testSelectors => {
                            /**
                             * @param {HTMLElement} elem
                             */
                            function isElementVisible(elem) {
                                if (!elem) {
                                    return false;
                                }
                                if (elem.offsetParent !== null) {
                                    return true;
                                }
                                // eslint-disable-next-line no-undef
                                const css = window.getComputedStyle(elem);
                                if (css.position === 'fixed' && css.display !== "none") { // fixed elements may be visible even if the parent is not
                                    return true;
                                }
                                return false;
                            }
                            return testSelectors.filter((/** @type {string} */ s) => {
                                // eslint-disable-next-line no-undef
                                const elem = document.querySelectorAll(s);
                                const results = new Array(elem.length);
                                elem.forEach((e, i) => {
                                    // check for display: none
                                    // @ts-ignore
                                    results[i] = isElementVisible(e);
                                    if (results[i]) {
                                        e.setAttribute('style', 'border: 4px dashed red;');
                                    }
                                });
                                return results.some(r => r);
                            });
                        }, present);
                        resolve({
                            present,
                            visible,
                        });
                    });
                });
            }, () => this.log('Unable to get pages'));
        }
    }

    /**
     * Called after the crawl to retrieve the data. Can be async, can throw errors.
     * 
     * @param {{finalUrl: string, urlFilter?: function(string):boolean}} options
     * @returns {Promise<Object>|Object}
     */
    // eslint-disable-next-line no-unused-vars
    getData(options) {
        return this.check;
    }
}

module.exports = ElementCollector;