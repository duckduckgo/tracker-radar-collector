const {mkdtemp, rm} = require('fs/promises');
const {join} = require('path');
const {tmpdir} = require('os');
const {CDP_WEBSOCKET_ENDPOINT_REGEX, launch} = require('@puppeteer/browsers');

const {Connection} = require('puppeteer-core');

// INTERNAL puppeteer classes
const {ChromeLauncher} = require('puppeteer-core/lib/cjs/puppeteer/node/ChromeLauncher.js');
const {NodeWebSocketTransport} = require('puppeteer-core/lib/cjs/puppeteer/node/NodeWebSocketTransport.js');

const BaseBrowser = require("./BaseBrowser");

class LocalChrome extends BaseBrowser {
    /**
     * @param {BrowserOptions} options
     */
    constructor(options) {
        super();
        this.options = options;
        this.connection = null;
        this.browserProcess = null;
        this.userDataDir = null;
    }

    _getProfilePath() {
        return join(
            tmpdir(),
            // '/dev/shm',
            `tr_collector_chrome_profile-`
        );
    }

    /**
     * @returns {Promise<void>}
     */
    async start() {
        this.userDataDir = await mkdtemp(this._getProfilePath());

        const devtools = !this.options.headless;
        const headless = this.options.headless;

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
        //     '--disable-dev-shm-usage', // overridden below
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
            devtools,
            headless,
            args: this.options.extraArgs,
            userDataDir: this.userDataDir,
        }).filter(arg => [
            '--disable-dev-shm-usage', // see https://github.com/puppeteer/puppeteer/issues/1834#issuecomment-1435707522
        ].includes(arg) === false);

        chromeArguments.push(`--remote-debugging-port=0`);

        const handleSIGINT = true;
        const handleSIGTERM = true;
        const handleSIGHUP = true;
      
        const launchArgs = {
            executablePath: this.options.executablePath,
            args: chromeArguments,
            userDataDir: this.userDataDir,
        };

        // console.log('chromeArguments', chromeArguments);
      
        const onProcessExit = async () => {
            try {
                await rm(this.userDataDir, {
                    force: true,
                    recursive: true,
                    maxRetries: 5,
                });
            } catch (error) {
                console.error('Error when deleting user data dir', error);
            }
        };
    
        this.browserProcess = launch({
            executablePath: launchArgs.executablePath,
            detached: true,
            env: process.env,
            args: launchArgs.args,
            handleSIGHUP,
            handleSIGTERM,
            handleSIGINT,
            dumpio: true, // set to true to connect stdio from the browser process to the current process
            pipe: false,
            onExit: onProcessExit,
        });
    }

    /**
     * @returns {Promise<void>}
     */
    async close() {
        if (!this.browserProcess) {
            throw new Error('Browser is not running');
        }
        if (this.closing) {
            return;
        }
        this.closing = true;
        if (this.connection) {
            // Attempt to close the browser gracefully
            try {
              await this.connection.send('Browser.close');
              await this.browserProcess.hasClosed();
            } catch (error) {
              console.error('Error when closing browser connection', error);
              await this.browserProcess.close();
            }
            this.connection.dispose();
        } else {
            await this.browserProcess.close();
        }
    }

    /**
     * @returns {Promise<BrowserConnection>}
     */
    async getConnection() {
        try {
            const wsTimeout = 30000;
            const browserWSEndpoint = await this.browserProcess.waitForLineOutput(
                CDP_WEBSOCKET_ENDPOINT_REGEX,
                wsTimeout
            );
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
            console.log('error setting up connection', e);
            this.close();
            throw e;
        }
    }
}

module.exports = LocalChrome;

/**
 * @typedef {import('./BaseBrowser').BrowserOptions} BrowserOptions
 */

/**
 * @typedef {import('puppeteer-core').Connection} BrowserConnection
 */
