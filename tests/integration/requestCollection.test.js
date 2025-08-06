const { crawler, RequestCollector } = require('../../main.js');
const assert = require('assert');

async function main() {
    const requestData = await crawler(new URL('https://privacy-test-pages.site/privacy-protections/request-blocking/?run'), {
        log: () => {},
        collectors: [new RequestCollector()],
    });

    // we are testing edge cases - requests that we missed in the past

    // service worker is not captured on recent Chromium versions, seems to be a race condition https://app.asana.com/0/1118485203673454/1204338487583978/f
    // const serviceWorkerRequest = requestData.data.requests.find((/** @type {{url: string}} **/ r) => r.url.endsWith('/service-worker.js'));
    // assert(serviceWorkerRequest, 'Service worker request captured.');

    const webWorkerRequest = requestData.data.requests.find((/** @type {{url: string}} **/ r) => r.url.endsWith('/worker.js'));

    assert(webWorkerRequest, 'Web worker request captured.');

    const cspRequest = requestData.data.requests.find((/** @type {{url: string}} **/ r) => r.url.endsWith('/csp'));

    assert(cspRequest, 'CSP report request captured.');
}

main();
