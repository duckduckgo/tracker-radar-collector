const os = require('os');
const cores = os.cpus().length;
const chalk = require('chalk');
const asyncLib = require('async');
const crawl = require('./crawler');
const {createTimer} = require('./helpers/timer');
const {downloadChrome} = require('./helpers/chromiumDownload');
const notABot = require('./helpers/notABot');

const MAX_NUMBER_OF_RETRIES = 2;

/**
 * @param {CrawlAndSaveDataOptions} options
 * @returns {Promise<void>}
 * @description Wrapper function to call the crawler with the provided options.
 */
async function crawlAndSaveData({
    urlString,
    dataCollectors,
    log,
    filterOutFirstParty,
    dataCallback,
    emulateMobile,
    proxyHost,
    antiBotDetection,
    executablePath,
    maxLoadTimeMs,
    extraExecutionTimeMs,
    collectorFlags,
    seleniumHub
}) {
    const url = new URL(urlString);
    /**
     * @type {function(...any):void} 
     */
    const prefixedLog = ((...msg) => {
        const now = new Date();
        const curTime = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(now);
        log(
            chalk.gray(`${curTime} ${url.hostname}:`),
            ...msg
        );
    });

    const data = await crawl(url, {
        log: prefixedLog,
        // @ts-ignore
        collectors: dataCollectors.map(collector => new collector.constructor()),
        filterOutFirstParty,
        emulateMobile,
        proxyHost,
        runInEveryFrame: antiBotDetection ? notABot : undefined,
        executablePath,
        maxLoadTimeMs,
        extraExecutionTimeMs,
        collectorFlags,
        seleniumHub,
    });

    dataCallback(url, data);
}

/**
 * @param {CrawlerConductorOptions} options
 */
module.exports = async options => {
    const log = options.logFunction || (() => {});
    const failureCallback = options.failureCallback || (() => {});

    let numberOfCrawlers = options.numberOfCrawlers || Math.floor(cores * 0.8);
    numberOfCrawlers = Math.min(numberOfCrawlers, options.urls.length);

    // Increase number of listeners so we have at least one listener for each async process
    if (numberOfCrawlers > process.getMaxListeners()) {
        const maxListeners = (numberOfCrawlers * 4) + 1;
        process.setMaxListeners(maxListeners);
    }
    log(chalk.cyan(`Number of crawlers: ${numberOfCrawlers}\n`));

    // make sure the browser is downloaded before we start parallel tasks
    let executablePath = null;
    if (!options.seleniumHub) {
        executablePath = await downloadChrome(log, options.chromiumVersion);
    }

    /** @type {Set<string>} */
    const inProgress = new Set();

    await asyncLib.eachOfLimit(options.urls, numberOfCrawlers, (urlItem, idx, callback) => {
        const urlString = (typeof urlItem === 'string') ? urlItem : urlItem.url;
        let dataCollectors = options.dataCollectors;

        // there can be a different set of collectors for every item
        if ((typeof urlItem !== 'string') && urlItem.dataCollectors) {
            dataCollectors = urlItem.dataCollectors;
        }

        inProgress.add(urlString);
        log(chalk.cyan(`Processing entry #${Number(idx) + 1} (${urlString}).`));
        const timer = createTimer();

        const crawlAndSaveDataOptions = {
            urlString,
            dataCollectors,
            log,
            filterOutFirstParty: options.filterOutFirstParty,
            dataCallback: options.dataCallback,
            emulateMobile: options.emulateMobile,
            proxyHost: options.proxyHost,
            antiBotDetection: (options.antiBotDetection !== false),
            executablePath,
            maxLoadTimeMs: options.maxLoadTimeMs,
            extraExecutionTimeMs: options.extraExecutionTimeMs,
            collectorFlags: JSON.parse(JSON.stringify(options.collectorFlags || {})), // clone so that we can modify it for each call
            seleniumHub: options.seleniumHub,
        };

        const task = crawlAndSaveData.bind(
            null,
            crawlAndSaveDataOptions,
        );

        asyncLib.retry(
            {
                times: MAX_NUMBER_OF_RETRIES,
                interval: 0,
                errorFilter: () => {
                    crawlAndSaveDataOptions.collectorFlags.enableAsyncStacktraces = false; // disable async stack traces because they sometimes are the cause of crash
                    return true;
                }
            },
            task,
            err => {
                if (err) {
                    console.log(err);
                    log(chalk.red(`Max number of retries (${MAX_NUMBER_OF_RETRIES}) exceeded for "${urlString}".`));
                    failureCallback(urlString, err);
                } else {
                    log(chalk.cyan(`Processing "${urlString}" took ${timer.getElapsedTime()}s.`));
                }
                inProgress.delete(urlString);
                log(chalk.cyan(`In progress (${inProgress.size}): ${Array.from(inProgress).join(', ')}`));
                callback();
            }
        );
    });
};

/**
 * @typedef {import('./collectors/BaseCollector')} BaseCollector
 */

/**
 * @typedef {Object} CrawlAndSaveDataOptions
 * @property {string} urlString
 * @property {BaseCollector[]} dataCollectors
 * @property {function(...any):void} log
 * @property {boolean} filterOutFirstParty
 * @property {function(URL, import('./crawler').CollectResult): void} dataCallback
 * @property {boolean} emulateMobile
 * @property {string} proxyHost
 * @property {boolean} antiBotDetection
 * @property {string} executablePath
 * @property {number} maxLoadTimeMs
 * @property {number} extraExecutionTimeMs
 * @property {import('./collectors/BaseCollector').CollectorFlags} collectorFlags
 * @property {string} seleniumHub
 */

/**
 * @typedef {Object} CrawlerConductorOptions
 * @property {Array<string|{url:string,dataCollectors?:BaseCollector[]}>} urls
 * @property {function(URL, import('./crawler').CollectResult): void} dataCallback
 * @property {BaseCollector[]=} dataCollectors
 * @property {function(string, Error): void=} failureCallback
 * @property {number=} numberOfCrawlers
 * @property {function=} logFunction
 * @property {boolean} filterOutFirstParty
 * @property {boolean} emulateMobile
 * @property {string} proxyHost
 * @property {boolean=} antiBotDetection
 * @property {string=} chromiumVersion
 * @property {number=} maxLoadTimeMs
 * @property {number=} extraExecutionTimeMs
 * @property {import('./collectors/BaseCollector').CollectorFlags=} collectorFlags
 * @property {string=} seleniumHub
 */
