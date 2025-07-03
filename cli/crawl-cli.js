/* eslint-disable max-lines */
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const asyncLib = require('async');
const runCrawlers = require('../crawlerConductor');
const {program} = require('commander');
const {getCollectorIds, createCollector} = require('../helpers/collectorsList');
const {getReporterIds, createReporter} = require('../helpers/reportersList');
const {metadataFileExists, createMetadataFile} = require('./metadataFile');
const crawlConfig = require('./crawlConfig');
const {createUniqueUrlName} = require('../helpers/hash');

program
    .option('-o, --output <path>', 'output folder')
    .option('-u, --url <url>', 'single URL')
    .option('-i, --input-list <path>', 'path to list of URLs')
    .option('-d, --data-collectors <list>', `comma separated list of data collectors: ${getCollectorIds().join(', ')} (all by default)`)
    .option('--reporters <list>', `comma separated list of reporters: ${getReporterIds().join(', ')}`)
    .option('-l, --log-path <path>', 'instructs reporters where all logs should be written to')
    .option('-v, --verbose', 'instructs reporters to log additional information (e.g. for "cli" reporter progress bar will not be shown when verbose logging is enabled)')
    .option('-c, --crawlers <number>', 'overwrite the default number of concurent crawlers')
    .option('-f, --force-overwrite', 'overwrite existing output files')
    .option('-3, --only-3p', 'don\'t save any first-party data')
    .option('-m, --mobile', 'emulate a mobile device')
    .option('-p, --proxy-config <host>', 'use an optional proxy configuration')
    .option('-r, --region-code <region>', 'optional 2 letter region code. Used for metadata only.')
    .option('-a, --disable-anti-bot', 'disable anti bot detection protections injected to every frame')
    .option('--config <path>', 'crawl configuration file')
    .option('--autoconsent-action <action>', 'dismiss cookie popups. Possible values: optOut, optIn. Works only when cookiepopups collector is enabled.')
    .option('--chromium-version <version_number>', 'use custom version of chromium')
    .option('--selenium-hub <url>', 'selenium hub endpoint to request browsers from')
    .parse(process.argv);

/**
 * @param {string} outputPath
 * @param {URL} url
 * @param {string} fileType file extension, defaults to 'json'
 */
function createOutputPath(outputPath, url, fileType = 'json') {
    return path.join(outputPath, `${createUniqueUrlName(url)}.${fileType}`);
}

/**
 * @param {Array<string|{url:string, dataCollectors?:BaseCollector[]}>} inputUrls
 * @param {function} logFunction
 * @param {string} outputPath
 */
function filterUrls(inputUrls, logFunction, outputPath) {
    return asyncLib.filter(inputUrls, (item, filterCallback) => {
        const urlString = (typeof item === 'string') ? item : item.url;

        /**
         * @type {URL}
         */
        let url;

        try {
            url = new URL(urlString);
        } catch {
            logFunction(chalk.yellow('Invalid URL:'), urlString);
            filterCallback(null, false);
            return;
        }

        if (outputPath) {
            // filter out entries for which result file already exists
            const outputFile = createOutputPath(outputPath, url);
            fs.access(outputFile, err => {
                if (err) {
                    filterCallback(null, true);
                } else {
                    logFunction(chalk.yellow(`Skipping "${urlString}" because output file already exists.`));
                    filterCallback(null, false);
                }
            });
            return;
        }
        filterCallback(null, true);
    }).catch(err => {
        logFunction(chalk.red(`Could not filter URL list: ${err}`));
        throw err;
    });
}

/**
 * @param {RunOptions} options
 */
async function run({
    inputUrls,
    outputPath,
    verbose,
    logPath,
    numberOfCrawlers,
    dataCollectors,
    reporters,
    forceOverwrite,
    filterOutFirstParty,
    emulateMobile,
    proxyHost,
    regionCode,
    antiBotDetection,
    chromiumVersion,
    maxLoadTimeMs,
    extraExecutionTimeMs,
    collectorFlags,
    seleniumHub
}) {
    const startTime = new Date();

    reporters.forEach(reporter => {
        reporter.init({verbose, startTime, urls: inputUrls.length, logPath});
    });

    /**
     * @type {function(...any):void}
     */
    const log = (...msg) => {
        reporters.forEach(reporter => {
            reporter.log(...msg);
        });
    };

    const urls = await filterUrls(inputUrls, log, forceOverwrite === true ? null : outputPath);
    log(chalk.yellow(`Skipped ${inputUrls.length - urls.length} URLs`));

    const urlsLength = urls.length;
    let failures = 0;
    let successes = 0;

    /**
     * @type {Error}
     */
    let fatalError = null;

    /**
     * @type {Array<Array<number>>}
     */
    let crawlTimes = [];

    // eslint-disable-next-line arrow-parens
    const updateProgress = (/** @type {string} */site = '', /** @type {import('../crawler').CollectResult} */data) => {
        reporters.forEach(reporter => {
            reporter.update({site, successes, failures, urls: urlsLength, data, crawlTimes, fatalError, numberOfCrawlers, regionCode});
        });
    };

    /**
     * @param {URL} url
     * @param {import('../crawler').CollectResult} data
     */
    const dataCallback = (url, data) => {
        successes++;

        crawlTimes.push([data.testStarted, data.testFinished, data.testFinished - data.testStarted]);

        const outputFile = createOutputPath(outputPath, url);

        // move screenshot to its own file and only keep screenshot path in the JSON data
        if (data.data.screenshots) {
            const screenshotFilename = createOutputPath(outputPath, url, 'jpg');
            fs.writeFileSync(screenshotFilename, Buffer.from(data.data.screenshots, 'base64'));

            data.data.screenshots = screenshotFilename;
        }

        updateProgress(url.toString(), data);

        fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
    };

    /**
     * @param {string} url
     */
    const failureCallback = url => {
        failures++;
        updateProgress(url);
    };

    try {
        await runCrawlers({
            urls,
            logFunction: log,
            dataCollectors,
            numberOfCrawlers,
            failureCallback,
            dataCallback,
            filterOutFirstParty,
            emulateMobile,
            proxyHost,
            antiBotDetection,
            chromiumVersion,
            maxLoadTimeMs,
            extraExecutionTimeMs,
            collectorFlags,
            seleniumHub
        });
        log(chalk.green('\n✅ Finished successfully.'));
    } catch(e) {
        log(chalk.red('\n🚨 Fatal error.'), e);
        fatalError = e;
    }

    const endTime = new Date();

    await Promise.all(reporters.map(reporter => reporter.cleanup({startTime, endTime, successes, failures, urls: urlsLength})));

    createMetadataFile(outputPath, {
        startTime,
        endTime,
        fatalError,
        numberOfCrawlers,
        filterOutFirstParty,
        emulateMobile,
        proxyHost,
        regionCode,
        dataCollectors: dataCollectors.map(c => c.id()),
        successes,
        failures,
        urls: inputUrls.length,
        skipped: inputUrls.length - urls.length
    });
}

const config = crawlConfig.figureOut(program.opts());
const collectorFlags = {
    autoconsentAction: program.opts().autoconsentAction,
    enableAsyncStacktraces: true, // this flag is disabled during retries
    shortTimeouts: false,
};
/**
 * @type {BaseCollector[]}
 */
let dataCollectors = null;

if (config.dataCollectors) {
    dataCollectors = config.dataCollectors.map(id => createCollector(id));
} else {
    dataCollectors = getCollectorIds().map(id => createCollector(id));
}

/**
 * @type {BaseReporter[]}
 */
let reporters = null;

if (config.reporters) {
    reporters = config.reporters.map(id => createReporter(id));
} else {
    reporters = [createReporter('cli')];
}

if (!config.urls || !config.output) {
    program.help();
} else {
    if (fs.existsSync(config.output)) {
        if (metadataFileExists(config.output) && !config.forceOverwrite) {
            // eslint-disable-next-line no-console
            console.log(chalk.red('Output folder already exists and contains metadata file.'), 'Use -f to overwrite.');
            process.exit(1);
        }
    } else {
        fs.mkdirSync(config.output);
    }

    /**
     * @type {Array<string|{url:string, dataCollectors:BaseCollector[]}>}
     */
    // @ts-ignore typescript doesn't understand that all string[] will be converted to BaseCollector[]
    const urls = config.urls.map(item => {
        if (typeof item !== 'string' && item.dataCollectors) {
            return {
                url: item.url,
                dataCollectors: item.dataCollectors.map(id => createCollector(id))
            };
        }

        return item;
    });

    run({
        inputUrls: urls,
        outputPath: config.output,
        verbose: config.verbose,
        logPath: config.logPath,
        numberOfCrawlers: config.crawlers || null,
        dataCollectors,
        reporters,
        forceOverwrite: config.forceOverwrite,
        filterOutFirstParty: config.filterOutFirstParty,
        emulateMobile: config.emulateMobile,
        proxyHost: config.proxyConfig,
        regionCode: config.regionCode,
        antiBotDetection: !config.disableAntiBot,
        chromiumVersion: config.chromiumVersion,
        maxLoadTimeMs: config.maxLoadTimeMs,
        extraExecutionTimeMs: config.extraExecutionTimeMs,
        collectorFlags,
        seleniumHub: config.seleniumHub
    });
}

/**
 * @typedef {import('../collectors/BaseCollector')} BaseCollector
 */

/**
 * @typedef {import('../reporters/BaseReporter')} BaseReporter
 */

/**
 * @typedef {Object} RunOptions
 * @property {Array<string|{url:string, dataCollectors?:BaseCollector[]}>} inputUrls
 * @property {string} outputPath
 * @property {boolean} verbose
 * @property {string} logPath
 * @property {number} numberOfCrawlers
 * @property {BaseCollector[]} dataCollectors
 * @property {BaseReporter[]} reporters
 * @property {boolean} forceOverwrite
 * @property {boolean} filterOutFirstParty
 * @property {boolean} emulateMobile
 * @property {string} proxyHost
 * @property {string} regionCode
 * @property {boolean} antiBotDetection
 * @property {string} chromiumVersion
 * @property {number} maxLoadTimeMs
 * @property {number} extraExecutionTimeMs
 * @property {import('../collectors/BaseCollector').CollectorFlags} collectorFlags
 * @property {string} seleniumHub
 */