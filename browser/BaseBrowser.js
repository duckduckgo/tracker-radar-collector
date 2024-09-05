class BaseBrowser {
    /**
     * @returns {Promise<void>}
     */
    start() {
        throw new Error('Not implemented');
    }

    close() {
        throw new Error('Not implemented');
    }

    /**
     * @returns {Promise<import('puppeteer-core/lib/cjs/puppeteer/common/Connection').Connection>}
     */
    getConnection() {
        throw new Error('Not implemented');
    }
}

module.exports = BaseBrowser;

/**
 * @typedef BrowserOptions
 * @property {any=} viewport
 * @property {string=} executablePath
 * @property {string[]=} extraArgs
 * @property {boolean=} headless
 */
