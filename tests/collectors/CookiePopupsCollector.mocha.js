const CookiePopupsCollector = require('../../collectors/CookiePopupsCollector');
const { filterCompactRules } = require('@duckduckgo/autoconsent');
const compactRules = require('@duckduckgo/autoconsent/rules/compact-rules.json');
const { consentomatic } = require('@duckduckgo/autoconsent/rules/consentomatic.json');
const assert = require('assert');
const sinon = require('sinon');

/**
 * @typedef { import('../../node_modules/@duckduckgo/autoconsent/lib/messages').ContentScriptMessage } ContentScriptMessage
 */

/**
 * @type {Array<{name: String, callback: function}>}
 */
const listeners = [];

/**
 * @type {Array<Array<any>>}
 */
const commands = [];

const fakeCDPClient = {
    send: async (/** @type {String} **/ command, /** @type {any} **/ payload) => {
        commands.push([command, payload]);
        switch (command) {
            case 'Runtime.evaluate': {
                return {
                    result: {
                        value: true,
                    },
                };
            }
            case 'Page.createIsolatedWorld': {
                return {
                    executionContextId: 31337,
                };
            }
            default:
        }
        return {};
    },
    on: (/** @type {string} **/ name, /** @type {function(object)} **/ callback) => {
        listeners.push({ name, callback });
        return Promise.resolve();
    },
};

describe('CookiePopupsCollector', () => {
    /**
     * @type {CookiePopupsCollector}
     */
    let collector;

    beforeEach(async () => {
        commands.splice(0, commands.length);
        listeners.splice(0, listeners.length);
        collector = new CookiePopupsCollector();
        // @ts-ignore no need to provide all params
        collector.init({
            log: () => {},
            collectorFlags: {
                shortTimeouts: true,
                autoconsentAction: 'optOut',
                enableAsyncStacktraces: true,
            },
            // @ts-ignore no need to provide all params
            context: {
                pages: () => Promise.resolve([]),
            },
        });
        // @ts-expect-error not a real CDP client
        await collector.addTarget(fakeCDPClient, { type: 'page', url: 'https://example.com', targetId: 'someframeid' });
        // @ts-expect-error passing mock objects
        collector.cdpSessions.set('1111', fakeCDPClient);
        // @ts-expect-error passing mock objects
        collector.cdpSessions.set('3333', fakeCDPClient);
    });

    describe('handleMessage', () => {
        describe('init ', () => {
            it('should respond with initResp with filtered compact rules', async () => {
                /**
                 * @type {ContentScriptMessage}
                 */
                const msg = {
                    type: 'init',
                    url: 'https://example.com/',
                };
                collector.contextFrameInfo.set('1111', { frameId: 'someframeid', isMainFrame: true });
                commands.splice(0, commands.length);
                await collector.handleMessage(msg, '1111');
                assert.strictEqual(commands.length, 1);
                const expectedConfig = {
                    enabled: true,
                    autoAction: null,
                    disabledCmps: [],
                    enablePrehide: false,
                    enableCosmeticRules: true,
                    enableFilterList: false,
                    enableHeuristicDetection: true,
                    enableHeuristicAction: true,
                    detectRetries: 20,
                    isMainWorld: false,
                };
                const expectedRules = {
                    autoconsent: [],
                    consentomatic,
                    compact: filterCompactRules(compactRules, { url: 'https://example.com/', mainFrame: true }),
                };
                assert.deepStrictEqual(commands[0], [
                    'Runtime.evaluate',
                    {
                        expression: `autoconsentReceiveMessage({ type: "initResp", config: ${JSON.stringify(expectedConfig)}, rules: ${JSON.stringify(expectedRules)} })`,
                        uniqueContextId: '1111',
                    },
                ]);
            });

            it('should filter rules for sub-frames', async () => {
                /**
                 * @type {ContentScriptMessage}
                 */
                const msg = {
                    type: 'init',
                    url: 'https://consent.example.com/iframe',
                };
                collector.contextFrameInfo.set('1111', { frameId: 'subframeid', isMainFrame: false });
                commands.splice(0, commands.length);
                await collector.handleMessage(msg, '1111');
                assert.strictEqual(commands.length, 1);
                const expectedConfig = {
                    enabled: true,
                    autoAction: null,
                    disabledCmps: [],
                    enablePrehide: false,
                    enableCosmeticRules: true,
                    enableFilterList: false,
                    enableHeuristicDetection: true,
                    enableHeuristicAction: true,
                    detectRetries: 20,
                    isMainWorld: false,
                };
                const expectedRules = {
                    autoconsent: [],
                    consentomatic,
                    compact: filterCompactRules(compactRules, { url: 'https://consent.example.com/iframe', mainFrame: false }),
                };
                assert.deepStrictEqual(commands[0], [
                    'Runtime.evaluate',
                    {
                        expression: `autoconsentReceiveMessage({ type: "initResp", config: ${JSON.stringify(expectedConfig)}, rules: ${JSON.stringify(expectedRules)} })`,
                        uniqueContextId: '1111',
                    },
                ]);
            });
        });
        describe('optOutResult ', () => {
            it('should remember where to run self test', async () => {
                /**
                 * @type {ContentScriptMessage}
                 */
                const msg = {
                    type: 'optOutResult',
                    cmp: 'some cmp',
                    result: true,
                    scheduleSelfTest: true,
                    url: 'some url',
                };
                await collector.handleMessage(msg, '1337');
                assert.strictEqual(collector.selfTestFrame, '1337');
            });

            it('should (not) remember where to run self test', async () => {
                /**
                 * @type {ContentScriptMessage}
                 */
                const msg = {
                    type: 'optOutResult',
                    cmp: 'some cmp',
                    result: true,
                    scheduleSelfTest: false,
                    url: 'some url',
                };
                await collector.handleMessage(msg, '1337');
                assert.strictEqual(collector.selfTestFrame, null);
            });
        });

        describe('optInResult ', () => {
            it('should remember where to run self test', async () => {
                /**
                 * @type {ContentScriptMessage}
                 */
                const msg = {
                    type: 'optInResult',
                    cmp: 'some cmp',
                    result: true,
                    scheduleSelfTest: true,
                    url: 'some url',
                };
                await collector.handleMessage(msg, '1337');
                assert.strictEqual(collector.selfTestFrame, '1337');
            });

            it('should (not) remember where to run self test', async () => {
                /**
                 * @type {ContentScriptMessage}
                 */
                const msg = {
                    type: 'optInResult',
                    cmp: 'some cmp',
                    result: true,
                    scheduleSelfTest: false,
                    url: 'some url',
                };
                await collector.handleMessage(msg, '1337');
                assert.strictEqual(collector.selfTestFrame, null);
            });
        });

        describe('autoconsentDone', () => {
            it('should not trigger self-test when not necessary', async () => {
                /**
                 * @type {ContentScriptMessage}
                 */
                const msg = {
                    type: 'autoconsentDone',
                    cmp: 'some cmp',
                    url: 'some url',
                    isCosmetic: false,
                };
                collector.selfTestFrame = null;
                commands.splice(0, commands.length);
                await collector.handleMessage(msg, '1111');
                assert.strictEqual(commands.length, 0);
            });

            it('should trigger self-test when necessary', async () => {
                /**
                 * @type {ContentScriptMessage}
                 */
                const msg = {
                    type: 'autoconsentDone',
                    cmp: 'some cmp',
                    url: 'some url',
                    isCosmetic: false,
                };
                collector.selfTestFrame = '1111';
                commands.splice(0, commands.length);
                await collector.handleMessage(msg, '1337');
                assert.strictEqual(commands.length, 1);
                assert.deepStrictEqual(commands.pop(), [
                    'Runtime.evaluate',
                    {
                        expression: `autoconsentReceiveMessage({ type: "selfTest" })`,
                        allowUnsafeEvalBlockedByCSP: true,
                        uniqueContextId: '1111',
                    },
                ]);
            });
        });

        describe('eval', () => {
            it('should execute in main world', async () => {
                /**
                 * @type {ContentScriptMessage}
                 */
                const msg = {
                    type: 'eval',
                    id: 'some id',
                    code: '1+1==2',
                };
                commands.splice(0, commands.length);
                collector.isolated2pageworld = new Map([['1111', '2222']]);
                await collector.handleMessage(msg, '1111');
                assert.strictEqual(commands.length, 2);
                assert.deepStrictEqual(commands[0], [
                    'Runtime.evaluate',
                    {
                        expression: msg.code,
                        returnByValue: true,
                        allowUnsafeEvalBlockedByCSP: true,
                        uniqueContextId: '2222',
                    },
                ]);

                assert.deepStrictEqual(commands[1], [
                    'Runtime.evaluate',
                    {
                        expression: 'autoconsentReceiveMessage({ id: "some id", type: "evalResp", result: true })',
                        allowUnsafeEvalBlockedByCSP: true,
                        uniqueContextId: '1111',
                    },
                ]);
            });
        });
    });

    describe('autoconsent cases', () => {
        let executionContextCreated;
        /**
         * @type {{name: string, callback: Function}}
         */
        let bindingCalled;
        beforeEach(async () => {
            executionContextCreated = listeners.find((a) => a.name === 'Runtime.executionContextCreated');
            assert(executionContextCreated, 'executionContextCreated listener was set');
            assert(!commands.some((cmd) => cmd[0] === 'Runtime.evaluate'), 'no eval commands expected');

            await executionContextCreated.callback({
                context: {
                    id: 1,
                    uniqueId: 'some_main_world',
                    origin: 'https://example.com/',
                    auxData: {
                        type: 'default',
                        frameId: 'someframeid',
                    },
                },
            });

            await executionContextCreated.callback({
                context: {
                    id: 2,
                    uniqueId: 'some_isolated_world',
                    origin: 'https://example.com/',
                    auxData: {
                        type: 'isolated',
                        frameId: 'someframeid',
                    },
                    name: 'iw_for_cookiepopups_some_main_world_frameId_someframeid',
                },
            });

            bindingCalled = listeners.find((a) => a.name === 'Runtime.bindingCalled');
            assert(bindingCalled, 'bindingCalled listener was set');
        });

        it('no CMP', async function () {
            const contentScriptEval = commands.find((cmd) => cmd[0] === 'Runtime.evaluate')[1];
            assert.strictEqual(contentScriptEval.uniqueContextId, 'some_isolated_world');
            await collector.postLoad();
            const results = await collector.getData();
            assert.deepStrictEqual(results.cmps, []);
        });

        it('no CMP, but detected heuristic patterns', async function () {
            const contentScriptEval = commands.find((cmd) => cmd[0] === 'Runtime.evaluate')[1];
            assert.strictEqual(contentScriptEval.uniqueContextId, 'some_isolated_world');

            const expectedPatterns = [
                '/we are using cookies/gi',
                '/use of cookies/gi',
                '/(this|our) (web)?site.*cookies/gi',
                '/consent to.*cookies/gi',
            ];
            const expectedSnippets = [
                'We are using cookies',
                'use of cookies',
                'This website is using cookies. We are using cookies! To reiterate, you consent to the use of cookies',
                'consent to the use of cookies',
            ];

            bindingCalled.callback({
                name: `cdpAutoconsentSendMessage_some_isolated_world`,
                payload: JSON.stringify({
                    type: 'report',
                    url: 'some-url',
                    instanceId: 'xxxxxx',
                    mainFrame: true,
                    state: {
                        cosmeticFiltersOn: false,
                        filterListReported: false,
                        lifecycle: 'loading',
                        prehideOn: false,
                        findCmpAttempts: 0,
                        detectedCmps: [],
                        detectedPopups: [],
                        heuristicPatterns: expectedPatterns,
                        heuristicSnippets: expectedSnippets,
                        selfTest: null,
                    },
                }),
                executionContextId: 2,
            });

            await collector.postLoad();
            const results = await collector.getData();
            assert.deepStrictEqual(results.cmps, [
                {
                    name: '',
                    final: false,
                    open: false,
                    started: false,
                    succeeded: false,
                    selfTestFail: false,
                    filterListMatched: false,
                    errors: [],
                    patterns: expectedPatterns,
                    snippets: expectedSnippets,
                },
            ]);
        });

        it('CMP with no visible popup', async function () {
            const contentScriptEval = commands.find((cmd) => cmd[0] === 'Runtime.evaluate')[1];
            assert.strictEqual(contentScriptEval.uniqueContextId, 'some_isolated_world');
            bindingCalled.callback({
                name: `cdpAutoconsentSendMessage_some_isolated_world`,
                payload: JSON.stringify({
                    type: 'cmpDetected',
                    url: 'some-url',
                    cmp: 'superduperCMP',
                }),
                executionContextId: 2,
            });

            await collector.postLoad();
            const results = await collector.getData();
            assert.deepStrictEqual(results.cmps, [
                {
                    name: 'superduperCMP',
                    final: false,
                    open: false,
                    started: false,
                    succeeded: false,
                    filterListMatched: false,
                    selfTestFail: false,
                    errors: [],
                    patterns: [],
                    snippets: [],
                },
            ]);
        });

        it('CMP with a visible popup - opt-out OFF', async function () {
            collector.autoAction = null;
            const contentScriptEval = commands.find((cmd) => cmd[0] === 'Runtime.evaluate')[1];
            assert.strictEqual(contentScriptEval.uniqueContextId, 'some_isolated_world');
            bindingCalled.callback({
                name: `cdpAutoconsentSendMessage_some_isolated_world`,
                payload: JSON.stringify({
                    type: 'cmpDetected',
                    url: 'some-url',
                    cmp: 'superduperCMP',
                }),
                executionContextId: 2,
            });
            bindingCalled.callback({
                name: `cdpAutoconsentSendMessage_some_isolated_world`,
                payload: JSON.stringify({
                    type: 'popupFound',
                    url: 'some-url',
                    cmp: 'superduperCMP',
                }),
                executionContextId: 2,
            });

            await collector.postLoad();
            const results = await collector.getData();
            assert.deepStrictEqual(results.cmps, [
                {
                    name: 'superduperCMP',
                    final: false,
                    open: true,
                    started: false,
                    succeeded: false,
                    selfTestFail: false,
                    filterListMatched: false,
                    errors: [],
                    patterns: [],
                    snippets: [],
                },
            ]);
        });

        describe('CMP with a visible popup - opt-out ON', function () {
            beforeEach(() => {
                const contentScriptEval = commands.find((cmd) => cmd[0] === 'Runtime.evaluate')[1];
                assert.strictEqual(contentScriptEval.uniqueContextId, 'some_isolated_world');
                bindingCalled.callback({
                    name: 'cdpAutoconsentSendMessage_some_isolated_world',
                    payload: JSON.stringify({
                        type: 'cmpDetected',
                        url: 'some-url',
                        cmp: 'superduperCMP',
                    }),
                    executionContextId: 2,
                });
                bindingCalled.callback({
                    name: 'cdpAutoconsentSendMessage_some_isolated_world',
                    payload: JSON.stringify({
                        type: 'popupFound',
                        url: 'some-url',
                        cmp: 'superduperCMP',
                    }),
                    executionContextId: 2,
                });
            });

            describe('no self-test', function () {
                it('opt-out failure', async function () {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage_some_isolated_world',
                        payload: JSON.stringify({
                            type: 'optOutResult',
                            url: 'some-url',
                            scheduleSelfTest: false,
                            cmp: 'superduperCMP',
                            result: false,
                        }),
                        executionContextId: 2,
                    });
                    await collector.postLoad();
                    const results = await collector.getData();
                    assert.deepStrictEqual(results.cmps, [
                        {
                            name: 'superduperCMP',
                            final: false,
                            open: true,
                            started: true,
                            succeeded: false,
                            selfTestFail: false,
                            filterListMatched: false,
                            errors: [],
                            patterns: [],
                            snippets: [],
                        },
                    ]);
                });

                it('opt-out success', async function () {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage_some_isolated_world',
                        payload: JSON.stringify({
                            type: 'optOutResult',
                            url: 'some-url',
                            scheduleSelfTest: false,
                            cmp: 'superduperCMP',
                            result: true,
                        }),
                        executionContextId: 2,
                    });

                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage_some_isolated_world',
                        payload: JSON.stringify({
                            type: 'autoconsentDone',
                            url: 'some-url',
                            cmp: 'superduperCMP',
                        }),
                        executionContextId: 2,
                    });

                    await collector.postLoad();
                    const results = await collector.getData();
                    assert.deepStrictEqual(results.cmps, [
                        {
                            name: 'superduperCMP',
                            final: true,
                            open: true,
                            started: true,
                            succeeded: true,
                            selfTestFail: false,
                            filterListMatched: false,
                            errors: [],
                            patterns: [],
                            snippets: [],
                        },
                    ]);
                });
            });

            describe('with self-test', function () {
                beforeEach(() => {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage_some_isolated_world',
                        payload: JSON.stringify({
                            type: 'optOutResult',
                            url: 'some-url',
                            scheduleSelfTest: true,
                            cmp: 'superduperCMP',
                            result: true,
                        }),
                        executionContextId: 2,
                    });
                    assert.strictEqual(collector.selfTestFrame, 'some_isolated_world', 'self-test frame must be remembered');

                    assert(
                        !commands.some(
                            (cmd) =>
                                cmd[0] === 'Runtime.evaluate' &&
                                cmd[1].uniqueContextId === 'some_isolated_world' &&
                                cmd[1].expression.startsWith('autoconsentReceiveMessage'),
                        ),
                        'no self-test should be requested yet',
                    );

                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage_some_isolated_world',
                        payload: JSON.stringify({
                            type: 'autoconsentDone',
                            url: 'some-url',
                            cmp: 'superduperCMP',
                        }),
                        executionContextId: 2,
                    });

                    const selfTestRequest = commands.find(
                        (cmd) =>
                            cmd[0] === 'Runtime.evaluate' &&
                            cmd[1].uniqueContextId === 'some_isolated_world' &&
                            cmd[1].expression.startsWith('autoconsentReceiveMessage'),
                    )[1];
                    assert.deepStrictEqual(
                        selfTestRequest,
                        {
                            expression: `autoconsentReceiveMessage({ type: "selfTest" })`,
                            allowUnsafeEvalBlockedByCSP: true,
                            uniqueContextId: 'some_isolated_world',
                        },
                        'self-test request must be sent',
                    );
                });

                it('self-test successful', async function () {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage_some_isolated_world',
                        payload: JSON.stringify({
                            type: 'selfTestResult',
                            cmp: 'superduperCMP',
                            result: true,
                            url: 'some-url',
                        }),
                        executionContextId: 2,
                    });

                    await collector.postLoad();
                    const results = await collector.getData();
                    assert.deepStrictEqual(results.cmps, [
                        {
                            name: 'superduperCMP',
                            final: true,
                            open: true,
                            started: true,
                            succeeded: true,
                            selfTestFail: false,
                            filterListMatched: false,
                            errors: [],
                            patterns: [],
                            snippets: [],
                        },
                    ]);
                });

                it('self-test failure', async function () {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage_some_isolated_world',
                        payload: JSON.stringify({
                            type: 'selfTestResult',
                            cmp: 'superduperCMP',
                            result: false,
                            url: 'some-url',
                        }),
                        executionContextId: 2,
                    });

                    await collector.postLoad();
                    const results = await collector.getData();
                    assert.deepStrictEqual(results.cmps, [
                        {
                            name: 'superduperCMP',
                            final: true,
                            open: true,
                            started: true,
                            succeeded: true,
                            filterListMatched: false,
                            selfTestFail: true,
                            errors: [],
                            patterns: [],
                            snippets: [],
                        },
                    ]);
                });
            });
        });
    });

    describe('scrape script', () => {
        beforeEach(() => {
            collector.cdpSessions = new Map();
        });

        it('should retrieve cookie popup data from the page', async () => {
            const mockSession = {
                send: sinon.stub(),
                on: sinon.stub(),
            };

            const fakePopupData = {
                potentialPopups: [
                    {
                        text: 'This website uses cookies',
                        selector: 'div.cookie-banner',
                        buttons: [{ text: 'Accept', selector: 'button.accept' }],
                        isTop: true,
                        origin: 'https://example.com',
                    },
                ],
            };

            mockSession.send.withArgs('Runtime.evaluate', sinon.match.any).resolves({
                result: {
                    type: 'object',
                    value: fakePopupData,
                },
            });

            // @ts-expect-error passing mock objects
            collector.cdpSessions.set(1, mockSession);

            const data = await collector.getData();
            assert.deepStrictEqual(
                data.scrapedFrames.flatMap((frame) => frame.potentialPopups),
                fakePopupData.potentialPopups,
            );
        });

        it('should handle evaluation errors gracefully', async () => {
            const mockSession = {
                send: sinon.stub(),
                on: sinon.stub(),
            };
            mockSession.send.withArgs('Runtime.evaluate', sinon.match.any).resolves({
                exceptionDetails: {
                    exceptionId: 1,
                    text: 'Uncaught',
                    lineNumber: 1,
                    columnNumber: 1,
                    exception: {
                        type: 'object',
                        description: 'Something went wrong',
                    },
                },
            });

            // @ts-expect-error passing mock objects
            collector.cdpSessions.set(1, mockSession);

            const data = await collector.getData();
            assert.strictEqual(data.scrapedFrames.flatMap((frame) => frame.potentialPopups).length, 0);
        });
    });

    describe('autoconsent CDP profile', () => {
        it('should summarize time spent in the autoconsent script', async () => {
            const profileCommands = [];
            const mockSession = {
                send: sinon.stub().callsFake(async (command, payload) => {
                    profileCommands.push([command, payload]);
                    if (command === 'Profiler.stop') {
                        return {
                            profile: {
                                startTime: 0,
                                endTime: 23000,
                                nodes: [
                                    {
                                        id: 1,
                                        callFrame: {
                                            functionName: '(root)',
                                            scriptId: '0',
                                            url: '',
                                            lineNumber: 0,
                                            columnNumber: 0,
                                        },
                                        children: [2, 4],
                                    },
                                    {
                                        id: 2,
                                        callFrame: {
                                            functionName: 'detectCMP',
                                            scriptId: '1',
                                            url: 'duckduckgo-autoconsent.js',
                                            lineNumber: 10,
                                            columnNumber: 2,
                                        },
                                        children: [3],
                                    },
                                    {
                                        id: 3,
                                        callFrame: {
                                            functionName: 'querySelectorAll',
                                            scriptId: '2',
                                            url: '',
                                            lineNumber: 0,
                                            columnNumber: 0,
                                        },
                                    },
                                    {
                                        id: 4,
                                        callFrame: {
                                            functionName: 'siteScript',
                                            scriptId: '3',
                                            url: 'https://example.com/site.js',
                                            lineNumber: 1,
                                            columnNumber: 1,
                                        },
                                    },
                                ],
                                samples: [2, 3, 4],
                                timeDeltas: [5000, 7000, 11000],
                            },
                        };
                    }
                    if (command === 'Runtime.evaluate') {
                        return { result: { value: null } };
                    }
                    return {};
                }),
                on: sinon.stub(),
            };

            collector = new CookiePopupsCollector();
            // @ts-ignore no need to provide all params
            collector.init({
                log: () => {},
                collectorFlags: {
                    shortTimeouts: true,
                    autoconsentProfile: true,
                },
            });
            // @ts-expect-error passing mock objects
            await collector.addTarget(mockSession, { type: 'page', url: 'https://example.com', targetId: 'profile-target' });

            const data = await collector.getData();

            assert.deepStrictEqual(profileCommands.slice(0, 3), [
                ['Profiler.enable', undefined],
                ['Profiler.setSamplingInterval', { interval: 1000 }],
                ['Profiler.start', undefined],
            ]);
            assert(
                profileCommands.some(([command]) => command === 'Profiler.stop'),
                'profile should be stopped',
            );
            assert(
                profileCommands.some(([command]) => command === 'Profiler.disable'),
                'profiler should be disabled',
            );
            assert.strictEqual(data.autoconsentScriptTimeMs, 12);
            assert.deepStrictEqual(data.autoconsentProfile, {
                enabled: true,
                profileCount: 1,
                errors: [],
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
            });
        });
    });
});
