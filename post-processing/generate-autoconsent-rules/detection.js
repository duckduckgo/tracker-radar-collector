const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');


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
        /by clicking.*(accept|agree|allow)/gi,
        /by continuing/gi,
        /we (use|serve)( optional)? cookies/gi,
        /we are using cookies/gi,
        /use of cookies/gi,
        /(this|our) (web)?site.*cookies/gi,
        /cookies (and|or) .* technologies/gi,
        /such as cookies/gi,
        /read more about.*cookies/gi,
        /consent to.*cookies/gi,
        /we and our partners.*cookies/gi,
        /we.*store.*information.*such as.*cookies/gi,
        /store and\/or access information.*on a device/gi,
        /personalised ads and content, ad and content measurement/gi,

        // it might be tempting to add the patterns below, but they cause too many false positives. Don't do it :)
        // /cookies? settings/i,
        // /cookies? preferences/i,
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
 * @returns {boolean}
 */
function isRejectButton(buttonText) {
    const REJECT_PATTERNS = [
        // e.g. "i reject cookies", "reject all", "reject all cookies", "reject cookies", "deny all", "deny all cookies", "refuse", "refuse all", "refuse cookies", "refuse all cookies", "deny", "reject all and close", "deny all and close", "reject non-essential cookies", "reject all non-essential cookies and continue", "reject optional cookies", "reject additional cookies", "reject targeting cookies", "reject marketing cookies", "reject analytics cookies", "reject tracking cookies", "reject advertising cookies", "reject all and close", "deny all and close"
        // note that "reject and subscribe" and "reject and pay" are excluded
        /^\s*(i)?\s*(reject|deny|refuse|decline|disable)\s*(all)?\s*(non-essential|optional|additional|targeting|analytics|marketing|unrequired|non-necessary|extra|tracking|advertising)?\s*(cookies)?\s*(and\s+(?!subscribe|pay)\w+)?\s*$/i,

        // e.g. "i do not accept", "i do not accept cookies", "do not accept", "do not accept cookies"
        /^\s*(i)?\s*do\s+not\s+accept\s*(cookies)?\s*$/i,

        // e.g. "continue without accepting", "continue without agreeing", "continue without agreeing →"
        /^\s*(continue|proceed|continue\s+browsing)\s+without\s+(accepting|agreeing|consent|cookies|tracking)(\s*→)?\s*$/i,

        // e.g. "strictly necessary cookies only", "essential cookies only", "required only", "use necessary cookies only", "essentials only"
        // note that "only" is required
        /^\s*(use|accept|allow|continue\s+with)?\s*(strictly)?\s*(necessary|essentials?|required)?\s*(cookies)?\s*only\s*$/i,

        // e.g. "allow essential cookies", "allow necessary", "allow essentials", "allow essentials only"
        // note that "essential" is required
        /^\s*(use|accept|allow|continue\s+with)?\s*(strictly)?\s*(necessary|essentials?|required)\s*(cookies)?\s*$/i,

        // e.g. "accept only essential cookies", "use only necessary cookies", "allow only essential", "only essentials", "continue with only essential cookies"
        // note that "only" is required
        /^\s*(use|accept|allow|continue\s+with)?\s*only\s*(strictly)?\s*(necessary|essentials?|required)?\s*(cookies)?\s*$/i,

        // e.g. "do not sell or share my personal information", "do not sell my personal information"
        // often used in CCPA
        /^\s*do\s+not\s+sell(\s+or\s+share)?\s*my\s*personal\s*information\s*$/i,

        // These are impactful, but look error-prone
        // // e.g. "disagree"
        // /^\s*(i)?\s*disagree\s*(and\s+close)?\s*$/i,
        // // e.g. "i do not agree"
        // /^\s*(i\s+)?do\s+not\s+agree\s*$/i,
    ];
    return REJECT_PATTERNS.some(p => p.test(buttonText));
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
            // eslint-disable-next-line camelcase
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
 * Run popup through LLM and regex to determine if it's a cookie popup and identify reject buttons.
 * @param {import('./main').PopupData} popup
 * @param {import('openai').OpenAI} openai
 * @returns {Promise<import('./main').ProcessedCookiePopup | null>}
 */
async function applyDetectionHeuristics(popup, openai) {
    const popupText = popup.text?.trim();
    if (!popupText) {
        return null;
    }
    const regexMatch = checkHeuristicPatterns(popupText);
    const llmMatch = await checkLLM(openai, popupText);

    /** @type {import('./main').ButtonData[]} */
    const rejectButtons = [];
    /** @type {import('./main').ButtonData[]} */
    const otherButtons = [];

    popup.buttons.forEach(button => {
        if (isRejectButton(button.text)) {
            rejectButtons.push(button);
        } else {
            otherButtons.push(button);
        }
    });

    return {
        ...popup,
        llmMatch,
        regexMatch,
        rejectButtons,
        otherButtons,
    };
}

module.exports = {
    applyDetectionHeuristics,
    checkHeuristicPatterns,
};
