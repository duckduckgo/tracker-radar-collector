const assert = require('assert');
const mockery = require('mockery');

async function main() {
    /** @type {{browserLocale?: string, extraArgs: string[]} | null} */
    let localChromeOptions = null;
    /** @type {{browserLocale?: string, extraArgs: string[]} | null} */
    let remoteChromeOptions = null;

    class MockLocalChrome {
        constructor(options) {
            localChromeOptions = options;
        }

        async start() {}
    }

    class MockRemoteChrome {
        constructor(options) {
            remoteChromeOptions = options;
        }

        async start() {}
    }

    mockery.enable({
        warnOnUnregistered: false,
        useCleanCache: true,
    });
    mockery.registerMock('../constants', { VISUAL_DEBUG: false });
    mockery.registerMock('../helpers/chromiumDownload', {
        downloadChrome: async () => '/mock/chrome',
    });
    mockery.registerMock('./LocalChrome', MockLocalChrome);
    mockery.registerMock('./RemoteChrome', MockRemoteChrome);

    try {
        const openBrowser = require('../../browser/openBrowser');

        await openBrowser(() => {}, null, null, 'http://selenium.example', 'fr');
        if (!remoteChromeOptions) {
            throw new Error('RemoteChrome was not created');
        }
        assert.strictEqual(remoteChromeOptions.browserLocale, 'fr');
        assert(remoteChromeOptions.extraArgs.includes('--lang=fr'));
        assert(remoteChromeOptions.extraArgs.includes('--accept-lang=fr'));

        await openBrowser(() => {}, null, null, null);
        if (!localChromeOptions) {
            throw new Error('LocalChrome was not created');
        }
        assert.strictEqual(localChromeOptions.browserLocale, undefined);
        assert(!localChromeOptions.extraArgs.some((arg) => arg.startsWith('--lang=')));
        assert(!localChromeOptions.extraArgs.some((arg) => arg.startsWith('--accept-lang=')));

        await assert.rejects(
            openBrowser(() => {}, null, null, null, 'de_DE.UTF-8'),
            /Invalid browser locale/,
        );
    } finally {
        mockery.deregisterAll();
        mockery.disable();
    }
}

main();
