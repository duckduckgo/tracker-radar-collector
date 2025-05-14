const REJECT_PATTERNS = [
    // e.g. "i reject cookies", "reject all", "reject all cookies", "reject cookies", "deny all", "deny all cookies", "refuse", "refuse all", "refuse cookies", "refuse all cookies", "deny", "reject all and close", "deny all and close", "reject non-essential cookies", "reject optional cookies", "reject additional cookies", "reject targeting cookies", "reject marketing cookies", "reject analytics cookies", "reject tracking cookies", "reject advertising cookies", "reject all and close", "deny all and close"
    /^\s*(i)?\s*(reject|deny|refuse|decline|disable)\s*(all)?\s*(non-essential|optional|additional|targeting|analytics|marketing|unrequired|non-necessary|extra|tracking|advertising)?\s*(cookies)?\s*(and\s+close)?\s*$/i,

    // e.g. "i do not accept", "i do not accept cookies", "do not accept", "do not accept cookies"
    /^\s*(i)?\s*do\s+not\s+accept\s*(cookies)?\s*$/i,

    // e.g. "continue without accepting", "continue without agreeing", "continue without agreeing →"
    /^\s*(continue|proceed|continue\s+browsing)\s+without\s+(accepting|agreeing|consent|cookies|tracking)(\s*→)?\s*$/i,

    // e.g. "strictly necessary cookies only", "essential cookies only", "required only", "use necessary cookies only"
    // note that "only" is required
    /^\s*(use|accept|allow|continue\s+with)?\s*(strictly)?\s*(necessary|essential|required)?\s*(cookies)?\s*only\s*$/i,

    // e.g. "allow essential cookies", "allow necessary",
    // note that "essential" is required
    /^\s*(use|accept|allow|continue\s+with)?\s*(strictly)?\s*(necessary|essential|required)\s*(cookies)?\s*$/i,

    // e.g. "accept only essential cookies", "use only necessary cookies", "allow only essential", "continue with only essential cookies"
    // note that "only" is required
    /^\s*(use|accept|allow|continue\s+with)?\s*only\s*(strictly)?\s*(necessary|essential|required)?\s*(cookies)?\s*$/i,

    // e.g. "do not sell or share my personal information", "do not sell my personal information"
    // often used in CCPA
    /^\s*do\s+not\s+sell(\s+or\s+share)?\s*my\s*personal\s*information\s*$/i,

    /* These are impactful, but look error-prone
    // e.g. "disagree"
    /^\s*(i)?\s*disagree\s*(and\s+close)?\s*$/i,
    // e.g. "i do not agree"
    /^\s*(i\s+)?do\s+not\s+agree\s*$/i,
    */
];

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
    return REJECT_PATTERNS.some(p => p.test(buttonText));
}

/**
 * @param {HTMLElement} node
 * @returns {boolean}
 */
function isVisible(node) {
    if (!node.isConnected) {
        return false;
    }
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
    }
    const rect = node.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth &&
        rect.bottom > 0 &&
        rect.right > 0
    );
}

/**
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isDisabled(el) {
    // @ts-expect-error disabled is a property of input elements
    return el.disabled || el.getAttribute('disabled') === 'true';
}

/**
 * @param {(el: HTMLElement) => boolean} filterFn
 * @returns {HTMLElement[]}
 */
function matchElements(filterFn) {
    const elements = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (n) => (n instanceof HTMLElement && filterFn(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    while (walker.nextNode()) {
        elements.push(/** @type {HTMLElement} */ (walker.currentNode));
    }
    return elements;
}

/**
 * Leave only elements that do not contain any other elements
 * @param {HTMLElement[]} elements
 * @returns {HTMLElement[]}
 */
function nonParentElements(elements) {
    const results = [];
    if (elements.length > 0) {
        for (let i = elements.length - 1; i >= 0; i--) {
            let container = false;
            for (let j = 0; j < elements.length; j++) {
                if (i !== j && elements[i].contains(elements[j])) {
                    container = true;
                    break;
                }
            }
            if (!container) {
                results.push(elements[i]);
            }
        }
    }
    return results;
}

/**
 * @param {HTMLElement} el
 * @returns {HTMLElement[]}
 */
function getButtons(el) {
    return Array.from(el.querySelectorAll('button, input[type="button"], input[type="submit"], a[href], [role="button"], [class*="button"]'));
}

/**
 * @param {boolean} isFramed
 */
function collectPotentialPopups(isFramed) {
    let elements = [];
    if (!isFramed) {
        // Collect fixed/sticky positioned elements that are visible
        elements = matchElements((el) => {
            if (el.tagName === 'BODY') return false;
            const computedStyle = window.getComputedStyle(el).position;
            return (computedStyle === 'fixed' || computedStyle === 'sticky') && isVisible(el);
        });

        // Get non-parent elements
        elements = nonParentElements(elements);
    } else {
        // for iframes, just take the whole document
        const doc = document.body || document.documentElement;
        if (doc && isVisible(doc) && doc.innerText) {
            elements.push(doc);
        }
    }

    const results = [];

    // for each potential popup, get the buttons
    for (const el of elements) {
        const regexMatch = checkHeuristicPatterns(el.innerText);
        const buttons = nonParentElements(getButtons(el))
            .filter(b => isVisible(b) && !isDisabled(b));
        const rejectButtons = [];
        const otherButtons = [];
        for (const b of buttons) {
            if (isRejectButton(b.innerText)) {
                rejectButtons.push(b);
            } else {
                otherButtons.push(b);
            }
        }
        if (el.innerText) {
            results.push({
                el,
                rejectButtons,
                otherButtons,
                regexMatch,
                isTop: !isFramed,
                origin: window.location.origin,
            });
        }
    }

    // Return the elements
    return results;
}

/**
 * Get the selector for an element
 * @param {HTMLElement} el - The element to get the selector for
 * @returns {string} The selector for the element
 */
function getSelector(el) {
    let element = el;
    let parent;
    let result = '';

    if (element.nodeType !== Node.ELEMENT_NODE) {
        return result; // Should be an empty string if not an element, or handle as an error
    }

    parent = element.parentNode;

    while (parent instanceof HTMLElement) {
        const siblings = Array.from(parent.children);
        const tagName = element.tagName.toLowerCase();
        let localSelector = tagName;

        if (element.id) {
            localSelector += `#${element.id}`;
        } else if (!element.hasAttribute('id')) { // do not add it for id attribute without a value
            localSelector += `:not([id])`;
        }

        if (siblings.length > 1 &&
            parent !== document.body && // element order under <body> is often unstable.
            parent !== document.documentElement
        ) {
            localSelector += `:nth-child(${siblings.indexOf(element) + 1})`
        }

        result = localSelector + (result ? ' > ' + result : '');
        element = parent;
        parent = element.parentNode;
    }

    return result;
}

/**
 * Get a unique selector for an element
 * @param {HTMLElement} el - The element to get the unique selector for
 * @returns {string} The unique selector for the element
 */
function getUniqueSelector(el) {
    const selector = getSelector(el);
    // verify that the selector is unique
    if (document.querySelectorAll(selector).length > 1) {
        // FIXME: try a more strict selector with class names, data attributes, etc.
        return 'FIXME';
    }
    return selector;
}

/**
 * @returns {import('../CookiePopupCollector').ContentScriptResult}
 */
function serializeResults() {
    let isFramed = window.top !== window || location.ancestorOrigins?.length > 0;
    // do not inspect frames that are more than one level deep
    if (isFramed && window.parent && window.parent !== window.top) {
        return {
            potentialPopups: [],
        };
    }

    const potentialPopups = collectPotentialPopups(isFramed);
    return {
        potentialPopups: potentialPopups.map((r) => ({
            // html: r.el.outerHTML,
            text: r.el.innerText,
            rejectButtons: r.rejectButtons.map(b => ({
                text: b.innerText,
                selector: getUniqueSelector(b),
            })),
            otherButtons: r.otherButtons.map(b => ({
                text: b.innerText,
                selector: getUniqueSelector(b),
            })),
            regexMatch: r.regexMatch,
            isTop: r.isTop,
            origin: r.origin,
        })),
    };
}

serializeResults();
