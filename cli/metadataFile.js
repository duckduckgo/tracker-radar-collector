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

module.exports = {
    createMetadataFile,
    metadataFileExists
};
