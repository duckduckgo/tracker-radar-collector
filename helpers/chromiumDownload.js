const { canDownload, install, Browser, resolveBuildId, detectBrowserPlatform, getInstalledBrowsers } = require('@puppeteer/browsers');
const ProgressBar = require('progress');
const { CHROMIUM_DOWNLOAD_DIR } = require('../constants');
const chalk = require('chalk');

/**
 * @param {function} log
 * @param {string=} buildId
 * @returns {Promise<string>} executable path of the downloaded Chromium
 */
async function downloadChrome(log, buildId) {
    const platform = detectBrowserPlatform();
    const finalBuildId = buildId || (await resolveBuildId(Browser.CHROME, detectBrowserPlatform(), 'stable'));

    const installOptions = {
        cacheDir: CHROMIUM_DOWNLOAD_DIR,
        browser: Browser.CHROME,
        platform,
        buildId: finalBuildId,
    };

    const installedBrowsers = await getInstalledBrowsers({
        cacheDir: CHROMIUM_DOWNLOAD_DIR,
    });

    for (const browser of installedBrowsers) {
        if (browser.platform === platform && browser.buildId === finalBuildId && browser.browser === Browser.CHROME) {
            return browser.executablePath;
        }
    }

    if (!canDownload(installOptions)) {
        throw new Error(`Provided version of Chrome (${finalBuildId}) can't be downloaded.`);
    }

    log(chalk.blue(`⬇ Downloading Chrome build ${finalBuildId} for ${platform}...`));
    const progressBar = new ProgressBar('[:bar] :percent ETA :etas', { total: 100, width: 30 });
    const browser = await install({
        ...installOptions,
        downloadProgressCallback(downloadedBytes, totalBytes) {
            progressBar.update(downloadedBytes / totalBytes);
        },
    });
    log(chalk.blue(`⬇ Downloaded Chrome build ${browser.buildId} for ${browser.platform} to ${browser.executablePath}`));
    return browser.executablePath;
}

module.exports = {
    downloadChrome,
};
