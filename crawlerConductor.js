const os = require('os');
const cores = os.cpus().length;
const puppeteer = require('puppeteer');
const chalk = require('chalk').default;
const async = require('async');
const crawl = require('./crawler');
const URL = require('url').URL;
const {createTimer} = require('./helpers/timer');
const createDeferred = require('./helpers/deferred');
// eslint-disable-next-line no-unused-vars
const BaseCollector = require('./collectors/BaseCollector');

const MAX_NUMBER_OF_CRAWLERS = 38;// by trial and error there seems to be network bandwidth issues with more than 38 browsers. 
const MAX_NUMBER_OF_RETRIES = 2;
const BROWSER_MAX_REUSE = 10;
const BROWSER_MAX_CONTEXTS = 2;

/**
 * @type {Set<{browser: import('puppeteer').Browser, used: number, contexts: number}>}
 */
const allBrowsers = new Set();

/**
 * @param {string} proxyHost
 */
async function getBrowser(proxyHost) {
    const availableBrowser = Array.from(allBrowsers.values()).find(e => e.used < BROWSER_MAX_REUSE && e.contexts < BROWSER_MAX_CONTEXTS);

    if (availableBrowser) {
        availableBrowser.contexts++;
        // console.log('♻️ Reusing browser', availableBrowser.used, 'time. (context #', availableBrowser.contexts, ')');
        return availableBrowser.browser;
    }

    const args = {};
    if (proxyHost) {
        args.args = [`--proxy-server=${proxyHost}`];
    }

    // for debugging: use different version of Chromium/Chrome
    // executablePath: "/Applications/Google\ Chrome\ Canary.app/Contents/MacOS/Google\ Chrome\ Canary"

    const browser = await puppeteer.launch(args);

    allBrowsers.add({
        browser,
        used: 0,
        contexts: 1
    });

    // console.log('🍼 Creating new browser', allBrowsers.size);

    return browser;
}

/**
 * @param {puppeteer.Browser} browser 
 */
async function returnBrowser(browser) {
    const entry = Array.from(allBrowsers.values()).find(e => e.browser === browser);
    entry.used++;
    entry.contexts--;

    if (entry.used >= BROWSER_MAX_REUSE && entry.contexts === 0) {
        await browser.close();
        // console.log('💀 Browser killed. Used', entry.used, 'times.');
        allBrowsers.delete(entry);
        // console.log('All browsers:', allBrowsers.size);
    }
}

function closeAllBrowsers() {
    return Promise.all(Array.from(allBrowsers.values())
        .map(({browser}) => browser.close()));
}

/**
 * @param {string} urlString 
 * @param {BaseCollector[]} dataCollectors
 * @param {number} idx 
 * @param {function} log 
 * @param {boolean} filterOutFirstParty
 * @param {function(URL, object): void} dataCallback 
 * @param {boolean} emulateMobile
 * @param {string} proxyHost
 */
async function crawlAndSaveData(urlString, dataCollectors, idx, log, filterOutFirstParty, dataCallback, emulateMobile, proxyHost) {
    const url = new URL(urlString);
    /**
     * @type {function(...any):void} 
     */
    const prefixedLog = (...msg) => log(chalk.gray(`${url.hostname}:`), ...msg);

    const browser = await getBrowser(proxyHost);

    const data = await crawl(url, {
        browser,
        log: prefixedLog,
        collectors: dataCollectors,
        rank: idx + 1,
        filterOutFirstParty,
        emulateMobile,
        proxyHost
    });

    await returnBrowser(browser);

    dataCallback(url, data);
}

/**
 * @param {{urls: string[], dataCallback: function(URL, object): void, dataCollectors?: BaseCollector[], failureCallback?: function(string, Error): void, numberOfCrawlers?: number, logFunction?: function, filterOutFirstParty: boolean, emulateMobile: boolean, proxyHost: string}} options
 */
module.exports = options => {
    const deferred = createDeferred();
    const log = options.logFunction || (() => {});
    const failureCallback = options.failureCallback || (() => {});

    let numberOfCrawlers = options.numberOfCrawlers || Math.floor(cores * 0.8);
    numberOfCrawlers = Math.min(MAX_NUMBER_OF_CRAWLERS, numberOfCrawlers, options.urls.length);

    // Increase number of listeners so we have at least one listener for each async process
    if (numberOfCrawlers > process.getMaxListeners()) {
        process.setMaxListeners(numberOfCrawlers + 1);
    }
    log(chalk.cyan(`Number of crawlers: ${numberOfCrawlers}\n`));

    // console.time('Crawling');

    async.eachOfLimit(options.urls, numberOfCrawlers, (urlString, idx, callback) => {
        log(chalk.cyan(`Processing entry #${Number(idx) + 1} (${urlString}).`));
        const timer = createTimer();

        const task = crawlAndSaveData.bind(null, urlString, options.dataCollectors, idx, log, options.filterOutFirstParty, options.dataCallback, options.emulateMobile, options.proxyHost);

        async.retry(MAX_NUMBER_OF_RETRIES, task, err => {
            if (err) {
                log(chalk.red(`Max number of retries (${MAX_NUMBER_OF_RETRIES}) exceeded for "${urlString}".`));
                failureCallback(urlString, err);
            } else {
                log(chalk.cyan(`Processing "${urlString}" took ${timer.getElapsedTime()}s.`));
            }

            callback();
        });
    }, err => {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve();
        }

        closeAllBrowsers();
        // console.timeEnd('Crawling');
    });

    return deferred.promise;
};