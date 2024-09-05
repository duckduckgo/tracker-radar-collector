const {mkdtemp} = require('fs/promises');
const {join} = require('path');
const {tmpdir} = require('os');
const {BrowserRunner} = require('puppeteer-core/lib/cjs/puppeteer/node/BrowserRunner.js');
const {ChromeLauncher} = require('puppeteer-core/lib/cjs/puppeteer/node/ChromeLauncher.js');

const BaseBrowser = require("./BaseBrowser");
const {DEFAULT_VIEWPORT} = require('../constants');

class LocalChrome extends BaseBrowser {
    /**
     * @param {BrowserOptions} options
     */
    constructor(options) {
        super();
        this.options = options;
        this.connection = null;
        this.runner = null;
        this.userDataDir = null;
        /** @type import('puppeteer-core/lib/cjs/puppeteer/node/LaunchOptions') */
        this.launchOptions = {
            ignoreDefaultArgs: false,
            args: options.extraArgs,
            dumpio: false,
            pipe: false,
            // eslint-disable-next-line no-process-env
            env: process.env,
            handleSIGINT: true,
            handleSIGTERM: true,
            handleSIGHUP: true,
            ignoreHTTPSErrors: false,
            defaultViewport: options.viewport || DEFAULT_VIEWPORT,
            slowMo: 0,
            timeout: 30000,
            waitForInitialPage: true,
            channel: undefined,
            executablePath: options.executablePath,
            debuggingPort: undefined,
            protocol: undefined,
        };
    }

    _getProfilePath() {
        return join(
            tmpdir(),
            `tr_collector_chrome_profile-`
        );
    }

    /**
     * @returns {Promise<void>}
     */
    async start() {
        this.userDataDir = await mkdtemp(this._getProfilePath());

        const devtools = !this.options.headless;
        const headless = this.options.headless ? 'new' : false;

        const chromeArguments = ChromeLauncher.prototype.defaultArgs({
            devtools,
            headless,
            args: this.options.extraArgs,
            userDataDir: this.userDataDir,
        });
        chromeArguments.push(`--remote-debugging-port=0`);

        this.runner = new BrowserRunner('chrome', this.options.executablePath, chromeArguments, this.userDataDir, true);
        this.runner.start(this.launchOptions);
    }

    /**
     * @returns {Promise<void>}
     */
    async close() {
        if (!this.runner.proc) {
            throw new Error('Browser is not running');
        }
        await this.runner.close();
    }

    /**
     * @returns {Promise<BrowserConnection>}
     */
    async getConnection() {
        try {
            this.connection = await this.runner.setupConnection({
                timeout: 30000,
                slowMo: 0,
                preferredRevision: '<SEE_PUPPETEER_SOURCE>',
                usePipe: false,
            });
            return this.connection;
        } catch (e) {
            console.log('error setting up connection', e);
            this.runner.kill();
            throw e;
        }
    }
}

module.exports = LocalChrome;

/**
 * @typedef {import('./BaseBrowser').BrowserOptions} BrowserOptions
 */

/**
 * @typedef {import('puppeteer-core/lib/cjs/puppeteer/common/Connection').Connection} BrowserConnection
 */
