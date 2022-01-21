const fs = require('fs');
const path = require('path');
const BaseReporter = require('./BaseReporter');

/**
 * @param {string} outputPath
 * @param {Array<{path: string, url: string}>} screenshotPaths
 */
function rebuildIndex (outputPath, screenshotPaths) {
    const bodyContent = screenshotPaths.map(item => `<p>${item.url}</p><a href='${item.path}'><img src='${item.path}' alt='${item.url}' loading='lazy' style='max-width: 800px; max-height: 400px' /></a>`);

    const html = `<html>
    <head>
        <title>Crawler screenshots</title>
    </head>
    <body>
        <p>Number of screenshots: ${screenshotPaths.length}</p>
        ${bodyContent}
    </body>
</html>`;

    fs.writeFileSync(`${outputPath}/screenshots.html`, html);
}

/**
 * @param {number} dateString
 * @return {string}
 */
function _getTimeBucket (dateString) {
    const date = new Date(dateString);
    return `${date.getMonth()}/${date.getDay()}/${date.getHours()}:${date.getMinutes()}`;
}

/**
 * @param {string} outputPath
 * @param {{crawlTimes: number[][], startTime: Date, urls: number, successes: number, failures: number, numberOfCrawlers: number, regionCode: string, fatalError: Error}} data
 */
function createMetadataHTML(outputPath, {startTime, crawlTimes, fatalError, numberOfCrawlers, regionCode, successes, failures, urls}) {
    /** @type {Object.<string, number>} */
    let minuteBuckets = {};

    /** @type {{sites: number, total: number}}*/
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
    finishTime.setMinutes(finishTime.getMinutes() + ((urls - (successes + failures)) / crawlRate));

    const html = `<html>
<head>
    <title>Crawler status</title>
</head>
<body>
    <p>Status: crawling site ${successes + failures} of ${urls}</p>
    <p>Avg site load time: ${((crawlStats.total / crawlStats.sites) / 1000).toFixed(1)} sec</p>
    <p>Avg crawl rate: ${crawlRate.toFixed(1)} sites/min ${numberOfCrawlers ? 'with ' + numberOfCrawlers + ' crawlers' : ''}</p>
    <p>Estimated completion time: ${finishTime.toString()}</p>
    <p>Region: ${regionCode ? regionCode : "US"}</p>
    <p>Crawl started: ${startTime}</p>
    <p>Last update: ${new Date()}</p>
    <p>Errors: ${fatalError ? fatalError : 'None'}</p>
    <a href="./screenshots.html?a=${Math.floor(Math.random() * 10000000)}">Screenshots</a>
</body>
</html>`;

    fs.writeFileSync(`${outputPath}/index.html`, html);
}

class HTMLReporter extends BaseReporter {

    id() {
        return 'html';
    }

    /**
     * @param {{verbose: boolean, startTime: Date, urls: number, logPath: string}} options 
     */
    init(options) {
        this.logPath = options.logPath;
        /**
         * @type {Array<{path: string, url: string}>}
         */
        this.screenshotPaths = [];
        this.startTime = options.startTime;
    }

    /**
     * @param {{site: string, failures: number, successes: number, urls: number, data: import("../crawler").CollectResult, crawlTimes: Array<Array<number>>, fatalError: Error, numberOfCrawlers: number, regionCode: string}} updateData 
     */
    update(updateData) {
        const screenshotPath = updateData.data ? updateData.data.data.screenshots : null;

        if (screenshotPath) {
            const resolvedPath = path.relative(this.logPath, screenshotPath);
            this.screenshotPaths.push({path: resolvedPath, url: updateData.site});
            rebuildIndex(this.logPath, this.screenshotPaths);
        }

        // rewrite metadata page every 1%
        if (((updateData.successes + updateData.failures) / updateData.urls) * 100 % 1 === 0) {
            createMetadataHTML(this.logPath, {
                startTime: this.startTime,
                crawlTimes: updateData.crawlTimes,
                fatalError: updateData.fatalError,
                numberOfCrawlers: updateData.numberOfCrawlers,
                regionCode: updateData.regionCode,
                successes: updateData.successes,
                failures: updateData.failures,
                urls: updateData.urls
            });
        }
    }
}

module.exports = HTMLReporter;
