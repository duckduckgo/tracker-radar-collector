/* Adapted from leaky forms emailPasswordField collector 
*  https://github.com/leaky-forms/leaky-forms-crawler
*/

/* eslint-disable no-await-in-loop */
/* eslint-disable max-lines */
const BaseCollector = require('./BaseCollector');
const path = require('path');
const fs = require('fs');
const fathomSrc = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'emailAIHelpers', 'fathomDetect.js'), 'utf8');
const pageUtils = require('../helpers/emailAIHelpers/utils.js');
const tldts = require('tldts');

const NATIVE_CLICK = 'native';
const EVENT_BASED_CLICK = 'event-based';
const CLICK_METHODS = [NATIVE_CLICK, EVENT_BASED_CLICK];
const MAX_RELOAD_TIME = 30000;
const POST_CLICK_LOAD_TIMEOUT = 2500;
const POST_HOMEPAGE_RELOAD_WAIT = 1000;

// constants that determine the email & password behavior
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

        // Store all sessions — getData() iterates these for scanning
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
        this._log(`EmailAndPasswordsCollector getData called`);

        if (!this._mainSession) {
            this._log(`No page session found, skipping emailFieldAI collection`);
            return {};
        }

        // ── 1. Scan landing page and all stored iframes ──────────────────────
        for (const {session, targetInfo} of this._allSessions.values()) {
            const emailPasswordFields = await this.findEmailPasswordFieldsInSession(
                session, targetInfo.url
            );
            if (emailPasswordFields && (emailPasswordFields.emailFields.length || emailPasswordFields.passwordFields.length)) {
                this._log(`Found email and(or) password field(s) on ${targetInfo.url}`);
                this._emailPasswordFields.push(emailPasswordFields);
            } else {
                this._log(`Cannot find email and(or) password field on ${targetInfo.url}`);
            }
        }

        // ── 2. Find login/register links on the landing page ─────────────────
        const loginRegisterLinksAttrs = await pageUtils.getLoginLinkAttrs(
            this._mainSession, this._log
        );
        const matchTypeCounts = loginRegisterLinksAttrs.reduce(
            (acc, link) => acc.set(link.matchType, (acc.get(link.matchType) || 0) + 1),
            new Map()
        );
        this._log(`Found ${loginRegisterLinksAttrs.length} login/register related links on the homepage. Match types: ${[...matchTypeCounts]}`);
        this._log(`Login/register links attributes: ${JSON.stringify(loginRegisterLinksAttrs)}`);

        // ── 3. Click each link and scan the resulting page ───────────────────
        let numClickedLinks = 0;

        for (const loginRegisterLinkAttrs of loginRegisterLinksAttrs) {
            if (numClickedLinks >= NUM_LOGIN_REGISTER_LINKS_TO_CLICK) {
                this._log(`Clicked ${numClickedLinks} (max) elements. Will skip remaining ` +
                    `${loginRegisterLinksAttrs.length - numClickedLinks} !`);
                break;
            }

            if (this._visitedHrefs.includes(loginRegisterLinkAttrs.href)) {
                this._log(`Already visited ${loginRegisterLinkAttrs.href}, will skip this link`);
                continue;
            }

            if (SKIP_EXTERNAL_LINKS && (loginRegisterLinkAttrs.href !== undefined)) {
                try {
                    const linkDomain = tldts.getDomain(loginRegisterLinkAttrs.href);
                    if (linkDomain && linkDomain !== this._siteDomain) {
                        this._log("External link; will skip", linkDomain, this._siteDomain, loginRegisterLinkAttrs.href);
                        continue;
                    }
                } catch (error) {
                    this._log("Error while getting link domain", loginRegisterLinkAttrs.href, pageUtils.removeNewLineChar(error.message));
                }
            }

            numClickedLinks++;
            const emailPasswordFields = await this.clickElementAndFindEmailPasswordFields(loginRegisterLinkAttrs);

            if (emailPasswordFields && loginRegisterLinkAttrs.href) {
                try {
                    const protocol = new URL(loginRegisterLinkAttrs.href).protocol;
                    if (protocol === 'http:' || protocol === 'https:') {
                        this._log('Adding link to the visited URLs: ', loginRegisterLinkAttrs.href);
                        this._visitedHrefs.push(loginRegisterLinkAttrs.href);
                    }
                } catch (error) {
                    this._log('Error while getting URL of the link: ', loginRegisterLinkAttrs.href);
                }
            }

            if (emailPasswordFields && (emailPasswordFields.emailFields.length || emailPasswordFields.passwordFields.length)) {
                this._log(`Found ${emailPasswordFields.emailFields.length} email` +
                    ` ${emailPasswordFields.passwordFields.length} password field(s)` +
                    ` after clicking ${JSON.stringify(loginRegisterLinkAttrs)}`);
                this._emailPasswordFields.push(emailPasswordFields);
            }
        }

        return {
            finalEmailPasswordFields: this.removeHandles(this._emailPasswordFields),
            numEmailFields: this._numOfEmailFields,
            numPasswordFields: this._numOfPasswordFields,
            numLoginLinks: loginRegisterLinksAttrs.length,
            loginRegisterLinksDetails: JSON.stringify(loginRegisterLinksAttrs)
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
        this._log(`Landing page will be loaded. Current: ${currentUrl} Target: ${this.finalUrl}`);

        if (ALWAYS_RELOAD_BEFORE_CLICKING || currentUrl !== this.finalUrl) {
            try {
                await this._mainSession.send('Page.navigate', {
                    url: this.finalUrl,
                });
                await this.waitForPageLoad(MAX_RELOAD_TIME);
                await new Promise(resolve => setTimeout(resolve, POST_HOMEPAGE_RELOAD_WAIT));
                this._log(`Navigated to ${await this._getCurrentUrl()}`);
            } catch (error) {
                this._log(`Error while going back to landing page: ${pageUtils.removeNewLineChar(error.message)}`);
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
            const readyState = await this._evaluateInSession(
                this._mainSession, 'document.readyState'
            );
            if (readyState === 'complete') {
                break;
            }
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
        this._log(`Will click using ${method} on ${currentUrl} to ${JSON.stringify(loginRegisterLinkAttrs)}`);
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
                this._log(`Element not found in page for xpath: ${xpath}`);
                return false;
            }
        } catch (error) {
            this._log(`Error while ${method} clicking: ${pageUtils.removeNewLineChar(error.message)}`);
            return false;
        }
        return true;
    }

    /**
     * Navigate to landing page, click a login/register link, wait for
     * navigation, then scan the resulting page for email/password fields.
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

            if (clickOk) {
                await this.waitForPageLoad(POST_CLICK_LOAD_TIMEOUT);

                // After navigation, new targets (new tabs/popups) may have been
                // added via addTarget() already — scan the most recently added one
                emailPasswordFields = await this.findEmailPasswordFieldsOnLastSession();

                if (emailPasswordFields && (emailPasswordFields.emailFields.length || emailPasswordFields.passwordFields.length)) {
                    return emailPasswordFields;
                }

                const postClickUrl = await this._getCurrentUrl();
                if (postClickUrl !== preClickUrl) {
                    this._log(`Click caused navigation ${preClickUrl} -> ${postClickUrl}, skipping event-based click`);
                    return emailPasswordFields;
                }
            }
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
            this._log(`New tab detected, injecting fathom into ${last.targetInfo.url}`);
            try {
                await last.session.send('Runtime.evaluate', {
                    expression: fathomSrc,
                    returnByValue: false,
                });
            } catch (e) {
                this._log(`Failed to inject fathom into new tab: ${e.message}`);
            }
        }

        return await this.findEmailPasswordFieldsInSession(last.session, last.targetInfo.url);
    }

    /**
     * Scan a single CDP session for email and password fields using fathom.
     *
     * @param {object} session
     * @param {string} pageUrl
     * @returns {Promise<EmailPasswordFieldsUrlBased|undefined>}
     */
    async findEmailPasswordFieldsInSession(session, pageUrl) {
        const pageDomain = tldts.getDomain(pageUrl);
        if (SKIP_EXTERNAL_LINKS && this._siteDomain !== pageDomain) {
            this._log(`Off-domain, skipping: ${pageUrl}`);
            return undefined;
        }

        this._log(`Will search for email/password fields on ${pageUrl}`);

        try {
            // Run fathom in the browser — returns [{xpath, score}, ...]
            const emailFieldsFromFathom = await this._evaluateInSession(
                session,
                `(function() {
                    try { return [...fathom.detectEmailInputs(document)]; }
                    catch(e) { return []; }
                })()`
            ) || [];

            // Get password field xpaths via fathom.getXPath
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

            const emailFields = emailFieldsFromFathom.map(f => ({
                xpath: f.xpath,
                score: f.score,
            }));

            const passwordFields = passwordFieldXPaths.map(xpath => ({xpath}));

            if (emailFields.length) {
                this._log(`Found ${emailFields.length} email field(s) on ${pageUrl}`);
            }
            if (passwordFields.length) {
                this._log(`Found ${passwordFields.length} password field(s) on ${pageUrl}`);
            }

            this._numOfEmailFields += emailFields.length;
            this._numOfPasswordFields += passwordFields.length;

            return {
                location: pageUrl,
                emailFields,
                passwordFields,
                clickedElementXPath: this._lastClickedXPath,
            };

        } catch (error) {
            this._log(`Error on ${pageUrl} while searching email/password fields: ${pageUtils.removeNewLineChar(error.message)}`);
        }

        return undefined;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

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