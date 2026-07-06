function normalizeBrowserLocale(locale) {
    if (!locale) {
        return null;
    }

    const normalized = locale
        .split(':')[0]
        .split('.')[0]
        .trim()
        .replace('_', '-');

    if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(normalized)) {
        return normalized;
    }

    return null;
}

function getBrowserLocale(env = process.env) {
    return normalizeBrowserLocale(env.BROWSER_LOCALE || env.LANGUAGE);
}

module.exports = {
    getBrowserLocale,
    normalizeBrowserLocale,
};
