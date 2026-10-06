const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');
const {
    checkHeuristicPatterns: matchHeuristicPatterns,
    classifyButtonTextRegex,
    cleanButtonText,
    isExcludedPopup,
} = require('@duckduckgo/autoconsent/heuristics');

/**
 * @param {string} allText
 * @returns {boolean}
 */
function checkHeuristicPatterns(allText) {
    return matchHeuristicPatterns(allText).patterns.length > 0;
}

/**
 * @param {string} buttonText
 * @returns {boolean}
 */
function isRejectButton(buttonText) {
    return classifyButtonTextRegex(buttonText) === 'reject';
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
        regexMatch = !isExcludedPopup(popupText) && checkHeuristicPatterns(popupText);
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
 * @typedef {import('@duckduckgo/autoconsent/heuristics').ButtonRegexClassification} ButtonClassification
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
