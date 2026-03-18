'use strict';

/**
 * @file emailFieldHeuristicCollector.js
 *
 * EmailFieldHeuristicCollector — BaseCollector that scans every reachable page for
 * email-input fields and classifies each form by its likely purpose.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ROLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   • Visits the landing page and navigates candidate sub-pages (up to
 *     MAX_CANDIDATE_LINKS links discovered per page).
 *   • In each page / non-noise iframe it runs the browser-side scanner
 *     (emailFieldScanner.js) via CDP Runtime.evaluate.
 *   • Each discovered form is classified (emailFieldConstants.js scoring).
 *   • No typing, clicking, or form submission ever occurs.
 *   • No event bus required.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEPENDENCIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   ./BaseCollector
 *   ../helpers/emailHeuristicHelpers/emailFieldConstants  — all tuneable values
 *   ../helpers/emailHeuristicHelpers/primitiveJS/emailFieldScanner.js
 *   ../helpers/emailHeuristicHelpers/primitiveJS/emailLinkDiscovery.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BASECOLLECTER LIFECYCLE IMPLEMENTED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   id()        → 'emailFieldHeuristic'
 *   init()      → reset state for the current URL
 *   addTarget() → capture main CDPSession + non-noise iframe sessions
 *   postLoad()  → full scan: landing page + sub-pages + iframes
 *   getData()   → return result object
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RESULT SCHEMA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  postLoad() accumulates:
 *  {
 *    visitedUrls : string[]             — all URLs scanned (landing + sub-pages)
 *    rawForms    : RawFormDescriptor[]  — unclassified, as returned by the scanner
 *    error       : string|null
 *  }
 *
 *  getData() returns:
 *  {
 *    visitedUrls : string[]
 *    forms       : EmailFormRecord[]    — classified, one entry per raw descriptor
 *    error       : string|null
 *  }
 *
 *  EmailFormRecord {
 *    url            : string          — page where the form was found
 *    frame          : 'main'|'iframe'
 *    iframeUrl      : string|null     — populated when frame === 'iframe'
 *    formIndex      : number          — index in document.forms; -1 = orphan
 *    classification : string          — see FORM_CLASS below
 *    confidence     : 'high'|'medium'|'low'
 *    signals        : string[]        — human-readable classification reasons
 *    emailFields    : EmailFieldMeta[]
 *  }
 */

const fs = require('fs');
const path = require('path');
const BaseCollector = require('./BaseCollector');
const chalk = require('chalk');
const {
    MAX_CANDIDATE_LINKS,
    POST_NAVIGATE_DELAY,
    IFRAME_NOISE,
    SCORE,
    HIGH_CONFIDENCE_GAP,
    MED_CONFIDENCE_GAP,
} = require('../helpers/emailHeuristicHelpers/emailFieldConstants');

// ── Browser-side scripts loaded from disk ────────────────────────────────────
const HELPERS_DIR = path.join(__dirname, '../helpers/emailHeuristicHelpers');
const EMAIL_FIELD_SCANNER = fs.readFileSync(path.join(HELPERS_DIR, 'primitiveJS/emailFieldScanner.js'), 'utf8');
const LINK_DISCOVERY_SRC = fs.readFileSync(path.join(HELPERS_DIR, 'primitiveJS/emailLinkDiscovery.js'), 'utf8');

// ── Chalk styles ─────────────────────────────────────────────────────────────
const C = {
    bold: chalk.cyan.bold,
    plain: chalk.cyan,
    dim: chalk.cyan.dim,
};

// ── Form classification enum ──────────────────────────────────────────────────
const FORM_CLASS = Object.freeze({
    SUBSCRIPTION: 'subscription', // newsletter / waitlist / marketing opt-in
    LOGIN: 'login', // sign-in with existing credentials
    CREATE_ACCOUNT: 'create_account', // registration / sign-up
    PASSWORD_RESET: 'password_reset', // forgot-password flow
    CONTACT: 'contact', // contact-us / support
    CHECKOUT: 'checkout', // e-commerce checkout with email field
    UNKNOWN: 'unknown',
});

// =============================================================================
// COLLECTOR
// =============================================================================

class EmailFieldHeuristicCollector extends BaseCollector {
    // ═══════════════════════════════════════════════════════════════════════════
    // 1. LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════════

    id() {
        return 'emailFieldHeuristic';
    }

    /**
     * @param {{ browserConnection: object, url: URL, log: Function }} options
     */
    init({ browserConnection, url, log }) {
        this._browserConnection = browserConnection;
        this._url = url;
        this._rawLog = log;

        /** @type {object|null} */
        this._mainSession = null;

        /** Non-noise iframe sessions, keyed by iframe URL. */
        this._iframeSessions = new Map();

        this._result = {
            visitedUrls: [],
            rawForms: [], // populated by postLoad(); classified in getData()
            error: null,
        };
    }

    /**
     * Capture the main CDPSession and any non-noise iframe sessions.
     *
     * @param {object} session
     * @param {{ type: string, url?: string }} targetInfo
     */
    async addTarget(session, targetInfo) {
        if (targetInfo.type === 'page' && !this._mainSession) {
            this._mainSession = session;
            return;
        }

        if (targetInfo.type === 'iframe') {
            const url = targetInfo.url || '';
            if (IFRAME_NOISE.some((noise) => url.includes(noise))) return;
            this._iframeSessions.set(url, session);
            this._log(C.dim(`iframe session stored: ${url}`));
        }
    }

    /**
     * Main scan entry point, called after network-idle.
     *
     * BFS crawl: scan the current page, collect new candidate links, enqueue
     * them, then repeat for each queued link — until the queue is empty or
     * MAX_CANDIDATE_LINKS total sub-pages have been visited.
     *
     * Landing page (depth 0) is always scanned and does not count toward the
     * MAX_CANDIDATE_LINKS budget.
     */
    async postLoad() {
        if (!this._mainSession) return;

        this._log(C.bold('── postLoad() starting ──'), C.dim(this._url.href));

        try {
            // visited tracks every URL we have navigated to, so we never
            // enqueue the same link twice regardless of which page linked to it.
            const visited = new Set([this._url.href]);

            // queue holds URLs discovered but not yet visited.
            const queue = [];

            // ── Scan landing page and seed the queue ─────────────────────────
            await this._scanAllFrames(this._url.href);

            const seedLinks = await this._findCandidateLinks();
            this._log(C.plain(`Landing page: ${seedLinks.length} candidate link(s) found`));

            for (const link of seedLinks) {
                if (!visited.has(link)) queue.push(link);
            }

            // ── BFS over queued links ─────────────────────────────────────────
            let subPagesVisited = 0;

            while (queue.length > 0 && subPagesVisited < MAX_CANDIDATE_LINKS) {
                const link = queue.shift();

                if (visited.has(link)) continue;
                visited.add(link);
                subPagesVisited++;

                this._log(C.plain(`Navigating [${subPagesVisited}/${MAX_CANDIDATE_LINKS}] →`), C.dim(link));

                await this._mainSession.send('Page.navigate', { url: link });
                await this._sleep(POST_NAVIGATE_DELAY);
                await this._scanAllFrames(link);

                // Discover new links from this page and add unseen ones to queue.
                const newLinks = await this._findCandidateLinks();
                let newCount = 0;

                for (const newLink of newLinks) {
                    if (!visited.has(newLink) && !queue.includes(newLink)) {
                        queue.push(newLink);
                        newCount++;
                    }
                }

                if (newCount > 0) {
                    this._log(C.dim(`  └─ ${newCount} new link(s) added to queue (queue size: ${queue.length})`));
                }
            }

            if (queue.length > 0) {
                this._log(C.dim(`Stopped: limit of ${MAX_CANDIDATE_LINKS} sub-pages reached (${queue.length} link(s) left in queue)`));
            }

            this._log(
                C.bold('── complete ──'),
                C.dim(
                    `${this._result.rawForms.length} raw form(s) across ${this._result.visitedUrls.length} URL(s) — classification deferred to getData()`,
                ),
            );
        } catch (err) {
            this._log(C.plain('Unhandled error in postLoad():'), C.dim(err.message));
            this._result.error = err.message;
        }
    }

    getData() {
        const forms = this._result.rawForms.map((item) => {
            const { classification, confidence, signals } = classifyForm(item);
            this._log(C.plain(`  [${classification}]`), C.dim(`confidence:${confidence}  url:${item.url}  signals:${signals.join(', ')}`));
            return {
                url: item.url,
                frame: item.frame,
                iframeUrl: item.iframeUrl,
                formIndex: item.formIndex,
                classification,
                confidence,
                signals,
                emailFields: item.emailFields,
            };
        });

        this._log(C.bold('── getData() complete ──'), C.dim(`${forms.length} form(s) classified`));

        return {
            visitedUrls: this._result.visitedUrls,
            forms,
            error: this._result.error,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. SCANNING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Scan the main frame and every stored iframe for the given page URL.
     *
     * @param {string} pageUrl
     */
    async _scanAllFrames(pageUrl) {
        this._result.visitedUrls.push(pageUrl);

        const mainForms = await this._scanSession(this._mainSession, pageUrl, 'main', null);
        this._result.rawForms.push(...mainForms);

        for (const [iframeUrl, iframeSession] of this._iframeSessions) {
            this._log(C.dim(`Scanning iframe: ${iframeUrl}`));
            const iframeForms = await this._scanSession(iframeSession, pageUrl, 'iframe', iframeUrl);
            this._result.rawForms.push(...iframeForms);
        }
    }

    /**
     * Evaluate the browser-side scanner in one CDPSession and return raw
     * form descriptors annotated with page/frame location.
     * Classification is deferred to getData().
     *
     * @param {object}          session
     * @param {string}          pageUrl
     * @param {'main'|'iframe'} frameType
     * @param {string|null}     iframeUrl
     * @returns {Promise<object[]>}
     */
    async _scanSession(session, pageUrl, frameType, iframeUrl) {
        const raw = await this._evaluateIn(session, EMAIL_FIELD_SCANNER, true);

        if (!Array.isArray(raw) || raw.length === 0) {
            this._log(C.dim(`No email fields in ${frameType} frame of ${pageUrl}`));
            return [];
        }

        this._log(C.plain(`${raw.length} email form(s) found in ${frameType} frame of ${pageUrl}`));

        // Attach location metadata to each raw descriptor so getData() has
        // everything it needs without access to the CDP session.
        return raw.map((item) => ({
            ...item,
            url: pageUrl,
            frame: frameType,
            iframeUrl,
        }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. LINK DISCOVERY
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Find same-origin links whose text or href matches the keywords hardcoded
     * in emailLinkDiscovery.js.
     *
     * @returns {Promise<string[]>}
     */
    async _findCandidateLinks() {
        const links = await this._evaluateIn(this._mainSession, LINK_DISCOVERY_SRC, false);
        return Array.isArray(links) ? links : [];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. CDP HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Evaluate a JS expression in the given CDPSession.
     * Returns undefined on any error so failures never crash the crawler.
     *
     * @param {object}  session
     * @param {string}  expression
     * @param {boolean} [awaitPromise=false]
     * @returns {Promise<any>}
     */
    async _evaluateIn(session, expression, awaitPromise = false) {
        try {
            const res = await session.send('Runtime.evaluate', {
                expression,
                awaitPromise,
                returnByValue: true,
                userGesture: false,
            });

            if (res?.exceptionDetails) {
                this._log(C.dim(`evaluate exception: ${res.exceptionDetails.text}`));
                return undefined;
            }

            return res?.result?.value;
        } catch (err) {
            this._log(C.dim(`CDP evaluate threw: ${err.message}`));
            return undefined;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    _log(...parts) {
        this._rawLog(`${C.bold('[emailFieldHeuristic]')} ${parts.join(' ')}`);
    }

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// =============================================================================
// CLASSIFIER  (Node context — never sent to the browser)
// =============================================================================

/**
 * Classify a raw form descriptor returned by emailFieldScanner.
 *
 * Uses a scoring approach: each matched signal adds points to a class bucket;
 * the highest-scoring bucket wins.  Confidence reflects the margin over second
 * place, using the gap thresholds from emailFieldConstants.
 *
 * @param {object} item  — RawFormDescriptor from emailFieldScanner
 * @returns {{ classification: string, confidence: string, signals: string[] }}
 */
function classifyForm(item) {
    const scores = Object.fromEntries(Object.values(FORM_CLASS).map((c) => [c, 0]));
    const signals = [];

    // Build a single text bag from all form metadata for keyword matching.
    const bag = [item.id, item.classes, item.action, ...(item.labels || []), ...(item.submitTexts || [])].join(' ').toLowerCase();

    const inputBag = (item.inputSummary || []).join(' ').toLowerCase();

    // ── Subscription ─────────────────────────────────────────────────────────
    for (const kw of [
        'newsletter',
        'subscribe',
        'subscription',
        'signup',
        'sign-up',
        'mailing',
        'alerts',
        'updates',
        'waitlist',
        'notify',
        'join our',
        'stay informed',
        'latest news',
        'opt.in',
        'opt in',
    ]) {
        if (bag.includes(kw)) {
            scores[FORM_CLASS.SUBSCRIPTION] += SCORE.KEYWORD_HIT;
            signals.push(`subscription:kw:"${kw}"`);
        }
    }
    if (item.emailFields.length === 1 && !item.hasPassword) {
        scores[FORM_CLASS.SUBSCRIPTION] += SCORE.SINGLE_EMAIL_NO_PW;
        signals.push('subscription:single-email-no-password');
    }

    // ── Login ─────────────────────────────────────────────────────────────────
    for (const kw of ['login', 'log in', 'log-in', 'sign in', 'signin', 'sign-in', 'my account', 'password', 'forgot', 'remember me']) {
        if (bag.includes(kw)) {
            scores[FORM_CLASS.LOGIN] += SCORE.KEYWORD_HIT;
            signals.push(`login:kw:"${kw}"`);
        }
    }
    if (item.hasPassword) {
        scores[FORM_CLASS.LOGIN] += SCORE.HAS_PASSWORD;
        signals.push('login:has-password-field');
    }

    // ── Create account ────────────────────────────────────────────────────────
    for (const kw of [
        'register',
        'registration',
        'create account',
        'create an account',
        'sign up',
        'new account',
        'join',
        'get started',
        'new user',
        'confirm password',
        'repeat password',
        'retype',
    ]) {
        if (bag.includes(kw)) {
            scores[FORM_CLASS.CREATE_ACCOUNT] += SCORE.KEYWORD_HIT;
            signals.push(`create_account:kw:"${kw}"`);
        }
    }
    const passwordCount = (inputBag.match(/password:/g) || []).length;
    if (passwordCount >= 2) {
        scores[FORM_CLASS.CREATE_ACCOUNT] += SCORE.TWO_PASSWORDS;
        scores[FORM_CLASS.LOGIN] = Math.max(0, scores[FORM_CLASS.LOGIN] - SCORE.TWO_PASSWORDS_LOGIN_PENALTY);
        signals.push('create_account:two-password-fields');
    }

    // ── Password reset ────────────────────────────────────────────────────────
    for (const kw of [
        'forgot password',
        'reset password',
        'forgot your password',
        'password reset',
        'recover',
        'send reset',
        'reset link',
    ]) {
        if (bag.includes(kw)) {
            scores[FORM_CLASS.PASSWORD_RESET] += SCORE.RESET_KEYWORD_HIT;
            signals.push(`password_reset:kw:"${kw}"`);
        }
    }

    // ── Contact ───────────────────────────────────────────────────────────────
    for (const kw of [
        'contact',
        'get in touch',
        'send message',
        'send us',
        'inquiry',
        'enquiry',
        'support',
        'feedback',
        'help',
        'message',
        'subject',
    ]) {
        if (bag.includes(kw)) {
            scores[FORM_CLASS.CONTACT] += SCORE.KEYWORD_HIT;
            signals.push(`contact:kw:"${kw}"`);
        }
    }
    if (inputBag.includes('textarea') || inputBag.includes('message') || inputBag.includes('subject')) {
        scores[FORM_CLASS.CONTACT] += SCORE.HAS_MESSAGE_FIELD;
        signals.push('contact:has-message-or-subject-field');
    }

    // ── Checkout ──────────────────────────────────────────────────────────────
    for (const kw of [
        'checkout',
        'check out',
        'billing',
        'payment',
        'order',
        'shipping',
        'cart',
        'purchase',
        'credit card',
        'card number',
    ]) {
        if (bag.includes(kw)) {
            scores[FORM_CLASS.CHECKOUT] += SCORE.CHECKOUT_KEYWORD_HIT;
            signals.push(`checkout:kw:"${kw}"`);
        }
    }
    if (inputBag.includes('card') || inputBag.includes('cvv') || inputBag.includes('expiry')) {
        scores[FORM_CLASS.CHECKOUT] += SCORE.HAS_PAYMENT_FIELDS;
        signals.push('checkout:has-payment-fields');
    }

    // ── Pick winner ───────────────────────────────────────────────────────────
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topClass, topScore] = sorted[0];
    const [, secondScore] = sorted[1] || ['', 0];
    const gap = topScore - secondScore;

    const classification = topScore === 0 ? FORM_CLASS.UNKNOWN : topClass;
    const confidence = topScore === 0 ? 'low' : gap >= HIGH_CONFIDENCE_GAP ? 'high' : gap >= MED_CONFIDENCE_GAP ? 'medium' : 'low';

    return { classification, confidence, signals };
}

module.exports = EmailFieldHeuristicCollector;

/**
 * @typedef EmailFieldMeta
 * @property {number}  index
 * @property {string}  name
 * @property {string}  id
 * @property {string}  placeholder
 * @property {string}  autocomplete
 * @property {boolean} visible
 */

/**
 * @typedef EmailFormRecord
 * @property {string}                url
 * @property {'main'|'iframe'}       frame
 * @property {string|null}           iframeUrl
 * @property {number}                formIndex
 * @property {string}                classification
 * @property {'high'|'medium'|'low'} confidence
 * @property {string[]}              signals
 * @property {EmailFieldMeta[]}      emailFields
 */

/**
 * @typedef EmailFieldHeuristicResult
 * @property {string[]}          visitedUrls
 * @property {EmailFormRecord[]} forms
 * @property {string|null}       error
 */
