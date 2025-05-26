/* global window, document, HTMLElement, Node, NodeFilter, location */

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
        acceptNode: n => (n instanceof HTMLElement && filterFn(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
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
                localSelector += `#${element.id}`;
            } else if (!element.hasAttribute('id')) { // do not add it for id attribute without a value
                localSelector += `:not([id])`;
            }
        }

        if (specificity.dataAttributes) {
            const dataAttributes = Array.from(element.attributes).filter(a => a.name.startsWith('data-'));
            dataAttributes.forEach(a => {
                const escapedValue = a.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                localSelector += `[${a.name}="${escapedValue}"]`;
            });
        }

        if (specificity.classes) {
            const classes = Array.from(element.classList);
            if (classes.length > 0) {
                localSelector += `.${classes.join('.')}`;
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
 */
function collectPotentialPopups(isFramed) {
    let elements = [];
    if (!isFramed) {
        // Collect fixed/sticky positioned elements that are visible
        elements = matchElements(el => {
            if (el.tagName === 'BODY') {
                return false;
            }
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
        const buttons = nonParentElements(getButtons(el))
            .filter(b => isVisible(b) && !isDisabled(b));
        if (el.innerText) {
            results.push({
                el,
                selector: getUniqueSelector(el),
                buttons,
                isTop: !isFramed,
                origin: window.location.origin,
            });
        }
    }

    // Return the elements
    return results;
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
        potentialPopups: potentialPopups.map(r => ({
            // html: r.el.outerHTML,
            text: r.el.innerText,
            selector: r.selector,
            buttons: r.buttons.map(b => ({
                text: b.innerText,
                selector: getUniqueSelector(b),
            })),
            isTop: r.isTop,
            origin: r.origin,
        })),
    };
}

serializeResults();
