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

    const previousBrowserLocale = process.env.BROWSER_LOCALE;
    process.env.BROWSER_LOCALE = 'de-DE';

    try {
        const openBrowser = require('../../browser/openBrowser');

        await openBrowser(() => {}, null, null, 'http://selenium.example', 'fr-fr');
        if (!remoteChromeOptions) {
            throw new Error('RemoteChrome was not created');
        }
        assert.strictEqual(remoteChromeOptions.browserLocale, 'fr-fr');
        assert(remoteChromeOptions.extraArgs.includes('--lang=fr-fr'));

        await openBrowser(() => {}, null, null, null);
        if (!localChromeOptions) {
            throw new Error('LocalChrome was not created');
        }
        assert.strictEqual(localChromeOptions.browserLocale, undefined);
        assert(!localChromeOptions.extraArgs.some((arg) => arg.startsWith('--lang=')));

        await assert.rejects(
            openBrowser(() => {}, null, null, null, 'de_DE.UTF-8'),
            /Invalid browser locale/,
        );
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
