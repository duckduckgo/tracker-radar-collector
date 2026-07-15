const assert = require('assert');
const { resolveBrowserLocale, validateBrowserLocale } = require('../../browser/locale');

assert.doesNotThrow(() => validateBrowserLocale('de'));
assert.doesNotThrow(() => validateBrowserLocale('de-DE'));
assert.doesNotThrow(() => validateBrowserLocale('EN-us'));
assert.doesNotThrow(() => validateBrowserLocale());
assert.throws(() => validateBrowserLocale('de_DE.UTF-8'), /Invalid browser locale/);
assert.throws(() => validateBrowserLocale('fr-FR:en'), /Invalid browser locale/);
assert.throws(() => validateBrowserLocale(''), /Invalid browser locale/);

assert.strictEqual(resolveBrowserLocale(undefined, { LANGUAGE: 'de' }), 'de');
assert.strictEqual(resolveBrowserLocale('fr', { LANGUAGE: 'de' }), 'fr');
assert.strictEqual(resolveBrowserLocale(undefined, {}), undefined);
assert.strictEqual(resolveBrowserLocale(undefined, { LANGUAGE: 'de_DE.UTF-8' }), undefined);
assert.strictEqual(resolveBrowserLocale(undefined, { LANGUAGE: 'fr_FR.UTF-8:en_US:en' }), undefined);
assert.strictEqual(resolveBrowserLocale(undefined, { LANGUAGE: 'C.UTF-8' }), undefined);
assert.throws(() => resolveBrowserLocale('de_DE.UTF-8', { LANGUAGE: 'de' }), /Invalid browser locale/);
