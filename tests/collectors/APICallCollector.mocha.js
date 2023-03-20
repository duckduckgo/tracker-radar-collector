const APICallCollector = require('../../collectors/APICallCollector');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

/** @type {import('devtools-protocol/types/protocol').Protocol.Debugger.PausedEvent} */
const pausedEventExample = JSON.parse(fs.readFileSync(path.join(__dirname, './fixtures/debugger-paused.json'), 'utf8'));

describe('APICallCollector', () => {
    /**
     * @type {APICallCollector}
     */
    let collector;
    /**
     * @type {Array<{name: String, callback: function}>}
     */
    let listeners;

    /**
     * @type {Array<String>}
     */
    let commands;

    /**
     * @type {number}
     */
    let breakpointIdCnt;

    const fakeCDPClient = {
        // eslint-disable-next-line arrow-parens
        send: (/** @type {String} **/command, /** @type {any} **/ params) => {
            commands.push(command);
            if (command === 'Runtime.evaluate') {
                return Promise.resolve({
                    result: {
                        objectId: 1
                    }
                });
            } else if (command === 'Debugger.setBreakpointOnFunctionCall') {
                if (params.condition.includes('Navigator.prototype.plugins')) {
                    return Promise.resolve({
                        breakpointId: "7:76",
                    });
                }
                return Promise.resolve({
                    breakpointId: `${breakpointIdCnt++}`,
                });
            }
            return Promise.resolve();
        },
        on: (/** @type {string} **/name, /** @type {function(object)} **/callback) => {
            listeners.push({name, callback});
            return Promise.resolve();
        }
    };

    beforeEach(async () => {
        listeners = [];
        commands = [];
        breakpointIdCnt = 1;
        collector = new APICallCollector();
        // @ts-ignore no need to provide all params
        collector.init({
            log: () => {}
        });

        // @ts-ignore not a real CDP client
        await collector.addTarget({cdpClient: fakeCDPClient, type: 'page', url: 'https://example.com'});

        const executionContextCreated = listeners.find(a => a.name === 'Runtime.executionContextCreated');
        assert(executionContextCreated, 'executionContextCreated listener was set');

        await executionContextCreated.callback({
            context: {
                id: 1,
                origin: 'https://example.com/',
                auxData: {}
            }
        });
    });

    it('should handle runtime call records', () => {
        assert(commands.filter(c => c === 'Debugger.setBreakpointOnFunctionCall').length > 30, 'Breakpoints set');

        const bindingCalled = listeners.find(a => a.name === 'Runtime.bindingCalled');
        assert(bindingCalled, 'bindingCalled listener was set');

        bindingCalled.callback({
            name: 'registerAPICall',
            payload: JSON.stringify({
                description: 'window.devicePixelRatio',
                stack: '<anonymous>:1:10\n(https://example.com/bad.js:1:23)',
                args: [],
                url: 'https://example.com/bad.js',
            })
        });

        // same call again
        bindingCalled.callback({
            name: 'registerAPICall',
            payload: JSON.stringify({
                description: 'window.devicePixelRatio',
                stack: '<anonymous>:1:10\n(https://example.com/bad.js:1:23)',
                args: [],
                url: 'https://example.com/bad.js',
            })
        });

        // different api, different script
        bindingCalled.callback({
            name: 'registerAPICall',
            payload: JSON.stringify({
                description: 'Navigator.prototype.userAgent',
                stack: '(https://example.com/different.js:1:23)\n(https://example.com/different.js:2:23)',
                args: [],
                url: 'https://example.com/different.js',
            })
        });

        // API call that gets saved with arguments
        bindingCalled.callback({
            name: 'registerAPICall',
            payload: JSON.stringify({
                description: 'Document.cookie setter',
                stack: '(https://example.com/different.js:1:23)\n(https://example.com/different.js:2:23)',
                args: ['uuid=123'],
                url: 'https://example.com/different.js',
            })
        });

        // Some real-life stack example
        bindingCalled.callback({
            name: 'registerAPICall',
            payload: JSON.stringify({
                description: 'Navigator.prototype.userAgent',
                stack: 'Error\n' +
                '    at eval (eval at <anonymous> (:25:46), <anonymous>:4:29)\n' +
                '    at <anonymous>:25:46\n' +
                '    at <anonymous>:37:3\n' +
                '    at https://static.zdassets.com/ekr/snippet.js?key=0f2412b9-0d39-4b87-a4af-f7edd25c9d3a:1:8383\n' +
                '    at https://static.zdassets.com/ekr/snippet.js?key=0f2412b9-0d39-4b87-a4af-f7edd25c9d3a:1:3779',
                args: [],
                url: 'https://static.zdassets.com/ekr/snippet.js',
            })
        });

        const data = collector.getData({finalUrl: 'https://example.com/'});

        assert.deepStrictEqual(data, {
            callStats: {
                'https://example.com/bad.js': {'window.devicePixelRatio': 2},
                'https://example.com/different.js': {'Navigator.prototype.userAgent': 1, 'Document.cookie setter': 1},
                'https://static.zdassets.com/ekr/snippet.js': {'Navigator.prototype.userAgent': 1},
            },
            savedCalls: [
                {
                    source: 'https://example.com/different.js',
                    description: 'Document.cookie setter',
                    arguments: [
                        'uuid=123'
                    ]
                },
            ]
        });
    });

    it('should handle async stack traces', () => {
        const debuggerPaused = listeners.find(a => a.name === 'Debugger.paused');
        assert(debuggerPaused, 'Debugger.paused listener was set');

        const scriptParsed = listeners.find(a => a.name === 'Debugger.scriptParsed');
        assert(scriptParsed, 'Debugger.scriptParsed listener was set');

        // Async stack example
        debuggerPaused.callback(pausedEventExample);

        const data = collector.getData({finalUrl: 'https://example.com/'});

        assert.deepStrictEqual(data, {
            callStats: {
                'https://example.com/_nuxt/5f888f5.js': {'Navigator.prototype.plugins': 1},
            },
            savedCalls: []
        });
    });
});
