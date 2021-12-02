const path = require('path');
const fs = require('fs');
const os = require('os');
const package = require('../package.json');
const METADATA_FILE_NAME = 'metadata.json';

/**
 * @param {string} outputPath
 * @returns {boolean} 
 */
function metadataFileExists(outputPath) {
    const filePath = path.join(outputPath, METADATA_FILE_NAME);

    return fs.existsSync(filePath);
}

/**
 * @param {string} outputPath
 * @param {{startTime: Date, endTime: Date, urls: number, successes: number, failures: number, skipped: number, numberOfCrawlers: number, filterOutFirstParty: boolean, emulateMobile: boolean, proxyHost: string, regionCode: string, dataCollectors: string[], fatalError: Error}} data
 */
function createMetadataFile(outputPath, {startTime, endTime, urls, successes, failures, skipped, numberOfCrawlers, filterOutFirstParty, dataCollectors, fatalError, emulateMobile, proxyHost, regionCode}) {
    const filePath = path.join(outputPath, METADATA_FILE_NAME);

    fs.writeFileSync(filePath, JSON.stringify({
        startTime: startTime.getTime(),
        endTime: endTime.getTime(),
        result: fatalError ? fatalError.message : 'success',
        stats: {
            urls,
            skipped,
            successes,
            failures
        },
        config: {
            numberOfCrawlers: numberOfCrawlers || undefined,
            dataCollectors: dataCollectors || undefined,
            filterOutFirstParty: filterOutFirstParty || undefined,
            proxyHost: proxyHost || undefined,
            regionCode: regionCode || undefined,
            emulateMobile: emulateMobile || undefined
        },
        environment: {
            projectVersion: package.version,
            hostname: os.hostname(),
            cpus: os.cpus().length,
            username: os.userInfo().username
        }
    }, null, 2));
}

/**
 * @param {string} dateString
 * @return {string}
 */
function _getTimeBucket (dateString) {
    const date = new Date(dateString);
    return `${date.getMonth()}/${date.getDay()}/${date.getHours()}:${date.getMinutes()}`;
}

/**
 * @param {string} outputPath
 * @param {{crawlTimes: number[], startTime: Date, urls: number, successes: number, failures: number, skipped: number, numberOfCrawlers: number, regionCode: string, fatalError: Error}} data
 */
function createMetadataHTML(outputPath, {startTime, crawlTimes, fatalError, numberOfCrawlers, regionCode, successes, failures, urls, skipped}) {
    let minuteBuckets = {};

    const crawlStats = crawlTimes.reduce((stats, siteTime) => {
        stats.sites++;
        stats.total += siteTime[2];

        const timeBucketKey = _getTimeBucket(siteTime[1]);
        if (minuteBuckets[timeBucketKey]) {
            minuteBuckets[timeBucketKey]++;
        } else {
            minuteBuckets[timeBucketKey] = 1;
        }
        return stats;
    }, {sites: 0, total: 0});

    const crawlRate = crawlStats.sites / Object.keys(minuteBuckets).length;
    const finishTime = new Date();
    finishTime.setMinutes(finishTime.getMinutes() + ((urls - (successes + failures + skipped)) / crawlRate));

    const html = `<html>
    <head>
        <title>Crawler status</title>
    </head>
    <body>
        <p>Status: crawling site ${successes + failures} of ${urls}</p>
        <p>Avg site load time: ${((crawlStats.total / crawlStats.sites) / 1000).toFixed(1)} sec</p>
        <p>Avg crawl rate: ${crawlRate.toFixed(1)} sites/min with ${numberOfCrawlers} crawlers</p>
        <p>Estimated completion time: ${finishTime.toString()}</p>
        <p>Region: ${regionCode ? regionCode : "US"}</p>
        <p>Crawl started: ${startTime}</p>
        <p>Last update: ${new Date()}</p>
        <p>Errors: ${fatalError ? fatalError : 'None'}</p>
        <a href="/screenshots/index.html?a=${Math.floor(Math.random() * 10000000)}">Screenshots</a>
    </body>
    </html>`;

    fs.writeFileSync(`${outputPath}/index.html`, html);
}

module.exports = {
    createMetadataFile,
    metadataFileExists,
    createMetadataHTML
};
