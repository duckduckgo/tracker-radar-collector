const BaseCollector = require('./BaseCollector');

/**
 * @type {import('@duckduckgo/autoconsent/lib/node')}
 */
// @ts-ignore
const autoconsent = require('@duckduckgo/autoconsent/dist/autoconsent.puppet');
const extraRules = require('@duckduckgo/autoconsent/rules/rules.json');

/**
 * @type {Object.<string, import('@duckduckgo/autoconsent/lib/consentomatic/').ConsentOMaticConfig>}}
 */
const consentomatic = extraRules.consentomatic;
const rules = [
    ...autoconsent.rules,
    ...Object.keys(consentomatic).map(name => new autoconsent.ConsentOMaticCMP(`com_${name}`, consentomatic[name])),
    ...extraRules.autoconsent.map(spec => autoconsent.createAutoCMP(spec)),
];

class CMPCollector extends BaseCollector {

    id() {
        return 'cmps';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options 
     */
    init(options) {
        this.context = options.context;
        this.doOptOut = Boolean(options.collectorFlags.runAutoconsent);
        this.log = options.log;
        /**
         * @type {import('puppeteer').Frame[]}
         */
        this.frames = [];
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
                    this.page.once('load', async () => {
                        this.tab = autoconsent.attachToPage(this.page, targetInfo.url, rules, 10);
                        const results = [];
                        try {
                            await this.tab.checked;
                            if (this.tab.getCMPName()) {
                                const entry = {
                                    name: this.tab.getCMPName(),
                                    isOpen: (await this.tab.isPopupOpen(10, 100)) || false,
                                    optOutRuns: false,
                                    optOutSucceeds: false,
                                    error: '',
                                };
                                try {
                                    if (this.doOptOut) {
                                        entry.optOutRuns = entry.isOpen && await this.tab.doOptOut();
                                        entry.optOutSucceeds = this.tab.hasTest() && await this.tab.testOptOutWorked();
                                    }
                                } catch (e) {
                                    entry.error = e.toString();
                                }
                                results.push(entry);
                            }
                        } catch (e) {
                            console.warn(`CMP error`, e);
                        }
                        resolve(results);
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

module.exports = CMPCollector;