(el => ({
    id: el.id || '',
    type: el.getAttribute('type') || '',
    nodeType: el.nodeName || '',
    name: el.getAttribute('name') || '',
    href: el.href || '',
    class: el.className || '',
    innerText: (el.innerText || '').trim(),
    ariaLabel: el.ariaLabel || '',
    placeholder: el.getAttribute('placeholder') || '',
    xpath: (typeof fathom !== 'undefined') ? fathom.getXPath(el) : '',
    onTop: (typeof fathom !== 'undefined') ? fathom.isOnTop(el) : false,
}))