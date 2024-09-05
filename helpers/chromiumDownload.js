const puppeteer = require('puppeteer');
const {PUPPETEER_REVISIONS} = require('puppeteer-core/lib/cjs/puppeteer/revisions.js');
const ProgressBar = require('progress');
const {CHROMIUM_DOWNLOAD_DIR} = require('../constants');
const chalk = require('chalk');

/**
 * @param {function} log
 * @param {string} version 
 * @returns {Promise<string>} executable path of the downloaded Chromium
 */
async function downloadCustomChromium(log, version) {
    const browserFetcher = puppeteer.createBrowserFetcher({
        path: CHROMIUM_DOWNLOAD_DIR,
    });
    const revInfo = browserFetcher.revisionInfo(version);
    if (revInfo.local) {
        log(chalk.blue(`⬇ Using existing version of Chromium - ${version}.`));
        return revInfo.executablePath;
    }
    const canDownload = await browserFetcher.canDownload(version);

    if (!canDownload) {
        throw new Error(`Provided version of Chromium (${version}) can't be downloaded.`);
    }

    log(chalk.blue(`⬇ Downloading custom version of Chromium - ${version}.`));
    const progressBar = new ProgressBar('[:bar] :percent ETA :etas', {total: 100, width: 30});
    const revisionInfo = await browserFetcher.download(version, (/** @type {number} **/current, /** @type {number} **/total) => progressBar.update(current / total));

    return revisionInfo.executablePath;
}

/**
 * @param {function} log 
 * @returns {Promise<string>} executable path of the downloaded Chromium
 */
function getDefaultChromium(log) {
    const browserFetcher = puppeteer.createBrowserFetcher({
        path: CHROMIUM_DOWNLOAD_DIR,
    });
    const revisionInfo = browserFetcher.revisionInfo(PUPPETEER_REVISIONS.chromium);
    if (!revisionInfo.local) {
        return downloadCustomChromium(log, PUPPETEER_REVISIONS.chromium);
    }
    return Promise.resolve(revisionInfo.executablePath);
}

module.exports = {
    downloadCustomChromium,
    getDefaultChromium,
};
