const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk').default;
const runCrawlers = require('../crawlerConductor');
const program = require('commander');
const ProgressBar = require('progress');
const URL = require('url').URL;
const crypto = require('crypto');
const {getCollectorIds, createCollector} = require('../helpers/collectorsList');
const {metadataFileExists, createMetadataFile, createMetadataHTML} = require('./metadataFile');
// eslint-disable-next-line no-unused-vars
const BaseCollector = require('../collectors/BaseCollector');
const screenshotHelper = require('../helpers/screenshot');

program
    .option('-o, --output <path>', '(required) output folder')
    .option('-u, --url <url>', 'single URL')
    .option('-i, --input-list <path>', 'path to list of URLs')
    .option('-d, --data-collectors <list>', `comma separated list of data collectors: ${getCollectorIds().join(', ')} (all by default)`)
    .option('-l, --log-file <path>', 'save log data to a file')
    .option('-v, --verbose', 'print log data to the screen')
    .option('-c, --crawlers <number>', 'overwrite the default number of concurent crawlers')
    .option('-f, --force-overwrite', 'overwrite existing output files')
    .option('-3, --only-3p', 'don\'t save any first-party data')
    .option('-m, --mobile', 'emulate a mobile device')
    .option('-p, --proxy-config <host>', 'use an optional proxy configuration')
    .option('-r, --region-code <region>', 'optional 2 letter region code. Used for metadata only.')
    .option('-a, --disable-anti-bot', 'disable anti bot detection protections injected to every frame')
    .option('--chromium-version <version_number>', 'use custom version of chromium')
    .option('-s, --screenshot-logging <path>', 'optional list of sites to take screenshots for')
    .option('-h, --html-log', 'Write index.html to output directory with crawl stats')
    .parse(process.argv);

/**
 * @param {string[]} inputUrls
 * @param {string} outputPath
 * @param {boolean} verbose
 * @param {string} logPath
 * @param {number} numberOfCrawlers
 * @param {BaseCollector[]} dataCollectors
 * @param {boolean} forceOverwrite
 * @param {boolean} filterOutFirstParty
 * @param {boolean} emulateMobile
 * @param {string} proxyHost
 * @param {string} regionCode
 * @param {boolean} antiBotDetection
 * @param {string} chromiumVersion
 * @param {string} screenshotLogging
 */
async function run(inputUrls, outputPath, verbose, logPath, numberOfCrawlers, dataCollectors, forceOverwrite, filterOutFirstParty, emulateMobile, proxyHost, regionCode, antiBotDetection, chromiumVersion, screenshotLogging) {
    const logFile = logPath ? fs.createWriteStream(logPath, {flags: 'w'}) : null;

    /**
     * @type {function(...any):void}
     */
    const log = (...msg) => {
        if (verbose) {
            // eslint-disable-next-line no-console
            console.log(...msg);
        }

        if (logFile) {
            logFile.write(msg.join(' ') + '\n');
        }
    };

    /**
     * @type {function(...any):string}
     * @param {URL} url
     */
    const createOutputPath = (url => {
        let hash = crypto.createHash('sha1').update(url.toString()).digest('hex');
        hash = hash.substring(0, 4); // truncate to length 4
        return path.join(outputPath, `${url.hostname}_${hash}.json`);
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

    // show progress bar only if we are not printing all logs to screen (verbose)
    const progressBar = (verbose || urls.length === 0) ? null : new ProgressBar('[:bar] :percent ETA :etas fail :fail% :site', {
        complete: chalk.green('='),
        incomplete: ' ',
        total: urls.length,
        width: 30
    });

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
    
    const startTime = new Date();

    log(chalk.cyan(`Start time: ${startTime.toUTCString()}`));
    log(chalk.cyan(`Number of urls to crawl: ${urls.length}`));

    // eslint-disable-next-line arrow-parens
    const updateProgress = (/** @type {string} */site = '') => {
        if(progressBar) {
            progressBar.tick({
                site,
                fail: (failures / (failures + successes) * 100).toFixed(1)
            });
        }
    };

    /**
     * @param {URL} url
     * @param {{testStarted: number, testFinished: number, data: {screenshot: string}}} data
     */
    const dataCallback = (url, data) => {
        successes++;
        updateProgress(url.toString());

        crawlTimes.push([data.testStarted, data.testFinished, data.testFinished - data.testStarted]);

        const outputFile = createOutputPath(url);
        fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));

        // temp name for the screenshot is scored in data. rename the screenshot to match the file crawl file
        if (data.data.screenshot) {
            const screenshotFilename = `${outputPath}/screenshots/${url.hostname}_${outputFile.match(/_([a-z0-9]{4})\.json/)[1]}.jpg`;
            fs.move(data.data.screenshot, screenshotFilename, err => {
                log(err);
            });
            screenshotHelper.rebuildIndex(outputPath);
        }

        // rewrite metadata page every 1%
        if (program.htmlLog && ((successes + failures) / urls.length)*100 % 1 === 0) {
            createMetadataHTML(outputPath, {
                startTime,
                crawlTimes,
                fatalError,
                numberOfCrawlers,
                regionCode,
                successes,
                failures,
                urls: inputUrls.length,
                skipped: inputUrls.length - urls.length
            });
        }
    };

    /**
     * @param {string} url
     */
    const failureCallback = url => {
        failures++;
        updateProgress(url);
    };

    if (progressBar) {
        progressBar.render();
    }

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
            screenshotLogging
        });
        log(chalk.green('\n✅ Finished successfully.'));
    } catch(e) {
        log(chalk.red('\n🚨 Fatal error.'), e);
        fatalError = e;
    }

    const endTime = new Date();

    log(chalk.cyan(`Finish time: ${endTime.toUTCString()}`));
    log(chalk.cyan(`Sucessful crawls: ${successes}/${urls.length} (${(successes / urls.length * 100).toFixed(2)}%)`));
    log(chalk.cyan(`Failed crawls: ${failures}/${urls.length} (${(failures / urls.length * 100).toFixed(2)}%)`));

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
let urls = null;

if (typeof program.dataCollectors === 'string') {
    const dataCollectorsIds = program.dataCollectors.split(',').map(n => n.trim()).filter(n => n.length > 0);

    dataCollectors = [];

    dataCollectorsIds.forEach(id => {
        if (!getCollectorIds().includes(id)) {
            // eslint-disable-next-line no-console
            console.log(chalk.red(`Unknown collector "${id}".`), `Valid collector names are: ${getCollectorIds().join(', ')}.`);
            process.exit(1);
        }

        dataCollectors.push(createCollector(id));
    });
} else {
    dataCollectors = getCollectorIds().map(id => createCollector(id));
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

    if (fs.existsSync(`${program.output}/screenshots`) && !forceOverwrite) {
        // eslint-disable-next-line no-console
        console.log(chalk.red('Screenshot folder already exists'), 'Use -f to overwrite.');
    } else if (program.screenshotLogging) {
        screenshotHelper.loadScreenshotList(program.screenshotLogging);
        if (!fs.existsSync(`${program.output}/screenshots`)) {
            fs.mkdirSync(`${program.output}/screenshots`);
        }
    }

    if (fs.existsSync(program.output)) {
        if (metadataFileExists(program.output) && !forceOverwrite) {
            // eslint-disable-next-line no-console
            console.log(chalk.red('Output folder already exists and contains metadata file.'), 'Use -f to overwrite.');
            process.exit(1);
        }
    } else {
        fs.mkdirSync(program.output);
    }

    run(urls, program.output, verbose, program.logFile, program.crawlers || null, dataCollectors, forceOverwrite, filterOutFirstParty, emulateMobile, program.proxyConfig, program.regionCode, !program.disableAntiBot, program.chromiumVersion, program.screenshotLogging);
}
