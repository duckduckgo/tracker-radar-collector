class BaseReporter {

    id() {
        return 'base';
    }

    /**
     * Called once before crawling starts
     * 
     * @param {{verbose: boolean, startTime: Date, urls: number, logPath: string}} options 
     */
    // eslint-disable-next-line no-unused-vars
    init(options) {
    }

    /**
     * Called whenever site was crawled (either successfully or not)
     * 
     * @param {{site: string, failures: number, successes: number, urls: number, data: import("../crawler").CollectResult | undefined, crawlTimes: Array<Array<number>>, fatalError: Error, numberOfCrawlers: number, regionCode: string}} data 
     */
    // eslint-disable-next-line no-unused-vars
    update(data) {
    }

    /**
     * Called whenever some message is meant to be logged (not every reporter has to support that)
     * 
     * @param  {...any} messages 
     */
    // eslint-disable-next-line no-unused-vars
    log(...messages) {
    }

    /**
     * Called at the end of crawling, gives time for clean up (if needed)
     * 
     * @param {{endTime: Date, successes: number, failures: number, urls: number}} data
     * @returns {Promise<void>}
     */
    // eslint-disable-next-line no-unused-vars
    cleanup(data) {
        return Promise.resolve();
    }
}

module.exports = BaseReporter;
