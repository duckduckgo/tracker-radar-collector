const APICallCollector = require('../../collectors/APICallCollector');
const assert = require('assert');

const collector = new APICallCollector();

/**
 * @type {Array<{name: String, callback: function}>}
 */
const listeners = [];

/**
 * @type {Array<String>}
 */
const commands = [];

/**
 * getData
 */
const fakeCDPClient = {
    // eslint-disable-next-line arrow-parens
    send: (/** @type {String} **/command) => {
        commands.push(command);
        if (command === 'Runtime.evaluate') {
            return Promise.resolve({
                result: {
                    objectId: 1
                }
            });
        }
        return Promise.resolve();
    },
    on: (/** @type {string} **/name, /** @type {function(object)} **/callback) => {
        listeners.push({name, callback});
        return Promise.resolve();
    }
};

// @ts-ignore no need to provide all params
collector.init({
    log: () => {}
});

async function main() {
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

    assert(commands.filter(c => c === 'Debugger.setBreakpointOnFunctionCall').length > 30, 'Breakpoints set');

    const bindingCalled = listeners.find(a => a.name === 'Runtime.bindingCalled');

    assert(bindingCalled, 'bindingCalled listener was set');

    bindingCalled.callback({
        name: 'registerAPICall',
        payload: JSON.stringify({
            description: 'window.devicePixelRatio',
            stack: '<anonymous>:1:10\n(https://example.com/bad.js:1:23)',
            args: []
        })
    });

    // same call again
    bindingCalled.callback({
        name: 'registerAPICall',
        payload: JSON.stringify({
            description: 'window.devicePixelRatio',
            stack: '<anonymous>:1:10\n(https://example.com/bad.js:1:23)',
            args: []
        })
    });

    // different api, different script
    bindingCalled.callback({
        name: 'registerAPICall',
        payload: JSON.stringify({
            description: 'Navigator.prototype.userAgent',
            stack: '(https://example.com/different.js:1:23)\n(https://example.com/different.js:2:23)',
            args: []
        })
    });

    // API call that gets saved with arguments
    bindingCalled.callback({
        name: 'registerAPICall',
        payload: JSON.stringify({
            description: 'Document.cookie setter',
            stack: '(https://example.com/different.js:1:23)\n(https://example.com/different.js:2:23)',
            args: ['uuid=123']
        })
    });

    const data = collector.getData({finalUrl: 'https://example.com/'});

    assert.deepStrictEqual(data, {
        callStats: {
            'https://example.com/bad.js': {'window.devicePixelRatio': 2},
            'https://example.com/different.js': {'Navigator.prototype.userAgent': 1, 'Document.cookie setter': 1},
        },
        savedCalls: [
            {
                source: 'https://example.com/different.js',
                description: 'Document.cookie setter',
                arguments: [
                    'uuid=123'
                ]
            }
        ]
    });
}

main();
