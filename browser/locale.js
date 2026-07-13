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

module.exports = {
    validateBrowserLocale,
};
