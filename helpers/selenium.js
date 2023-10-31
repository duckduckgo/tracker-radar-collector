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
 * 
 * @returns {Promise<import('selenium-webdriver').WebDriver>}
 */
async function getRemoteDriver(options) {
    const opts = new chrome.Options();

    // default chrome arguments passed by puppeteer 10.2.0
    opts.addArguments(
        '--allow-pre-commit-input',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-component-extensions-with-background-pages',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        // AcceptCHFrame disabled because of crbug.com/1348106.
        '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--enable-automation',
        // TODO(sadym): remove '--enable-blink-features=IdleDetection' once
        // IdleDetection is turned on by default.
        '--enable-blink-features=IdleDetection',
        '--enable-features=NetworkServiceInProcess2',
        '--export-tagged-pdf',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--no-first-run',
        '--password-store=basic',
        '--use-mock-keychain',
    );

    opts.addArguments(
        // enable FLoC
        '--enable-blink-features=InterestCohortAPI',
        '--enable-features="FederatedLearningOfCohorts:update_interval/10s/minimum_history_domain_size_required/1,FlocIdSortingLshBasedComputation,InterestCohortFeaturePolicy"',
    );

    opts.setUserPreferences({
        "download.default_directory": "/dev/null",
    });

    if (VISUAL_DEBUG) {
        opts.addArguments('--auto-open-devtools-for-tabs');
    } else {
        //opts.headless();
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

    let driver = await (new Builder()
        .usingServer(options.seleniumHub)
        .forBrowser('chrome')
        .setChromeOptions(opts)
        .build());

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
