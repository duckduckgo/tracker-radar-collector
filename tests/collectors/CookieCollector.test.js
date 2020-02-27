const CookieCollector = require('../../collectors/CookieCollector');
const assert = require('assert');

const collector = new CookieCollector();

/**
 * normalizeDate helper
 */

assert.strictEqual(collector.normalizeDate(1577836800.325027), 1577836800325);
assert.strictEqual(collector.normalizeDate(1577836800.325927), 1577836800325);
assert.strictEqual(collector.normalizeDate(-1), undefined);

/**
 * getData
 */
const cookies = [{
    name: 'uid',
    domain: 'example.com',
    path: '/test/',
    sameSite: 'Lax',
    expires: 1577836800.325027,
    session: false
},
{
    name: 'session_id',
    domain: 'example.com',
    path: '/',
    sameSite: 'Strict',
    expires: -1,
    session: true
}
];

const fakeCDPClient = {
    /**
     * @param {string} command 
     */
    send(command) {
        if (command === 'Network.getAllCookies') {
            return Promise.resolve({cookies});
        } else if (command === 'Page.enable') {
            return Promise.resolve();
        }
        
        throw new Error('Unexpected command called: ' + command);
    }
};

// @ts-ignore not a real options object
collector.init({});

// @ts-ignore not a real CDP client
collector.addTarget({cdpClient: fakeCDPClient, type: 'page', url: 'http://example.com'});

collector.getData()
    .then(data => {
        assert.deepStrictEqual(data, [
            {
                name: 'uid',
                domain: 'example.com',
                path: '/test/',
                expires: 1577836800325,
                session: false,
                sameSite: 'Lax'
            },
            {
                name: 'session_id',
                domain: 'example.com',
                path: '/',
                expires: undefined,
                session: true,
                sameSite: 'Strict'
            }
        ]);
    });
