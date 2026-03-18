'use strict';

/**
 * @file emailFieldConstants.js
 *
 * All tuneable constants for EmailFieldCollector and its helpers.
 *
 * This file is the single place edited by the Python wrapper (or any external
 * orchestrator) to change crawl behaviour without touching collector logic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NAVIGATION
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Maximum total number of sub-pages to visit across the entire BFS crawl.
 * The landing page itself does not count toward this budget.
 *
 * Example with MAX_CANDIDATE_LINKS = 5:
 *   landing → finds [/newsletter, /login, /register]  (all enqueued)
 *   visit /newsletter → finds [/confirm]              (enqueued, budget: 1/5)
 *   visit /login      →                               (budget: 2/5)
 *   visit /register   → finds [/signup/step2]         (enqueued, budget: 3/5)
 *   visit /confirm    →                               (budget: 4/5)
 *   visit /signup/step2 →                             (budget: 5/5 → stop)
 */
const MAX_CANDIDATE_LINKS = 10;

/**
 * Milliseconds to wait after navigating to a sub-page before scanning.
 * Increase on slow or JS-heavy sites.
 */
const POST_NAVIGATE_DELAY = 2000;

// ─────────────────────────────────────────────────────────────────────────────
// IFRAME FILTERING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Substrings matched against iframe URLs in addTarget().
 * Sessions whose URL contains any of these strings are silently discarded —
 * they will never contain a meaningful email form.
 */
const IFRAME_NOISE = [
    'google.com/recaptcha',
    'recaptcha.net',
    'hcaptcha.com',
    'challenges.cloudflare.com',
    'doubleclick.net',
    'googletagmanager.com',
    'google-analytics.com',
    'facebook.com/plugins',
    'youtube.com/embed',
];

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFIER SCORING WEIGHTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Points awarded for each keyword hit in classifyForm().
 * Raise a value to make that signal more decisive.
 */
const SCORE = Object.freeze({
    /** Points per keyword match (applies to every form class). */
    KEYWORD_HIT: 3,

    /** Single email field with no password → subscription hint. */
    SINGLE_EMAIL_NO_PW: 2,

    /** Any password field present → login hint. */
    HAS_PASSWORD: 2,

    /** Two or more password fields → create-account / registration. */
    TWO_PASSWORDS: 4,
    /** Counter-weight removed from LOGIN when two passwords are found. */
    TWO_PASSWORDS_LOGIN_PENALTY: 2,

    /** Password-reset keywords carry extra weight (very specific phrases). */
    RESET_KEYWORD_HIT: 4,

    /** Textarea / message / subject field → contact hint. */
    HAS_MESSAGE_FIELD: 2,

    /** Payment-related input names (card, cvv, expiry) → checkout. */
    HAS_PAYMENT_FIELDS: 4,

    /** Checkout keywords carry same weight as generic keywords. */
    CHECKOUT_KEYWORD_HIT: 3,
});

/**
 * Minimum score-gap between the top-ranked and second-ranked class
 * required to declare HIGH or MEDIUM confidence.
 *
 *   gap >= HIGH_CONFIDENCE_GAP  → 'high'
 *   gap >= MED_CONFIDENCE_GAP   → 'medium'
 *   otherwise                   → 'low'
 */
const HIGH_CONFIDENCE_GAP = 4;
const MED_CONFIDENCE_GAP = 2;

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    MAX_CANDIDATE_LINKS,
    POST_NAVIGATE_DELAY,
    IFRAME_NOISE,
    SCORE,
    HIGH_CONFIDENCE_GAP,
    MED_CONFIDENCE_GAP,
};
