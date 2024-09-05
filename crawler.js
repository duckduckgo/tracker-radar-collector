/* eslint-disable max-lines */
const chalk = require('chalk');
const {createTimer} = require('./helpers/timer');
const createDeferred = require('./helpers/deferred');
const {wait, TimeoutError} = require('./helpers/wait');
const tldts = require('tldts');
const {DEFAULT_USER_AGENT, MOBILE_USER_AGENT, DEFAULT_VIEWPORT, MOBILE_VIEWPORT, VISUAL_DEBUG} = require('./constants');
const openBrowser = require('./browser/openBrowser');

class Crawler {

    /**
     * @param {GetSiteDataOptions} options
     */
    constructor(options) {
        this.options = options;
        /** @type {Map<import('devtools-protocol/types/protocol').Protocol.Target.TargetID, import('./collectors/BaseCollector').TargetInfo>} */
        this.targets = new Map();
        this._mainPageDeferred = createDeferred();
        /** @type {import('./collectors/BaseCollector').TargetInfo} */
        this.mainPageTarget = null;
        this._mainFrameDeferred = createDeferred();
        /** @type {import('devtools-protocol/types/protocol').Protocol.Page.FrameId} */
        this.mainFrameId = null;
        this.log = options.log;
        this.browserConnection = options.browserConnection;
        this.collectors = options.collectors;
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.AttachedToTargetEvent} event
     */
    async onTargetAttached(event) {
        const session = this.browserConnection.session(event.sessionId);
        this.log(`new target ${event.targetInfo.targetId}: ${event.targetInfo.type} ${event.targetInfo.url}`);
        const timer = createTimer();
        /** @type {import('./collectors/BaseCollector').TargetInfo} */
        const targetInfo = {
            id: event.targetInfo.targetId,
            url: event.targetInfo.url,
            type: event.targetInfo.type,
            session
        };
        if (this.targets.has(targetInfo.id)) {
            this.log(chalk.yellow(`Target ${targetInfo.id} already exists: old session: ${this.targets.get(targetInfo.id).session.id()}, new: ${session.id()}`));
        }
        this.targets.set(targetInfo.id, targetInfo);
        try {
            await this._onTargetAttached(session, targetInfo);
            this.log(`${targetInfo.url} (${targetInfo.url}) context initiated in ${timer.getElapsedTime()}s`);
        } catch (e) {
            this.log(chalk.yellow(`Could not attach to ${targetInfo.type} ${targetInfo.url}: ${e.message}`));
        }
    }

    /**
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('./collectors/BaseCollector').TargetInfo} targetInfo
     */
    async _onTargetAttached(session, targetInfo) {
        session.on('Target.attachedToTarget', this.onTargetAttached.bind(this));

        await session.send('Target.setAutoAttach', {
            autoAttach: true,
            waitForDebuggerOnStart: true, // pause execution until we attach all event handlers
            flatten: true,
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
            session.on('Inspector.targetCrashed', () => {
                this.log(chalk.red('Target crashed', targetInfo.url));
            });
            session.on('Page.frameNavigated', e => {
                if (!e.frame.parentId) {
                    if (this.mainFrameId) {
                        this.log(chalk.red(`Main frame changed: ${this.mainFrameId} -> ${e.frame.id}`));
                        this.mainFrameId = e.frame.id;
                    } else {
                        this.mainFrameId = e.frame.id;
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

        for (let collector of this.collectors) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await collector.addTarget(targetInfo);
            } catch (e) {
                this.log(chalk.yellow(`${collector.id()} failed to attach to "${targetInfo.url}"`), chalk.gray(e.message), chalk.gray(e.stack));
            }
        }

        await session.send('Runtime.runIfWaitingForDebugger');

        if (!this.mainPageTarget && targetInfo.type === 'page') {
            this.mainPageTarget = targetInfo;
            this._mainPageDeferred.resolve(targetInfo);
        }
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfoChangedEvent} event
     */
    onTargetInfoChanged(event) {
        const target = this.targets.get(event.targetInfo.targetId);
        if (target) {
            this.log(`${target.id} changed to ${event.targetInfo.url}`);
            target.url = event.targetInfo.url;
        }
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.DetachedFromTargetEvent} event
     */
    onDetachedFromTarget(event) {
        this.log(`detached from: ${event.targetId}; session: ${event.sessionId}`);
        this.targets.delete(event.targetId);
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetDestroyedEvent} event
     */
    onTargetDestroyed(event) {
        this.log(`target ${event.targetId} destroyed`);
        this.targets.delete(event.targetId);
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetCreatedEvent} event
     */
    onTargetCreated(event) {
        this.log(`target created: ${event.targetInfo.targetId} ${event.targetInfo.type} ${event.targetInfo.url}`);
    }

    /**
     * @returns {Promise<import('./collectors/BaseCollector').TargetInfo>}
     */
    waitForMainPage() {
        return this._mainPageDeferred.promise;
    }

    /**
     * @param {string} url
     * @param {number} timeoutMs
     * @returns {Promise<void>}
     */
    async goto(url, timeoutMs) {
        const mainTarget = await wait(this.waitForMainPage(), timeoutMs, 'Main page target not found');
        await mainTarget.session.send('Page.navigate', {
            url: url.toString(),
        });
        await wait(
            new Promise(resolve => {
                /**
                 * @param {import('devtools-protocol/types/protocol').Protocol.Page.LifecycleEventEvent} e
                 */
                const lifecycleHandler = async e => {
                    if (e.name === 'networkIdle') {
                        if (e.frameId === await this._mainFrameDeferred.promise) {
                            this.log(chalk.green(`network idle in ${mainTarget.url}`));
                            mainTarget.session.off('Page.lifecycleEvent', lifecycleHandler);
                            resolve();
                        }
                    }
                };
                mainTarget.session.on('Page.lifecycleEvent', lifecycleHandler);
            }),
            timeoutMs,
            `Page navigation timeout`
        );
    }

    /**
     * @param {URL} url
     * @returns {Promise<CollectResult>}
     */
    async getSiteData(url) {
        const testStarted = Date.now();

        const conn = this.browserConnection;
        conn.on('Target.targetCreated', this.onTargetCreated.bind(this));
        conn.on('Target.attachedToTarget', this.onTargetAttached.bind(this));
        conn.on('Target.detachedFromTarget', this.onDetachedFromTarget.bind(this));
        conn.on('Target.targetInfoChanged', this.onTargetInfoChanged.bind(this));
        conn.on('Target.targetDestroyed', this.onTargetDestroyed.bind(this));

        /** @type {import('./collectors/BaseCollector').CollectorInitOptions} */
        const collectorOptions = {
            browserConnection: conn,
            url,
            log: this.log,
            collectorFlags: this.options.collectorFlags,
        };

        for (let collector of this.collectors) {
            const timer = createTimer();

            try {
                // eslint-disable-next-line no-await-in-loop
                await collector.init(collectorOptions);
                this.log(`${collector.id()} init took ${timer.getElapsedTime()}s`);
            } catch (e) {
                this.log(chalk.yellow(`${collector.id()} init failed`), chalk.gray(e.message), chalk.gray(e.stack));
            }
        }

        await conn.send('Target.setAutoAttach', {
            autoAttach: true,
            waitForDebuggerOnStart: true,
            flatten: true,
        });
        await conn.send('Target.setDiscoverTargets', {
            discover: true,
            filter: [{type: 'tab', exclude: true}, {}],
        });

        let timeout = false;

        try {
            await this.goto(url.toString(), this.options.maxLoadTimeMs);
        } catch (e) {
            if (e instanceof TimeoutError) {
                this.log(chalk.yellow(e.message));

                for (let target of this.targets.values()) {
                    if (target.type === 'page') {
                        target.session.send('Page.stopLoading').catch(() => {/* ignore */});
                    }
                }
                timeout = true;
            } else {
                throw e;
            }
        }

        for (let collector of this.collectors) {
            const postLoadTimer = createTimer();
            try {
                // eslint-disable-next-line no-await-in-loop
                await collector.postLoad();
                this.log(`${collector.id()} postLoad took ${postLoadTimer.getElapsedTime()}s`);
            } catch (e) {
                this.log(chalk.yellow(`${collector.id()} postLoad failed`), chalk.gray(e.message), chalk.gray(e.stack));
            }
        }

        // give website a bit more time for things to settle
        await new Promise(resolve => {
            setTimeout(resolve, this.options.extraExecutionTimeMs);
        });

        const finalUrl = this.mainPageTarget.url; // URL could have changed by now
        /**
         * @type {Object<string, Object>}
         */
        const data = {};

        for (let collector of this.collectors) {
            const getDataTimer = createTimer();
            try {
                // eslint-disable-next-line no-await-in-loop
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

        for (let target of this.targets.values()) {
            target.session.detach().catch(() => {/* ignore */});
        }

        return {
            initialUrl: url.toString(),
            finalUrl,
            timeout,
            testStarted,
            testFinished: Date.now(),
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
    const browser = options.browserConnection ? null : await openBrowser(log, options.proxyHost, options.executablePath);
    const browserConnection = options.browserConnection || await browser.getConnection();

    let data = null;

    const maxLoadTimeMs = options.maxLoadTimeMs || 30000;
    const extraExecutionTimeMs = options.extraExecutionTimeMs || 2500;
    const maxTotalTimeMs = maxLoadTimeMs * 2;

    try {
        const crawler = new Crawler({
            browserConnection,
            collectors: options.collectors || [],
            log,
            urlFilter: options.filterOutFirstParty === true ? isThirdPartyRequest.bind(null) : null,
            emulateUserAgent: options.emulateUserAgent !== false, // true by default
            emulateMobile: options.emulateMobile,
            runInEveryFrame: options.runInEveryFrame,
            maxLoadTimeMs,
            extraExecutionTimeMs,
            collectorFlags: options.collectorFlags
        });
        data = await wait(crawler.getSiteData(url), maxTotalTimeMs);
    } catch(e) {
        log(chalk.red('Crawl failed'), e.message, chalk.gray(e.stack));
        throw e;
    } finally {
        // only close the browser if it was created here and not debugging
        if (browser && !VISUAL_DEBUG) {
            await browser.close();
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
 * @property {Object.<string, string>=} collectorFlags
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
 * @property {Object.<string, string>} collectorFlags,
 */

module.exports = crawl;
