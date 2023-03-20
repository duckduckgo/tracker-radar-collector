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
        `${firstPartyOrigin}/crawler/attribution/`, // this can be flaky due to a race condition in the crawler https://app.asana.com/0/72649045549333/1204120569983283
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/simple-3p-script.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/createelement.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/eval.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/new-function.js`,
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/dom0.js`, // dom0 event handlers are attributed to the current page because that's the only entry in the call stack https://app.asana.com/0/0/1204138450097419/f
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/blob-url.js`, // blob: urls are attributed to the origin (e.g. https://example.com/1234-1234-1234-1234) https://app.asana.com/0/0/1204138450097417/f
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/data-url.js`, // data: urls are attributed to https://example.com/current-path/null because there's no link to the original script in stack traces https://app.asana.com/0/0/1204138450097417/f
        `${firstPartyOrigin}/crawler/attribution/entrypoints/document-write.js`,
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/iframe-blob-url.js`, // capturing small dynamic contexts is currently flaky due to a race condition in the crawler https://app.asana.com/0/72649045549333/1204120569983283
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/iframe-data-url.js`, // capturing small dynamic contexts is currently flaky due to a race condition in the crawler https://app.asana.com/0/72649045549333/1204120569983283
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/iframe-javascript-url.js`, // capturing small dynamic contexts is currently flaky due to a race condition in the crawler https://app.asana.com/0/72649045549333/1204120569983283
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/iframe-document-write.js`, // capturing small dynamic contexts is currently flaky due to a race condition in the crawler https://app.asana.com/0/72649045549333/1204120569983283
        `${thirdPartyOrigin}/crawler/attribution/iframe-sandbox.html`,
        `${thirdPartyOrigin}/crawler/attribution/iframe-simple.html`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/eventlistener.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/settimeout.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/promise.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/module.mjs`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/deep-stack.js`,
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/deep-async-stack.js`,
        // `${firstPartyOrigin}/crawler/attribution/worker-source.js`, // capturing small dynamic contexts is currently flaky due to a race condition in the crawler https://app.asana.com/0/72649045549333/1204120569983283
        // `${firstPartyOrigin}/crawler/attribution/sw-source.js`, // capturing small dynamic contexts is currently flaky due to a race condition in the crawler https://app.asana.com/0/72649045549333/1204120569983283
        `${firstPartyOrigin}/crawler/attribution/entrypoints/1p-prototype-overload.js`,
        // `${thirdPartyOrigin}/crawler/attribution/entrypoints/reusing-1p-prototype.js`, // calls like this are currently attributed to the intermediate script, see https://app.asana.com/0/0/1204144855579740/f
        `${thirdPartyOrigin}/crawler/attribution/entrypoints/3p-prototype-overload.js`,
        // `${firstPartyOrigin}/crawler/attribution/entrypoints/reusing-3p-prototype.js`, // calls like this are currently attributed to the intermediate script, see https://app.asana.com/0/0/1204144855579740/f
    ];
    const errors = [];
    for (const url of expectedScripts) {
        if (!(url in apiData.data.apis.callStats)) {
            errors.push(`Missing ${url} script`);
            continue;
        }
        if (!apiData.data.apis.callStats[url]["Navigator.prototype.userAgent"]) {
            errors.push(`Missing a call from ${url} script`);
        }
    }
    assert(errors.length === 0, 'Missing some API calls:\n' + errors.join('\n'));
}

main();
