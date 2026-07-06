const assert = require('assert');
const { getBrowserLocale, normalizeBrowserLocale } = require('../../browser/locale');

assert.strictEqual(normalizeBrowserLocale('de-DE'), 'de-DE');
assert.strictEqual(normalizeBrowserLocale('de_DE.UTF-8'), 'de-DE');
assert.strictEqual(normalizeBrowserLocale('fr-FR:en'), 'fr-FR');
assert.strictEqual(normalizeBrowserLocale('C.UTF-8'), null);
assert.strictEqual(normalizeBrowserLocale(''), null);

assert.strictEqual(getBrowserLocale({ BROWSER_LOCALE: 'en-GB', LANGUAGE: 'de-DE' }), 'en-GB');
assert.strictEqual(getBrowserLocale({ LANGUAGE: 'ja-JP' }), 'ja-JP');
assert.strictEqual(getBrowserLocale({}), null);
