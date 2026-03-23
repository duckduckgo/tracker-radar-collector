/* Adapted from leaky forms emailPasswordField collector
*  https://github.com/leaky-forms/leaky-forms-crawler
*/

/* eslint-disable max-lines */

// Get the files to inject in browser
const path = require('path');
const fs = require('fs');
const findLoginLinksJS = fs.readFileSync(path.join(__dirname, '..', 'emailAIHelpers', 'browserJS', 'findloginlinks.js'), 'utf8');
const findLoginLinksbycoordsJS = fs.readFileSync(path.join(__dirname, '..', 'emailAIHelpers', 'browserJS', 'findloginlinksbycoords.js'), 'utf8');
/**
 * Inline browser-side snippet that serializes a DOM element to a plain object.
 * Embedded as a string inside evaluateInSession expressions.
 */
const SERIALIZE_EL = fs.readFileSync(path.join(__dirname, '..', 'emailAIHelpers', 'browserJS', 'serialize.js'), 'utf8');


// ── No puppeteer dependency — all functions work with raw CDP sessions ─────────

const ENABLE_LOOSE_LOGIN_LINK_MATCHES = true;
const ENABLE_COORD_BASED_LINK_SEARCH = true;

// Regexes taken from:
// https://searchfox.org/mozilla-central/rev/5e70cd673a0ba0ad19b662c1cf656e0823781596/toolkit/components/passwordmgr/NewPasswordModel.jsm#105-109
const loginRegex = /login|log in|log on|log-on|Войти|sign in|sigin|sign\/in|sign-in|sign on|sign-on|ورود|登录|Přihlásit se|Přihlaste|Авторизоваться|Авторизация|entrar|ログイン|로그인|inloggen|Συνδέσου|accedi|ログオン|Giriş Yap|登入|connecter|connectez-vous|Connexion|Вход/i;
const loginFormAttrRegex = /login|log in|log on|log-on|sign in|sigin|sign\/in|sign-in|sign on|sign-on/i;
const registerStringRegex = /create[a-zA-Z\s]+account|Zugang anlegen|Angaben prüfen|Konto erstellen|register|sign up|ثبت نام|登録|注册|cadastr|Зарегистрироваться|Регистрация|Bellige alynmak|تسجيل|ΕΓΓΡΑΦΗΣ|Εγγραφή|Créer mon compte|Mendaftar|가입하기|inschrijving|Zarejestruj się|Deschideți un cont|Создать аккаунт|ร่วม|Üye Ol|registr|new account|ساخت حساب کاربری|Schrijf je/i;
const registerActionRegex = /register|signup|sign-up|create-account|account\/create|join|new_account|user\/create|sign\/up|membership\/create/i;
const registerFormAttrRegex = /signup|join|register|regform|registration|new_user|AccountCreate|create_customer|CreateAccount|CreateAcct|create-account|reg-form|newuser|new-reg|new-form|new_membership/i;
const loginRegexExtra = /log_in|logon|log_on|signin|sign_in|sign_up|signon|sign_on|Aanmelden/i;

const combinedLoginLinkRegexLooseSrc = [
    loginRegex.source,
    loginFormAttrRegex.source,
    registerStringRegex.source,
    registerActionRegex.source,
    registerFormAttrRegex.source,
    loginRegexExtra.source,
].join('|');

const combinedLoginLinkRegexExactSrc = '^' + combinedLoginLinkRegexLooseSrc.replace(/\|/g, '$|^') + '$';

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * @param {number} time
 */
function sleep(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

/**
 * @param {string} str
 */
function removeNewLineChar(str) {
    return str.replace(/[\n\r]+/g, ' ');
}

/**
 * @param {string} typeOfEl
 */
function isButtonOrLink(typeOfEl) {
    return (typeOfEl === 'BUTTON' || typeOfEl === 'A') ? 1 : 0;
}

/**
 * @param {string} browserScriptTemplate
 * @param {string} loginRegexSrc
 */
function _buildScript(browserScriptTemplate, loginRegexSrc) {
    let script = browserScriptTemplate;
    if (loginRegexSrc) {
    script = script.replace('__LOGIN_REGEX_SRC__', JSON.stringify(loginRegexSrc));
    }
    return script.replace('__SERIALIZE_EL__', SERIALIZE_EL);
}

// ── CDP helper ────────────────────────────────────────────────────────────────

/**
 * Run an expression in a CDP session and return the plain JS result.
 * Equivalent to puppeteer's page.evaluate() but works on raw CDP sessions.
 *
 * @param {object} session
 * @param {string} expression
 * @param {function|null} log
 * @returns {Promise<any>}
 */
async function evaluateInSession(session, expression, log = null) {
    try {
        const res = await session.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            userGesture: false,
        });
        if (res?.exceptionDetails) {
            if (log) {log(`evaluate exception: ${res.exceptionDetails.text}`);}
            return undefined;
        }
        return res?.result?.value;
    } catch (err) {
        if (log) {log(`CDP evaluate threw: ${err.message}`);}
        return undefined;
    }
}

// ── Login link detection ──────────────────────────────────────────────────────
// All element attribute extraction happens inside the browser via Runtime.evaluate
// so results come back as plain serializable objects — no ElementHandles needed.

/**
 * Find login/register links near the typical top-right coordinates where
 * login buttons are most commonly found.
 *
 * @param {object} session - CDP session (fathom must be injected)
 * @returns {Promise<ElementAttributes[]>}
 */
async function findLoginLinksByCoords(session) {
    const result = await evaluateInSession(session, _buildScript(findLoginLinksbycoordsJS, null));
    return result || [];
}

/**
 * Find login/register links by matching element attributes against login regexes.
 *
 * @param {object} session - CDP session (fathom must be injected)
 * @param {boolean} exactMatch
 * @returns {Promise<ElementAttributes[]>}
 */
async function findLoginLinks(session, exactMatch = false) {
    const loginRegexSrc = exactMatch ? combinedLoginLinkRegexExactSrc : combinedLoginLinkRegexLooseSrc;
    const result = await evaluateInSession(session, _buildScript(findLoginLinksJS, loginRegexSrc));
    return result || [];
}

/**
 * Get deduplicated, sorted login/register link attributes from all match strategies.
 *
 * @param {object} session - CDP session (fathom must be injected)
 * @param {function} log
 * @returns {Promise<ElementAttributes[]>}
 */
async function getLoginLinkAttrs(session, log) {
    /** @type {ElementAttributes[]} */
    let linkAttrs = [];
    /** @type {string[]} */
    let seenXpaths = [];

    const linkMatchTypes = ['exact'];
    if (ENABLE_LOOSE_LOGIN_LINK_MATCHES) {linkMatchTypes.push('loose');}
    if (ENABLE_COORD_BASED_LINK_SEARCH) {linkMatchTypes.push('coords');}

    for (const matchType of linkMatchTypes) {
        let links;
        if (matchType === 'coords') {
            links = await findLoginLinksByCoords(session);
        } else {
            links = await findLoginLinks(session, matchType === 'exact');
        }

        // tag each result with its matchType
        links.forEach(link => { link.matchType = matchType; });

        // sort: buttons/anchors first, then onTop
        links.sort((a, b) => {
            if (isButtonOrLink(a.nodeType) > isButtonOrLink(b.nodeType)) {return -1;}
            if (isButtonOrLink(a.nodeType) < isButtonOrLink(b.nodeType)) {return 1;}
            if (a.onTop > b.onTop) {return -1;}
            if (a.onTop < b.onTop) {return 1;}
            return 0;
        });

        // deduplicate by xpath across all match types
        const newLinks = links.filter(link => link.xpath && !seenXpaths.includes(link.xpath));
        linkAttrs.push(...newLinks);
        seenXpaths = linkAttrs.map(el => el.xpath);
    }

    return linkAttrs;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    sleep,
    removeNewLineChar,
    evaluateInSession,
    findLoginLinks,
    getLoginLinkAttrs,
};


/**
 * @typedef ElementAttributes
 * @property {string} id
 * @property {string} type
 * @property {string} nodeType
 * @property {string} name
 * @property {string} class
 * @property {string} innerText
 * @property {string} href
 * @property {string} ariaLabel
 * @property {string} placeholder
 * @property {string} xpath
 * @property {boolean} onTop
 * @property {number} score
 * @property {string} matchType
 */