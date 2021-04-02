const {crawler, RequestCollector} = require('../../main.js');
const assert = require('assert');

async function main() {

    const requestData = await crawler(new URL('https://privacy-test-pages.glitch.me/privacy-protections/request-blocking/?run'), {
        log: () => {},
        collectors: [new RequestCollector()]
    });

    // we are testing edge cases - requests that we missed in the past

    const serviceWorkerRequest = requestData.data.requests.find((/** @type {{url: string}} **/ r) => r.url.endsWith('/service-worker.js'));
    
    assert(serviceWorkerRequest, 'Service worker request captured.');
    
    const webWorkerRequest = requestData.data.requests.find((/** @type {{url: string}} **/ r) => r.url.endsWith('/worker.js'));

    assert(webWorkerRequest, 'Web worker request captured.');

    const cspRequest = requestData.data.requests.find((/** @type {{url: string}} **/ r) => r.url.endsWith('/csp'));

    assert(cspRequest, 'CSP report request captured.');
}

main();
