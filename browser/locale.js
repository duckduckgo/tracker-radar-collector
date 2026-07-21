function validateBrowserLocale(locale) {
    if (locale === undefined) {
        return;
    }
    if (typeof locale !== 'string') {
        throw new TypeError(`Invalid browser locale: ${JSON.stringify(locale)}`);
    }

    try {
        Intl.getCanonicalLocales(locale);
    } catch {
        throw new TypeError(`Invalid browser locale: ${JSON.stringify(locale)}`);
    }
}

function resolveBrowserLocale(locale, env = process.env) {
    if (locale !== undefined) {
        validateBrowserLocale(locale);
        return locale;
    }

    try {
        validateBrowserLocale(env.LANGUAGE);
        return env.LANGUAGE;
    } catch {
        // LANGUAGE is inherited from the host and may not contain a BCP 47 locale.
        return undefined;
    }
}

module.exports = {
    resolveBrowserLocale,
    validateBrowserLocale,
};
