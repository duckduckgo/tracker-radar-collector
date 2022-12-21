const {Builder} = require("selenium-webdriver");
const puppeteer = require('puppeteer');
const chrome = require("selenium-webdriver/chrome");
const {VISUAL_DEBUG} = require('../constants');

/**
 * @param {{
 * seleniumHub: string,
 * chromiumVersion?: string,
 * proxyHost?: string
 * }} options
 */
function getRemoteDriver(options) {
    const opts = new chrome.Options();
    opts.addArguments(
        // enable FLoC
        '--enable-blink-features=InterestCohortAPI',
        '--enable-features="FederatedLearningOfCohorts:update_interval/10s/minimum_history_domain_size_required/1,FlocIdSortingLshBasedComputation,InterestCohortFeaturePolicy"',
    );

    if (VISUAL_DEBUG) {
        opts.addArguments('--auto-open-devtools-for-tabs');
    } else {
        opts.headless();
        opts.addArguments(
            '--hide-scrollbars',
            '--mute-audio',
        );
    }

    if (options.chromiumVersion) {
        opts.setBrowserVersion(options.chromiumVersion);
    }

    if (options.proxyHost) {
        const url = new URL(options.proxyHost);
        opts.addArguments(
            `--proxy-server=${options.proxyHost}`,
            `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE ${url.hostname}"`,
        );
    }

    let driver = new Builder()
        .usingServer(options.seleniumHub)
        .forBrowser('chrome')
        .setChromeOptions(opts)
        .build();
    return driver;
}

/**
 * @param {string} seleniumHub
 * @param {import("selenium-webdriver").WebDriver} driver
 */
async function getPuppeteerContext(seleniumHub, driver) {
    const host = new URL(seleniumHub).host;
    const sessionId = await driver.getSession().then(session => session.getId());
    const debuggerUrl = `ws://${host}/session/${sessionId}/se/cdp`;
    const browser = await puppeteer.connect({
        browserWSEndpoint: debuggerUrl,
    });
    return browser.defaultBrowserContext();
}


module.exports = {
    getRemoteDriver,
    getPuppeteerContext
};