function checkHeuristicPatterns(el) {
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

    const allText = el.innerText;
    for (const p of DETECT_PATTERNS) {
        const matches = allText.match(p);
        if (matches) {
            return true;
        }
    }
    return false;
}

const isVisible = (node) => {
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
};

const collectMatchingElements = (criteria) => {
    const elements = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (n) => (n instanceof HTMLElement && criteria(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    while (walker.nextNode()) {
        elements.push(walker.currentNode);
    }
    return elements;
};

const nonParentElements = (elements) => {
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
};

function getButtons(el) {
    return Array.from(el.querySelectorAll('button, input[type="button"], input[type="submit"], a[href]'));
}

function serializeResults(results) {
    return results.map((r) => ({
        html: r.el.outerHTML,
        buttons: r.buttons.map(b => b.innerText),
    }));
}

function main() {
    // Collect fixed/sticky positioned elements that are visible
    let elements = collectMatchingElements((el) => {
        if (el.tagName === 'BODY') return false;
        const computedStyle = window.getComputedStyle(el).position;
        return (computedStyle === 'fixed' || computedStyle === 'sticky') && isVisible(el);
    });

    // Filter out elements that don't match the heuristic patterns
    elements = elements.filter((e) => checkHeuristicPatterns(e));

    // Get non-parent elements
    elements = nonParentElements(elements);

    const results = [];

    // for each potential popup, get the buttons
    for (const el of elements) {
        const buttons = getButtons(el);
        results.push({
            el,
            buttons,
        });
    }

    // Return the elements
    return results;
}

const res = main();
serializeResults(res);
