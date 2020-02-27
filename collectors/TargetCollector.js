const BaseCollector = require('./BaseCollector');

class TargetCollector extends BaseCollector {

    id() {
        return 'targets';
    }

    init() {
        /**
         * @type {TargetData[]}
         */
        this._targets = [];
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('puppeteer').TargetType}} targetInfo 
     */
    addTarget({type, url}) {
        this._targets.push({
            type,
            url
        });
    }

    /**
     * @returns {TargetData[]}
     */
    getData() {
        return this._targets;
    }
}

module.exports = TargetCollector;

/**
 * @typedef TargetData
 * @property {string} url
 * @property {import('puppeteer').TargetType} type
 */
