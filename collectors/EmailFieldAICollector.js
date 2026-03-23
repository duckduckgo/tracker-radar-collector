/* Adapted from leaky forms emailPasswordField collector
*  https://github.com/leaky-forms/leaky-forms-crawler
*/

/* eslint-disable no-await-in-loop */
/* eslint-disable max-lines */
const BaseCollector = require('./BaseCollector');
const path = require('path');
const fs = require('fs');
const fathomSrc = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'emailAIHelpers', 'browserJS', 'fathomDetect.js'), 'utf8');
const pageUtils = require('../helpers/emailAIHelpers/utils.js');
const tldts = require('tldts');

const NATIVE_CLICK = 'native';
const EVENT_BASED_CLICK = 'event-based';
const CLICK_METHODS = [NATIVE_CLICK, EVENT_BASED_CLICK];
const MAX_RELOAD_TIME = 30000;
const POST_CLICK_LOAD_TIMEOUT = 2500;
const POST_HOMEPAGE_RELOAD_WAIT = 1000;

const SKIP_EXTERNAL_LINKS = true;
const ALWAYS_RELOAD_BEFORE_CLICKING = true;
const NUM_LOGIN_REGISTER_LINKS_TO_CLICK = 10;

class EmailPasswordFieldsCollector extends BaseCollector {

    id() {
        return 'emailFieldAI';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options
     */
    init({log, url, browserConnection}) {
        this._log = log;
        this._url = url;
        this._browserConnection = browserConnection;
        this._siteDomain = tldts.getDomain(url.toString());

        /** @type {object|null} */
        this._mainSession = null;

        /** @type {Map<string, {session: object, targetInfo: object}>} */
        this._allSessions = new Map();

        this._clickCounter = 0;
        this._numOfPasswordFields = 0;
        this._numOfEmailFields = 0;
        this._lastClickedXPath = null;

        /** @type {string[]} */
        this._visitedHrefs = [];

        /** @type {EmailPasswordFieldsUrlBased[]} */
        this._emailPasswordFields = [];
    }

    /**
     * Inject fathom into every page/iframe target and store its session.
     *
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo} targetInfo
     * @returns {Promise<void>}
     */
    async addTarget(session, targetInfo) {
        if (targetInfo.type !== 'page' && targetInfo.type !== 'iframe') {
            return;
        }

        // Inject fathom so it's available before any page script runs
        try {
            await session.send('Page.addScriptToEvaluateOnNewDocument', {
                source: fathomSrc
            });
        } catch (e) {
            // iframes don't support Page domain — expected, ignore
        }

        // Also inject immediately for pages that are already loaded
        try {
            await session.send('Runtime.evaluate', {
                expression: fathomSrc,
                returnByValue: false,
            });
        } catch (e) {
            this._log(`Failed to inject fathom into ${targetInfo.type} ${targetInfo.url}: ${e.message}`);
        }

        // Keep the first page session as main for navigation
        if (targetInfo.type === 'page' && !this._mainSession) {
            this._mainSession = session;
        }

        this._allSessions.set(targetInfo.targetId, {session, targetInfo});
        this._log(`Stored session for ${targetInfo.type}: ${targetInfo.url}`);
    }

    /**
     * @param {object} options
     * @param {string} options.finalUrl
     */
    async getData(options) {
        this._options = options;
        this.finalUrl = options.finalUrl;
        this._log(`EmailAndPasswordsCollector getData called for: ${this.finalUrl}`);

        if (!this._mainSession) {
            this._log(`No page session found, skipping emailFieldAI collection`);
            return {};
        }

        // Queue of pages to visit. Starts with the landing page.
        // Each entry is a { session, url } to scan, plus an optional linkToClick
        // that gets us there (undefined for the landing page itself).
        /** @type {{ session: object, url: string, linkToClick?: object }[]} */
        const queue = [{ session: this._mainSession, url: this.finalUrl }];
        let numClickedLinks = 0;
        const allLoginRegisterLinksAttrs = [];

        while (queue.length > 0 && numClickedLinks <= NUM_LOGIN_REGISTER_LINKS_TO_CLICK) {
            const { session, url, linkToClick } = queue.shift();
            this._log(`\n[Page ${numClickedLinks}] Processing: ${url}`);

            // ── If this is not the landing page, navigate there by clicking ──
            if (linkToClick) {
                this._log(`[Page ${numClickedLinks}] Clicking link: ${JSON.stringify(linkToClick)}`);
                const emailPasswordFields = await this.clickElementAndFindEmailPasswordFields(linkToClick);

                if (!emailPasswordFields) {
                    this._log(`[Page ${numClickedLinks}] ✗ Click returned nothing (failed or off-domain), skipping`);
                    continue;
                }

                const { emailFields, passwordFields, location } = emailPasswordFields;
                this._log(`[Page ${numClickedLinks}] Scan after click on ${location}: ${emailFields.length} email / ${passwordFields.length} password field(s)`);

                if (emailFields.length || passwordFields.length) {
                    this._log(`[Page ${numClickedLinks}] ✓ Fields found — adding to results`);
                    this._emailPasswordFields.push(emailPasswordFields);
                } else {
                    this._log(`[Page ${numClickedLinks}] ✗ No fields found on ${location}`);
                }

                // After clicking, the main session is now on the new page — use it for link discovery
                const currentSession = this._mainSession;
                const currentUrl = await this._getCurrentUrl();

                this._log(`[Page ${numClickedLinks}] Scanning ${currentUrl} for login/register links...`);
                const links = await pageUtils.getLoginLinkAttrs(currentSession, this._log);
                this._log(`[Page ${numClickedLinks}] Found ${links.length} link(s): ${JSON.stringify(links)}`);

                for (const link of links) {
                    if (!allLoginRegisterLinksAttrs.some(l => l.href === link.href)) {
                        allLoginRegisterLinksAttrs.push(link);
                    }
                    if (this._shouldSkipLink(link, numClickedLinks)) {continue;}
                    this._markVisited(link);
                    if (numClickedLinks < NUM_LOGIN_REGISTER_LINKS_TO_CLICK) {
                        queue.push({ session: currentSession, url: link.href, linkToClick: link });
                    }
                }

            } else {
                // ── Landing page: scan + collect links ───────────────────────
                this._log(`[Page ${numClickedLinks}] Scanning landing page for email/password fields...`);
                const landingPageFields = await this.findEmailPasswordFieldsInSession(session, url);

                if (landingPageFields && (landingPageFields.emailFields.length || landingPageFields.passwordFields.length)) {
                    this._log(`[Page ${numClickedLinks}] ✓ Found ${landingPageFields.emailFields.length} email / ${landingPageFields.passwordFields.length} password field(s) on landing page`);
                    this._emailPasswordFields.push(landingPageFields);
                } else {
                    this._log(`[Page ${numClickedLinks}] No email/password fields on landing page`);
                }

                this._log(`[Page ${numClickedLinks}] Scanning landing page for login/register links...`);
                const links = await pageUtils.getLoginLinkAttrs(session, this._log);
                const matchTypeCounts = links.reduce(
                    (acc, link) => acc.set(link.matchType, (acc.get(link.matchType) || 0) + 1),
                    new Map()
                );
                this._log(`[Page ${numClickedLinks}] Found ${links.length} link(s). Match types: ${JSON.stringify([...matchTypeCounts])}`);
                this._log(`[Page ${numClickedLinks}] Links: ${JSON.stringify(links)}`);

                for (const link of links) {
                    allLoginRegisterLinksAttrs.push(link);
                    if (this._shouldSkipLink(link, numClickedLinks)) {continue;}
                    this._markVisited(link);
                    queue.push({ session, url: link.href, linkToClick: link });
                }
            }

            numClickedLinks++;
        }

        this._log(`\n[Done] Visited ${numClickedLinks} page(s). Results: ${this._emailPasswordFields.length} page(s) with fields.`);

        return {
            finalEmailPasswordFields: this.removeHandles(this._emailPasswordFields),
            numEmailFields: this._numOfEmailFields,
            numPasswordFields: this._numOfPasswordFields,
            numLoginLinks: allLoginRegisterLinksAttrs.length,
            loginRegisterLinksDetails: JSON.stringify(allLoginRegisterLinksAttrs)
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CDP HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Run an expression in a CDP session and return the result value.
     * Equivalent to puppeteer's page.evaluate() but works on raw CDP sessions.
     *
     * @param {object} session
     * @param {string} expression
     * @returns {Promise<any>}
     */
    async _evaluateInSession(session, expression) {
        try {
            const res = await session.send('Runtime.evaluate', {
                expression,
                returnByValue: true,
                userGesture: false,
            });
            if (res?.exceptionDetails) {
                this._log(`evaluate exception: ${res.exceptionDetails.text}`);
                return undefined;
            }
            return res?.result?.value;
        } catch (err) {
            this._log(`CDP evaluate threw: ${err.message}`);
            return undefined;
        }
    }

    /**
     * Get the current URL of the main session.
     * @returns {Promise<string>}
     */
    async _getCurrentUrl() {
        return await this._evaluateInSession(this._mainSession, 'window.location.href') || '';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // NAVIGATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Navigate the main session back to the landing page.
     */
    async goToLandingPage() {
        const currentUrl = await this._getCurrentUrl();
        this._log(`Going back to landing page. Current: ${currentUrl}, Target: ${this.finalUrl}`);

        if (ALWAYS_RELOAD_BEFORE_CLICKING || currentUrl !== this.finalUrl) {
            try {
                await this._mainSession.send('Page.navigate', {url: this.finalUrl});
                await this.waitForPageLoad(MAX_RELOAD_TIME);
                await new Promise(resolve => setTimeout(resolve, POST_HOMEPAGE_RELOAD_WAIT));
                this._log(`Navigated to ${await this._getCurrentUrl()}`);
            } catch (error) {
                this._log(`Error navigating to landing page: ${pageUtils.removeNewLineChar(error.message)}`);
            }
        }
    }

    /**
     * Wait for the page to reach document.readyState === 'complete'.
     * Falls back gracefully on timeout.
     *
     * @param {number} timeoutMs
     */
    async waitForPageLoad(timeoutMs = POST_CLICK_LOAD_TIMEOUT) {
        const maxWait = Math.max(timeoutMs, POST_CLICK_LOAD_TIMEOUT);
        const pollInterval = 200;
        const start = Date.now();

        while (Date.now() - start < maxWait) {
            const readyState = await this._evaluateInSession(this._mainSession, 'document.readyState');
            if (readyState === 'complete') {break;}
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Give the page a little extra time to settle after load
        await new Promise(resolve => setTimeout(resolve, POST_CLICK_LOAD_TIMEOUT));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLICKING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Click an element identified by xpath using one of two methods.
     * Returns true if the click was dispatched without error.
     *
     * @param {string} xpath
     * @param {object} loginRegisterLinkAttrs
     * @param {string} method
     * @returns {Promise<boolean>}
     */
    async click(xpath, loginRegisterLinkAttrs, method = NATIVE_CLICK) {
        const currentUrl = await this._getCurrentUrl();
        this._log(`Clicking via ${method} on ${currentUrl}: ${JSON.stringify(loginRegisterLinkAttrs)}`);
        this._clickCounter++;
        this._lastClickedXPath = xpath;

        const clickExpression = method === NATIVE_CLICK
            ? `(function() {
                const result = document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const el = result.singleNodeValue;
                if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
                return false;
               })()`
            : `(function() {
                const result = document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const el = result.singleNodeValue;
                if (el) { el.dispatchEvent(new MouseEvent('click')); return true; }
                return false;
               })()`;

        try {
            const clicked = await this._evaluateInSession(this._mainSession, clickExpression);
            if (!clicked) {
                this._log(`Element not found for xpath: ${xpath}`);
                return false;
            }
        } catch (error) {
            this._log(`Error during ${method} click: ${pageUtils.removeNewLineChar(error.message)}`);
            return false;
        }
        return true;
    }

    /**
     * Navigate to the landing page, click a login/register link, wait for
     * navigation, then scan the resulting page for email/password fields.
     *
     * Tries native click first, then falls back to event-based click if the
     * page didn't navigate and no fields were found.
     *
     * @param {object} loginRegisterLinkAttrs
     * @returns {Promise<EmailPasswordFieldsUrlBased|undefined>}
     */
    async clickElementAndFindEmailPasswordFields(loginRegisterLinkAttrs) {
        let emailPasswordFields;

        for (const method of CLICK_METHODS) {
            await this.goToLandingPage();

            const preClickUrl = await this._getCurrentUrl();
            const clickOk = await this.click(loginRegisterLinkAttrs.xpath, loginRegisterLinkAttrs, method);

            if (!clickOk) {continue;}

            await this.waitForPageLoad(POST_CLICK_LOAD_TIMEOUT);

            // Scan whichever session is now "last" — could be a new tab or the main page
            emailPasswordFields = await this.findEmailPasswordFieldsOnLastSession();

            const foundFields = emailPasswordFields &&
                (emailPasswordFields.emailFields.length || emailPasswordFields.passwordFields.length);

            if (foundFields) {
                return emailPasswordFields;
            }

            const postClickUrl = await this._getCurrentUrl();
            if (postClickUrl !== preClickUrl) {
                // Navigation happened but no fields found — no point retrying with event-based
                this._log(`Navigation occurred (${preClickUrl} → ${postClickUrl}) but no fields found. Skipping fallback click.`);
                return emailPasswordFields;
            }

            // No navigation and no fields — fall through to try the next click method
        }

        return emailPasswordFields;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCANNING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * After a click, scan whichever session is "last" — either a newly opened
     * tab (last added to _allSessions) or the main session if no new tab opened.
     *
     * @returns {Promise<EmailPasswordFieldsUrlBased|undefined>}
     */
    async findEmailPasswordFieldsOnLastSession() {
        const sessions = [...this._allSessions.values()];
        const last = sessions[sessions.length - 1];

        if (!last) {return undefined;}

        // If a new tab was opened, inject fathom into it first
        if (last.session !== this._mainSession) {
            this._log(`New tab detected at ${last.targetInfo.url}, injecting fathom`);
            try {
                await last.session.send('Runtime.evaluate', {
                    expression: fathomSrc,
                    returnByValue: false,
                });
            } catch (e) {
                this._log(`Failed to inject fathom into new tab: ${e.message}`);
            }
        }

        return this.findEmailPasswordFieldsInSession(last.session, last.targetInfo.url);
    }

    /**
     * Scan a single CDP session for email and password fields using fathom.
     *
     * @param {object} session
     * @param {string} pageUrl
     * @returns {Promise<EmailPasswordFieldsUrlBased|undefined>}
     */
    async findEmailPasswordFieldsInSession(session, pageUrl) {
        if (SKIP_EXTERNAL_LINKS && tldts.getDomain(pageUrl) !== this._siteDomain) {
            this._log(`Off-domain, skipping: ${pageUrl}`);
            return undefined;
        }

        this._log(`Scanning for email/password fields on: ${pageUrl}`);

        try {
            const emailFieldsFromFathom = await this._evaluateInSession(
                session,
                `(function() {
                    try { return [...fathom.detectEmailInputs(document)]; }
                    catch(e) { return []; }
                })()`
            ) || [];

            const passwordFieldXPaths = await this._evaluateInSession(
                session,
                `(function() {
                    try {
                        return [...document.querySelectorAll(
                            'input[type=password]:not([disabled]):not([aria-hidden="true"])'
                        )].map(el => fathom.getXPath(el));
                    } catch(e) { return []; }
                })()`
            ) || [];

            const emailFields = emailFieldsFromFathom.map(f => ({xpath: f.xpath, score: f.score}));
            const passwordFields = passwordFieldXPaths.map(xpath => ({xpath}));

            this._log(`Found ${emailFields.length} email field(s) and ${passwordFields.length} password field(s) on ${pageUrl}`);
            this._numOfEmailFields += emailFields.length;
            this._numOfPasswordFields += passwordFields.length;

            return {
                location: pageUrl,
                emailFields,
                passwordFields,
                clickedElementXPath: this._lastClickedXPath,
            };

        } catch (error) {
            this._log(`Error scanning ${pageUrl}: ${pageUtils.removeNewLineChar(error.message)}`);
        }

        return undefined;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Returns true if the link should be skipped (already visited or external).
     * @param {object} link
     * @param {number} pageNum - for logging
     * @returns {boolean}
     */
    _shouldSkipLink(link, pageNum) {
        if (this._visitedHrefs.includes(link.href)) {
            this._log(`[Page ${pageNum}] Skipping already-visited: ${link.href}`);
            return true;
        }
        if (SKIP_EXTERNAL_LINKS && link.href !== undefined) {
            try {
                const linkDomain = tldts.getDomain(link.href);
                if (linkDomain && linkDomain !== this._siteDomain) {
                    this._log(`[Page ${pageNum}] Skipping external: ${link.href}`);
                    return true;
                }
            } catch (e) {
                this._log(`[Page ${pageNum}] Error parsing domain for ${link.href}: ${e.message}`);
            }
        }
        return false;
    }

    /**
     * Mark a link's href as visited so we don't follow it twice.
     * @param {object} link
     */
    _markVisited(link) {
        if (!link.href) {return;}
        try {
            const protocol = new URL(link.href).protocol;
            if (protocol === 'http:' || protocol === 'https:') {
                this._visitedHrefs.push(link.href);
            }
        } catch (e) {
            // not a full URL (e.g. relative or javascript:) — skip
        }
    }

    /**
     * Remove circular ElementHandle references before JSON serialization.
     *
     * @param {EmailPasswordFieldsUrlBased[]} emailPasswordFields
     */
    removeHandles(emailPasswordFields) {
        for (const emailPasswordField of emailPasswordFields) {
            for (const emailField of emailPasswordField.emailFields) {
                Reflect.deleteProperty(emailField, 'elHandle');
            }
            for (const passwordField of emailPasswordField.passwordFields) {
                Reflect.deleteProperty(passwordField, 'elHandle');
            }
        }
        return emailPasswordFields;
    }
}

module.exports = EmailPasswordFieldsCollector;

/**
 * @typedef EmailPasswordFieldsUrlBased
 * @property {string} location
 * @property {object[]} passwordFields
 * @property {object[]} emailFields
 * @property {string} clickedElementXPath
 */

/**
 * @typedef Options
 * @property {string} finalUrl
 * @property {function(string):boolean} urlFilter
 */