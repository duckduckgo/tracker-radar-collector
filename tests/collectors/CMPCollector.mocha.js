/* eslint-disable max-lines, func-names, prefer-arrow-callback */
const CMPCollector = require('../../collectors/CMPCollector');
const assert = require('assert');

/**
 * @type {Array<{name: String, callback: function}>}
 */
const listeners = [];

 /**
  * @type {Array<Array<any>>}
  */
const commands = [];

const fakeCDPClient = {
    // eslint-disable-next-line arrow-parens, require-await
    send: async (/** @type {String} **/command, /** @type {any} **/ payload) => {
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
    on: (/** @type {string} **/name, /** @type {function(object)} **/callback) => {
        listeners.push({name, callback});
        return Promise.resolve();
    }
};

describe('CMPCollector', () => {
    /**
     * @type {CMPCollector}
     */
    let collector;

    beforeEach(async () => {
        commands.splice(0, commands.length);
        listeners.splice(0, listeners.length);
        collector = new CMPCollector();
        // @ts-ignore no need to provide all params
        collector.init({
            log: () => {},
            collectorFlags: {
                shortTimeouts: '1',
                autoconsentAction: 'optOut',
            },
        });
        // @ts-ignore not a real CDP client
        await collector.addTarget({cdpClient: fakeCDPClient, type: 'page', url: 'https://example.com'});
    });

    describe('handleMessage', () => {
        describe('init ', () => {
            it('should respond with initResp', async () => {
                /**
                 * @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage}
                 */
                const msg = {
                    type: 'init',
                    url: 'some-url',
                };
                commands.splice(0, commands.length);
                await collector.handleMessage(msg, 1111);
                assert.strictEqual(commands.length, 1);
                assert.deepStrictEqual(commands[0], ['Runtime.evaluate', {
                    expression: `autoconsentReceiveMessage({ type: "initResp", config: ${JSON.stringify({
                        enabled: true,
                        autoAction: 'optOut',
                        disabledCmps: [],
                        enablePrehide: true,
                        detectRetries: 20,
                    })} })`,
                    contextId: 1111,
                }]);
            });
        });
        describe('optOutResult ', () => {
            it('should remember where to run self test', async () => {
                /**
                 * @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage}
                 */
                const msg = {
                    type: 'optOutResult',
                    cmp: 'some cmp',
                    result: true,
                    scheduleSelfTest: true,
                    url: 'some url',
                };
                await collector.handleMessage(msg, 1337);
                assert.strictEqual(collector.selfTestFrame, 1337);
            });

            it('should (not) remember where to run self test', async () => {
                /**
                 * @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage}
                 */
                const msg = {
                    type: 'optOutResult',
                    cmp: 'some cmp',
                    result: true,
                    scheduleSelfTest: false,
                    url: 'some url',
                };
                await collector.handleMessage(msg, 1337);
                assert.strictEqual(collector.selfTestFrame, null);
            });
        });

        describe('optInResult ', () => {
            it('should remember where to run self test', async () => {
                /**
                 * @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage}
                 */
                const msg = {
                    type: 'optInResult',
                    cmp: 'some cmp',
                    result: true,
                    scheduleSelfTest: true,
                    url: 'some url',
                };
                await collector.handleMessage(msg, 1337);
                assert.strictEqual(collector.selfTestFrame, 1337);
            });

            it('should (not) remember where to run self test', async () => {
                /**
                 * @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage}
                 */
                const msg = {
                    type: 'optInResult',
                    cmp: 'some cmp',
                    result: true,
                    scheduleSelfTest: false,
                    url: 'some url',
                };
                await collector.handleMessage(msg, 1337);
                assert.strictEqual(collector.selfTestFrame, null);
            });
        });

        describe('autoconsentDone', () => {
            it('should not trigger self-test when not necessary', async () => {
                /**
                 * @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage}
                 */
                const msg = {
                    type: 'autoconsentDone',
                    cmp: 'some cmp',
                    url: 'some url',
                };
                collector.selfTestFrame = null;
                commands.splice(0, commands.length);
                await collector.handleMessage(msg, 1111);
                assert.strictEqual(commands.length, 0);
            });

            it('should trigger self-test when necessary', async () => {
                /**
                 * @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage}
                 */
                const msg = {
                    type: 'autoconsentDone',
                    cmp: 'some cmp',
                    url: 'some url',
                };
                collector.selfTestFrame = 1337;
                commands.splice(0, commands.length);
                await collector.handleMessage(msg, 1111);
                assert.strictEqual(commands.length, 1);
                assert.deepStrictEqual(commands.pop(), ['Runtime.evaluate', {
                    expression: `autoconsentReceiveMessage({ type: "selfTest" })`,
                    allowUnsafeEvalBlockedByCSP: true,
                    contextId: 1337,
                }]);
            });
        });

        describe('eval', () => {
            it('should execute in main world', async () => {
                /**
                 * @type {import('@duckduckgo/autoconsent/lib/messages').ContentScriptMessage}
                 */
                const msg = {
                    type: 'eval',
                    id: 'some id',
                    code: '1+1==2'
                };
                commands.splice(0, commands.length);
                collector.isolated2pageworld = new Map([[1111, 2222]]);
                await collector.handleMessage(msg, 1111);
                assert.strictEqual(commands.length, 2);
                assert.deepStrictEqual(commands[0], ['Runtime.evaluate', {
                    expression: msg.code,
                    returnByValue: true,
                    allowUnsafeEvalBlockedByCSP: true,
                    contextId: 2222,
                }]);

                assert.deepStrictEqual(commands[1], ['Runtime.evaluate', {
                    expression: 'autoconsentReceiveMessage({ id: "some id", type: "evalResp", result: true })',
                    allowUnsafeEvalBlockedByCSP: true,
                    contextId: 1111,
                }]);
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
            executionContextCreated = listeners.find(a => a.name === 'Runtime.executionContextCreated');
            assert(executionContextCreated, 'executionContextCreated listener was set');
            assert(!commands.some(cmd => cmd[0] === 'Runtime.evaluate'), 'no eval commands expected');

            await executionContextCreated.callback({
                context: {
                    id: 1,
                    origin: 'https://example.com/',
                    auxData: {}
                }
            });

            bindingCalled = listeners.find(a => a.name === 'Runtime.bindingCalled');
            assert(bindingCalled, 'bindingCalled listener was set');
        });

        it('no CMP', async function() {
            const contentScriptEval = commands.find(cmd => cmd[0] === 'Runtime.evaluate')[1];
            assert.strictEqual(contentScriptEval.contextId, 31337);
            const results = await collector.getData();
            assert.deepStrictEqual(results, []);
        });

        it('CMP with no visible popup', async function() {
            const contentScriptEval = commands.find(cmd => cmd[0] === 'Runtime.evaluate')[1];
            assert.strictEqual(contentScriptEval.contextId, 31337);
            bindingCalled.callback({
                name: 'cdpAutoconsentSendMessage',
                payload: JSON.stringify({
                    type: 'cmpDetected',
                    url: 'some-url',
                    cmp: 'superduperCMP',
                }),
                executionContextId: 31337,
            });

            const results = await collector.getData();
            assert.deepStrictEqual(results, [{
                name: 'superduperCMP',
                final: false,
                open: false,
                started: false,
                succeeded: false,
                selfTestFail: false,
                errors: [],
            }]);
        });

        it('CMP with a visible popup - opt-out OFF', async function() {
            collector.autoAction = null;
            const contentScriptEval = commands.find(cmd => cmd[0] === 'Runtime.evaluate')[1];
            assert.strictEqual(contentScriptEval.contextId, 31337);
            bindingCalled.callback({
                name: 'cdpAutoconsentSendMessage',
                payload: JSON.stringify({
                    type: 'cmpDetected',
                    url: 'some-url',
                    cmp: 'superduperCMP',
                }),
                executionContextId: 31337,
            });
            bindingCalled.callback({
                name: 'cdpAutoconsentSendMessage',
                payload: JSON.stringify({
                    type: 'popupFound',
                    url: 'some-url',
                    cmp: 'superduperCMP',
                }),
                executionContextId: 31337,
            });

            const results = await collector.getData();
            assert.deepStrictEqual(results, [{
                name: 'superduperCMP',
                final: false,
                open: true,
                started: false,
                succeeded: false,
                selfTestFail: false,
                errors: [],
            }]);
        });

        describe('CMP with a visible popup - opt-out ON', function() {
            beforeEach(() => {
                const contentScriptEval = commands.find(cmd => cmd[0] === 'Runtime.evaluate')[1];
                assert.strictEqual(contentScriptEval.contextId, 31337);
                bindingCalled.callback({
                    name: 'cdpAutoconsentSendMessage',
                    payload: JSON.stringify({
                        type: 'cmpDetected',
                        url: 'some-url',
                        cmp: 'superduperCMP',
                    }),
                    executionContextId: 31337,
                });
                bindingCalled.callback({
                    name: 'cdpAutoconsentSendMessage',
                    payload: JSON.stringify({
                        type: 'popupFound',
                        url: 'some-url',
                        cmp: 'superduperCMP',
                    }),
                    executionContextId: 31337,
                });
            });

            describe('no self-test', function() {
                it('opt-out failure', async function() {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage',
                        payload: JSON.stringify({
                            type: 'optOutResult',
                            url: 'some-url',
                            scheduleSelfTest: false,
                            cmp: 'superduperCMP',
                            result: false,
                        }),
                        executionContextId: 31337,
                    });
                    const results = await collector.getData();
                    assert.deepStrictEqual(results, [{
                        name: 'superduperCMP',
                        final: false,
                        open: true,
                        started: true,
                        succeeded: false,
                        selfTestFail: false,
                        errors: [],
                    }]);
                });

                it('opt-out success', async function() {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage',
                        payload: JSON.stringify({
                            type: 'optOutResult',
                            url: 'some-url',
                            scheduleSelfTest: false,
                            cmp: 'superduperCMP',
                            result: true,
                        }),
                        executionContextId: 31337,
                    });

                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage',
                        payload: JSON.stringify({
                            type: 'autoconsentDone',
                            url: 'some-url',
                            cmp: 'superduperCMP',
                        }),
                        executionContextId: 31337,
                    });

                    const results = await collector.getData();
                    assert.deepStrictEqual(results, [{
                        name: 'superduperCMP',
                        final: true,
                        open: true,
                        started: true,
                        succeeded: true,
                        selfTestFail: false,
                        errors: [],
                    }]);
                });
            });

            describe('with self-test', function() {
                beforeEach(() => {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage',
                        payload: JSON.stringify({
                            type: 'optOutResult',
                            url: 'some-url',
                            scheduleSelfTest: true,
                            cmp: 'superduperCMP',
                            result: true,
                        }),
                        executionContextId: 3333,
                    });
                    assert.strictEqual(collector.selfTestFrame, 3333, 'self-test frame must be remembered');

                    assert(!commands.some(cmd => cmd[0] === 'Runtime.evaluate' && cmd[1].contextId === 3333), 'no self-test should be requested yet');

                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage',
                        payload: JSON.stringify({
                            type: 'autoconsentDone',
                            url: 'some-url',
                            cmp: 'superduperCMP',
                        }),
                        executionContextId: 31337,
                    });

                    const selfTestRequest = commands.find(cmd => cmd[0] === 'Runtime.evaluate' && cmd[1].contextId === 3333)[1];
                    assert.deepStrictEqual(selfTestRequest,{
                        expression: `autoconsentReceiveMessage({ type: "selfTest" })`,
                        allowUnsafeEvalBlockedByCSP: true,
                        contextId: 3333,
                    }, 'self-test request must be sent');
                });

                it('self-test successful', async function() {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage',
                        payload: JSON.stringify({
                            type: 'selfTestResult',
                            cmp: 'superduperCMP',
                            result: true,
                            url: 'some-url',
                        }),
                        executionContextId: 31337,
                    });

                    const results = await collector.getData();
                    assert.deepStrictEqual(results, [{
                        name: 'superduperCMP',
                        final: true,
                        open: true,
                        started: true,
                        succeeded: true,
                        selfTestFail: false,
                        errors: [],
                    }]);
                });

                it('self-test failure', async function() {
                    bindingCalled.callback({
                        name: 'cdpAutoconsentSendMessage',
                        payload: JSON.stringify({
                            type: 'selfTestResult',
                            cmp: 'superduperCMP',
                            result: false,
                            url: 'some-url',
                        }),
                        executionContextId: 31337,
                    });

                    const results = await collector.getData();
                    assert.deepStrictEqual(results, [{
                        name: 'superduperCMP',
                        final: true,
                        open: true,
                        started: true,
                        succeeded: true,
                        selfTestFail: true,
                        errors: [],
                    }]);
                });
            });
        });
    });
});
