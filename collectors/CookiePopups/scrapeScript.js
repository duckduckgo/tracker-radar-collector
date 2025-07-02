/* global window, document, HTMLElement, Node, NodeFilter, location */

const BUTTON_LIKE_ELEMENT_SELECTOR = 'button, input[type="button"], input[type="submit"], a, [role="button"], [class*="button"]';
const LIMIT_TEXT_LENGTH = 150000;
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
    // we want to be lenient here: if a non-input element has a disabled attribute, we want to consider it too
    return ('disabled' in el && Boolean(el.disabled)) || el.hasAttribute('disabled');
}

/**
 * Leave only elements that do not contain any other elements
 * @param {HTMLElement[]} elements
 * @returns {HTMLElement[]}
 */
function excludeContainers(elements) {
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
 * Heuristic to get all elements that look like "popups"
 * TODO: this heuristic is too strict, not all popups are actually sticky/fixed
 * @returns {HTMLElement[]}
 */
function getPopupLikeElements() {
    const walker = document.createTreeWalker(
        document.documentElement,
        NodeFilter.SHOW_ELEMENT,      // visit only element nodes
        {
            /**
             * @param {HTMLElement} node
             */
            acceptNode(node) {
                if (node.tagName === 'BODY') {
                    return NodeFilter.FILTER_SKIP;
                }
                const cssPosition = window.getComputedStyle(node).position;
                if ((cssPosition === 'fixed' || cssPosition === 'sticky') && isVisible(node)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }
        }
    );

    const found = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        found.push(/** @type {HTMLElement} */ (node));
    }
    return excludeContainers(found);
}

function getDocumentText() {
    /**
     * @param {Node} root
     */
    function collectShadowDOMText(root) {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            {
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
                }
            }
        );

        let result = '';
        let node = walker.nextNode();

        while (node) {
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
            node = walker.nextNode();
        }

        return result;
    }

    const visibleText = (document.body ?? document.documentElement).innerText;
    const shadowText = collectShadowDOMText(document.documentElement);
    return `${visibleText} ${shadowText}`.trim();
}

/**
 * @param {HTMLElement} el
 * @returns {HTMLElement[]}
 */
function getButtonLikeElements(el) {
    return Array.from(el.querySelectorAll(BUTTON_LIKE_ELEMENT_SELECTOR));
}

/**
 * Serialize all actionable buttons on the page
 * @param {HTMLElement} el
 * @returns {import('../CookiePopupCollector').ButtonData[]}
 */
function getButtonData(el) {
    const actionableButtons = excludeContainers(getButtonLikeElements(el))
        .filter(b => isVisible(b) && !isDisabled(b));

    return actionableButtons.map(b => ({
        text: b.innerText,
        selector: getUniqueSelector(b),
    }));
}

/**
 * Naive selector escaping. Use with caution.
 * @param {string} selector
 * @returns {string}
 */
function insecureEscapeSelectorPart(selector) {
    return selector.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
}

/**
 * Get the selector for an element
 * @param {HTMLElement} el - The element to get the selector for
 * @param {{ order?: boolean, ids?: boolean, dataAttributes?: boolean, classes?: boolean, absoluteOrder?: boolean }} specificity - details to add to the selector
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
                (
                    siblings.length > 1 &&
                    parent !== document.body && // element order under <body> is often unstable.
                    parent !== document.documentElement
                )
            ) {
                localSelector += `:nth-child(${siblings.indexOf(element) + 1})`;
            }
        }

        if (specificity.ids) {
            if (element.id) {
                localSelector += `#${insecureEscapeSelectorPart(element.id)}`;
            } else if (!element.hasAttribute('id')) { // do not add it for id attribute without a value
                localSelector += `:not([id])`;
            }
        }

        if (specificity.dataAttributes) {
            const dataAttributes = Array.from(element.attributes).filter(a => a.name.startsWith('data-'));
            dataAttributes.forEach(a => {
                const escapedValue = insecureEscapeSelectorPart(a.value);
                localSelector += `[${a.name}="${escapedValue}"]`;
            });
        }

        if (specificity.classes) {
            const classes = Array.from(element.classList);
            if (classes.length > 0) {
                localSelector += `.${classes.map(c => insecureEscapeSelectorPart(c)).join('.')}`;
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
    // We need to strike a balance here. Selector has to be unique, but we want to avoid auto-generated (randomized) identifiers to make the it resilient. Assumptions:
    // - Classes are the most common thing to randomize, so we use them as the last resort.
    // - The general shape of the DOM doesn't change that much, so order is always preferred
    // - data attributes can contain anything, so don't add them by default
    // - IDs are often used on the popup containers, so are very useful. And they are definitely less commonly randomized than classes, but it's still possible, so we may want to change this logic later if we see randomized ids in the results.
    const specificity = {
        order: true,
        ids: true, // consider disabling this by default for auto-generated IDs
        dataAttributes: false,
        classes: false,
        absoluteOrder: false,
    };
    let selector = getSelector(el, specificity);

    // verify that the selector is unique
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

    return selector;
}

/**
 * @param {boolean} isFramed
 * @returns {import('../CookiePopupCollector').PopupData[]}
 */
function collectPotentialPopups(isFramed) {
    let elements = [];
    if (!isFramed) {
        elements = getPopupLikeElements();
    } else {
        // for iframes, just take the whole document
        const doc = document.body || document.documentElement;
        if (doc && isVisible(doc) && doc.innerText) {
            elements.push(doc);
        }
    }

    /**
     * @type {import('../CookiePopupCollector').PopupData[]}
     */
    const potentialPopups = [];

    // for each potential popup, get the buttons
    for (const el of elements) {
        if (el.innerText) {
            potentialPopups.push({
                text: el.innerText,
                selector: getUniqueSelector(el),
                buttons: getButtonData(el),
            });
        }
    }

    return potentialPopups;
}

/**
 * @returns {import('../CookiePopupCollector').ContentScriptResult}
 */
function scrapePage() {
    const isFramed = window.top !== window || location.ancestorOrigins?.length > 0;
    // do not inspect frames that are more than one level deep
    if (isFramed && window.parent && window.parent !== window.top) {
        return {
            isTop: !isFramed,
            origin: window.location.origin,
            buttons: [],
            cleanedText: '',
            potentialPopups: [],
        };
    }

    return {
        isTop: !isFramed,
        origin: window.location.origin,
        buttons: getButtonData(document.documentElement),
        cleanedText: getDocumentText().slice(0, LIMIT_TEXT_LENGTH),
        potentialPopups: collectPotentialPopups(isFramed),
    };
}

scrapePage();
