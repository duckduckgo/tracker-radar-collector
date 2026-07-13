const assert = require('assert');
const { validateBrowserLocale } = require('../../browser/locale');

assert.doesNotThrow(() => validateBrowserLocale('de-DE'));
assert.doesNotThrow(() => validateBrowserLocale('EN-us'));
assert.doesNotThrow(() => validateBrowserLocale());
assert.throws(() => validateBrowserLocale('de_DE.UTF-8'), /Invalid browser locale/);
assert.throws(() => validateBrowserLocale('fr-FR:en'), /Invalid browser locale/);
assert.throws(() => validateBrowserLocale(''), /Invalid browser locale/);
