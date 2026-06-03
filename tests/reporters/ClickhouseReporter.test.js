const assert = require('assert');
const mockery = require('mockery');
const { createUniqueUrlName } = require('../../helpers/hash');

const queries = [];
const inserts = [];

mockery.enable({
    warnOnUnregistered: false,
});
mockery.registerMock('@clickhouse/client', {
    createClient: () => ({
        query: async ({ query }) => {
            queries.push(query);
            return {};
        },
        insert: async ({ table, values }) => {
            inserts.push({ table, values });
            return {};
        },
    }),
});

const ClickhouseReporter = require('../../reporters/ClickhouseReporter');

async function main() {
    const reporter = new ClickhouseReporter();
    reporter.init({ verbose: false });
    reporter.crawlId = 'test-crawl-id';

    const initialUrl = 'https://example.com/path';
    const pageId = createUniqueUrlName(new URL(initialUrl));
    await reporter.processSite({
        initialUrl,
        finalUrl: initialUrl,
        timeout: false,
        testStarted: 1710000000000,
        testFinished: 1710000001000,
        data: {
            cookiepopups: {
                cmps: [],
                scrapedFrames: [],
                autoconsentScriptTimeMs: 12,
                autoconsentProfile: {
                    enabled: true,
                    profileCount: 1,
                    errors: ['profiler error'],
                    totalProfiledTimeMs: 23,
                    autoconsentScriptTimeMs: 12,
                    autoconsentSelfTimeMs: 5,
                    totalSampleCount: 3,
                    autoconsentSampleCount: 2,
                    topFunctions: [
                        {
                            functionName: 'detectCMP',
                            url: 'duckduckgo-autoconsent.js',
                            lineNumber: 10,
                            columnNumber: 2,
                            selfTimeMs: 5,
                            totalTimeMs: 12,
                            hitCount: 1,
                        },
                    ],
                },
            },
        },
    });
    await reporter.cleanup();

    assert(
        queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS autoconsentPerformance')),
        'autoconsentPerformance table should be created',
    );
    assert(
        queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS autoconsentProfileFunctions')),
        'autoconsentProfileFunctions table should be created',
    );

    const performanceInsert = inserts.find((insert) => insert.table === 'autoconsentPerformance');
    assert.deepStrictEqual(performanceInsert.values, [
        ['test-crawl-id', pageId, true, 1, ['profiler error'], 23, 12, 5, 3, 2],
    ]);

    const functionInsert = inserts.find((insert) => insert.table === 'autoconsentProfileFunctions');
    assert.deepStrictEqual(functionInsert.values, [
        ['test-crawl-id', pageId, 0, 'detectCMP', 'duckduckgo-autoconsent.js', 10, 2, 5, 12, 1],
    ]);

    mockery.disable();
}

main();
