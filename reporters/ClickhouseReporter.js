const {createClient} = require('@clickhouse/client');
const os = require('os');
const BaseReporter = require('./BaseReporter');
const {createUniqueUrlName} = require('../helpers/hash');

// eslint-disable-next-line no-process-env
const CLICKHOUSE_SERVER = process.env.CLICKHOUSE_SERVER || 'clickhouse';
const DB = 'tracker_radar_crawls';
const TABLE_DEFINITIONS = [
    `CREATE TABLE IF NOT EXISTS crawls ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        name String,
        region String,
        startedOn Date DEFAULT today()
    )
    ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId)
    ORDER BY crawlId`,
    `CREATE TABLE IF NOT EXISTS pages ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        testStarted DateTime64(3, 'UTC'),
        testFinished DateTime64(3, 'UTC'),
        initialUrl String,
        finalUrl String,
        timeout UInt8
    )
    ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId)`,
    `CREATE TABLE IF NOT EXISTS requests ON CLUSTER 'ch-prod-cluster' (
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
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId, requestId)`,
    `CREATE TABLE IF NOT EXISTS elements ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        present Array(String),
        visible Array(String)
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId)`,
    `CREATE TABLE IF NOT EXISTS cmps ON CLUSTER 'ch-prod-cluster' (
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
        snippets Array(String),
        filterListMatched Bool
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId, name)`,
    `CREATE TABLE IF NOT EXISTS apiSavedCalls ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        callId UInt32,
        source String,
        description String,
        arguments Array(String)
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId, callId)`,
    `CREATE TABLE IF NOT EXISTS apiCallStats ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        source String,
        stats String
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId, source)`,
    `CREATE TABLE IF NOT EXISTS cookies ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        cookieId UInt32,
        cookie String
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId, cookieId)`,
    `CREATE TABLE IF NOT EXISTS targets ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        targetId UInt32,
        url String,
        type String
    ) ENGINE = ReplicatedMergeTree
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
        this.client = createClient({
            url: `http://${CLICKHOUSE_SERVER}:8123`,
            database: DB,
        });
        this.crawlId = `${new Date().toISOString()}-${os.hostname()}`;
        this.ready = Promise.all(TABLE_DEFINITIONS.map(stmt => this.client.query({query: stmt})));
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
            if (this.verbose) {
                console.log(`Creating crawl ${this.crawlId}`);
            }
            await this.client.insert({
                table: 'crawls',
                values: [{
                    crawlId: this.crawlId,
                    name,
                    region,
                }],
                columns: ['crawlId', 'name', 'region'],
                format: 'JSONEachRow',
            });
        });
        return this.ready;
    }

    async deleteCrawlData() {
        await this.ready;
        console.log(`Deleting all data for crawl ${this.crawlId}`);
        const deletes = Object.keys(this.queue)
            .map(table => this.client.query({
                query: `ALTER TABLE ${table} DELETE WHERE crawlId = '${this.crawlId}'`,
            }));
        await Promise.all(deletes);
        await this.client.query({
            query: `ALTER TABLE crawls DELETE WHERE crawlId = '${this.crawlId}'`,
        });
    }

    /**
     * Called whenever site was crawled (either successfully or not)
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
                    // request.size,
                    typeof request.size === 'number' && request.size < 0 ? null : request.size, // FIXME: this is a hack for legacy data
                    request.remoteIPAddress, JSON.stringify(request.responseHeaders || {}),
                    request.responseBodyHash, request.failureReason, request.redirectedTo, request.redirectedFrom,
                    request.initiators.map(u => u.replace(/'/g, '')), request.time || 0
                ]);

                this.queue.requests = this.queue.requests.concat(requestRows);
            }
            if (data.data.elements) {
                this.queue.elements.push([this.crawlId, pageId, data.data.elements.present, data.data.elements.visible]);
            }
            if (data.data.cmps) {
                const cmpRows = data.data.cmps.cmps.map(c => [
                    this.crawlId,
                    pageId,
                    c.name,
                    c.final,
                    c.open,
                    c.started,
                    c.succeeded,
                    c.selfTestFail,
                    c.errors,
                    c.patterns || [],
                    c.snippets || [],
                    c.filterListMatched || false,
                ]);
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
            await this.client.insert({
                table,
                // @ts-ignore
                values: this.queue[table],
            });
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
