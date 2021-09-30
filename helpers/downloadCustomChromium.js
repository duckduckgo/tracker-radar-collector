const puppeteer = require('puppeteer');
const ProgressBar = require('progress');
const chalk = require('chalk').default;

/**
 * @param {function} log
 * @param {string} version 
 * @returns {Promise<string>} executable path of the downloaded Chromium
 */
async function downloadCustomChromium(log, version) {
    /**
     * @type {import('puppeteer').BrowserFetcher}
     */
    // @ts-ignore for some reason createBrowserFetcher is missing from the typescript definition?
    const browserFetcher = puppeteer.createBrowserFetcher();
    const canDownload = await browserFetcher.canDownload(version);

    if (!canDownload) {
        throw new Error(`Provided version of Chromium (${version}) can't be downloaded.`);
    }

    log(chalk.blue(`⬇ Downloading custom version of Chromium - ${version}.`));
    const progressBar = new ProgressBar('[:bar] :percent ETA :etas', {total: 100, width: 30});
    const revisionInfo = await browserFetcher.download(version, (/** @type {number} **/current, /** @type {number} **/total) => progressBar.update(current / total));

    return revisionInfo.executablePath;
}

module.exports = downloadCustomChromium;
