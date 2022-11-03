/* eslint-disable max-lines */
const path = require('path');
const fs = require('fs');
const chalk = require('chalk').default;
const runCrawlers = require('../crawlerConductor');
const program = require('commander');
const URL = require('url').URL;
const {getCollectorIds, createCollector} = require('../helpers/collectorsList');
const {getReporterIds, createReporter} = require('../helpers/reportersList');
const {metadataFileExists, createMetadataFile} = require('./metadataFile');
const crawlConfig = require('./crawlConfig');
const {createUniqueUrlName} = require('../helpers/hash');

// eslint-disable-next-line no-unused-vars
const BaseCollector = require('../collectors/BaseCollector');
// eslint-disable-next-line no-unused-vars
const BaseReporter = require('../reporters/BaseReporter');

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
    .option('--autoconsent-action <action>', 'dismiss cookie popups. Possible values: optout, optin')
    .option('--chromium-version <version_number>', 'use custom version of chromium')
    .parse(process.argv);

/**
 * @param {Array<string|{url:string, dataCollectors?:BaseCollector[]}>} inputUrls
 * @param {string} outputPath
 * @param {boolean} verbose
 * @param {string} logPath
 * @param {number} numberOfCrawlers
 * @param {BaseCollector[]} dataCollectors
 * @param {BaseReporter[]} reporters
 * @param {boolean} forceOverwrite
 * @param {boolean} filterOutFirstParty
 * @param {boolean} emulateMobile
 * @param {string} proxyHost
 * @param {string} regionCode
 * @param {boolean} antiBotDetection
 * @param {string} chromiumVersion
 * @param {number} maxLoadTimeMs
 * @param {number} extraExecutionTimeMs
 * @param {Object.<string, boolean>} collectorFlags
 */
async function run(inputUrls, outputPath, verbose, logPath, numberOfCrawlers, dataCollectors, reporters, forceOverwrite, filterOutFirstParty, emulateMobile, proxyHost, regionCode, antiBotDetection, chromiumVersion, maxLoadTimeMs, extraExecutionTimeMs, collectorFlags) {
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

    /**
     * @type {function(...any):string}
     * @param {URL} url
     * @param {string} fileType file extension, defaults to 'json'
     */
    const createOutputPath = ((url, fileType = 'json') => path.join(outputPath, `${createUniqueUrlName(url)}.${fileType}`));

    const urls = inputUrls.filter(item => {
        const urlString = (typeof item === 'string') ? item : item.url;

        /**
         * @type {URL}
         */
        let url;

        try {
            url = new URL(urlString);
        } catch(e) {
            log(chalk.yellow('Invalid URL:'), urlString);
            return false;
        }

        if (forceOverwrite !== true) {
            // filter out entries for which result file already exists
            const outputFile = createOutputPath(url);
            if (fs.existsSync(outputFile)) {
                log(chalk.yellow(`Skipping "${urlString}" because output file already exists.`));
                return false;
            }
        }

        return true;
    });

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

        const outputFile = createOutputPath(url);

        // move screenshot to its own file and only keep screenshot path in the JSON data
        if (data.data.screenshots) {
            const screenshotFilename = createOutputPath(url, 'jpg');
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
        });
        log(chalk.green('\n✅ Finished successfully.'));
    } catch(e) {
        log(chalk.red('\n🚨 Fatal error.'), e);
        fatalError = e;
    }

    const endTime = new Date();

    await Promise.all(reporters.map(reporter => reporter.cleanup({endTime, successes, failures, urls: urlsLength})));

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

// @ts-ignore
const config = crawlConfig.figureOut(program);
const collectorFlags = {
    autoconsentAction: program.autoconsentAction,
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

    run(urls, config.output, config.verbose, config.logPath, config.crawlers || null, dataCollectors, reporters, config.forceOverwrite, config.filterOutFirstParty, config.emulateMobile, config.proxyConfig, config.regionCode, !config.disableAntiBot, config.chromiumVersion, config.maxLoadTimeMs, config.extraExecutionTimeMs, collectorFlags);
}
