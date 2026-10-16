// Excerpts of long frame texts for the frame LLM: the start and end of the text plus windows around consent keywords.

// characters kept either side of a keyword hit; the start and end of the text kept are fractions of the cap
const WINDOW = 350;
const DEFAULT_MAX_CHARS = 4500;

// Consent vocabulary for the core crawl regions (EN, DE, NL, FR, IT, ES), case-insensitive. Kept to consent-specific
// words and phrases, since windows are taken in text order until the budget runs out and generic words would use it up.
// "cookie" and "consent" already cover the loanword and consentement/consentimiento.
const KEYWORDS = new RegExp(
    [
        // shared and English
        'cookie',
        'consent',
        'privacy',
        'tracking',
        'tracker',
        'gdpr',
        '\\btcf\\b',
        'vendor',
        'partner',
        'accept all',
        'reject',
        'do not sell',
        'your (?:privacy )?choices',
        'personal (?:data|information)',
        'personali[sz]ed',
        'legitimate interest',
        // German
        'einwillig',
        'zustimm',
        'datenschutz',
        'dsgvo',
        'alle akzeptieren',
        'akzeptieren',
        'ablehnen',
        'berechtigtes interesse',
        // Dutch
        'toestemming',
        'persoonsgegevens',
        'gerechtvaardigd belang',
        'leveranciers',
        'alles accepteren',
        'alles weigeren',
        'alles afwijzen',
        'weigeren',
        '\\bavg\\b',
        // French
        'traceur',
        'données personnelles',
        'vie privée',
        'confidentialit',
        'partenaires',
        'intérêt légitime',
        'tout accepter',
        'tout refuser',
        'continuer sans accepter',
        '\\brgpd\\b',
        // Italian
        'consenso',
        'dati personali',
        'riservatezza',
        'interesse legittimo',
        'fornitori',
        'accetta tutt',
        'rifiuta tutt',
        'continua senza accettare',
        // Spanish
        'privacidad',
        'datos personales',
        'interés legítimo',
        'proveedores',
        'socios',
        'aceptar todo',
        'rechazar todo',
        'continuar sin aceptar',
    ].join('|'),
    'gi',
);

/**
 * Frame LLM input for a long page: the start and end of the text plus windows around consent keywords, merged in text
 * order and capped at about `maxChars`, with gaps marked "[...]". Consent notices usually sit at the start or the end of
 * the page text, or are found by their keywords; the rest of a long page only dilutes them. Texts within the cap are
 * returned unchanged.
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string}
 */
function frameExcerpt(text, maxChars = DEFAULT_MAX_CHARS) {
    if (text.length <= maxChars) {
        return text;
    }
    const head = Math.round(maxChars * 0.18);
    const tail = Math.round(maxChars * 0.27);
    /** @type {[number, number][]} */
    const ranges = [
        [0, head],
        [text.length - tail, text.length],
    ];
    let budget = maxChars - head - tail;
    for (const m of text.matchAll(KEYWORDS)) {
        if (budget <= 0) {
            break;
        }
        const i = m.index ?? 0;
        const range = /** @type {[number, number]} */ ([Math.max(0, i - WINDOW), Math.min(text.length, i + WINDOW)]);
        if (!ranges.some(([a, b]) => range[0] >= a && range[1] <= b)) {
            ranges.push(range);
            budget -= range[1] - range[0];
        }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    /** @type {[number, number][]} */
    const merged = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) {
            last[1] = Math.max(last[1], r[1]);
        } else {
            merged.push([...r]);
        }
    }
    const parts = merged.map(([a, b]) => text.slice(a, b));
    const gapBefore = merged[0][0] > 0 ? '[...]\n' : '';
    const gapAfter = merged[merged.length - 1][1] < text.length ? '\n[...]' : '';
    return gapBefore + parts.join('\n[...]\n') + gapAfter;
}

module.exports = { DEFAULT_MAX_CHARS, KEYWORDS, frameExcerpt };
