const {ClickHouse} = require('clickhouse');
const os = require('os');
const BaseReporter = require('./BaseReporter');
const {createUniqueUrlName} = require('../helpers/hash');

// eslint-disable-next-line no-process-env
const CLICKHOUSE_SERVER = process.env.CLICKHOUSE_SERVER || 'va-clickhouse1';
const DB = 'tracker_radar_crawls';
const TABLE_DEFINITIONS = [
    `CREATE TABLE IF NOT EXISTS ${DB}.crawls (
        crawlId String,
        name String,
        region String,
        startedOn Date DEFAULT today()
    )
    ENGINE = MergeTree()
    PRIMARY KEY(crawlId)
    ORDER BY crawlId`,
    `CREATE TABLE IF NOT EXISTS ${DB}.pages (
        crawlId String,
        pageId String,
        testStarted DateTime64(3, 'UTC'),
        testFinished DateTime64(3, 'UTC'),
        initialUrl String,
        finalUrl String,
        timeout UInt8
    ) ENGINE = MergeTree()
    PRIMARY KEY(crawlId, pageId)`,
    `CREATE TABLE IF NOT EXISTS ${DB}.requests (
        crawlId String,
        pageId String,
        requestId UInt32,
        url String,
        method String,
        type String,
        status UInt16 NULL,
        size UInt32 NULL,
        remoteIPAddress String NULL,
        responseHeaders String,
        responseBodyHash String NULL,
        failureReason String NULL,
        redirectedTo String NULL,
        redirectedFrom String NULL,
        initiators Array(String),
        time DOUBLE NULL
    ) ENGINE = MergeTree()
    PRIMARY KEY(crawlId, pageId, requestId)`,
    `CREATE TABLE IF NOT EXISTS ${DB}.elements (
        crawlId String,
        pageId String,
        present Array(String),
        visible Array(String)
    ) ENGINE = MergeTree()
    PRIMARY KEY(crawlId, pageId)`,
    `CREATE TABLE IF NOT EXISTS ${DB}.cmps (
        crawlId String,
        pageId String,
        name String,
        final UInt8,
        open UInt8,
        started UInt8,
        succeeded UInt8,
        selfTestFail UInt8,
        errors Array(String),
        patterns Array(String),
        snippets Array(String)
    ) ENGINE = MergeTree()
    PRIMARY KEY(crawlId, pageId, name)`,
    `CREATE TABLE IF NOT EXISTS ${DB}.apiSavedCalls (
        crawlId String,
        pageId String,
        callId UInt32,
        source String,
        description String,
        arguments Array(String)
    ) ENGINE = MergeTree()
    PRIMARY KEY(crawlId, pageId, callId)`,
    `CREATE TABLE IF NOT EXISTS ${DB}.apiCallStats (
        crawlId String,
        pageId String,
        source String,
        stats String
    ) ENGINE = MergeTree()
    PRIMARY KEY(crawlId, pageId, source)`,
    `CREATE TABLE IF NOT EXISTS ${DB}.cookies (
        crawlId String,
        pageId String,
        cookieId UInt32,
        cookie String
    ) ENGINE = MergeTree()
    PRIMARY KEY(crawlId, pageId, cookieId)`,
    `CREATE TABLE IF NOT EXISTS ${DB}.targets (
        crawlId String,
        pageId String,
        targetId UInt32,
        url String,
        type String
    ) ENGINE = MergeTree()
    PRIMARY KEY(crawlId, pageId, targetId)`,
];

/**
 * @param {string | string[]} args
 */
function santizeCallArgs(args) {
    // in some cases call args have been stringified, so unwrap that first.
    const argsArray = typeof args === 'string' ? JSON.parse(args) : (args || []);
    return argsArray.map((/** @type {string} */ s) => s.replace(/'/g, ''));
}

class ClickhouseReporter extends BaseReporter {

    id() {
        return 'clickhouse';
    }

    /**
     * @param {{verbose: boolean, startTime: Date, urls: number, logPath: string}} options 
     */
    init(options) {
        this.verbose = options.verbose;
        this.client = new ClickHouse({url: CLICKHOUSE_SERVER});
        this.crawlId = `${new Date().toISOString()}-${os.hostname()}`;
        this.ready = Promise.all(TABLE_DEFINITIONS.map(stmt => this.client.query(stmt).toPromise()));
        if (this.verbose) {
            console.log(`Creating crawl ${this.crawlId}`);
        }
        this.queue = {
            pages: [],
            requests: [],
            elements: [],
            apiSavedCalls: [],
            cmps: [],
            apiCallStats: [],
            cookies: [],
            targets: [],
        };
    }

    /**
     * @param {string} name
     * @param {string} region
     */
    createCrawl(name = '', region = '') {
        this.ready.then(async () => {
            await this.client.insert(`INSERT INTO ${DB}.crawls (crawlId, name, region)`, [{
                crawlId: this.crawlId,
                name,
                region,
            }]).toPromise();
        });
        return this.ready;
    }

    async deleteCrawlData() {
        await this.ready;
        console.log(`Deleting all data for crawl ${this.crawlId}`);
        const deletes = Object.keys(this.queue)
            .map(table => this.client.query(`ALTER TABLE ${DB}.${table} DELETE WHERE crawlId = '${this.crawlId}'`).toPromise());
        await Promise.all(deletes);
        await this.client.query(`ALTER TABLE ${DB}.crawls DELETE WHERE crawlId = '${this.crawlId}'`).toPromise();
    }

    /**
     * Called whenever site was crawled (either successfully or not)
     * 
     * @param {{site: string, failures: number, successes: number, urls: number, data: import('../crawler').CollectResult | undefined, crawlTimes: Array<Array<number>>, fatalError: Error, numberOfCrawlers: number, regionCode: string}} data 
     */
    update(data) {
        if (data.data) {
            this.processSite(data.data);
        }
    }

    /**
     * @param {import('../crawler').CollectResult} data
     */
    processSite(data) {
        // @ts-ignore
        const pageId = createUniqueUrlName(new URL(data.initialUrl));
        this.ready = this.ready.then(async () => {
            this.queue.pages.push([this.crawlId, pageId, data.testStarted, data.testFinished, data.initialUrl, data.finalUrl, data.timeout]);
            if (data.data.requests) {
                const requestRows = data.data.requests.map((request, requestId) => [
                    this.crawlId, pageId, requestId, request.url, request.method, request.type, request.status,
                    request.size, request.remoteIPAddress, JSON.stringify(request.responseHeaders || {}),
                    request.responseBodyHash, request.failureReason, request.redirectedTo, request.redirectedFrom,
                    request.initiators.map(u => u.replace(/'/g, '')), request.time || 0
                ]);

                this.queue.requests = this.queue.requests.concat(requestRows);
            }
            if (data.data.elements) {
                this.queue.elements.push([this.crawlId, pageId, data.data.elements.present, data.data.elements.visible]);
            }
            if (data.data.cmps) {
                const cmpRows = data.data.cmps.map(c => [this.crawlId, pageId, c.name, c.final, c.open, c.started, c.succeeded, c.selfTestFail, c.errors, c.patterns || [], c.snippets || []]);
                this.queue.cmps = this.queue.cmps.concat(cmpRows);
            }
            if (data.data.apis) {
                const {callStats,savedCalls} = data.data.apis;
                const callStatRows = Object.keys(callStats).map(source => [this.crawlId, pageId, source, JSON.stringify(callStats[source])]);
                this.queue.apiCallStats = this.queue.apiCallStats.concat(callStatRows);
                const savedCallRows = savedCalls.map((c, i) => [this.crawlId, pageId, i, c.source, c.description, santizeCallArgs(c.arguments)]);
                this.queue.apiSavedCalls = this.queue.apiSavedCalls.concat(savedCallRows);
            }
            if (data.data.cookies) {
                this.queue.cookies = this.queue.cookies.concat(data.data.cookies.map((c, i) => [this.crawlId, pageId, i, JSON.stringify(c)]));
            }
            if (data.data.targets) {
                this.queue.targets = this.queue.targets.concat(data.data.targets.map((t, i) => [this.crawlId, pageId, i, t.url, t.type]));
            }

            if (this.queue.pages.length >= 10) {
                await this.commitQueue();
            }
        });
        return this.ready;
    }

    async commitQueue() {
        const inserts = Object.keys(this.queue).map(async table => {
            // @ts-ignore
            await this.client.insert(`INSERT INTO ${DB}.${table}`, this.queue[table]).toPromise();
            // @ts-ignore
            this.queue[table] = [];
        });
        await Promise.all(inserts);
    }

    /**
     * @returns {Promise<void>}
     */
    async cleanup() {
        await this.ready;
        await this.commitQueue();
    }
}

module.exports = ClickhouseReporter;
