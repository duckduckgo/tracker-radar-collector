/* eslint-disable max-lines */
const RequestCollector = require('../../collectors/RequestCollector');
const assert = require('assert');

function createFakeCDP() {
    /**
     * @type {Array<{name: String, callback: function}>}
     */
    const listeners = [];

    const cdpClient = {
        send: () => Promise.resolve(),
        on: (/** @type {string} **/name, /** @type {function(object)} **/callback) => {
            listeners.push({name, callback});
            return Promise.resolve();
        }
    };

    return {
        listeners,
        cdpClient
    };
}

async function testDefaultSettings() {

    const collector = new RequestCollector();

    /**
     * getData
     */
    const {listeners, cdpClient: fakeCDPClient} = createFakeCDP();

    // @ts-ignore no need to provide all params
    collector.init({
        log: () => {}
    });

    // @ts-ignore not a real CDP client
    await collector.addTarget({cdpClient: fakeCDPClient, type: 'page', url: 'http://example.com'});

    /**
     * Regular request - success
     */

    const requestWillBeSent = listeners.find(a => a.name === 'Network.requestWillBeSent');

    assert(requestWillBeSent, 'requestWillBeSent listener was set');

    requestWillBeSent.callback({
        initiator: {name: 'parser'},
        request: {
            url: 'https://example.com/header.jpg',
            method: 'GET'
        },
        requestId: 100,
        timestamp: 123456,
        frameId: 1,
        type: 'Image'
    });

    const responseReceived = listeners.find(a => a.name === 'Network.responseReceived');

    assert(requestWillBeSent, 'responseReceived listener was set');

    responseReceived.callback({
        requestId: 100,
        type: 'Image',
        frameId: 1,
        response: {
            url: '',
            status: 200,
            remoteIPAddress: '123.123.123.123',
            headers: {
                etag: 'uniqueidhiddenhere',
                'SET-COOKIE': 'cookie monster approves',
                'x-client-data': 'evil'
            }
        }
    });
    
    const loadingFinished = listeners.find(a => a.name === 'Network.loadingFinished');

    assert(loadingFinished, 'loadingFinished listener was set');

    loadingFinished.callback({requestId: 100, encodedDataLength: 666, timestamp: 223456});

    const data1 = collector.getData({finalUrl: 'https://example.com/'});

    assert.deepStrictEqual(data1, [{
        url: 'https://example.com/header.jpg',
        method: 'GET',
        type: 'Image',
        status: 200,
        size: 666,
        remoteIPAddress: '123.123.123.123',
        responseHeaders: {
            etag: 'uniqueidhiddenhere',
            'set-cookie': 'cookie monster approves'
        },
        responseBodyHash: undefined,
        failureReason: undefined,
        redirectedTo: undefined,
        redirectedFrom: undefined,
        initiators: [],
        time: 100000
    }]);

    /**
     * Regular request - failure
     */

    requestWillBeSent.callback({
        initiator: {name: 'parser'},
        request: {
            url: 'https://example.com/error.js',
            method: 'GET'
        },
        requestId: 101,
        timestamp: 123456,
        frameId: 1,
        type: 'Script'
    });

    const loadingFailed = listeners.find(a => a.name === 'Network.loadingFailed');

    assert(loadingFailed, 'loadingFailed listener was set');

    loadingFailed.callback({requestId: 101, errorText: 'You are in a simulation', timestamp: 123457});

    const data2 = collector.getData({finalUrl: 'https://example.com/'});

    assert.deepStrictEqual(data2[1], {
        url: 'https://example.com/error.js',
        method: 'GET',
        type: 'Script',
        status: undefined,
        size: undefined,
        remoteIPAddress: undefined,
        responseHeaders: undefined,
        responseBodyHash: undefined,
        failureReason: 'You are in a simulation',
        redirectedTo: undefined,
        redirectedFrom: undefined,
        initiators: [],
        time: 1
    });

    /**
     * Regular request - redirect
     */

    requestWillBeSent.callback({
        initiator: {name: 'parser'},
        request: {
            url: 'https://example.com/redirect.js',
            method: 'GET'
        },
        requestId: 102,
        timestamp: 123456,
        frameId: 1,
        type: 'Script'
    });

    requestWillBeSent.callback({
        initiator: {name: 'parser'},
        request: {
            url: 'https://example.com/other_script.js',
            method: 'GET'
        },
        requestId: 102,
        timestamp: 123457,
        frameId: 1,
        type: 'Script',
        redirectResponse: {
            url: 'https://example.com/other_script.js',
            status: 301,
            remoteIPAddress: '123.123.123.234',
            headers: {
                etag: 'redirect-etag'
            }
        }
    });

    responseReceived.callback({
        requestId: 102,
        type: 'Script',
        frameId: 1,
        response: {
            url: 'https://example.com/other_script.js',
            status: 200,
            remoteIPAddress: '123.123.123.345',
            headers: {
                etag: 'other-script-etag'
            }
        }
    });

    loadingFinished.callback({requestId: 102, encodedDataLength: 777, timestamp: 123458});

    const data3 = collector.getData({finalUrl: 'https://example.com/'});

    assert.deepStrictEqual(data3[2], {
        url: 'https://example.com/redirect.js',
        method: 'GET',
        type: 'Script',
        status: 301,
        size: undefined,
        remoteIPAddress: '123.123.123.234',
        responseHeaders: {
            etag: 'redirect-etag'
        },
        responseBodyHash: undefined,
        failureReason: undefined,
        redirectedTo: 'https://example.com/other_script.js',
        redirectedFrom: undefined,
        initiators: [],
        time: 1
    });

    assert.deepStrictEqual(data3[3], {
        url: 'https://example.com/other_script.js',
        method: 'GET',
        type: 'Script',
        status: 200,
        size: 777,
        remoteIPAddress: '123.123.123.345',
        responseHeaders: {
            etag: 'other-script-etag'
        },
        responseBodyHash: undefined,
        failureReason: undefined,
        redirectedTo: undefined,
        redirectedFrom: 'https://example.com/redirect.js',
        initiators: [],
        time: 1
    });

    /**
     * Web socket
     */

    const webSocketCreated = listeners.find(a => a.name === 'Network.webSocketCreated');

    assert(webSocketCreated, 'webSocketCreated listener was set');

    webSocketCreated.callback({requestId: 103, url: 'wss://example.com/chat', initiator: {name: 'parser'}});

    const data4 = collector.getData({finalUrl: 'https://example.com/'});

    assert.deepStrictEqual(data4[4], {
        url: 'wss://example.com/chat',
        method: undefined,
        type: 'WebSocket',
        status: undefined,
        size: undefined,
        remoteIPAddress: undefined,
        responseHeaders: undefined,
        responseBodyHash: undefined,
        failureReason: undefined,
        redirectedTo: undefined,
        redirectedFrom: undefined,
        initiators: [],
        time: undefined
    });
}

async function testResponseHashSetting() {
    const collector = new RequestCollector({
        saveResponseHash: true
    });

    /**
     * getData
     */
    const {listeners, cdpClient: fakeCDPClient} = createFakeCDP();

    // @ts-ignore no need to provide all params
    collector.init({
        log: () => {}
    });

    // @ts-ignore not a real CDP client
    await collector.addTarget({cdpClient: fakeCDPClient, type: 'page', url: 'http://example.com'});
    
    const requestWillBeSent = listeners.find(a => a.name === 'Network.requestWillBeSent');
    const responseReceived = listeners.find(a => a.name === 'Network.responseReceived');
    const loadingFinished = listeners.find(a => a.name === 'Network.loadingFinished');

    requestWillBeSent.callback({
        initiator: {name: 'parser'},
        request: {
            url: 'https://example.com/header.txt',
            method: 'GET'
        },
        requestId: 100,
        timestamp: 123456,
        frameId: 1,
        type: 'Image'
    });

    responseReceived.callback({
        requestId: 100,
        type: 'Document',
        frameId: 1,
        response: {
            url: '',
            status: 200,
            remoteIPAddress: '123.123.123.123',
            headers: {}
        }
    });

    //@ts-ignore
    fakeCDPClient.send = command => {
        if (command === 'Network.getResponseBody') {
            // eslint-disable-next-line no-console
            return Promise.resolve({body: 'dGVzdA==', base64Encoded: true});//btoa('test')
        }

        return Promise.resolve();
    };

    await loadingFinished.callback({requestId: 100, encodedDataLength: 666, timestamp: 223456});

    const data1 = collector.getData({finalUrl: 'https://example.com/'});

    assert.deepStrictEqual(data1, [{
        url: 'https://example.com/header.txt',
        method: 'GET',
        type: 'Document',
        status: 200,
        size: 666,
        remoteIPAddress: '123.123.123.123',
        responseHeaders: {},
        responseBodyHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        failureReason: undefined,
        redirectedTo: undefined,
        redirectedFrom: undefined,
        initiators: [],
        time: 100000
    }]);
}

async function testCustomHeadersSetting() {
    const collector = new RequestCollector({
        saveHeaders: ['X-Client-Data', 'test-header']
    });

    /**
     * getData
     */
    const {listeners, cdpClient: fakeCDPClient} = createFakeCDP();

    // @ts-ignore no need to provide all params
    collector.init({
        log: () => {}
    });

    // @ts-ignore not a real CDP client
    await collector.addTarget({cdpClient: fakeCDPClient, type: 'page', url: 'http://example.com'});
    
    const requestWillBeSent = listeners.find(a => a.name === 'Network.requestWillBeSent');
    const responseReceived = listeners.find(a => a.name === 'Network.responseReceived');
    const loadingFinished = listeners.find(a => a.name === 'Network.loadingFinished');

    requestWillBeSent.callback({
        initiator: {name: 'parser'},
        request: {
            url: 'https://example.com/header.txt',
            method: 'GET'
        },
        requestId: 100,
        timestamp: 123456,
        frameId: 1,
        type: 'Image'
    });

    responseReceived.callback({
        requestId: 100,
        type: 'Document',
        frameId: 1,
        response: {
            url: '',
            status: 200,
            remoteIPAddress: '123.123.123.123',
            headers: {
                etag: 'oh-no',
                expires: '1y',
                'timing-allow-origin': '*',
                'x-client-data': 'tracking',
                'TEST-HEADER': 'hello'
            }
        }
    });

    await loadingFinished.callback({requestId: 100, encodedDataLength: 666, timestamp: 223456});

    const data1 = collector.getData({finalUrl: 'https://example.com/'});

    assert.deepStrictEqual(data1, [{
        url: 'https://example.com/header.txt',
        method: 'GET',
        type: 'Document',
        status: 200,
        size: 666,
        remoteIPAddress: '123.123.123.123',
        responseHeaders: {
            'x-client-data': 'tracking',
            'test-header': 'hello'
        },
        responseBodyHash: undefined,
        failureReason: undefined,
        redirectedTo: undefined,
        redirectedFrom: undefined,
        initiators: [],
        time: 100000
    }]);
}

Promise.all([
    testDefaultSettings(),
    testResponseHashSetting(),
    testCustomHeadersSetting()
]);
