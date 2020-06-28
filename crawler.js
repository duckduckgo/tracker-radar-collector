const puppeteer = require('puppeteer');
const chalk = require('chalk').default;
const {createTimer} = require('./helpers/timer');
const wait = require('./helpers/wait');
const tldts = require('tldts');

const MAX_LOAD_TIME = 30000;//ms
const MAX_TOTAL_TIME = MAX_LOAD_TIME * 2;//ms
const EXECUTION_WAIT_TIME = 2500;//ms

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; Pixel 2 XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.117 Mobile Safari/537.36';

const DEFAULT_VIEWPORT = {
    width: 1440,//px
    height: 812//px
};
const MOBILE_VIEWPORT = {
    width: 412,
    height: 691,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
};

// for debugging: will lunch in window mode instad of headless, open devtools and don't close windows after process finishes
const VISUAL_DEBUG = false;

const BROWSER_MAX_REUSE = 10;
const BROWSER_MAX_CONTEXTS = 1;

/**
 * @type {Set<{browser: import('puppeteer').Browser, used: number, contexts: number}>}
 */
const allBrowsers = new Set();

/**
 * @param {function(...any):void} log
 * @param {string} proxyHost
 */
async function openBrowser(log, proxyHost) {
    const availableBrowser = Array.from(allBrowsers.values()).find(e => e.used < BROWSER_MAX_REUSE && e.contexts < BROWSER_MAX_CONTEXTS);

    if (availableBrowser) {
        availableBrowser.contexts++;
        console.log('♻️ Reusing browser', availableBrowser.used, 'time. (context #', availableBrowser.contexts, ')');
        return availableBrowser.browser;
    }

    let args = {};
    if (VISUAL_DEBUG) {
        args.headless = false;
        args.devtools = true;
    }
    if (proxyHost) {
        let url;
        try {
            url = new URL(proxyHost);
        } catch(e) {
            log('Invalid proxy URL');
        }

        args.args = [
            `--proxy-server=${proxyHost}`,
            `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE ${url.hostname}"`
        ];
    }

    // for debugging: use different version of Chromium/Chrome
    // executablePath: "/Applications/Google\ Chrome\ Canary.app/Contents/MacOS/Google\ Chrome\ Canary"

    const browser = await puppeteer.launch(args);

    allBrowsers.add({
        browser,
        used: 0,
        contexts: 1
    });

    console.log('🍼 Creating new browser', allBrowsers.size);

    return browser;
}

/**
 * @param {puppeteer.Browser} browser
 */
async function closeBrowser(browser) {
    if (!VISUAL_DEBUG) {
        const entry = Array.from(allBrowsers.values()).find(e => e.browser === browser);
        entry.used++;
        entry.contexts--;

        if (entry.used >= BROWSER_MAX_REUSE && entry.contexts === 0) {
            await browser.close();
            console.log('💀 Browser killed. Used', entry.used, 'times.');
            allBrowsers.delete(entry);
            console.log('All browsers:', allBrowsers.size);
        }
    }
}

/**
 * @param {puppeteer.Browser} browser
 * @param {URL} url
 * @param {{collectors: import('./collectors/BaseCollector')[], log: function(...any):void, rank?: number, urlFilter: function(string, string):boolean, emulateMobile: boolean}} data
 *
 * @returns {Promise<CollectResult>}
 */
async function getSiteData(browser, url, {
    collectors,
    log,
    rank,
    urlFilter,
    emulateMobile
}) {
    const testStarted = Date.now();

    // Create a new incognito browser context.
    const context = await browser.createIncognitoBrowserContext();
    /**
     * @type {{cdpClient: import('puppeteer').CDPSession, type: string, url: string}[]}
     */
    const targets = [];

    const collectorOptions = {
        browser,
        context,
        url,
        log
    };

    for (let collector of collectors) {
        const timer = createTimer();

        try {
            // eslint-disable-next-line no-await-in-loop
            await collector.init(collectorOptions);
            log(`${collector.id()} init took ${timer.getElapsedTime()}s`);
        } catch (e) {
            log(chalk.yellow(`${collector.id()} init failed`), chalk.gray(e.message), chalk.gray(e.stack));
        }
    }

    // initiate collectors for all contexts (main page, web worker, service worker etc.)
    context.on('targetcreated', async target => {
        const timer = createTimer();
        const cdpClient = await target.createCDPSession();
        const simpleTarget = {url: target.url(), type: target.type(), cdpClient};
        targets.push(simpleTarget);

        // we have to pause new targets and attach to them as soon as they are created not to miss any data
        await cdpClient.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: true});

        for (let collector of collectors) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await collector.addTarget(simpleTarget);
            } catch (e) {
                log(chalk.yellow(`${collector.id()} failed to attach to "${target.url()}"`), chalk.gray(e.message), chalk.gray(e.stack));
            }
        }

        try {
            // resume target when all collectors are ready
            await cdpClient.send('Runtime.enable');
            await cdpClient.send('Runtime.runIfWaitingForDebugger');
        } catch (e) {
            log(chalk.yellow(`Failed to resume target "${target.url()}"`), chalk.gray(e.message), chalk.gray(e.stack));
            return;
        }

        log(`${target.url()} context initiated in ${timer.getElapsedTime()}s`);
    });

    // Create a new page in a pristine context.
    const page = await context.newPage();

    await page.emulate({
        // just in case some sites block headless visits
        userAgent: emulateMobile ? MOBILE_USER_AGENT : DEFAULT_USER_AGENT,
        viewport: emulateMobile ? MOBILE_VIEWPORT : DEFAULT_VIEWPORT
    });

    // if any prompts open on page load, they'll make the page hang unless closed
    page.on('dialog', dialog => dialog.dismiss());

    // catch and report crash errors
    page.on('error', e => log(chalk.red(e.message)));

    let timeout = false;

    try {
        await page.goto(url.toString(), {timeout: MAX_LOAD_TIME, waitUntil: 'networkidle0'});
    } catch (e) {
        if (e && e.message && e.message.startsWith('Navigation Timeout Exceeded')) {
            log(chalk.yellow('Navigation timeout exceeded.'));

            for (let target of targets) {
                if (target.type === 'page') {
                    // eslint-disable-next-line no-await-in-loop
                    await target.cdpClient.send('Page.stopLoading');
                }
            }
            timeout = true;
        } else {
            throw e;
        }
    }

    // give website a bit more time for things to settle
    await page.waitFor(EXECUTION_WAIT_TIME);

    const finalUrl = page.url();
    /**
     * @type {Object<string, Object>}
     */
    const data = {};

    for (let collector of collectors) {
        const timer = createTimer();
        try {
            // eslint-disable-next-line no-await-in-loop
            const collectorData = await collector.getData({
                finalUrl,
                urlFilter: urlFilter && urlFilter.bind(null, finalUrl)
            });
            data[collector.id()] = collectorData;
            log(`getting ${collector.id()} data took ${timer.getElapsedTime()}s`);
        } catch (e) {
            log(chalk.yellow(`getting ${collector.id()} data failed`), chalk.gray(e.message), chalk.gray(e.stack));
            data[collector.id()] = null;
        }
    }

    for (let target of targets) {
        // eslint-disable-next-line no-await-in-loop
        await target.cdpClient.detach();
    }

    if (!VISUAL_DEBUG) {
        await page.close();
        await context.close();
    }

    return {
        initialUrl: url.toString(),
        finalUrl,
        rank,
        timeout,
        testStarted,
        testFinished: Date.now(),
        data
    };
}

/**
 * @param {string} documentUrl
 * @param {string} requestUrl
 * @returns {boolean}
 */
function isThirdPartyRequest(documentUrl, requestUrl) {
    const mainPageDomain = tldts.getDomain(documentUrl);

    return tldts.getDomain(requestUrl) !== mainPageDomain;
}

/**
 * @param {URL} url
 * @param {{collectors?: import('./collectors/BaseCollector')[], log?: function(...any):void, rank?: number, filterOutFirstParty?: boolean, emulateMobile: boolean, proxyHost: string}} options
 * @returns {Promise<CollectResult>}
 */
module.exports = async (url, options) => {
    const browser = await openBrowser(options.log, options.proxyHost);
    let data = null;

    try {
        data = await wait(getSiteData(browser, url, {
            collectors: options.collectors || [],
            log: options.log || (() => {}),
            rank: options.rank,
            urlFilter: options.filterOutFirstParty === true ? isThirdPartyRequest.bind(null) : null,
            emulateMobile: options.emulateMobile
        }), MAX_TOTAL_TIME);
    } catch(e) {
        options.log(chalk.red('Crawl failed'), e.message, chalk.gray(e.stack));
        throw e;
    } finally {
        await closeBrowser(browser);
    }

    return data;
};

/**
 * @typedef {Object} CollectResult
 * @property {string} initialUrl URL from which the crawler began the crawl (as provided by the caller)
 * @property {string} finalUrl URL after page has loaded (can be different from initialUrl if e.g. there was a redirect)
 * @property {number?} rank website's rank (as provided by the caller)
 * @property {boolean} timeout true if page didn't fully load before the timeout and loading had to be stopped by the crawler
 * @property {number} testStarted time when the crawl started (unix timestamp)
 * @property {number} testFinished time when the crawl finished (unix timestamp)
 * @property {object} data object containing output from all collectors
*/
