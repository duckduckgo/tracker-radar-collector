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
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo} targetInfo
     */

    addTarget(session, targetInfo) {
        this._targets.push({
            type: targetInfo.type,
            url: targetInfo.url,
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
 * @property {string} type
 */
