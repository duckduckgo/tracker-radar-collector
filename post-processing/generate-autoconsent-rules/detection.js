const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');
const { REJECT_PATTERNS, NEVER_MATCH_PATTERNS } = require('./button-patterns');

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
        /by clicking.{0,100}(?:accept|agree|allow)/gi,
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
        /nous.{0,100}utilisons.{0,100}des/gi,
        /des.{0,100}cookies.{0,100}pour/gi,
        /des.{0,100}informations.{0,100}sur/gi,
        /retirer.{0,100}votre.{0,100}consentement/gi,
        /accéder.{0,100}à.{0,100}des/gi,
        /à.{0,100}des.{0,100}informations/gi,
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
    if (!buttonText) {
        return false;
    }
    const cleanedButtonText = cleanButtonText(buttonText);
    return (
        !NEVER_MATCH_PATTERNS.some((p) => p.test(cleanedButtonText)) &&
        REJECT_PATTERNS.some((p) => (p instanceof RegExp && p.test(cleanedButtonText)) || p === cleanedButtonText)
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
            model: 'gpt-4.1-nano-2025-04-14',
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

    const { rejectButtons, otherButtons } = classifyButtons(popup.buttons);

    return {
        llmMatch,
        regexMatch,
        rejectButtons,
        otherButtons,
    };
}

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
};
