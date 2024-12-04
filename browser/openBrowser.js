const {VISUAL_DEBUG} = require('../constants');
const {downloadChrome} = require('../helpers/chromiumDownload');
const LocalChrome = require('./LocalChrome');

/**
 * @param {function(...any):void} log
 * @param {string} proxyHost
 * @param {string} executablePath path to chromium executable to use
 * @returns {Promise<LocalChrome>}
 */
async function openBrowser(log, proxyHost, executablePath) {
    const extraArgs = [
        // enable FLoC
        // '--enable-blink-features=InterestCohortAPI',
        // '--enable-features=FederatedLearningOfCohorts:update_interval/10s/minimum_history_domain_size_required/1,FlocIdSortingLshBasedComputation,InterestCohortFeaturePolicy',
        '--js-flags=--async-stack-traces --stack-trace-limit 32' // no quotes around the CLI flags needed
    ];
    if (proxyHost) {
        let url;
        try {
            url = new URL(proxyHost);
        } catch (e) {
            log('Invalid proxy URL', e);
        }

        extraArgs.push(`--proxy-server=${proxyHost}`);
        extraArgs.push(`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${url.hostname}`); // no quotes around the CLI flags needed
    }

    const browser = new LocalChrome({
        extraArgs,
        headless: !VISUAL_DEBUG,
        executablePath: executablePath || await downloadChrome(log),
    });
    await browser.start();

    return browser;
}

module.exports = openBrowser;
