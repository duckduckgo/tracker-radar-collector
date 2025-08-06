 
const chalk = require('chalk');
const {createTimer} = require('./helpers/timer');
const createDeferred = require('./helpers/deferred');
const {wait, TimeoutError} = require('./helpers/wait');
const tldts = require('tldts');
const {DEFAULT_USER_AGENT, MOBILE_USER_AGENT, DEFAULT_VIEWPORT, MOBILE_VIEWPORT, VISUAL_DEBUG} = require('./constants');
const openBrowser = require('./browser/openBrowser');

const targetFilter = [
    // see list of types in https://source.chromium.org/chromium/chromium/src/+/main:content/browser/devtools/devtools_agent_host_impl.cc?ss=chromium&q=f:devtools%20-f:out%20%22::kTypeTab%5B%5D%22

    // these targets are disabled by default in CDP
    {type: 'browser', exclude: true},
    {type: 'tab', exclude: true},

    // main targets we're interested in
    {type: 'page', exclude: false},
    {type: 'iframe', exclude: false},

    // somewhat useful targets, but not sure if we actually need them
    {type: 'worker', exclude: false},
    {type: 'shared_worker', exclude: false},
    {type: 'service_worker', exclude: false},

    // exclude other targets because we're not doing anything with them at the moment
    {type: 'worklet', exclude: true},
    {type: 'shared_storage_worklet', exclude: true},
    {type: 'webview', exclude: true},
    {type: 'other', exclude: true},
    {type: 'auction_worklet', exclude: true},
    {type: 'assistive_technology', exclude: true},

    // allow all other unknown types
    {}
];

class Crawler {

    /**
     * @param {GetSiteDataOptions} options
     */
    constructor(options) {
        this.options = options;
        /** @type {Map<import('devtools-protocol/types/protocol').Protocol.Target.TargetID, {targetInfo: import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo, session: import('puppeteer-core').CDPSession}>} */
        this.targets = new Map();
        this._mainPageAttachedDeferred = createDeferred();
        this.mainPageAttached = false;
        /** @type {import('devtools-protocol/types/protocol').Protocol.Target.TargetID} */
        this.mainPageTargetId = null;
        this._mainFrameDeferred = createDeferred();
        /** @type {import('devtools-protocol/types/protocol').Protocol.Page.Frame} */
        this.mainPageFrame = null;
        this._navigationDeferred = createDeferred();
        this.log = options.log;
        this.browserConnection = options.browserConnection;
        this.collectors = options.collectors;
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.AttachedToTargetEvent} event
     */
    async onTargetAttached(event) {
        const targetInfo = event.targetInfo;
        const session = this.browserConnection.session(event.sessionId);
        this.log(`target attached tId ${targetInfo.targetId} type ${targetInfo.type} url ${targetInfo.url}`);
        const timer = createTimer();
        if (this.targets.has(targetInfo.targetId)) {
            this.log(chalk.yellow(`Target tId ${targetInfo.targetId} already exists: old session: ${this.targets.get(targetInfo.targetId).session.id()}, new: ${session.id()}`));
        }
        this.targets.set(targetInfo.targetId, {targetInfo, session});
        try {
            await this._onTargetAttached(session, targetInfo);
            this.log(`tId ${targetInfo.targetId} url ${targetInfo.url} target attached in ${timer.getElapsedTime()}s`);
        } catch (e) {
            this.log(chalk.yellow(`Could not attach to tId ${targetInfo.targetId} type ${targetInfo.type} url ${targetInfo.url} after ${timer.getElapsedTime()}s: ${e}`));
        }
    }

    /**
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo} targetInfo
     */
    async _onTargetAttached(session, targetInfo) {
        // Auto-attach works only on related targets, so if we want to attach to everything, we have to set it up for each target
        session.on('Target.attachedToTarget', this.onTargetAttached.bind(this));
        await session.send('Target.setAutoAttach', {
            autoAttach: true,
            waitForDebuggerOnStart: true, // pause execution until we attach all event handlers
            flatten: true,
            filter: targetFilter,
        });

        if (this.options.emulateUserAgent) {
            await session.send('Network.setUserAgentOverride', {
                userAgent: this.options.emulateMobile ? MOBILE_USER_AGENT : DEFAULT_USER_AGENT
            });
        }

        if (targetInfo.type === 'page') {
            session.on('Page.javascriptDialogOpening', async () => {
                await session.send('Page.handleJavaScriptDialog', {
                    accept: false,
                });
            });
            session.on('Page.frameNavigated', e => {
                if (!e.frame.parentId) {
                    if (this.mainPageFrame) {
                        this.log(chalk.red(`Main frame changed: fId ${this.mainPageFrame.id} -> fId ${e.frame.id}`));
                        this.mainPageFrame = e.frame;
                    } else {
                        this.log(`Main frame: fId ${e.frame.id} ${JSON.stringify(e.frame)}`);
                        this.mainPageFrame = e.frame;
                        this._mainFrameDeferred.resolve(e.frame.id);
                    }
                }
            });
            await session.send('Page.enable');
            await session.send('Inspector.enable');
            await session.send('Page.setLifecycleEventsEnabled', {enabled: true});
            await session.send(
                'Emulation.setDeviceMetricsOverride',
                this.options.emulateMobile ? MOBILE_VIEWPORT : DEFAULT_VIEWPORT,
            );
            if (this.options.runInEveryFrame) {
                await session.send('Page.addScriptToEvaluateOnNewDocument', {
                    source: `(${this.options.runInEveryFrame})()`
                });
            }
        }

        await session.send('Runtime.enable');

        for (const collector of this.collectors) {
            try {
                 
                await collector.addTarget(session, targetInfo);
            } catch (e) {
                this.log(chalk.yellow(`${collector.id()} failed to attach to "${targetInfo.url}"`), chalk.gray(e.message), chalk.gray(e.stack));
            }
        }

        await session.send('Runtime.runIfWaitingForDebugger');
        if (this.mainPageTargetId === targetInfo.targetId) {
            this.mainPageAttached = true;
            this.log(chalk.green(`main page target attached: tId ${targetInfo.targetId} url ${targetInfo.url}`));
            this._mainPageAttachedDeferred.resolve({targetInfo, session});
        }
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfoChangedEvent} event
     */
    onTargetInfoChanged(event) {
        const target = this.targets.get(event.targetInfo.targetId);
        if (target) {
            this.log(`tId ${target.targetInfo.targetId} changed. old url: ${target.targetInfo.url}, new url: ${event.targetInfo.url}`);
            target.targetInfo = event.targetInfo;
        }
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.DetachedFromTargetEvent} event
     */
    onDetachedFromTarget(event) {
        this.log(`detached from: tId ${event.targetId}; session: ${event.sessionId}`);
        this.targets.delete(event.targetId);
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetDestroyedEvent} event
     */
    onTargetDestroyed(event) {
        this.log(`target tId ${event.targetId} destroyed`);
        this.targets.delete(event.targetId);
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetCrashedEvent} event
     */
    onTargetCrashed(event) {
        this.log(chalk.red(`target tId ${event.targetId} crashed: status ${event.status}, code ${event.errorCode}`));
        if (this.mainPageTargetId === event.targetId) {
            this._navigationDeferred.reject(new Error(`Main target ${event.targetId} crashed`));
        }
        this.targets.delete(event.targetId);
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetCreatedEvent} event
     */
    onTargetCreated(event) {
        const targetInfo = event.targetInfo;
        this.log(`target created: tId ${targetInfo.targetId} type ${targetInfo.type} url ${targetInfo.url}`);
        if (!this.mainPageTargetId && targetInfo.type === 'page') {
            this.mainPageTargetId = targetInfo.targetId;
        }
    }

    /**
     * @param {string} url
     * @param {number} timeoutMs
     * @returns {Promise<void>}
     */
    async navigateMainTarget(url, timeoutMs) {
        const {session, targetInfo} = await wait(this._mainPageAttachedDeferred.promise, timeoutMs, 'Main page target not found');
        await session.send('Page.navigate', {
            url: url.toString(),
        });

        /**
         * @param {import('devtools-protocol/types/protocol').Protocol.Page.LifecycleEventEvent} e
         */
        const lifecycleHandler = async e => {
            if (e.name === 'networkAlmostIdle') {
                this.log(`networkAlmostIdle in fId ${e.frameId} tId ${targetInfo.targetId}`);
            }
            if (e.name === 'networkIdle') {
                this.log(`networkIdle in fId ${e.frameId} tId ${targetInfo.targetId}`);
                await this._mainFrameDeferred.promise;
                if (e.frameId === this.mainPageFrame.id) {
                    this.log(chalk.green(`network idle in the main frame ${this.mainPageFrame.url}`));
                    session.off('Page.lifecycleEvent', lifecycleHandler);
                    this._navigationDeferred.resolve();
                }
            }
        };
        session.on('Page.lifecycleEvent', lifecycleHandler);

        await wait(
            this._navigationDeferred.promise,
            timeoutMs,
            `Page navigation timeout`
        );
    }

    /**
     * @param {URL} url
     */
    async initCollectors(url) {
        /** @type {import('./collectors/BaseCollector').CollectorInitOptions} */
        const collectorOptions = {
            browserConnection: this.browserConnection,
            url,
            log: this.log,
            collectorFlags: this.options.collectorFlags,
        };

        for (const collector of this.collectors) {
            const timer = createTimer();
            try {
                 
                await collector.init(collectorOptions);
                this.log(`${collector.id()} init took ${timer.getElapsedTime()}s`);
            } catch (e) {
                this.log(chalk.yellow(`${collector.id()} init failed`), chalk.gray(e.message), chalk.gray(e.stack));
            }
        }
    }

    async postLoadCollectors() {
        for (const collector of this.collectors) {
            const postLoadTimer = createTimer();
            try {
                 
                await collector.postLoad();
                this.log(`${collector.id()} postLoad took ${postLoadTimer.getElapsedTime()}s`);
            } catch (e) {
                this.log(chalk.yellow(`${collector.id()} postLoad failed`), chalk.gray(e.message), chalk.gray(e.stack));
            }
        }
    }

    async getCollectorData() {
        /**
         * @type {Object<string, Object>}
         */
        const data = {};
        const finalUrl = this.mainPageFrame.url;
        for (const collector of this.collectors) {
            const getDataTimer = createTimer();
            try {
                 
                const collectorData = await collector.getData({
                    finalUrl,
                    urlFilter: this.options.urlFilter && this.options.urlFilter.bind(null, finalUrl)
                });
                data[collector.id()] = collectorData;
                this.log(`getting ${collector.id()} data took ${getDataTimer.getElapsedTime()}s`);
            } catch (e) {
                this.log(chalk.yellow(`getting ${collector.id()} data failed`), chalk.gray(e.message), chalk.gray(e.stack));
                data[collector.id()] = null;
            }
        }
        return data;
    }

    /**
     * @param {URL} url
     * @returns {Promise<CollectResult>}
     */
    async getSiteData(url) {
        const testStarted = Date.now();
        const getSiteDataTimer = createTimer();

        const conn = this.browserConnection;
        conn.on('Target.targetCreated', this.onTargetCreated.bind(this));
        conn.on('Target.attachedToTarget', this.onTargetAttached.bind(this));
        conn.on('Target.detachedFromTarget', this.onDetachedFromTarget.bind(this));
        conn.on('Target.targetInfoChanged', this.onTargetInfoChanged.bind(this));
        conn.on('Target.targetDestroyed', this.onTargetDestroyed.bind(this));
        conn.on('Target.targetCrashed', this.onTargetCrashed.bind(this));

        await this.initCollectors(url);
        this.log(`init collectors took ${getSiteDataTimer.getElapsedTime()}s`);

        await conn.send('Target.setAutoAttach', {
            autoAttach: true,
            waitForDebuggerOnStart: true,
            flatten: true,
            filter: targetFilter,
        });
        await conn.send('Target.setDiscoverTargets', {
            discover: true,
            filter: targetFilter,
        });

        let timeout = false;
        const navigateMainTargetTimer = createTimer();
        try {
            await this.navigateMainTarget(url.toString(), this.options.maxLoadTimeMs);
            this.log(`navigate main target took ${navigateMainTargetTimer.getElapsedTime()}s`);
        } catch (e) {
            if (e instanceof TimeoutError) {
                this.log(chalk.yellow(e.message));

                for (const {session, targetInfo} of this.targets.values()) {
                    if (targetInfo.type === 'page') {
                        session.send('Page.stopLoading').catch(() => {/* ignore */});
                    }
                }
                timeout = true;
            } else {
                throw e;
            }
        }

        const postLoadCollectorsTimer = createTimer();
        await this.postLoadCollectors();
        this.log(`post load collectors took ${postLoadCollectorsTimer.getElapsedTime()}s`);

        // give website a bit more time for things to settle
        await new Promise(resolve => {
            setTimeout(resolve, this.options.extraExecutionTimeMs);
        });

        const getCollectorDataTimer = createTimer();
        const data = await this.getCollectorData();
        this.log(`get collector data took ${getCollectorDataTimer.getElapsedTime()}s`);

        for (const target of this.targets.values()) {
            target.session.detach().catch(() => {/* ignore */});
        }

        const testFinished = Date.now();
        this.log(chalk.green(`crawl took ${(testFinished - testStarted) / 1000}s`));

        return {
            initialUrl: url.toString(),
            finalUrl: this.mainPageFrame.url,
            timeout,
            testStarted,
            testFinished,
            data
        };
    }
}

/**
 * @param {string} documentUrl
 * @param {string} requestUrl
 * @returns {boolean}
 */
function isThirdPartyRequest(documentUrl, requestUrl) {
    const mainPageDomain = tldts.getDomain(documentUrl);

    return tldts.getDomain(requestUrl) !== mainPageDomain;
}

/**
 * @param {URL} url
 * @param {CrawlerOptions} options
 * @returns {Promise<CollectResult>}
 */
async function crawl(url, options) {
    const log = options.log || (() => {});
    const browser = options.browserConnection ? null : await openBrowser(
        log,
        options.proxyHost,
        options.executablePath,
        options.seleniumHub,
    );
    const browserConnection = options.browserConnection || await browser.getConnection();

    let data = null;

    const maxLoadTimeMs = options.maxLoadTimeMs || 60000;
    const extraExecutionTimeMs = options.extraExecutionTimeMs || 2500;
    const collectorExtraTimeMs = options.collectors.reduce((sum, collector) => sum + (collector.collectorExtraTimeMs || 0), 0);
    const maxTotalTimeMs = (maxLoadTimeMs * 2) + collectorExtraTimeMs;

    let emulateUserAgent = !options.seleniumHub && !VISUAL_DEBUG; // by default, override only when in headless mode
    if (options.emulateUserAgent === false) {
        emulateUserAgent = false;
    }

    try {
        const crawler = new Crawler({
            browserConnection,
            collectors: options.collectors || [],
            log,
            urlFilter: options.filterOutFirstParty === true ? isThirdPartyRequest.bind(null) : null,
            emulateUserAgent,
            emulateMobile: options.emulateMobile,
            runInEveryFrame: options.runInEveryFrame,
            maxLoadTimeMs,
            extraExecutionTimeMs,
            collectorFlags: options.collectorFlags
        });
        data = await wait(crawler.getSiteData(url), maxTotalTimeMs, `${url} timed out`);
    } catch(e) {
        log(chalk.red('Crawl failed'), e.message, chalk.gray(e.stack));
        throw e;
    } finally {
        // only close the browser if it was created here and not debugging
        if (browser && !VISUAL_DEBUG) {
            try {
                await wait(browser.close(), 5000, 'Browser close timed out');
            } catch {
                // ignore
            }
        }
    }

    return data;
}

/**
 * @typedef {Object} CollectResult
 * @property {string} initialUrl URL from which the crawler began the crawl (as provided by the caller)
 * @property {string} finalUrl URL after page has loaded (can be different from initialUrl if e.g. there was a redirect)
 * @property {boolean} timeout true if page didn't fully load before the timeout and loading had to be stopped by the crawler
 * @property {number} testStarted time when the crawl started (unix timestamp)
 * @property {number} testFinished time when the crawl finished (unix timestamp)
 * @property {import('./helpers/collectorsList').CollectorData} data object containing output from all collectors
*/

/**
 * @typedef {Object} CrawlerOptions
 * @property {import('./collectors/BaseCollector')[]=} collectors
 * @property {function(...any):void=} log
 * @property {boolean=} filterOutFirstParty
 * @property {boolean=} emulateMobile
 * @property {boolean=} emulateUserAgent
 * @property {string=} proxyHost
 * @property {import('./browser/LocalChrome').BrowserConnection=} browserConnection
 * @property {function():void=} runInEveryFrame
 * @property {string=} executablePath
 * @property {number=} maxLoadTimeMs
 * @property {number=} extraExecutionTimeMs
 * @property {import('./collectors/BaseCollector').CollectorFlags=} collectorFlags
 * @property {string=} seleniumHub
 */

/**
 * @typedef {Object} GetSiteDataOptions
 * @property {import('./browser/LocalChrome').BrowserConnection} browserConnection,
 * @property {import('./collectors/BaseCollector')[]} collectors,
 * @property {function(...any):void} log,
 * @property {function(string, string):boolean} urlFilter,
 * @property {boolean} emulateMobile,
 * @property {boolean} emulateUserAgent,
 * @property {function():void} runInEveryFrame,
 * @property {number} maxLoadTimeMs,
 * @property {number} extraExecutionTimeMs,
 * @property {import('./collectors/BaseCollector').CollectorFlags} collectorFlags,
 */

module.exports = crawl;
