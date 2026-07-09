const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');
const { REJECT_PATTERNS, NEVER_MATCH_PATTERNS, SETTINGS_PATTERNS, ACCEPT_PATTERNS, ACKNOWLEDGE_PATTERNS } = require('./button-patterns');

// FIXME: the detection patterns are defined both in autoconsent codebase and here. We should consolidate them in one place.
/**
 * @param {string} allText
 * @returns {boolean}
 */
function checkHeuristicPatterns(allText) {
    const DETECT_PATTERNS = [
        /accept cookies/gi,
        /accept all/gi,
        /reject all/gi,
        /only necessary cookies/gi, // "only necessary" is probably too broad
        /(?:by continuing.{0,100}cookie)|(?:cookie.{0,100}by continuing)/gi,
        /(?:by continuing.{0,100}privacy)|(?:privacy.{0,100}by continuing)/gi,
        /we (?:use|serve)(?: optional)? cookies/gi,
        /we are using cookies/gi,
        /use of cookies/gi,
        /(?:this|our) (?:web)?site.{0,100}cookies/gi,
        /cookies (?:and|or) .{0,100} technologies/gi,
        /such as cookies/gi,
        /read more about.{0,100}cookies/gi,
        /consent to.{0,100}cookies/gi,
        /we and our partners.{0,100}cookies/gi,
        /we.{0,100}store.{0,100}information.{0,100}such as.{0,100}cookies/gi,
        /store and\/or access information.{0,100}on a device/gi,
        /personalised ads and content, ad and content measurement/gi,

        // it might be tempting to add the patterns below, but they cause too many false positives. Don't do it :)
        // /cookies? settings/i,
        // /cookies? preferences/i,

        // FR
        /utilisons.{0,100}des.{0,100}cookies/gi,
        /des.{0,100}cookies.{0,100}pour/gi,
        /retirer.{0,100}votre.{0,100}consentement/gi,
        /et.{0,100}nos.{0,100}partenaires/gi,
        /publicités.{0,100}et.{0,100}du.{0,100}contenu/gi,
        /utilise.{0,100}des.{0,100}cookies/gi,
        /utilisent.{0,100}des.{0,100}cookies/gi,
        /stocker.{0,100}et.{0,100}ou.{0,100}accéder/gi,
        /consentement.{0,100}à.{0,100}tout.{0,100}moment/gi,
        /votre.{0,100}consentement/gi,
        /accepter.{0,100}tout/gi,
        /utilisation.{0,100}des.{0,100}cookies/gi,
        /cookies.{0,100}ou.{0,100}technologies/gi,
        /acceptez.{0,100}l.{0,100}utilisation/gi,
        /continuer sans accepter/gi,
        /tout refuser/gi,
        /(?:refuser|rejeter) tous les cookies/gi,
        /je refuse/gi,
        /refuser et continuer/gi,
        /refuser les cookies/gi,
        /seulement nécessaires/gi,
        /je désactive les finalités non essentielles/gi,
        /cookies essentiels uniquement/gi,
        /nécessaires uniquement/gi,

        // DE
        /wir.{0,100}verwenden.{0,100}cookies/gi,
        /wir.{0,100}und.{0,100}unsere.{0,100}partner/gi,
        /zugriff.{0,100}auf.{0,100}informationen.{0,100}auf/gi,
        /inhalte.{0,100}messung.{0,100}von.{0,100}werbeleistung.{0,100}und/gi,
        /cookies.{0,100}und.{0,100}andere/gi,
        /verwendung.{0,100}von.{0,100}cookies/gi,
        /wir.{0,100}nutzen.{0,100}cookies/gi,
        /verwendet.{0,100}cookies/gi,
        /sie.{0,100}können.{0,100}ihre.{0,100}auswahl/gi,
        /und.{0,100}ähnliche.{0,100}technologien/gi,
        /cookies.{0,100}wir.{0,100}verwenden/gi,

        /alles?.{0,100}ablehnen/gi,
        /(?:nur|nicht).{0,100}(?:zusätzliche|essenzielle|funktionale|notwendige|erforderliche).{0,100}(?:cookies|akzeptieren|erlauben|ablehnen)/gi,
        /weiter.{0,100}(?:ohne|mit).{0,100}(?:einwilligung|zustimmung|cookies)/gi,
        /(?:cookies|einwilligung).{0,100}ablehnen/gi,
        /nur funktionale cookies akzeptieren/gi,
        /optionale ablehnen/gi,
        /zustimmung verweigern/gi,

        // NL
        /gebruik.{0,100}van.{0,100}cookies/gi,
        /(?:we|wij).{0,100}gebruiken.{0,100}cookies.{0,100}om/gi,
        /cookies.{0,100}en.{0,100}vergelijkbare/gi,

        /(?:alles|cookies).{0,100}(?:afwijzen|weigeren|verwerpen)/gi,
        /alleen.{0,100}noodzakelijke?\b/gi,
        /cookies weigeren/gi,
        /weiger.{0,100}(?:cookies|alles)/gi,
        /doorgaan zonder (?:te accepteren|akkoord te gaan)/gi,
        /alleen.{0,100}(?:optionele|functionele|functioneel|noodzakelijke|essentiële).{0,100}cookies/gi,
        /wijs alles af/gi,

        // Spanish (ES)
        /(si|al) contin[úu]a[sr]?( navegando)?.{0,100} cookie/i,
        /(usamos|utilizar?|utilizamos)( (tanto|las))?.{0,20}cookie/gi,
        /\b(hacemos|hace) uso de cookies\b/i,
        /\busa cookies de google\b/i,
        /acepta.{0,80} uso de cookies/i,
        /al utilizar nuestro sitio web.{0,80}cookie/i,
        /almacenar la información en un dispositivo y\/?o acceder a ella/i,
        /cookie.{0,30} utiliza/i,
        /cookies propias y de/gi,
        /cookies.{0,80}son necesarias/i,
        /est[ea] (sitio|página|web)( web)?( también)? (usa|utiliza|requiere del uso de|se sirven|emplea) cookies?/i,
        /navegando.{0,100}cookie/i,
        /nosotros y nuestros( \d+)? (socios|proveedores).{0,180} cookies/gi,
        /recopilamos y almacenamos datos de usted y de su dispositivo/gi,
        /utilizamos tecnolog[ií]as como las cookies/i,

        // Polish (PL)
        // examples:
        //  wykorzystuje pliki cookie (uses cookies)
        //  Wykorzystujemy informacje w plikach cookie (We use information in cookies)
        /(używamy|stosujemy|stosuje|wykorzystujemy|wykorzyst(uje|ywane))( są)?.{0,20} plik(i|ów|ach) cookie/i,
        /(używać|używamy).{0,80} (ciasteczek|cookie)/i,
        /cele przetwarzania twoich danych przez zaufanych partnerów iab/i,
        /dzięki (plikom cookie|ciasteczkom|cookie)/i,
        /korzysta.{0,80} plików cookie/i,
        /korzystamy z technologii, takich jak pliki cookie/gi,
        /korzystamy.{0,50} cookies/i,
        /niektóre pliki cookies/i,
        /pliki cookies i pokrewne im technologie umożliwiają poprawne działanie strony i pomagają nam dostosować ofertę do twoich potrzeb/i,
        /przechowywanie informacji na urządzeniu lub dostęp do nich/i,
        /przechowywanie plików cookie na swoim urządzeniu/i,
        /przechowywać i uzyskiwać dostęp do informacji na twoich urządzeniach/gi,
        /przetwarzamy.{0,80} cookie/i,
        /strona.{0,50} używa (ciasteczek|cookie)/gi,
        /ta strona korzysta z ciasteczek/i,
        /uzyskujemy dostęp i przechowujemy informacje na urządzeniu/gi,
        /używa plik[ió]w? cookie/gi,
        /używamy plików.{0,20}cookie/i,
        /wykorzystują .{0,100}cookie/gi,
        /za pomocą plików cookies.{0,100} my lub nasi partnerzy/gi,
        /zgodą my i nasi partnerzy możemy wykorzystywać precyzyjne dane geolokalizacyjne i identyfikację/gi,

        // Catalan (CA)
        /cookies pròpies i de tercers/gi,
        /utilitzem galetes/gi,
        /\búnicament utilitza galetes pròpies amb finalitat tècnica\b/i,
        /este lloc web utilitza només cookies tècniques necessàries per al seu funcionament/i,
        /utilitza cookies tècniques,\s*de personalització i anàlisi/i,
        /utilitzem cookies i altres tecnologies/i,

        // Basque (EU)
        /cookie propio eta hirugarrenenak helburu teknikoarekin erabiltzen ditu/i,
        /cookie propioak eta hirugarrenen cookieak erabiltzen ditugu/i,
        /cookie propioak eta hirugarrenenak helburu teknikoarekin erabiltzen ditu/i,
        /cookie[-\s]*ak erabiltzen ditu/i,
        /cookieak erabiltzen ditu/i,
        /guk eta gure \d+ bazkideek cookieak eta identifikadoreak erabiltzen ditugu/i,
        /norberaren eta hirugarrenen cookie-?ak baino ez ditu erabiltzen/i,
        /web orri honek cookieak erabiltzen ditu/i,
        /webgune honek cookie propioak eta hirugarrenen cookie-fitxategiak erabiltzen ditu/i,

        // Galician (GL)
        /^\s*empregamos cookies propias\b/i,
        /este portal emprega cookies propias ou de terceiros con fins analíticos/i,

        // Russian (RU)
        /мы используем файлы cookie и аналогичные технологии/i,

        // Italian (IT)
        /usiamo.{0,20}cookie/gi,
    ];

    for (const p of DETECT_PATTERNS) {
        const matches = allText.match(p);
        if (matches) {
            return true;
        }
    }
    return false;
}

/**
 * @param {string} buttonText
 * @returns {string}
 */
function cleanButtonText(buttonText) {
    // lowercase
    let result = buttonText.toLowerCase();
    // remove special characters
    result = result.replace(/[“”"'/#&[\]→✕×⟩❯><✗×‘’›«»]+/g, '');
    // remove emojis
    result = result.replace(
        /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u2600-\u26FF\u2700-\u27BF\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu,
        '',
    );
    // remove newlines
    result = result.replace(/\n+/g, ' ');
    // remove multiple spaces
    result = result.replace(/\s+/g, ' ');
    // strip whitespace around the text
    result = result.trim();
    return result;
}

/**
 * @param {string} buttonText
 * @returns {boolean}
 */
function isRejectButton(buttonText) {
    return testButtonMatches(buttonText, REJECT_PATTERNS, NEVER_MATCH_PATTERNS);
}

/**
 * @param {string} buttonText
 * @param {Array<string|RegExp>} matchPatterns
 * @param {Array<string|RegExp>} neverMatchPatterns
 * @returns {boolean}
 */
function testButtonMatches(buttonText, matchPatterns, neverMatchPatterns) {
    if (!buttonText) {
        return false;
    }
    const cleanedButtonText = cleanButtonText(buttonText);
    return (
        !neverMatchPatterns.some((p) => (p instanceof RegExp && p.test(cleanedButtonText)) || p === cleanedButtonText) &&
        matchPatterns.some((p) => (p instanceof RegExp && p.test(cleanedButtonText)) || p === cleanedButtonText)
    );
}

/**
 * @param {import('openai').OpenAI} openai
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function checkLLM(openai, text) {
    const systemPrompt = `
You are an expert in web application user interfaces. You are given a text extracted from an HTML element. Your task is to determine whether this element is a cookie popup.

A "cookie popup", also known as "consent management dialog", is a notification that informs users about the use of cookies (or other storage technologies), and seeks their consent. It typically includes information about cookies, consent options, privacy policy links, and action buttons.

While cookie popups are primarily focused on obtaining consent for the use of cookies, they often encompass broader data privacy and tracking practices. Therefore, cookie popups may also include information about:
- other tracking technologies: popups may address other tracking technologies such as web beacons, pixels, and local storage that websites use to collect data about user behavior.
- data collection and usage: the popups may provide information about what types of data are collected, how it is used, and with whom it is shared, extending beyond just cookies.
- consent for other technologies: some popups may also seek consent for other technologies that involve data processing, such as analytics tools, advertising networks, and social media plugins.
- user preferences: they often allow users to manage their preferences regarding different types of data collection and processing activities.

Examples of cookie popup text:
- "This site uses cookies to improve your experience. By continuing to use our site, you agree to our cookie policy."
- "We and our partners process data to provide and improve our services, including advertising and personalized content. This may include data from other companies and the public. [Accept All] [Reject All] [Show Purposes]"

Examples of NON-cookie popup text:
- "This site is for adults only. By pressing continue, you confirm that you are at least 18 years old."
- "Help Contact Pricing Company Jobs Research Program Sitemap Privacy Settings Legal Notice Cookie Policy"
- "Would you like to enable notifications to stay up to date?"
    `;

    const CookieConsentNoticeClassification = z.object({
        isCookieConsentNotice: z.boolean(),
    });

    try {
        const completion = await openai.beta.chat.completions.parse({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content: text,
                },
            ],

            response_format: zodResponseFormat(CookieConsentNoticeClassification, 'CookieConsentNoticeClassification'),
        });

        const result = completion.choices[0].message.parsed;
        return result?.isCookieConsentNotice ?? false;
    } catch (error) {
        console.error('Error classifying candidate:', error);
    }

    return false;
}

/** @type {Map<string, ButtonClassification>} */
const buttonClassificationCache = new Map();

const ButtonTextClassificationSchema = z.object({
    classification: z.enum(['settings', 'accept', 'reject', 'acknowledge', 'other']),
});

/**
 * @param {import('openai').OpenAI} openai
 * @param {string} buttonText
 * @returns {Promise<ButtonClassification>}
 */
async function classifyButtonTextLLM(openai, buttonText) {
    const cleaned = cleanButtonText(buttonText);
    if (cleaned.length > 200) {
        return 'other';
    }

    const cached = buttonClassificationCache.get(cleaned);
    if (cached) {
        return cached;
    }

    const systemPrompt = `
You are an expert in web application user interfaces.

You will be given the text of a button found on a cookie consent popup. Classify it
into exactly one of the following categories:

- settings: opens further customization of COOKIE or CONSENT preferences specifically (e.g. "Cookie Settings",
  "Manage preferences", "Preferences", "Customize", "More options", "Manage cookies", "Show details"). Buttons that open other site settings (accessibility, language, etc.) are "other".
- accept: explicitly accepts cookies, permits/allows consent, or signals agreement to something (e.g. "Accept
  all", "I agree", "Allow all cookies", "Allow selection"). The language must reference agreement,
  acceptance, or permitting — not just dismissal.
- reject: rejects cookies or opts out, including accepting only minimal/essential
  cookies and data-sale opt-outs (e.g. "Reject all", "Essential only", "Do not sell my personal information", "opt out").
- acknowledge: dismisses the notice with neutral language that does not explicitly
  reference accepting or rejecting (e.g. "OK", "Got it", "Close", "Dismiss", "Continue",
  "I understand", "×", "confirm my choices").
- other: none of the above (e.g. links to Privacy Policy, Impressum, or other
  informational content). Additionally, anything including payments or subscriptions, age checks, or
  language that suggests that the user would not be able to continue if they click this button, should be classified as other.

Rules:
- IMPORTANT: If a button accepts ONLY necessary, essential, required, or strictly
    necessary cookies (even if the word "accept" appears), classify as reject.
    Examples: "Strictly necessary", "Essentials", "Required", "Accept necessary cookies",
    "Accept essential only", "Notwendige Cookies akzeptieren" → reject
- IMPORTANT: "Do not sell", opt-out, decline, or disagree refusing consent → reject.
- IMPORTANT: Distinguish "confirm/apply a selection" from "open customization":
    - accept: confirms, saves, or applies the user's current or pre-selected consent choices
      (e.g. "Allow selection", "Accept selected", "zezwól na wybór", "zezwól na wybrane",
      "permitir la selección", "akceptuj wybrane").
    - settings: opens a UI to review, change, or make choices (e.g. "Customize", "Manage preferences",
      "Let me choose", "dostosuj wybór", "pozwól mi wybrać", "Show details").
    Verbs like allow/permit/accept + selection/selected → accept.
    Verbs like customize/manage/adjust/let me choose/show → settings.
    Apply these rules regardless of language.
- Only classify buttons that fit unabiguously into one of the categories, otherwise classify as other.
- If the text contains a negation indicating refusal (e.g. "continue without
  accepting"), classify as reject.
- Standalone Close, Dismiss, ×, or x, and close/dismiss of cookie banners or notices in any language → acknowledge, not other.
- If a button could fit multiple categories, prefer in this order:
  reject > accept > settings > acknowledge > other.
- The button text may be in any language — apply the same rules regardless.
- Respond with exactly one word: the category label. No explanation, no punctuation.
- Short affirmatives that imply agreement ("yes", "yeah") → accept, not acknowledge.
  "acknowledge" is for neutral dismissals that make no reference to agreement.
- If the button text contains a qualifier that makes it clearly unrelated to cookies
  or consent (e.g. "ad", "advertisement", "video", "newsletter"), classify as other,
  regardless of the action word.
- "Cancel" → other. It cancels an action within a dialog, not a consent decision.

Examples:
"Cookie Settings", "Manage preferences", "Customize", "dostosuj wybór", "pozwól mi wybrać" → settings
"Accept all", "I agree", "Allow cookies", "Allow selection", "Akzeptieren", "zezwól na wybór", "permitir la selección" → accept
"Reject all", "Essential only", "Ablehnen", "Do not sell my personal information", "opt out", "disagree and close" → reject
"OK", "Got it", "I understand", "×", "Close", "Dismiss", "cerrar", "zamknij", "confirm my choices", "Close cookie notice", "Continue" → acknowledge
"Privacy Policy", "Cookie-Richtlinie", "Impressum", "Learn more", "close ad", "Cancel" → other
    `;

    try {
        const completion = await openai.beta.chat.completions.parse({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `"${cleaned}"` },
            ],
            response_format: zodResponseFormat(ButtonTextClassificationSchema, 'ButtonTextClassification'),
        });

        const classification = completion.choices[0].message.parsed?.classification ?? 'other';
        buttonClassificationCache.set(cleaned, classification);
        return classification;
    } catch (error) {
        console.error('Error classifying button text:', error);
    }

    buttonClassificationCache.set(cleaned, 'other');
    return 'other';
}

/**
 * @param {string} buttonText
 * @returns {ButtonClassification}
 */
function classifyButtonTextRegex(buttonText) {
    if (isRejectButton(buttonText)) {
        return 'reject';
    }
    if (testButtonMatches(buttonText, SETTINGS_PATTERNS, NEVER_MATCH_PATTERNS)) {
        return 'settings';
    }
    if (testButtonMatches(buttonText, ACKNOWLEDGE_PATTERNS, NEVER_MATCH_PATTERNS)) {
        return 'acknowledge';
    }
    if (testButtonMatches(buttonText, ACCEPT_PATTERNS, NEVER_MATCH_PATTERNS)) {
        return 'accept';
    }
    return 'other';
}

/**
 * @param {import('./types').ButtonData[]} buttons
 * @returns {{rejectButtons: import('./types').ButtonData[], otherButtons: import('./types').ButtonData[]}}
 */
function classifyButtons(buttons) {
    const rejectButtons = [];
    const otherButtons = [];
    for (const button of buttons) {
        if (isRejectButton(button.text)) {
            rejectButtons.push(button);
        } else {
            otherButtons.push(button);
        }
    }
    return {
        rejectButtons,
        otherButtons,
    };
}

/**
 * @param {import('./types').ButtonData[]} buttons
 * @param {import('openai').OpenAI} openai
 * @returns {Promise<import('./types').ButtonData[]>}
 */
async function labelButtons(buttons, openai) {
    /** @type {import('./types').ButtonData[]} */
    const labelledButtons = [];
    for (const button of buttons) {
        const llmClassification = await classifyButtonTextLLM(openai, button.text);
        const regexClassification = classifyButtonTextRegex(button.text);
        labelledButtons.push({ ...button, llmClassification, regexClassification });
    }
    return labelledButtons;
}

/**
 * Run popup through LLM and regex to determine if it's a cookie popup and identify reject buttons.
 * @param {import('./types').PopupData} popup
 * @param {import('openai').OpenAI} openai
 * @returns {Promise<PopupClassificationResult>}
 */
async function classifyPopup(popup, openai) {
    const popupText = popup.text?.trim();
    let regexMatch = false;
    let llmMatch = false;
    if (popupText) {
        regexMatch = checkHeuristicPatterns(popupText);
        llmMatch = await checkLLM(openai, popupText);
    }
    // only label buttons if the popup is considered a cookie popup by regex or LLM
    const buttons = regexMatch || llmMatch ? await labelButtons(popup.buttons, openai) : popup.buttons;
    const { rejectButtons, otherButtons } = classifyButtons(buttons);

    return {
        llmMatch,
        regexMatch,
        rejectButtons,
        otherButtons,
    };
}

/**
 * @typedef {'settings'|'accept'|'reject'|'acknowledge'|'other'} ButtonClassification
 */

/**
 * @typedef {Object} PopupClassificationResult
 * @property {boolean} llmMatch
 * @property {boolean} regexMatch
 * @property {import('./types').ButtonData[]} rejectButtons
 * @property {import('./types').ButtonData[]} otherButtons
 */

module.exports = {
    classifyButtons,
    classifyPopup,
    checkHeuristicPatterns,
    classifyButtonTextRegex,
    classifyButtonTextLLM,
    cleanButtonText,
    isRejectButton,
};
