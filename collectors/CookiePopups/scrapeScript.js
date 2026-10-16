/* global window, document, HTMLElement, Node, NodeFilter, location, NamedNodeMap, DOMTokenList, DOMException, CSS */

// Popup and button discovery comes from autoconsent (window.autoconsentHeuristics), which CookiePopupsCollector
// injects into the same isolated world before this script runs.

const LIMIT_TEXT_LENGTH = 150000;
// autoconsent stops walking the DOM after this many ms; it uses 100ms in browsers, the crawler can afford more
const POPUP_SEARCH_TIMEOUT = 2000;
// bump when the shape or semantics of the scraped data change
const SCRAPE_VERSION = 2;

/**
 * @typedef {import('../../node_modules/@duckduckgo/autoconsent/lib/types').ButtonData} HeuristicButton
 * @typedef {{
 *  getPotentialPopups(timeout?: number): import('../../node_modules/@duckduckgo/autoconsent/lib/types').PopupData[],
 *  getButtonData(el: HTMLElement): HeuristicButton[],
 * }} AutoconsentHeuristics
 */
const ELEMENT_TAGS_TO_SKIP = [
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'META',
    'LINK',
    'SVG',
    'CANVAS',
    'IFRAME',
    'FRAME',
    'FRAMESET',
    'NOFRAMES',
    'NOEMBED',
    'AUDIO',
    'VIDEO',
    'SOURCE',
    'TRACK',
    'PICTURE',
    'IMG',
    'MAP',
];

/**
 * Page-level buttons are limited to the viewport, so that footer links are not mistaken for popup buttons.
 * @param {HTMLElement} node
 * @returns {boolean}
 */
function isInViewport(node) {
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

function getDocumentText() {
    /**
     * @param {Node} root
     */
    function collectShadowDOMText(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            /**
             * @param {Node} node
             */
            acceptNode(node) {
                const element = /** @type {HTMLElement} */ (node);
                // Accept elements with shadow roots for special handling
                if (element.shadowRoot) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                // Skip other elements but continue traversing their children
                return NodeFilter.FILTER_SKIP;
            },
        });

        let result = '';
        let node;
        while ((node = walker.nextNode())) {
            const element = /** @type {HTMLElement} */ (node);
            let shadowText = '';
            for (const child of element.shadowRoot.children) {
                if (child instanceof HTMLElement && !ELEMENT_TAGS_TO_SKIP.includes(child.tagName)) {
                    shadowText += ' ' + child.innerText;
                }
                if (child.shadowRoot) {
                    shadowText += ' ' + collectShadowDOMText(child);
                }
            }
            if (shadowText.trim()) {
                result += ' ' + shadowText.trim();
            }
        }

        return result;
    }

    const visibleText = (document.body ?? document.documentElement).innerText;
    const shadowText = collectShadowDOMText(document.documentElement);
    return `${visibleText} ${shadowText}`.trim();
}

/**
 * Get the selector for an element
 * @param {HTMLElement} el - The element to get the selector for
 * @param {{ order?: boolean, ids?: boolean, dataAttributes?: boolean, classes?: boolean, absoluteOrder?: boolean, testid?: boolean }} specificity - details to add to the selector
 * @returns {string} The selector for the element
 */
function getSelector(el, specificity) {
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

        if (specificity.order) {
            if (
                specificity.absoluteOrder ||
                (siblings.length > 1 &&
                    parent !== document.body && // element order under <body> is often unstable.
                    parent !== document.documentElement)
            ) {
                localSelector += `:nth-child(${siblings.indexOf(element) + 1})`;
            }
        }

        if (specificity.ids && tagName !== 'body') {
            // use getAttribute() instead of element.id to protect against DOM clobbering
            if (element.getAttribute('id')) {
                localSelector += `#${CSS.escape(element.getAttribute('id'))}`;
            } else if (!element.hasAttribute('id')) {
                // do not add it for id attribute without a value
                localSelector += `:not([id])`;
            }
        }

        if (specificity.dataAttributes && element.attributes instanceof NamedNodeMap) {
            const dataAttributes = Array.from(element.attributes).filter((a) => a.name.startsWith('data-'));
            dataAttributes.forEach((a) => {
                const escapedValue = CSS.escape(a.value);
                localSelector += `[${a.name}="${escapedValue}"]`;
            });
        } else if (specificity.testid) {
            // data-testid is a common attribute used by testing frameworks to identify elements
            const testid = element.getAttribute('data-testid');
            if (testid) {
                localSelector += `[data-testid="${CSS.escape(testid)}"]`;
            }
        }

        if (specificity.classes && element.classList instanceof DOMTokenList) {
            const classes = Array.from(element.classList);
            if (classes.length > 0) {
                localSelector += `.${classes.map((c) => CSS.escape(c)).join('.')}`;
            }
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
    const cached = selectorCache.get(el);
    if (cached) {
        return cached;
    }
    const selector = computeUniqueSelector(el);
    selectorCache.set(el, selector);
    return selector;
}

// buttons often appear both in a popup and in the page-level list
/** @type {Map<HTMLElement, string>} */
const selectorCache = new Map();

/**
 * @param {HTMLElement} el
 * @returns {string}
 */
function computeUniqueSelector(el) {
    // We need to strike a balance here. Selector has to be unique, but we want to avoid auto-generated (randomized) identifiers to make the it resilient. Assumptions:
    // - Classes are the most common thing to randomize, so we use them as the last resort.
    // - The general shape of the DOM doesn't change that much, so order is always preferred
    // - data attributes can contain anything, so don't add them by default (except for data-testid, which is usually fine)
    // - IDs are often used on the popup containers, so are very useful. Sometimes they are randomized too, but it's not as common.
    const specificity = {
        testid: true,
        ids: true,
        order: true,
        dataAttributes: false,
        classes: false,
        absoluteOrder: false,
    };
    let selector = getSelector(el, specificity);

    // increase specificity until the selector is unique
    try {
        if (document.querySelectorAll(selector).length > 1) {
            specificity.order = true;
            selector = getSelector(el, specificity);
        }

        if (document.querySelectorAll(selector).length > 1) {
            specificity.ids = true;
            selector = getSelector(el, specificity);
        }

        if (document.querySelectorAll(selector).length > 1) {
            specificity.dataAttributes = true;
            selector = getSelector(el, specificity);
        }

        if (document.querySelectorAll(selector).length > 1) {
            specificity.classes = true;
            selector = getSelector(el, specificity);
        }

        if (document.querySelectorAll(selector).length > 1) {
            specificity.absoluteOrder = true;
            selector = getSelector(el, specificity);
        }
    } catch (e) {
        console.error(`Error getting unique selector for`, el, e);
        if (e instanceof DOMException && e.message.includes('is not a valid selector')) {
            return 'cookiepopups-collector-selector-error';
        }
    }

    return selector;
}

/**
 * @param {HeuristicButton} button
 * @returns {import('../CookiePopupsCollector').ButtonData}
 */
function serializeButton(button) {
    return {
        text: button.text,
        selector: getUniqueSelector(button.element),
    };
}

/**
 * @returns {import('../CookiePopupsCollector').ScrapeScriptResult}
 */
function scrapePage() {
    /** @type {AutoconsentHeuristics | undefined} */
    // @ts-expect-error set by autoconsent.playwright.js
    const heuristics = window.autoconsentHeuristics;
    if (!heuristics) {
        throw new Error('autoconsent content script is not loaded in this context');
    }
    const isFramed = window.top !== window || location.ancestorOrigins?.length > 0;
    const base = { isTop: !isFramed, origin: window.location.origin, scrapeVersion: SCRAPE_VERSION };
    // do not inspect frames that are more than one level deep
    if (isFramed && window.parent && window.parent !== window.top) {
        return { ...base, buttons: [], cleanedText: '', potentialPopups: [] };
    }

    return {
        ...base,
        buttons: heuristics
            .getButtonData(document.documentElement)
            .filter((b) => isInViewport(b.element))
            .map(serializeButton),
        cleanedText: getDocumentText().slice(0, LIMIT_TEXT_LENGTH),
        potentialPopups: heuristics.getPotentialPopups(POPUP_SEARCH_TIMEOUT).map((popup) => ({
            text: popup.text,
            selector: getUniqueSelector(popup.element),
            buttons: popup.buttons.map(serializeButton),
        })),
    };
}

scrapePage();
