/* global window, document, HTMLElement, Node, NodeFilter, location, NamedNodeMap, DOMTokenList, DOMException, CSS */

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

        if (localSelector === 'input' && element.getAttribute('type')) {
            // for inputs, record the type
            localSelector += `[type="${CSS.escape(element.getAttribute('type'))}"]`;
        }

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

function highlightNode(node) {
    if (!node.style) return;
    if (node.__oldStyles !== undefined) {
        return; // already highlighted
    }
    if (node.hasAttribute('style')) {
        node.__oldStyles = node.style.cssText;
    }
    node.style.animation = 'pulsate .5s infinite';
    node.style.outline = 'solid red';

    let styleTag = document.querySelector('style#autoconsent-debug-styles');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'autoconsent-debug-styles';
    }

    styleTag.textContent = `
      @keyframes pulsate {
        0% {
          outline-width: 8px;
          outline-offset: -4px;
        }
        50% {
          outline-width: 4px;
          outline-offset: -2px;
        }
        100% {
          outline-width: 8px;
          outline-offset: -4px;
        }
      }
    `;
    document.head.appendChild(styleTag);
}

function clickElement(x, y) {
    const el = /** @type {HTMLElement} */ (document.elementFromPoint(x, y));
    let selector = null;
    if (el && el.nodeName !== 'IFRAME') {
        selector = getUniqueSelector(el);
        // highlightNode(el);
        el.click();
    }
    return selector;
}
