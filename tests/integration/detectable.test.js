const assert = require('assert');

const runCrawlers = require('../../crawlerConductor');
const {createCollector} = require('../../helpers/collectorsList');

async function main() {
    const errors = [];
    /**
     * @type {Array<import('../../crawler').CollectResult>}
     */
    const data = [];
    await runCrawlers({
        urls: ['https://privacy-test-pages.glitch.me/crawler/'],
        logFunction: () => {},
        dataCollectors: [createCollector('requests')],
        numberOfCrawlers: 2,
        failureCallback: (url, error) => errors.push({url, error: error.message}),
        dataCallback: (url, output) => data.push(output),
        filterOutFirstParty: false,
        emulateMobile: false,
        proxyHost: null
    });
    /**
     * @typedef {Object} Request
     * @property {string} url
     */
    /**
     * @type {Array<Request>}
     */
    const requests = data[0].data.requests;
    const tests = [
        'userAgent',
        'plugins',
        'languages',
        'webdriver',
        'window.chrome',
        'Notification.permission'
    ];
    tests.forEach(test => {
        const failed = requests.find(req => req.url.indexOf(`test=${test}`) !== -1);
        assert(!failed, `Detected as headless via ${test}`);
    });
}

main();

