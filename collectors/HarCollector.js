'use strict';

/**
 * @file HarCollector.js
 *
 * Captures a full HAR 1.2 archive for every crawled URL, covering all target
 * types that can originate network requests (page, cross-process iframes,
 * workers, service workers).
 *
 * ## Responsibilities of this file
 *
 * This class is purely an *orchestrator*.  All domain logic lives in helpers:
 *
 * | Helper           | Responsibility                                            |
 * |------------------|-----------------------------------------------------------|
 * | `harEvents.js`   | CDP event names + instrumented target types               |
 * | `harResponseBody.js` | Body fetching, draining, and HAR stitching            |
 * | `harEnrich.js`   | postData params parsing + initiator object normalisation  |
 *
 *
 * ## Crawler lifecycle
 *
 * ```
 * collector.init()              <- allocate per-URL state
 * collector.addTarget(s, t)     <- attach listeners + enable Network domain (per session)
 *   ... Chrome navigates, page becomes idle ...
 * collector.getData()           <- assemble and return the HAR
 * ```
 *
 * ## Race condition: duplicate service worker sessions
 *
 * Chrome occasionally attaches the same logical target twice with two different
 * CDP sessions (visible in logs as "Target already exists: old session X, new Y").
 * This happens most often with service workers that are already registered when
 * the page loads.  The crawler keeps only the second session — the first is
 * detached and its CDP connection closed.
 *
 * The previous code deferred Network.enable to a separate method the crawler
 * never called, meaning a single
 * closed/rejected session would cause the entire enable step to throw, leaving
 * the page session without Network.enable and producing an empty HAR.
 *
 * Fix: Network.enable is now called directly inside addTarget(), which the
 * crawler awaits before releasing the target. This guarantees every session is
 * instrumented before it can emit its first network event, and a dead session
 * only affects itself — it cannot block other sessions.
 */

const chalk = require('chalk');

const BaseCollector = require('./BaseCollector');
const chromeHar = require('chrome-har');

const { OBSERVED_EVENTS, NETWORK_TARGET_TYPES } = require('../helpers/harHelpers/harEvents');
const { registerBodyFetching, drainPendingFetches, stitchResponseBodies } = require('../helpers/harHelpers/harResponseBody');
const { enrichPostDataParams, enrichInitiator } = require('../helpers/harHelpers/harEnrich');

// Purple log prefix — distinct from the green/yellow/red used by other collectors
const HAR = chalk.magenta('[har]');

// ── Typedefs ──────────────────────────────────────────────────────────────────

/**
 * @typedef {object} HARData
 * @property {{ version: string, creator: object, browser?: object, pages: HARPage[], entries: HAREntry[] }} log
 */

/**
 * @typedef {object} HARPage
 * @property {string} startedDateTime
 * @property {string} id
 * @property {string} title
 * @property {{ send: number, receive: number, wait: number, onContentLoad: number, onLoad: number, _transferSize: number }} pageTimings
 */

/**
 * @typedef {object} HAREntry
 * @property {string}  startedDateTime
 * @property {number}  time
 * @property {object}  request
 * @property {object}  response
 * @property {object}  cache
 * @property {object}  timings
 * @property {string=} serverIPAddress
 * @property {string=} connection
 * @property {string=} pageref
 * @property {string=} _requestId - Non-standard chrome-har extension; used to stitch bodies
 */

// ── Collector ─────────────────────────────────────────────────────────────────

class HarCollector extends BaseCollector {
    /** @returns {string} */
    id() {
        return 'har';
    }

    /**
     * Allocate fresh per-URL state.
     *
     * Called by the crawler before any target is attached for a new URL.
     * Safe to call multiple times across URLs within the same worker process.
     *
     * @returns {void}
     */
    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options
     */
    init({ log }) {
        /**
         * Ordered log of CDP events from all sessions, merged into one array.
         * chrome-har replays this to reconstruct the HAR.
         * Node.js single-threaded event loop guarantees safe concurrent pushes.
         *
         * @type {Array<{method: string, params: object}>}
         */
        this._events = [];

        /**
         * Fetched response bodies keyed by CDP requestId.
         * Populated by harResponseBody.registerBodyFetching().
         * CDP guarantees requestId uniqueness across all targets in a context,
         * so a single flat map is safe even when merging multiple sessions.
         *
         * @type {Map<string, import('../helpers/harHelpers/harResponseBody').StoredResponseBody>}
         */
        this._responseBodies = new Map();

        /**
         * In-flight getResponseBody Promises.
         * Drained by harResponseBody.drainPendingFetches() in getData().
         *
         * @type {Set<Promise<void>>}
         */
        this._pendingFetches = new Set();

        /**
         * All CDP sessions instrumented for this URL.
         * One entry per addTarget() call that passes the NETWORK_TARGET_TYPES filter.
         *
         * @type {Set<import('puppeteer-core').CDPSession>}
         */
        this._sessions = new Set();

        /**
         * The top-level page session.
         * The only session that supports Page.enable and Browser.getVersion.
         *
         * @type {import('puppeteer-core').CDPSession | null}
         */
        this._pageSession = null;

        /**
         * Chrome version info fetched in addTarget() for the page session.
         * Injected into har.log.browser in getData().
         * chrome-har populates har.log.creator (the library) but never
         * har.log.browser (the actual Chrome binary).
         *
         * @type {{ name: string, version: string, comment: string } | null}
         */
        this._browserVersion = null;

        /**
         * Crawler-provided log function for CLI output.
         * Received via init() options, same pattern as all BaseCollector subclasses.
         *
         * @type {((...args: any[]) => void) | null}
         */
        this._log = log;
    }

    /**
     * Attach CDP event listeners to a new target's session and immediately
     * enable Network instrumentation on it.
     *
     * Called by the crawler for every target it attaches — page, iframe, worker,
     * service_worker, etc. — for both early targets (before navigation) and
     * late targets (service workers that register mid-navigation, JS-created iframes).
     * Because the crawler has no separate "enable domains" phase, everything must
     * happen here, synchronously for listeners and async for CDP commands.
     *
     * ## Why addTarget is async
     *
     * The crawler awaits each collector's addTarget() call before resuming
     * (see _onTargetAttached). Making it async lets us call Network.enable
     * before `Runtime.runIfWaitingForDebugger` releases the target — ensuring
     * we capture every request from the very first one.
     *
     * ## Duplicate session guard
     *
     * Chrome sometimes attaches the same logical target twice with two different
     * sessions (e.g. an already-registered service worker). The crawler logs
     * "Target already exists: old session X, new Y" and keeps only the second.
     * The first session's connection() returns null once detached — we detect
     * and skip it here so a dead session cannot cause Network.enable to throw.
     *
     * ## Page.enable
     *
     * The crawler already calls Page.enable on page targets in _onTargetAttached
     * before collector.addTarget() is invoked. We do NOT call it again here to
     * avoid duplicate domain enables which can cause CDP errors.
     *
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo} targetInfo
     * @returns {Promise<void>}
     */
    async addTarget(session, targetInfo) {
        if (targetInfo.type === 'page') {
            // Keep a dedicated reference — needed for Browser.getVersion in getData()
            this._pageSession = session;
        }

        if (!NETWORK_TARGET_TYPES.has(targetInfo.type)) {
            return; // Target type cannot originate network requests — skip
        }

        // Skip sessions that are already detached before we even start.
        // CDPSession.connection() returns null once the session is closed.
        if (session.connection && session.connection() === null) {
            this._log?.(HAR, chalk.magenta(`skipping already-closed session for ${targetInfo.type} ${targetInfo.url}`));
            return;
        }

        this._sessions.add(session);
        this._log?.(HAR, chalk.magenta(`attached session for ${targetInfo.type} ${targetInfo.url || '(no url)'}`));

        // Register all chrome-har CDP event listeners synchronously before
        // enabling the domain — no events can be missed this way.
        for (const method of OBSERVED_EVENTS) {
            session.on(method, (params) => {
                this._events.push({ method, params });
            });
        }

        // Register the body-fetch listener for this session.
        // Must use this session (not _pageSession) — bodies are only accessible
        // via the session that received the loadingFinished event.
        registerBodyFetching(session, this._responseBodies, this._pendingFetches);

        // Enable Network domain on this session immediately.
        // Because the crawler awaits addTarget(), this runs before
        // Runtime.runIfWaitingForDebugger releases the target, guaranteeing
        // we capture requests from the very first network activity.
        try {
            await session.send('Network.enable', {
                maxTotalBufferSize: 100_000_000, // 100 MB total — covers asset-heavy SPAs
                maxResourceBufferSize: 10_000_000, //  10 MB per resource — covers most payloads
            });
            this._log?.(HAR, chalk.magenta(`Network.enable OK for ${targetInfo.type}`));
        } catch (err) {
            // Non-fatal: session may have closed in the gap between the connection
            // check above and the send() call. Events already registered will still
            // fire if the session recovers; if not, we simply get no events from it.
            this._log?.(HAR, chalk.magenta(`Network.enable failed for ${targetInfo.type}: ${err.message}`));
        }

        // Fetch browser version once from the page session for har.log.browser.
        // Done here (not in getData) so it happens during setup time.
        // Browser.getVersion is browser-scoped — only the page session supports it.
        if (targetInfo.type === 'page') {
            try {
                const { product, userAgent } = await session.send('Browser.getVersion');
                const slashIdx = product.indexOf('/');
                this._browserVersion = {
                    name: slashIdx !== -1 ? product.slice(0, slashIdx) : product,
                    version: slashIdx !== -1 ? product.slice(slashIdx + 1) : '',
                    comment: userAgent || '',
                };
                this._log?.(HAR, chalk.magenta(`browser: ${this._browserVersion.name} ${this._browserVersion.version}`));
            } catch (err) {
                this._log?.(HAR, chalk.magenta(`Browser.getVersion failed: ${err.message}`));
            }
        }
    }

    /**
     * Build and return the complete HAR archive.
     *
     * Steps:
     *  1. Drain in-flight body fetches
     *  2. Flush Chrome's event buffers via Network.disable
     *  3. Build the HAR from the merged CDP event log
     *  4. Stitch pre-fetched response bodies into entries
     *  5. Inject har.log.browser
     *  6. Parse postData.params for form-encoded request bodies
     *  7. Normalise _initiator from escaped string to structured object
     *
     * @returns {Promise<HARData|null>} The HAR archive, or null if no page session was set up.
     */
    async getData() {
        if (!this._pageSession) {
            this._log?.(HAR, chalk.magenta('no page session — returning null'));
            return null;
        }

        // ── 1. Drain in-flight body fetches ───────────────────────────────────
        const pendingCount = this._pendingFetches.size;
        if (pendingCount > 0) {
            this._log?.(HAR, chalk.magenta(`waiting for ${pendingCount} pending body fetch(es)…`));
        }
        await drainPendingFetches(this._pendingFetches);

        // ── 2. Flush Chrome's internal event buffers ──────────────────────────
        // Network.disable causes Chrome to deliver any buffered events before
        // acknowledging the command, preventing a race where the last few
        // loadingFinished events haven't arrived when we call harFromMessages.
        // Errors are swallowed — a closed session already delivered all its events.
        await Promise.allSettled([...this._sessions].map((s) => s.send('Network.disable').catch(() => {})));

        // ── 3. Build the HAR from the merged event log ────────────────────────
        // requestIds are unique across all targets in a browser context (Chrome
        // guarantee), so merging events from multiple sessions is safe.
        this._log?.(HAR, chalk.magenta(`building HAR from ${this._events.length} CDP event(s)…`));

        const har = chromeHar.harFromMessages(this._events, {
            includeTextFromResponseBody: true,
            includeResourcesFromDiskCache: true,
        });

        // ── 4. Stitch response bodies into entries ────────────────────────────
        stitchResponseBodies(har.log.entries, this._responseBodies);

        // ── 5. Inject har.log.browser ─────────────────────────────────────────
        // chrome-har sets har.log.creator (the library) but never har.log.browser
        // (the Chrome binary). HAR 1.2 treats them as distinct optional fields.
        if (this._browserVersion) {
            har.log.browser = this._browserVersion;
        }

        // ── 6. Parse postData.params for form-encoded bodies ──────────────────
        // chrome-har always leaves postData.params as []. We decode it for
        // form submissions — the primary output of the emailFill collector.
        for (const entry of har.log.entries) {
            enrichPostDataParams(entry);
        }

        // ── 7. Normalise _initiator from escaped string to structured object ──
        // chrome-har stores the full initiator call stack as an escaped JSON
        // string in _initiator_detail rather than a structured object. We parse
        // it back so the call chain is queryable without a double-parse step.
        for (const entry of har.log.entries) {
            enrichInitiator(entry);
        }

        this._log?.(
            HAR,
            chalk.magenta(
                `done — ${har.log.entries.length} entries, ` +
                    `${this._responseBodies.size} bodies captured, ` +
                    `${har.log.pages.length} page(s)`,
            ),
        );

        return har;
    }
}

module.exports = HarCollector;
