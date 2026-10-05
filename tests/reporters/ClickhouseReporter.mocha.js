const assert = require('assert');
const ClickhouseReporter = require('../../reporters/ClickhouseReporter');
const { scrapedFramesToRows, SCRAPED_FRAMES_TABLES } = ClickhouseReporter;

describe('ClickhouseReporter scrapedFramesToRows', () => {
    it('handles missing or empty scrapedFrames', () => {
        assert.deepStrictEqual(scrapedFramesToRows('c', 'p', undefined), { frames: [], popups: [], buttons: [] });
        assert.deepStrictEqual(scrapedFramesToRows('c', 'p', []), { frames: [], popups: [], buttons: [] });
    });

    it('stores unclassified crawl data with null labels', () => {
        const { frames, popups, buttons } = scrapedFramesToRows('c', 'p', [
            {
                isTop: true,
                origin: 'https://example.com',
                cleanedText: 'page text',
                buttons: [
                    { text: 'Home', selector: 'a.home' },
                    { text: 'Accept', selector: '#accept' },
                ],
                potentialPopups: [
                    {
                        text: 'We use cookies',
                        selector: '#banner',
                        buttons: [
                            { text: 'Accept', selector: '#accept' },
                            { text: 'Reject', selector: '#reject' },
                        ],
                    },
                ],
            },
            {
                isTop: false,
                origin: 'https://nested.example',
                cleanedText: '',
                buttons: [],
                potentialPopups: [],
            },
        ]);

        assert.deepStrictEqual(frames, [
            ['c', 'p', 0, true, 'https://example.com', 'page text', null, null, 2, 1],
            ['c', 'p', 1, false, 'https://nested.example', '', null, null, 0, 0],
        ]);
        assert.deepStrictEqual(popups, [['c', 'p', 0, 0, '#banner', 'We use cookies', null, null, 2]]);
        // frame-level buttons are not stored
        assert.deepStrictEqual(buttons, [
            ['c', 'p', 0, 0, 0, 'Accept', '#accept', null, null, null],
            ['c', 'p', 0, 0, 1, 'Reject', '#reject', null, null, null],
        ]);
    });

    it('merges post-processed labels while keeping scrape order', () => {
        const { frames, popups, buttons } = scrapedFramesToRows('c', 'p', [
            {
                isTop: true,
                origin: 'https://example.com',
                cleanedText: 'page text',
                buttons: [],
                llmPopupDetected: true,
                regexPopupDetected: false,
                potentialPopups: [
                    {
                        text: 'Newsletter',
                        selector: '#news',
                        buttons: [],
                        llmMatch: false,
                        regexMatch: false,
                        rejectButtons: [],
                        otherButtons: [],
                    },
                    {
                        text: 'We use cookies',
                        selector: '#banner',
                        buttons: [
                            { text: 'Accept', selector: '#accept' },
                            { text: 'Reject', selector: '#reject' },
                            { text: 'Settings', selector: '#settings' },
                        ],
                        llmMatch: true,
                        regexMatch: true,
                        rejectButtons: [
                            { text: 'Reject', selector: '#reject', llmClassification: 'reject', regexClassification: 'reject' },
                        ],
                        otherButtons: [
                            { text: 'Settings', selector: '#settings', llmClassification: 'settings', regexClassification: 'other' },
                            { text: 'Accept', selector: '#accept', llmClassification: 'accept', regexClassification: 'accept' },
                        ],
                    },
                ],
            },
        ]);

        assert.deepStrictEqual(frames, [['c', 'p', 0, true, 'https://example.com', 'page text', true, false, 0, 2]]);
        assert.deepStrictEqual(popups, [
            ['c', 'p', 0, 0, '#news', 'Newsletter', false, false, 0],
            ['c', 'p', 0, 1, '#banner', 'We use cookies', true, true, 3],
        ]);
        assert.deepStrictEqual(buttons, [
            ['c', 'p', 0, 1, 0, 'Accept', '#accept', false, 'accept', 'accept'],
            ['c', 'p', 0, 1, 1, 'Reject', '#reject', true, 'reject', 'reject'],
            ['c', 'p', 0, 1, 2, 'Settings', '#settings', false, 'settings', 'other'],
        ]);
    });
});

describe('ClickhouseReporter tables option', () => {
    it('only inserts into the selected tables', async () => {
        const ch = new ClickhouseReporter();
        ch.init({ verbose: false, startTime: new Date(), urls: 1, logPath: '', tables: SCRAPED_FRAMES_TABLES });
        // no clickhouse server in tests: swallow table creation and stub out inserts
        ch.ready.catch(() => {});
        ch.ready = Promise.resolve();
        /** @type {{table: string, values: any[]}[]} */
        const inserts = [];
        // @ts-ignore
        ch.client = { insert: async (/** @type {{table: string, values: any[]}} */ i) => inserts.push(i) };

        await ch.processSite(
            /** @type {any} */ ({
                initialUrl: 'https://example.com/',
                finalUrl: 'https://example.com/',
                testStarted: 0,
                testFinished: 1,
                timeout: false,
                data: {
                    cookiepopups: {
                        cmps: [],
                        performance: [],
                        scrapedFrames: [
                            {
                                isTop: true,
                                origin: 'https://example.com',
                                cleanedText: 'text',
                                buttons: [],
                                potentialPopups: [{ text: 'cookies', selector: '#b', buttons: [{ text: 'OK', selector: '#ok' }] }],
                            },
                        ],
                    },
                },
            }),
        );
        await ch.cleanup();

        assert.deepStrictEqual(inserts.map((i) => i.table).sort(), [...SCRAPED_FRAMES_TABLES].sort());
        assert.deepStrictEqual(
            inserts.map((i) => i.values.length),
            [1, 1, 1],
        );
        assert.strictEqual(ch.queue.pages.length, 0);
    });
});
