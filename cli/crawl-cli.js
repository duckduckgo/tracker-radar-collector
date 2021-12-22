const path = require('path');
const fs = require('fs');
const chalk = require('chalk').default;
const runCrawlers = require('../crawlerConductor');
const program = require('commander');
const URL = require('url').URL;
const crypto = require('crypto');
const {getCollectorIds, createCollector} = require('../helpers/collectorsList');
const {getReporterIds, createReporter} = require('../helpers/reportersList');
const {metadataFileExists, createMetadataFile} = require('./metadataFile');

// eslint-disable-next-line no-unused-vars
const BaseCollector = require('../collectors/BaseCollector');
// eslint-disable-next-line no-unused-vars
const BaseReporter = require('../reporters/BaseReporter');

program
    .option('-o, --output <path>', '(required) output folder')
    .option('-u, --url <url>', 'single URL')
    .option('-i, --input-list <path>', 'path to list of URLs')
    .option('-d, --data-collectors <list>', `comma separated list of data collectors: ${getCollectorIds().join(', ')} (all by default)`)
    .option('-l, --log-path <path>', 'path where all logs should be written to')
    .option('-v, --verbose', 'print log data to the screen')
    .option('--reporters <list>', `comma separated list of reporters: ${getReporterIds().join(', ')}`)
    .option('-c, --crawlers <number>', 'overwrite the default number of concurent crawlers')
    .option('-f, --force-overwrite', 'overwrite existing output files')
    .option('-3, --only-3p', 'don\'t save any first-party data')
    .option('-m, --mobile', 'emulate a mobile device')
    .option('-p, --proxy-config <host>', 'use an optional proxy configuration')
    .option('-r, --region-code <region>', 'optional 2 letter region code. Used for metadata only.')
    .option('-a, --disable-anti-bot', 'disable anti bot detection protections injected to every frame')
    .option('--chromium-version <version_number>', 'use custom version of chromium')
    .option('-h, --html-log', 'Write index.html to output directory with crawl stats')
    .parse(process.argv);

/**
 * @param {string[]} inputUrls
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
 */
async function run(inputUrls, outputPath, verbose, logPath, numberOfCrawlers, dataCollectors, reporters, forceOverwrite, filterOutFirstParty, emulateMobile, proxyHost, regionCode, antiBotDetection, chromiumVersion) {
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
    const createOutputPath = ((url, fileType='json') => {
        let hash = crypto.createHash('sha1').update(url.toString()).digest('hex');
        hash = hash.substring(0, 4); // truncate to length 4
        return path.join(outputPath, `${url.hostname}_${hash}.${fileType}`);
    });

    const urls = inputUrls.filter(urlString => {
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
    const updateProgress = (/** @type {string} */site = '', /** @type {{testStarted: number, testFinished: number, data: {screenshots: string}}}} */data) => {
        reporters.forEach(reporter => {
            reporter.update({site, successes, failures, urls: urlsLength, data, crawlTimes, fatalError, numberOfCrawlers, regionCode});
        });
    };

    /**
     * @param {URL} url
     * @param {{testStarted: number, testFinished: number, data: {screenshots: string}}} data
     */
    const dataCallback = (url, data) => {
        successes++;

        crawlTimes.push([data.testStarted, data.testFinished, data.testFinished - data.testStarted]);

        const outputFile = createOutputPath(url);

        // temp name for the screenshot is scored in data. rename the screenshot to match the file crawl file
        if (data.data.screenshots) {
            const screenshotFilename = createOutputPath(url, 'jpg');
            fs.writeFileSync(screenshotFilename, Buffer.from(data.data.screenshots, 'base64'));

            // we don't want to keep base64 images in json files, lets replace that with jpeg output path
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
            chromiumVersion
        });
        log(chalk.green('\n✅ Finished successfully.'));
    } catch(e) {
        log(chalk.red('\n🚨 Fatal error.'), e);
        fatalError = e;
    }

    const endTime = new Date();

    reporters.forEach(reporter => {
        reporter.cleanup({endTime, successes, failures, urls: urlsLength});
    });

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

const verbose = Boolean(program.verbose);
const forceOverwrite = Boolean(program.forceOverwrite);
const filterOutFirstParty = Boolean(program.only3p);
const emulateMobile = Boolean(program.mobile);
/**
 * @type {BaseCollector[]}
 */
let dataCollectors = null;
/**
 * @type {BaseReporter[]}
 */
let reporters = null;
let urls = null;

if (typeof program.dataCollectors === 'string') {
    const dataCollectorsIds = program.dataCollectors.split(',').map(n => n.trim()).filter(n => n.length > 0);

    dataCollectors = [];

    dataCollectorsIds.forEach(id => {
        try {
            dataCollectors.push(createCollector(id));
        } catch (e) {
            console.log(chalk.red(`Error creating collector "${id}".`), e.message);
            process.exit(1);
        }
    });
} else {
    dataCollectors = getCollectorIds().map(id => createCollector(id));
}

if (typeof program.reporters === 'string') {
    const reporterIds = program.reporters.split(',').map(n => n.trim()).filter(n => n.length > 0);

    reporters = [];

    reporterIds.forEach(id => {
        try {
            reporters.push(createReporter(id));
        } catch (e) {
            console.log(chalk.red(`Error creating reporter "${id}".`), e.message);
            process.exit(1);
        }
    });
} else {
    reporters = [createReporter('cli')];
}

if (program.url) {
    urls = [program.url];
} else if(program.inputList) {
    urls = fs.readFileSync(program.inputList).toString().split('\n').map(u => u.trim());
}

if (!urls || !program.output) {
    program.help();
} else {
    urls = urls.map(url => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        return `http://${url}`;
    });

    if (fs.existsSync(program.output)) {
        if (metadataFileExists(program.output) && !forceOverwrite) {
            // eslint-disable-next-line no-console
            console.log(chalk.red('Output folder already exists and contains metadata file.'), 'Use -f to overwrite.');
            process.exit(1);
        }
    } else {
        fs.mkdirSync(program.output);
    }

    run(urls, program.output, verbose, program.logPath, program.crawlers || null, dataCollectors, reporters, forceOverwrite, filterOutFirstParty, emulateMobile, program.proxyConfig, program.regionCode, !program.disableAntiBot, program.chromiumVersion);
}
