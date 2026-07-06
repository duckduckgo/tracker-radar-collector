const assert = require('assert');
const mockery = require('mockery');

async function main() {
    let localChromeOptions = null;
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

    const previousBrowserLocale = process.env.BROWSER_LOCALE;
    process.env.BROWSER_LOCALE = 'de-DE';

    try {
        const openBrowser = require('../../browser/openBrowser');

        await openBrowser(() => {}, null, null, 'http://selenium.example', 'fr-FR');
        assert.strictEqual(remoteChromeOptions.browserLocale, 'fr-FR');
        assert(remoteChromeOptions.extraArgs.includes('--lang=fr-FR'));

        await openBrowser(() => {}, null, null, null);
        assert.strictEqual(localChromeOptions.browserLocale, 'de-DE');
        assert(localChromeOptions.extraArgs.includes('--lang=de-DE'));
    } finally {
        if (previousBrowserLocale === undefined) {
            delete process.env.BROWSER_LOCALE;
        } else {
            process.env.BROWSER_LOCALE = previousBrowserLocale;
        }
        mockery.deregisterAll();
        mockery.disable();
    }
}

main();
