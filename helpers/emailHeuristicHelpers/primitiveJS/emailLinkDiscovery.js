(() => {
    // To add or remove keywords, edit this array directly.
    const KEYWORDS = [
        'newsletter',
        'subscribe',
        'subscription',
        'signup',
        'sign-up',
        'sign up',
        'register',
        'registration',
        'login',
        'log-in',
        'log in',
        'signin',
        'sign-in',
        'sign in',
        'account',
        'join',
        'waitlist',
        'contact',
        'mailing',
        'alerts',
        'updates',
        'member',
    ];

    const seen = new Set();
    const links = [];

    for (const a of /** @type {NodeListOf<HTMLAnchorElement>} */ (document.querySelectorAll('a[href]'))) {
        try {
            const abs = new URL(a.href, location.href);
            if (abs.origin !== location.origin) continue;

            const href = abs.href.split('#')[0];
            if (seen.has(href)) continue;

            const text = (a.textContent + ' ' + a.getAttribute('href')).toLowerCase();
            if (!KEYWORDS.some((k) => text.includes(k))) continue;

            seen.add(href);
            links.push(href);
        } catch {
            /* skip malformed href */
        }
    }

    return links;
})();
