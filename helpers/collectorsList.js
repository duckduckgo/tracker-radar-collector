/**
 * @fileoverview Helper that provides IDs of all available collectors (based on the main.js file) and helps creating instances of collectors
 */
const allExports = require('../main');
// eslint-disable-next-line no-unused-vars
const BaseCollector = require('../collectors/BaseCollector');
const collectorClasses = Object.entries(allExports).filter(([name]) => name.endsWith('Collector')).map(([,collector]) => collector);
const collectors = collectorClasses.map(CollectorClass => ({
    // @ts-ignore
    id: (new CollectorClass()).id(),
    Klass: CollectorClass
}));

/**
 * @returns {string[]}
 */
function getCollectorIds() {
    return collectors.map(({id}) => id);
}

/**
 * @param {string} id 
 * @returns {BaseCollector}
 */
function createCollector(id) {
    const collector = collectors.find(c => c.id === id);

    if (!collector) {
        throw new Error(`Unknown collector id "${id}".`);
    }

    // @ts-ignore
    return (new collector.Klass());
}

module.exports = {
    getCollectorIds,
    createCollector
};

/**
 * @typedef CollectorData
 * @property {import('../collectors/APICallCollector').APICallReport=} apis
 * @property {import('../collectors/CMPCollector').CMPResult[]=} cmps
 * @property {import('../collectors/CookieCollector').CookieData[]=} cookies
 * @property {{ present: string[], visible: string[]}=} elements
 * @property {import('../collectors/RequestCollector').RequestData[]=} requests
 * @property {string=} screenshots
 * @property {import('../collectors/TargetCollector').TargetData[]=} targets
 */
