const TargetCollector = require('../../collectors/TargetCollector');
const assert = require('assert');

const collector = new TargetCollector();

/**
 * getData
 */
const fakeCDPClient = {};

collector.init();

// @ts-ignore not a real CDP client
collector.addTarget({cdpClient: fakeCDPClient, type: 'page', url: 'http://example.com'});
// @ts-ignore not a real CDP client
collector.addTarget({cdpClient: fakeCDPClient, type: 'service_worker', url: 'http://example.com/sw.js'});

const targets = collector.getData();

assert.deepStrictEqual(targets, [
    {
        type: 'page',
        url: 'http://example.com'
    },
    {
        type: 'service_worker',
        url: 'http://example.com/sw.js'
    }
]);
