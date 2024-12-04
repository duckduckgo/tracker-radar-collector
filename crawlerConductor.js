const os = require('os');
const cores = os.cpus().length;
const chalk = require('chalk');
const asyncLib = require('async');
const crawl = require('./crawler');
const {createTimer} = require('./helpers/timer');
const {downloadChrome} = require('./helpers/chromiumDownload');
const notABot = require('./helpers/notABot');

const MAX_NUMBER_OF_CRAWLERS = 38;// by trial and error there seems to be network bandwidth issues with more than 38 browsers. 
const MAX_NUMBER_OF_RETRIES = 2;

/**
 * @param {string} urlString 
 * @param {BaseCollector[]} dataCollectors
 * @param {function} log 
 * @param {boolean} filterOutFirstParty
 * @param {function(URL, import('./crawler').CollectResult): void} dataCallback 
 * @param {boolean} emulateMobile
 * @param {string} proxyHost
 * @param {boolean} antiBotDetection
 * @param {string} executablePath
 * @param {number} maxLoadTimeMs
 * @param {number} extraExecutionTimeMs
 * @param {Object.<string, string>} collectorFlags
 */
async function crawlAndSaveData(urlString, dataCollectors, log, filterOutFirstParty, dataCallback, emulateMobile, proxyHost, antiBotDetection, executablePath, maxLoadTimeMs, extraExecutionTimeMs, collectorFlags) {
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
    });

    dataCallback(url, data);
}

/**
 * @param {{urls: Array<string|{url:string,dataCollectors?:BaseCollector[]}>, dataCallback: function(URL, import('./crawler').CollectResult): void, dataCollectors?: BaseCollector[], failureCallback?: function(string, Error): void, numberOfCrawlers?: number, logFunction?: function, filterOutFirstParty: boolean, emulateMobile: boolean, proxyHost: string, antiBotDetection?: boolean, chromiumVersion?: string, maxLoadTimeMs?: number, extraExecutionTimeMs?: number, collectorFlags?: Object.<string, boolean>}} options
 */
module.exports = async options => {
    const log = options.logFunction || (() => {});
    const failureCallback = options.failureCallback || (() => {});

    let numberOfCrawlers = options.numberOfCrawlers || Math.floor(cores * 0.8);
    numberOfCrawlers = Math.min(MAX_NUMBER_OF_CRAWLERS, numberOfCrawlers, options.urls.length);

    // Increase number of listeners so we have at least one listener for each async process
    if (numberOfCrawlers > process.getMaxListeners()) {
        const maxListeners = (numberOfCrawlers * 4) + 1;
        console.log('Setting listeners to', maxListeners);
        process.setMaxListeners(maxListeners);
    }
    log(chalk.cyan(`Number of crawlers: ${numberOfCrawlers}\n`));

    // make sure the browser is downloaded before we start parallel tasks
    const executablePath = await downloadChrome(log, options.chromiumVersion);

    await asyncLib.eachOfLimit(options.urls, numberOfCrawlers, (urlItem, idx, callback) => {
        const urlString = (typeof urlItem === 'string') ? urlItem : urlItem.url;
        let dataCollectors = options.dataCollectors;

        // there can be a different set of collectors for every item
        if ((typeof urlItem !== 'string') && urlItem.dataCollectors) {
            dataCollectors = urlItem.dataCollectors;
        }

        log(chalk.cyan(`Processing entry #${Number(idx) + 1} (${urlString}).`));
        const timer = createTimer();

        const task = crawlAndSaveData.bind(null, urlString, dataCollectors, log, options.filterOutFirstParty, options.dataCallback, options.emulateMobile, options.proxyHost, (options.antiBotDetection !== false), executablePath, options.maxLoadTimeMs, options.extraExecutionTimeMs, options.collectorFlags);

        asyncLib.retry(MAX_NUMBER_OF_RETRIES, task, err => {
            if (err) {
                console.log(err);
                log(chalk.red(`Max number of retries (${MAX_NUMBER_OF_RETRIES}) exceeded for "${urlString}".`));
                failureCallback(urlString, err);
            } else {
                log(chalk.cyan(`Processing "${urlString}" took ${timer.getElapsedTime()}s.`));
            }

            callback();
        });
    });
};

/**
 * @typedef {import('./collectors/BaseCollector')} BaseCollector
 */