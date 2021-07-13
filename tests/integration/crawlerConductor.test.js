const runCrawlers = require('../../crawlerConductor');
const assert = require('assert');
const {createCollector} = require('../../helpers/collectorsList');

const testURLs = [
    'https://example.com/',
    'https://duck.com/',
    'https://privacy-test-pages.glitch.me/tracker-reporting/1major-via-script.html',
    'https://fingerprintjs.com/demo/'
];

/**
 * @param {import('../../crawler').CollectResult} output 
 * @param {string} crawlName 
 */
function commonTests(output, crawlName) {
    assert(output, `${crawlName} - data not found`);
    assert(output.timeout === false, `${crawlName} - page should load in full and not time out`);
    assert(output.testStarted < output.testFinished, `${crawlName} - testStarted time should be before testFinished time`);
    assert(output.data.requests, `${crawlName} - crawl should contain "requests" data object`);
    assert(output.data.cookies, `${crawlName} - crawl should contain "cookies" data object`);
    assert(output.data.targets, `${crawlName} - crawl should contain "targets" data object`);
    assert(output.data.apis, `${crawlName} - crawl should contain "apis" data object`);
}

async function main() {
    /**
     * @type {Array<{url: string, error: string}>}
     */
    const errors = [];
    /**
     * @type {Array<import('../../crawler').CollectResult>}
     */
    const data = [];

    await runCrawlers({
        urls: testURLs,
        logFunction: () => {},
        dataCollectors: [createCollector('requests'), createCollector('cookies'), createCollector('targets'), createCollector('apis')],
        numberOfCrawlers: 2,
        failureCallback: (url, error) => errors.push({url, error: error.message}),
        // @ts-ignore
        dataCallback: (url, output) => data.push(output),
        filterOutFirstParty: false,
        emulateMobile: false,
        proxyHost: null
    });

    if (errors.length > 0) {
        // eslint-disable-next-line no-console
        console.error(errors);
        assert(false, `${errors.length} page(s) failed to be crawled`);
    }

    /// example.com tests
    const exampleCom = data.find(d => d.initialUrl === 'https://example.com/');
    commonTests(exampleCom, 'example.com');

    assert(exampleCom.finalUrl === exampleCom.initialUrl, 'example.com does not redirect, final and initial urls should be the same');
    
    assert(exampleCom.data.requests.length === 1, 'example.com does not load any subresources, should only have one request');
    assert(exampleCom.data.requests[0].url === 'https://example.com/', 'example.com should have only one request to https://example.com/');
    
    assert(exampleCom.data.cookies.length === 0, 'example.com does not set any cookies');
    
    assert(exampleCom.data.targets.length === 1, 'example.com does have only one target - main frame');
    assert(exampleCom.data.targets[0].type === 'page', 'example.com does have only one target - main frame');
    
    assert(Object.keys(exampleCom.data.apis.callStats).length === 0, 'example.com does not execute any JavaScript, API call stats should be empty');

    /// duck.com tests
    const duckCom = data.find(d => d.initialUrl === 'https://duck.com/');
    commonTests(duckCom, 'duck.com');

    assert(duckCom.finalUrl !== duckCom.initialUrl, 'duck.com redirects, final url should be different than initial url');
    
    assert(duckCom.data.requests.length > 10, 'duck.com does load multiple subresources');
    assert(duckCom.data.requests[0].url === 'https://duck.com/', 'first request should be to "duck.com"');
    assert(duckCom.data.requests[0].redirectedTo === 'https://duckduckgo.com/', 'first request should redirect to "duckduckgo.com"');

    const firstParty = ['improving.duckduckgo.com', 'duckduckgo.com', 'duck.com'];
    // eslint-disable-next-line arrow-parens
    const thirdPartyRequsts = duckCom.data.requests.filter((/** @type {{url:string}} **/ r) => !firstParty.includes(new URL(r.url).hostname));
    // eslint-disable-next-line arrow-parens
    assert(thirdPartyRequsts.length === 0, `there should be no third party requests on duckduckgo.com (found: ${thirdPartyRequsts.map((/** @type {{url:string}} **/ r) => r.url).join(',')}).`);

    assert(duckCom.data.cookies.length === 0, 'duck.com does not set any cookies by default');

    assert(duckCom.data.targets.length === 1, 'duck.com does have only one target - main frame');

    assert(Object.keys(duckCom.data.apis.callStats).length > 0, 'duck.com does execute some JS and callStats should NOT be empty');

    /// https://privacy-test-pages.glitch.me/tracker-reporting/1major-via-script.html tests
    const privacyTestPages1 = data.find(d => d.initialUrl === 'https://privacy-test-pages.glitch.me/tracker-reporting/1major-via-script.html');
    commonTests(privacyTestPages1, 'privacy-test-pages/1major-via-script');

    assert(privacyTestPages1.data.requests.length === 2, 'privacy-test-pages/1major-via-script does load one subresource and one main page document');
    assert(privacyTestPages1.data.requests[1].url === 'https://doubleclick.net/tracker.js', 'subresource loaded should be "https://doubleclick.net/tracker.js"');
    assert(privacyTestPages1.data.requests[1].status === 404, 'subresource loaded should return HTTP 404');

    /// https://fingerprintjs.com/demo/ tests
    const fingerprintjs = data.find(d => d.initialUrl === 'https://fingerprintjs.com/demo/');
    commonTests(fingerprintjs, 'fingerprintjs.com');

    assert(fingerprintjs.data.requests.length > 10, 'fingerprintjs.com does load multiple subresources');
    // eslint-disable-next-line arrow-parens
    const fingerprintjsThirdPartyRequsts = fingerprintjs.data.requests.filter((/** @type {{url:string}} **/ r) => !new URL(r.url).hostname.endsWith('fingerprintjs.com'));
    assert(fingerprintjsThirdPartyRequsts.length > 2, `fingerprintjs.com loads multiple third parties`);

    /**
     * @type {Array<string>}
     */
    const apis = [];
    const scripts = Object.keys(fingerprintjs.data.apis.callStats);
    scripts.forEach(src => Object.keys(fingerprintjs.data.apis.callStats[src]).forEach(api => apis.push(api)));
    assert(apis.length > 15, 'fingerprintjs.com demo script touches over 15 APIs');
    assert(apis.includes('HTMLCanvasElement.prototype.toDataURL'), 'fingerprintjs.com demo script touches canvas API');

    assert(fingerprintjs.data.targets.length > 0, 'fingerprintjs.com does have multiple targets - main frame + blobs');

    assert(fingerprintjs.data.cookies.length > 1, 'fingerprintjs.com does set multiple cookies by default');
}

main();
