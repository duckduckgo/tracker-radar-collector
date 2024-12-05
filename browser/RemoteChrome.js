const {Builder} = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

const {Connection} = require('puppeteer-core');

// INTERNAL puppeteer classes
const {ChromeLauncher} = require('puppeteer-core/lib/cjs/puppeteer/node/ChromeLauncher.js');
const {NodeWebSocketTransport} = require('puppeteer-core/lib/cjs/puppeteer/node/NodeWebSocketTransport.js');

const BaseBrowser = require("./BaseBrowser");

class RemoteChrome extends BaseBrowser {
    /**
     * @param {SeleniumOptions} options
     */
    constructor(options) {
        super();
        this.options = options;
        this.connection = null;
        this.driver = null;
    }

    getArguments() {
        //   At the time of writing, default args are:
        //   [
        //     '--allow-pre-commit-input',
        //     '--disable-background-networking',
        //     '--disable-background-timer-throttling',
        //     '--disable-backgrounding-occluded-windows',
        //     '--disable-breakpad',
        //     '--disable-client-side-phishing-detection',
        //     '--disable-component-extensions-with-background-pages',
        //     '--disable-default-apps',
        //     '--disable-dev-shm-usage',
        //     '--disable-extensions',
        //     '--disable-hang-monitor',
        //     '--disable-infobars',
        //     '--disable-ipc-flooding-protection',
        //     '--disable-popup-blocking',
        //     '--disable-prompt-on-repost',
        //     '--disable-renderer-backgrounding',
        //     '--disable-search-engine-choice-screen',
        //     '--disable-sync',
        //     '--enable-automation',
        //     '--export-tagged-pdf',
        //     '--generate-pdf-document-outline',
        //     '--force-color-profile=srgb',
        //     '--metrics-recording-only',
        //     '--no-first-run',
        //     '--password-store=basic',
        //     '--use-mock-keychain',
        //     '--disable-features=Translate,AcceptCHFrame,MediaRouter,OptimizationHints,ProcessPerSiteUpToMainFrameThreshold,IsolateSandboxedIframes',
        //     '--enable-features=PdfOopif',
        //     '--headless=new', // depend on headless param
        //     '--hide-scrollbars', // depend on headless param
        //     '--mute-audio', // depend on headless param
        //     'about:blank',
        //   ]
        const chromeArguments = ChromeLauncher.prototype.defaultArgs({
            headless: false, // selenium will run headful browsers
            args: this.options.extraArgs,
        }).filter(arg => [
            // '--disable-dev-shm-usage', // see https://github.com/puppeteer/puppeteer/issues/1834#issuecomment-1435707522
            'about:blank',
        ].includes(arg) === false);
        return chromeArguments;
    }

    /**
     * @returns {Promise<void>}
     */
    async start() {
        const chromeArguments = this.getArguments();
        const opts = new chrome.Options();
        opts.addArguments(...chromeArguments);

        opts.setUserPreferences({
            "download.default_directory": "/dev/null",
        });

        this.driver = await (new Builder()
            .usingServer(this.options.seleniumHub)
            .forBrowser('chrome')
            .setChromeOptions(opts)
            .build());
    }

    /**
     * @returns {Promise<void>}
     */
    async close() {
        if (this.closing) {
            return;
        }
        this.closing = true;
        if (this.connection) {
            // Attempt to close the browser gracefully
            try {
                await this.connection.send('Browser.close');
            } catch (error) {
                console.error('Error when closing browser connection', error);
            }
            this.connection.dispose();
        }
        await this.driver?.quit();
    }

    /**
     * @returns {Promise<BrowserConnection>}
     */
    async getConnection() {
        try {
            const seleniumHost = new URL(this.options.seleniumHub).host;
            // @ts-expect-error session has the 'any' type
            const sessionId = await this.driver.getSession().then(session => session.getId());
            const browserWSEndpoint = `ws://${seleniumHost}/session/${sessionId}/se/cdp`;
            const transport = await NodeWebSocketTransport.create(browserWSEndpoint);

            let slowMo; // override for debugging
            let protocolTimeout; // override for debugging
            this.connection = new Connection(
                browserWSEndpoint,
                transport,
                slowMo,
                protocolTimeout
            );
            return this.connection;
        } catch (e) {
            console.log('error setting up remote connection', e);
            this.close();
            throw e;
        }
    }
}

module.exports = RemoteChrome;

/**
 * @typedef SeleniumOptions
 * @property {string[]=} extraArgs
 * @property {string} seleniumHub
 */

/**
 * @typedef {import('puppeteer-core').Connection} BrowserConnection
 */
