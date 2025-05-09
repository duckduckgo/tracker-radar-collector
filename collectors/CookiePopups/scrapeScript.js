/**
 * Traverses the DOM including Shadow DOM and returns formatted inner text
 * from visible elements only
 * @returns {string} The formatted inner text from visible DOM elements
 */
function extractDomText() {
    const result = [];

    /**
     * Checks if an element is visible
     * @param {Element} element - The element to check
     * @returns {boolean} Whether the element is visible
     */
    function isElementVisible(element) {
        const style = window.getComputedStyle(element);

        return !(
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0" ||
            element.hidden ||
            (style.height === "0px" && style.overflow === "hidden") ||
            element.getAttribute("aria-hidden") === "true"
        );
    }

    /**
     * Checks if an element is in the viewport
     * @param {Element} element - The element to check
     * @returns {boolean} Whether any part of the element is in the viewport
     */
    function isInViewport(element) {
        const rect = element.getBoundingClientRect();

        // Element has no size and isn't viewport-positioned
        if (
            rect.width === 0 &&
            rect.height === 0 &&
            window.getComputedStyle(element).position !== "fixed"
        ) {
            return false;
        }

        return true;
    }

    /**
     * Recursively processes a DOM node and its children
     * @param {Node} node - The DOM node to process
     */
    function processNode(node) {
        // Skip script, style, and non-element nodes
        if (
            node.nodeName === "SCRIPT" ||
            node.nodeName === "STYLE" ||
            node.nodeType !== Node.ELEMENT_NODE
        ) {
            return;
        }

        // Skip invisible elements
        if (!isElementVisible(node)) {
            return;
        }

        // Skip elements not in the viewport
        // if (!isInViewport(node)) {
        //     return;
        // }

        // Get computed style for the element
        const style = window.getComputedStyle(node);

        // Check if node is a button-like element
        const isButtonLike =
            node.nodeName === "BUTTON" ||
            node.getAttribute("role") === "button" ||
            (style.cursor === "pointer" &&
                (node.onclick ||
                    node.addEventListener ||
                    node.hasAttribute("onClick")) &&
                style.display !== "none");

        // Check if node is a link
        const isLink =
            node.nodeName === "A" ||
            node.hasAttribute("href") ||
            node.getAttribute("role") === "link";

        // Get text content from this node (excluding child nodes)
        let textContent = Array.from(node.childNodes)
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent.trim())
            .join(" ")
            .trim();

        // If we have text content, add it with appropriate formatting
        if (textContent) {
            if (isButtonLike) {
                result.push(`<button>${textContent}</button>`);
            } else if (isLink) {
                result.push(`<a>${textContent}</a>`);
            } else {
                result.push(textContent);
            }
        }

        // Process normal children
        Array.from(node.children).forEach((child) => {
            processNode(child);
        });

        // Process shadow DOM if it exists
        if (node.shadowRoot) {
            Array.from(node.shadowRoot.children).forEach((shadowChild) => {
                processNode(shadowChild);
            });
        }
    }

    // Start processing from document body
    processNode(document.body);

    return result.join(" ");
}

extractDomText();
