/* eslint-disable max-lines */
const puppeteer = require('puppeteer');
const chalk = require('chalk').default;
const {createTimer} = require('./helpers/timer');
const wait = require('./helpers/wait');
const tldts = require('tldts');

const MAX_LOAD_TIME = 30000;//ms
const MAX_TOTAL_TIME = MAX_LOAD_TIME * 2;//ms
const EXECUTION_WAIT_TIME = 2500;//ms

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.146 Safari/537.36';
const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; Pixel 2 XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.146 Mobile Safari/537.36';

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

/**
 * @param {function(...any):void} log
 * @param {string} proxyHost
 */
function openBrowser(log, proxyHost) {
    const args = {
        args: [
            // enable FLoC
            '--enable-blink-features=InterestCohortAPI',
            '--enable-features="FederatedLearningOfCohorts:update_interval/10s/minimum_history_domain_size_required/1,FlocIdSortingLshBasedComputation,InterestCohortFeaturePolicy"'
        ]
    };
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

        args.args.push(`--proxy-server=${proxyHost}`);
        args.args.push(`--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE ${url.hostname}"`);
    }

    // for debugging: use different version of Chromium/Chrome
    // args.executablePath = "/Applications/Google\ Chrome\ Canary.app/Contents/MacOS/Google\ Chrome\ Canary";

    return puppeteer.launch(args);
}

/**
 * @param {puppeteer.BrowserContext} context
 * @param {URL} url
 * @param {{collectors: import('./collectors/BaseCollector')[], log: function(...any):void, urlFilter: function(string, string):boolean, emulateMobile: boolean, emulateUserAgent: boolean}} data
 *
 * @returns {Promise<CollectResult>}
 */
async function getSiteData(context, url, {
    collectors,
    log,
    urlFilter,
    emulateUserAgent,
    emulateMobile
}) {
    const testStarted = Date.now();

    /**
     * @type {{cdpClient: import('puppeteer').CDPSession, type: string, url: string}[]}
     */
    const targets = [];

    const collectorOptions = {
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

    let pageTargetCreated = false;

    // initiate collectors for all contexts (main page, web worker, service worker etc.)
    context.on('targetcreated', async target => {
        // we have already initiated collectors for the main page, so we ignore the first page target
        if (target.type() === 'page' && !pageTargetCreated) {
            pageTargetCreated = true;
            return;
        }

        const timer = createTimer();
        let cdpClient = null;
        
        try {
            cdpClient = await target.createCDPSession();
        } catch (e) {
            log(chalk.yellow(`Failed to connect to "${target.url()}"`), chalk.gray(e.message), chalk.gray(e.stack));
            return;
        }

        const simpleTarget = {url: target.url(), type: target.type(), cdpClient};
        targets.push(simpleTarget);

        try {
            // we have to pause new targets and attach to them as soon as they are created not to miss any data
            await cdpClient.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: true});
        } catch (e) {
            log(chalk.yellow(`Failed to set "${target.url()}" up.`), chalk.gray(e.message), chalk.gray(e.stack));
            return;
        }

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

        log(`${target.url()} (${target.type()}) context initiated in ${timer.getElapsedTime()}s`);
    });

    // Create a new page in a pristine context.
    const page = await context.newPage();

    // We are creating CDP connection before page target is created, if we create it only after
    // new target is created we will miss some requests, API calls, etc.
    const cdpClient = await page.target().createCDPSession();

    const initPageTimer = createTimer();
    for (let collector of collectors) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await collector.addTarget({url: url.toString(), type: 'page', cdpClient});
        } catch (e) {
            log(chalk.yellow(`${collector.id()} failed to attach to page`), chalk.gray(e.message), chalk.gray(e.stack));
        }
    }
    log(`page context initiated in ${initPageTimer.getElapsedTime()}s`);

    if (emulateUserAgent) {
        page.setUserAgent(emulateMobile ? MOBILE_USER_AGENT : DEFAULT_USER_AGENT);
    }

    page.setViewport(emulateMobile ? MOBILE_VIEWPORT : DEFAULT_VIEWPORT);

    // if any prompts open on page load, they'll make the page hang unless closed
    page.on('dialog', dialog => dialog.dismiss());

    // catch and report crash errors
    page.on('error', e => log(chalk.red(e.message)));

    let timeout = false;

    try {
        await page.goto(url.toString(), {timeout: MAX_LOAD_TIME, waitUntil: 'networkidle0'});
    } catch (e) {
        if (e instanceof puppeteer.errors.TimeoutError || (e.name && e.name === 'TimeoutError')) {
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
    await page.waitForTimeout(EXECUTION_WAIT_TIME);

    const finalUrl = page.url();
    /**
     * @type {Object<string, Object>}
     */
    const data = {};

    for (let collector of collectors) {
        const getDataTimer = createTimer();
        try {
            // eslint-disable-next-line no-await-in-loop
            const collectorData = await collector.getData({
                finalUrl,
                urlFilter: urlFilter && urlFilter.bind(null, finalUrl)
            });
            data[collector.id()] = collectorData;
            log(`getting ${collector.id()} data took ${getDataTimer.getElapsedTime()}s`);
        } catch (e) {
            log(chalk.yellow(`getting ${collector.id()} data failed`), chalk.gray(e.message), chalk.gray(e.stack));
            data[collector.id()] = null;
        }
    }

    for (let target of targets) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await target.cdpClient.detach();
        } catch (e) {
            // we don't care that much because in most cases an error here means that target already detached
        }
    }

    if (!VISUAL_DEBUG) {
        await page.close();
    }

    return {
        initialUrl: url.toString(),
        finalUrl,
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
 * @param {{collectors?: import('./collectors/BaseCollector')[], log?: function(...any):void, filterOutFirstParty?: boolean, emulateMobile?: boolean, emulateUserAgent?: boolean, proxyHost?: string, browserContext?: puppeteer.BrowserContext}} options
 * @returns {Promise<CollectResult>}
 */
module.exports = async (url, options) => {
    const log = options.log || (() => {});
    const browser = options.browserContext ? null : await openBrowser(log, options.proxyHost);
    // Create a new incognito browser context.
    const context = options.browserContext || await browser.createIncognitoBrowserContext();

    let data = null;

    try {
        data = await wait(getSiteData(context, url, {
            collectors: options.collectors || [],
            log,
            urlFilter: options.filterOutFirstParty === true ? isThirdPartyRequest.bind(null) : null,
            emulateUserAgent: options.emulateUserAgent !== false, // true by default
            emulateMobile: options.emulateMobile
        }), MAX_TOTAL_TIME);
    } catch(e) {
        log(chalk.red('Crawl failed'), e.message, chalk.gray(e.stack));
        throw e;
    } finally {
        // only close the browser if it was created here and not debugging
        if (browser && !VISUAL_DEBUG) {
            await context.close();
            await browser.close();
        }
    }

    return data;
};

/**
 * @typedef {Object} CollectResult
 * @property {string} initialUrl URL from which the crawler began the crawl (as provided by the caller)
 * @property {string} finalUrl URL after page has loaded (can be different from initialUrl if e.g. there was a redirect)
 * @property {boolean} timeout true if page didn't fully load before the timeout and loading had to be stopped by the crawler
 * @property {number} testStarted time when the crawl started (unix timestamp)
 * @property {number} testFinished time when the crawl finished (unix timestamp)
 * @property {any} data object containing output from all collectors
*/
