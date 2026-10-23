const assert = require('assert');
const ClickhouseReporter = require('../../reporters/ClickhouseReporter');
const { scrapedFramesToRows, clickhouseCredentials, SCRAPED_FRAMES_TABLES } = ClickhouseReporter;

describe('ClickhouseReporter scrapedFramesToRows', () => {
    it('handles empty scrapedFrames', () => {
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
            ['c', 'p', 0, true, 'https://example.com', 'page text', null, null, 2, 1, null, null, null, null],
            ['c', 'p', 1, false, 'https://nested.example', '', null, null, 0, 0, null, null, null, null],
        ]);
        assert.deepStrictEqual(popups, [
            ['c', 'p', 0, 0, '#banner', 'We use cookies', null, null, 2, null, null, null, null, null, null, []],
        ]);
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

        assert.deepStrictEqual(frames, [
            ['c', 'p', 0, true, 'https://example.com', 'page text', true, false, 0, 2, null, null, null, null],
        ]);
        assert.deepStrictEqual(popups, [
            ['c', 'p', 0, 0, '#news', 'Newsletter', false, false, 0, null, null, null, null, null, null, []],
            ['c', 'p', 0, 1, '#banner', 'We use cookies', true, true, 3, null, null, null, null, null, null, []],
        ]);
        assert.deepStrictEqual(buttons, [
            ['c', 'p', 0, 1, 0, 'Accept', '#accept', false, 'accept', 'accept'],
            ['c', 'p', 0, 1, 1, 'Reject', '#reject', true, 'reject', 'reject'],
            ['c', 'p', 0, 1, 2, 'Settings', '#settings', false, 'settings', 'other'],
        ]);
    });

    it('stores the viewport and popup positions', () => {
        const { frames, popups } = scrapedFramesToRows('c', 'p', [
            {
                isTop: true,
                origin: 'https://example.com',
                viewport: { width: 1440, height: 812, scrollX: 0, scrollY: 100 },
                cleanedText: '',
                buttons: [],
                potentialPopups: [
                    {
                        text: 'We use cookies',
                        selector: '#banner',
                        buttons: [],
                        source: 'hitTest',
                        rect: { x: 0, y: 812, width: 1440, height: 100 },
                        cssPosition: 'fixed',
                        hitPoints: [
                            [144, 782],
                            [720, 782],
                        ],
                    },
                ],
            },
        ]);
        assert.deepStrictEqual(frames[0].slice(-4), [1440, 812, 0, 100]);
        assert.deepStrictEqual(popups[0].slice(-7), [
            'hitTest',
            0,
            812,
            1440,
            100,
            'fixed',
            [
                { x: 144, y: 782 },
                { x: 720, y: 782 },
            ],
        ]);
    });

    it('does not mix up labels of buttons sharing a selector', () => {
        const selector = 'cookiepopups-collector-selector-error';
        const { buttons } = scrapedFramesToRows('c', 'p', [
            {
                isTop: true,
                origin: 'https://example.com',
                cleanedText: '',
                buttons: [],
                potentialPopups: [
                    {
                        text: 'We use cookies',
                        selector: '#banner',
                        buttons: [
                            { text: 'Reject', selector },
                            { text: 'Accept', selector },
                        ],
                        rejectButtons: [{ text: 'Reject', selector, llmClassification: 'reject', regexClassification: 'reject' }],
                        otherButtons: [{ text: 'Accept', selector, llmClassification: 'accept', regexClassification: 'accept' }],
                    },
                ],
            },
        ]);
        assert.deepStrictEqual(buttons, [
            ['c', 'p', 0, 0, 0, 'Reject', selector, true, 'reject', 'reject'],
            ['c', 'p', 0, 0, 1, 'Accept', selector, false, 'accept', 'accept'],
        ]);
    });
});

describe('ClickhouseReporter clickhouseCredentials', () => {
    it('passes the user and password when both are set', () => {
        assert.deepStrictEqual(clickhouseCredentials({ CLICKHOUSE_USER: 'crawler', CLICKHOUSE_PASSWORD: 'secret' }), {
            username: 'crawler',
            password: 'secret',
        });
    });

    it('passes nothing when either is missing', () => {
        assert.deepStrictEqual(clickhouseCredentials({}), {});
        assert.deepStrictEqual(clickhouseCredentials({ CLICKHOUSE_USER: 'crawler' }), {});
        assert.deepStrictEqual(clickhouseCredentials({ CLICKHOUSE_PASSWORD: 'secret' }), {});
    });
});

describe('ClickhouseReporter text sanitization', () => {
    it('replaces lone surrogates so clickhouse can parse the JSON', () => {
        const truncated = 'cookies \u{1F36A}'.slice(0, -1); // ends in a lone high surrogate
        const { frames, popups, buttons } = scrapedFramesToRows('c', 'p', [
            {
                isTop: true,
                origin: 'https://example.com',
                cleanedText: truncated,
                buttons: [],
                potentialPopups: [{ text: '\uDC00 low first', selector: '#b', buttons: [{ text: 'OK \u{1F44D}', selector: '#ok' }] }],
            },
        ]);
        assert.strictEqual(frames[0][5], 'cookies \uFFFD');
        assert.strictEqual(popups[0][5], '\uFFFD low first');
        // valid surrogate pairs are kept
        assert.strictEqual(buttons[0][5], 'OK \u{1F44D}');
        assert.doesNotMatch(JSON.stringify([frames, popups, buttons]), /\\ud[89a-f]/i);
    });
});

/**
 * Create a reporter with a stubbed client, since there's no clickhouse server in tests.
 * @param {string[]} [tables]
 */
function createStubbedReporter(tables) {
    const ch = new ClickhouseReporter();
    ch.init({ verbose: false, startTime: new Date(), urls: 1, logPath: '', tables });
    // swallow table creation errors
    ch.ready.catch(() => {});
    ch.ready = Promise.resolve();
    /** @type {{table: string, values: any[]}[]} */
    const inserts = [];
    // @ts-ignore
    ch.client = { insert: async (/** @type {{table: string, values: any[]}} */ i) => inserts.push(i) };
    return { ch, inserts };
}

/**
 * @param {object} cookiepopups
 * @returns {any}
 */
function siteData(cookiepopups) {
    return {
        initialUrl: 'https://example.com/',
        finalUrl: 'https://example.com/',
        testStarted: 0,
        testFinished: 1,
        timeout: false,
        data: { cookiepopups: { cmps: [], performance: [], ...cookiepopups } },
    };
}

describe('ClickhouseReporter processSite', () => {
    it('imports older crawls without scrapedFrames', async () => {
        const { ch, inserts } = createStubbedReporter();
        await ch.processSite(
            siteData({ cmps: [{ name: 'cmp', final: true, open: true, started: true, succeeded: true, selfTestFail: false, errors: [] }] }),
        );
        await ch.cleanup();

        const rowsByTable = Object.fromEntries(inserts.map((i) => [i.table, i.values]));
        assert.strictEqual(rowsByTable.cmps.length, 1);
        // llmPopupDetected and regexPopupDetected
        assert.deepStrictEqual(rowsByTable.cmps[0].slice(-2), [false, false]);
        SCRAPED_FRAMES_TABLES.forEach((table) => assert.strictEqual(rowsByTable[table].length, 0));
    });

    it('only inserts into the selected tables', async () => {
        const { ch, inserts } = createStubbedReporter(SCRAPED_FRAMES_TABLES);
        await ch.processSite(
            siteData({
                scrapedFrames: [
                    {
                        isTop: true,
                        origin: 'https://example.com',
                        cleanedText: 'text',
                        buttons: [],
                        potentialPopups: [{ text: 'cookies', selector: '#b', buttons: [{ text: 'OK', selector: '#ok' }] }],
                    },
                ],
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
