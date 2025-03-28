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
     * @returns {Promise<import('puppeteer-core').Connection>}
     */
    getConnection() {
        throw new Error('Not implemented');
    }
}

module.exports = BaseBrowser;
