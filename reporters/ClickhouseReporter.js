const { createClient } = require('@clickhouse/client');
const os = require('os');
const BaseReporter = require('./BaseReporter');
const { createUniqueUrlName } = require('../helpers/hash');

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
        filterListMatched Bool,
        llmPopupDetected Bool DEFAULT false,
        regexPopupDetected Bool DEFAULT false
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
    `CREATE TABLE IF NOT EXISTS autoconsentPerformance ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        frameUrl String,
        isMainFrame UInt8,
        measurement String,
        sum Float64,
        count UInt32
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId, frameUrl, measurement)`,
    `CREATE TABLE IF NOT EXISTS cookiePopupFrames ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        frameId UInt16,
        isTop Bool,
        origin String,
        cleanedText String CODEC(ZSTD(3)),
        llmPopupDetected Nullable(Bool),
        regexPopupDetected Nullable(Bool),
        buttonCount UInt32,
        potentialPopupCount UInt16
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId, frameId)`,
    `CREATE TABLE IF NOT EXISTS cookiePopupPopups ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        frameId UInt16,
        popupId UInt16,
        selector String,
        text String CODEC(ZSTD(3)),
        llmMatch Nullable(Bool),
        regexMatch Nullable(Bool),
        buttonCount UInt16
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId, frameId, popupId)`,
    `CREATE TABLE IF NOT EXISTS cookiePopupButtons ON CLUSTER 'ch-prod-cluster' (
        crawlId String,
        pageId String,
        frameId UInt16,
        popupId UInt16,
        buttonId UInt16,
        text String,
        selector String,
        isReject Nullable(Bool),
        llmClassification LowCardinality(Nullable(String)),
        regexClassification LowCardinality(Nullable(String))
    ) ENGINE = ReplicatedMergeTree
    PRIMARY KEY(crawlId, pageId, frameId, popupId, buttonId)`,
];

/** @type {string[]} */
const SCRAPED_FRAMES_TABLES = ['cookiePopupFrames', 'cookiePopupPopups', 'cookiePopupButtons'];

/** @type {readonly string[]} */
const PERFORMANCE_MEASUREMENTS = [
    'filterCMPs',
    'detectHeuristics',
    'heuristicDetector',
    'findCmpSiteSpecific',
    'findCmpGeneric',
    'findCmpHeuristic',
];

/**
 * @param {number[] | undefined} values
 * @returns {{ sum: number, count: number }}
 */
function summarizeMeasurementArray(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return { sum: 0, count: 0 };
    }
    return {
        sum: values.reduce((total, value) => total + value, 0),
        count: values.length,
    };
}

/**
 * @param {string | string[]} args
 */
function santizeCallArgs(args) {
    // in some cases call args have been stringified, so unwrap that first.
    const argsArray = typeof args === 'string' ? JSON.parse(args) : args || [];
    return argsArray.map((/** @type {string} */ s) => s.replace(/'/g, ''));
}

/**
 * Popup buttons only carry classification labels on the copies stored in rejectButtons/otherButtons
 * (added by post-processing), so look them up by selector while keeping the original scrape order.
 * @param {import('../collectors/CookiePopupsCollector').PopupData} popup
 * @returns {{button: import('../collectors/CookiePopupsCollector').ButtonData, isReject: boolean | null}[]}
 */
function mergeButtonLabels(popup) {
    const buttons = popup.buttons || [];
    if (!popup.rejectButtons && !popup.otherButtons) {
        return buttons.map((button) => ({ button, isReject: null }));
    }
    /** @type {Map<string, {button: import('../collectors/CookiePopupsCollector').ButtonData, isReject: boolean}>} */
    const labelled = new Map();
    (popup.otherButtons || []).forEach((button) => labelled.set(button.selector, { button, isReject: false }));
    (popup.rejectButtons || []).forEach((button) => labelled.set(button.selector, { button, isReject: true }));
    return buttons.map((button) => labelled.get(button.selector) || { button, isReject: null });
}

/**
 * @param {string} crawlId
 * @param {string} pageId
 * @param {import('../collectors/CookiePopupsCollector').ScrapeScriptResult[] | undefined} scrapedFrames
 */
function scrapedFramesToRows(crawlId, pageId, scrapedFrames) {
    /** @type {any[][]} */
    const frames = [];
    /** @type {any[][]} */
    const popups = [];
    /** @type {any[][]} */
    const buttons = [];
    (scrapedFrames || []).forEach((frame, frameId) => {
        const potentialPopups = frame.potentialPopups || [];
        frames.push([
            crawlId,
            pageId,
            frameId,
            frame.isTop,
            frame.origin,
            frame.cleanedText || '',
            frame.llmPopupDetected ?? null,
            frame.regexPopupDetected ?? null,
            (frame.buttons || []).length,
            potentialPopups.length,
        ]);
        potentialPopups.forEach((popup, popupId) => {
            popups.push([
                crawlId,
                pageId,
                frameId,
                popupId,
                popup.selector,
                popup.text || '',
                popup.llmMatch ?? null,
                popup.regexMatch ?? null,
                (popup.buttons || []).length,
            ]);
            mergeButtonLabels(popup).forEach(({ button, isReject }, buttonId) => {
                buttons.push([
                    crawlId,
                    pageId,
                    frameId,
                    popupId,
                    buttonId,
                    button.text || '',
                    button.selector,
                    isReject,
                    button.llmClassification ?? null,
                    button.regexClassification ?? null,
                ]);
            });
        });
    });
    return { frames, popups, buttons };
}

class ClickhouseReporter extends BaseReporter {
    id() {
        return 'clickhouse';
    }

    /**
     * @param {{verbose: boolean, startTime: Date, urls: number, logPath: string, tables?: string[]}} options
     */
    init(options) {
        this.verbose = options.verbose;
        this.client = createClient({
            url: `http://${CLICKHOUSE_SERVER}:8123`,
            database: DB,
        });
        this.crawlId = `${new Date().toISOString()}-${os.hostname()}`;
        this.ready = Promise.all(TABLE_DEFINITIONS.map((stmt) => this.client.query({ query: stmt })));
        this.queue = {
            pages: [],
            requests: [],
            elements: [],
            apiSavedCalls: [],
            cmps: [],
            apiCallStats: [],
            cookies: [],
            targets: [],
            autoconsentPerformance: [],
            cookiePopupFrames: [],
            cookiePopupPopups: [],
            cookiePopupButtons: [],
        };
        // tables that will be written to on commit (defaults to all)
        this.tables = options.tables || Object.keys(this.queue);
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
                values: [
                    {
                        crawlId: this.crawlId,
                        name,
                        region,
                    },
                ],
                columns: ['crawlId', 'name', 'region'],
                format: 'JSONEachRow',
            });
        });
        return this.ready;
    }

    async deleteCrawlData() {
        await this.ready;
        console.log(`Deleting all data for crawl ${this.crawlId}`);
        const deletes = Object.keys(this.queue).map((table) =>
            this.client.query({
                query: `ALTER TABLE ${table} DELETE WHERE crawlId = '${this.crawlId}'`,
            }),
        );
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
            this.queue.pages.push([
                this.crawlId,
                pageId,
                data.testStarted,
                data.testFinished,
                data.initialUrl,
                data.finalUrl,
                data.timeout,
            ]);
            if (data.data.requests) {
                const requestRows = data.data.requests.map((request, requestId) => [
                    this.crawlId,
                    pageId,
                    requestId,
                    request.url,
                    request.method,
                    request.type,
                    request.status,
                    // request.size,
                    typeof request.size === 'number' && request.size < 0 ? null : request.size, // FIXME: this is a hack for legacy data
                    request.remoteIPAddress,
                    JSON.stringify(request.responseHeaders || {}),
                    request.responseBodyHash,
                    request.failureReason,
                    request.redirectedTo,
                    request.redirectedFrom,
                    request.initiators.map((u) => u.replace(/'/g, '')),
                    request.time || 0,
                ]);

                this.queue.requests = this.queue.requests.concat(requestRows);
            }
            if (data.data.elements) {
                this.queue.elements.push([this.crawlId, pageId, data.data.elements.present, data.data.elements.visible]);
            }
            if (data.data.cookiepopups) {
                const llmPopupDetected = data.data.cookiepopups.scrapedFrames.some((f) => f.llmPopupDetected);
                const regexPopupDetected = data.data.cookiepopups.scrapedFrames.some((f) => f.regexPopupDetected);
                const cmpRows = data.data.cookiepopups.cmps.map((c) => [
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
                    llmPopupDetected,
                    regexPopupDetected,
                ]);
                this.queue.cmps = this.queue.cmps.concat(cmpRows);

                const performanceRows = (data.data.cookiepopups.performance || []).flatMap((entry) =>
                    PERFORMANCE_MEASUREMENTS.map((measurement) => {
                        const { sum, count } = summarizeMeasurementArray(entry[measurement]);
                        return [
                            this.crawlId,
                            pageId,
                            entry.url || data.finalUrl || data.initialUrl,
                            entry.isMainFrame ? 1 : 0,
                            measurement,
                            sum,
                            count,
                        ];
                    }),
                );
                this.queue.autoconsentPerformance = this.queue.autoconsentPerformance.concat(performanceRows);

                const { frames, popups, buttons } = scrapedFramesToRows(this.crawlId, pageId, data.data.cookiepopups.scrapedFrames);
                this.queue.cookiePopupFrames = this.queue.cookiePopupFrames.concat(frames);
                this.queue.cookiePopupPopups = this.queue.cookiePopupPopups.concat(popups);
                this.queue.cookiePopupButtons = this.queue.cookiePopupButtons.concat(buttons);
            }
            if (data.data.apis) {
                const { callStats, savedCalls } = data.data.apis;
                const callStatRows = Object.keys(callStats).map((source) => [
                    this.crawlId,
                    pageId,
                    source,
                    JSON.stringify(callStats[source]),
                ]);
                this.queue.apiCallStats = this.queue.apiCallStats.concat(callStatRows);
                const savedCallRows = savedCalls.map((c, i) => [
                    this.crawlId,
                    pageId,
                    i,
                    c.source,
                    c.description,
                    santizeCallArgs(c.arguments),
                ]);
                this.queue.apiSavedCalls = this.queue.apiSavedCalls.concat(savedCallRows);
            }
            if (data.data.cookies) {
                this.queue.cookies = this.queue.cookies.concat(
                    data.data.cookies.map((c, i) => [this.crawlId, pageId, i, JSON.stringify(c)]),
                );
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
        const inserts = Object.keys(this.queue).map(async (table) => {
            if (this.tables.includes(table)) {
                // @ts-ignore
                await this.client.insert({
                    table,
                    // @ts-ignore
                    values: this.queue[table],
                });
            }
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
module.exports.scrapedFramesToRows = scrapedFramesToRows;
module.exports.SCRAPED_FRAMES_TABLES = SCRAPED_FRAMES_TABLES;
