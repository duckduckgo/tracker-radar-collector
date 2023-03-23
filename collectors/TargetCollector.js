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
     * @param {import('./BaseCollector').TargetInfo} targetInfo 
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
 * @property {string} type
 */
