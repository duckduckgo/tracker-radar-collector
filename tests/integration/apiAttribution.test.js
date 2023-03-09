const {crawler, APICallCollector} = require('../../main.js');
const assert = require('assert');

async function main() {
    const testOrigin = 'https://privacy-test-pages.glitch.me'; // set to https://first-party.example for local testing
    let apiData;
    try {
        apiData = await crawler(new URL(`${testOrigin}/crawler/attribution/`), {
            collectors: [new APICallCollector()],
            // log: console.log,
        });
    } catch (e) {
        assert(false, `Page load failed - ${e}`);
    }

    const expectedScripts = [
        `${testOrigin}/crawler/attribution/`, // race condition
        `${testOrigin}/crawler/attribution/entrypoints/createelement.js`,
        `${testOrigin}/crawler/attribution/entrypoints/eval.js`,
        // `${testOrigin}/crawler/attribution/entrypoints/dom0.js`, // https://app.asana.com/0/0/1204138450097419/f
        // `${testOrigin}/crawler/attribution/entrypoints/blob-url.js`, // https://app.asana.com/0/0/1204138450097417/f
        // `${testOrigin}/crawler/attribution/entrypoints/data-url.js`, // https://app.asana.com/0/0/1204138450097417/f
        `${testOrigin}/crawler/attribution/entrypoints/document-write.js`,
        // `${testOrigin}/crawler/attribution/entrypoints/iframe-blob-url.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        // `${testOrigin}/crawler/attribution/entrypoints/iframe-data-url.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        // `${testOrigin}/crawler/attribution/entrypoints/iframe-javascript-url.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        // `${testOrigin}/crawler/attribution/entrypoints/iframe-document-write.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        `${testOrigin}/crawler/attribution/iframe-sandbox.html`,
        `${testOrigin}/crawler/attribution/iframe-simple.html`,
        `${testOrigin}/crawler/attribution/entrypoints/eventlistener.js`,
        `${testOrigin}/crawler/attribution/entrypoints/settimeout.js`,
        `${testOrigin}/crawler/attribution/entrypoints/promise.js`,
        `${testOrigin}/crawler/attribution/entrypoints/module.mjs`,
        `${testOrigin}/crawler/attribution/entrypoints/deep-stack.js`,
        `${testOrigin}/crawler/attribution/entrypoints/deep-async-stack.js`,
        // `${testOrigin}/crawler/attribution/worker-source.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        // `${testOrigin}/crawler/attribution/sw-source.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        `${testOrigin}/crawler/attribution/entrypoints/prototype-overload.js`,
    ];
    for (const url of expectedScripts) {
        assert(url in apiData.data.apis.callStats, `Missing ${url} script`);
        assert(apiData.data.apis.callStats[url]["Navigator.prototype.userAgent"], `Missing a call from ${url} script`);
    }
}

main();
