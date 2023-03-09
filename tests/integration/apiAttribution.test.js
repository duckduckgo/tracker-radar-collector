const {crawler, APICallCollector} = require('../../main.js');
const assert = require('assert');

async function main() {
    const isLocalTest = false; // set to true for local testing

    const firstPartyOrigin = isLocalTest ? 'https://first-party.example' : 'https://www.first-party.site';
    const thirdPartyOrigin = isLocalTest ? 'https://third-party.example' : 'https://bad.third-party.site';
    let apiData;
    try {
        apiData = await crawler(new URL(`${firstPartyOrigin}/crawler/attribution/`), {
            collectors: [new APICallCollector()],
            // log: console.log,
        });
    } catch (e) {
        assert(false, `Page load failed - ${e}`);
    }

    const expectedScripts = [
        `${firstPartyOrigin}/crawler/attribution/`, // race condition
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/simple-3p-script.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/createelement.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/eval.js`,
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/dom0.js`, // https://app.asana.com/0/0/1204138450097419/f
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/blob-url.js`, // https://app.asana.com/0/0/1204138450097417/f
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/data-url.js`, // https://app.asana.com/0/0/1204138450097417/f
        `${firstPartyOrigin}/crawler/attribution/entrypoints/document-write.js`,
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/iframe-blob-url.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/iframe-data-url.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/iframe-javascript-url.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/iframe-document-write.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        `${thirdPartyOrigin}/crawler/attribution/iframe-sandbox.html`,
        `${thirdPartyOrigin}/crawler/attribution/iframe-simple.html`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/eventlistener.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/settimeout.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/promise.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/module.mjs`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/deep-stack.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/deep-async-stack.js`,
        // `${firstPartyOrigin}/crawler/attribution/worker-source.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        // `${firstPartyOrigin}/crawler/attribution/sw-source.js`, // https://app.asana.com/0/72649045549333/1204120569983283
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/prototype-overload.js`,
    ];
    for (const url of expectedScripts) {
        assert(url in apiData.data.apis.callStats, `Missing ${url} script`);
        assert(apiData.data.apis.callStats[url]["Navigator.prototype.userAgent"], `Missing a call from ${url} script`);
    }
}

main();
