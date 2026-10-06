const assert = require('assert');
const puppeteer = require('puppeteer');
const { getAutoconsentContentScript, cookiePopupScrapeScript } = require('../../collectors/CookiePopupsCollector');

const PAGE = `
<html><body style="margin: 0">
    <div id="banner" style="position: fixed; bottom: 0; left: 0; right: 0;">
        <p>We use cookies to improve your experience.</p>
        <button id="reject">Reject all</button>
        <button id="accept">Accept all</button>
    </div>
    <div role="dialog" id="dialog">
        <p>Choose your privacy settings</p>
        <a href="#" id="settings">Manage settings</a>
    </div>
    <div style="height: 3000px"></div>
    <footer><a href="#" id="dns">Do not sell my personal information</a></footer>
</body></html>`;

/**
 * @param {import('puppeteer').Page} page
 * @param {boolean} [withAutoconsent] inject autoconsent first, as CookiePopupsCollector does
 * @returns {Promise<import('../../collectors/CookiePopupsCollector').ScrapeScriptResult>}
 */
async function scrape(page, withAutoconsent = true) {
    await page.setContent(PAGE);
    if (withAutoconsent) {
        await page.evaluate(`window.testBinding = () => {};\n${getAutoconsentContentScript('testBinding')}`);
    }
    return /** @type {Promise<import('../../collectors/CookiePopupsCollector').ScrapeScriptResult>} */ (
        page.evaluate(cookiePopupScrapeScript)
    );
}

describe('scrapeScript', function () {
    this.timeout(30000);

    /** @type {import('puppeteer').Browser} */
    let browser;
    /** @type {import('puppeteer').Page} */
    let page;

    before(async () => {
        // only local content is loaded, so the sandbox is not needed (and is unavailable on some CI runners)
        browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    });

    // the scrape script declares top-level consts, so each run needs a fresh page
    beforeEach(async () => {
        page = await browser.newPage();
    });

    afterEach(async () => {
        await page.close();
    });

    after(async () => {
        await browser?.close();
    });

    it('uses autoconsent popup and button discovery', async () => {
        const result = await scrape(page);
        assert.strictEqual(result.isTop, true);
        assert.strictEqual(result.scrapeVersion, 2);
        assert.ok(result.cleanedText.includes('We use cookies'));

        const banner = result.potentialPopups.find((p) => p.selector.includes('#banner'));
        assert.ok(banner, 'fixed-position banner is a potential popup');
        assert.deepStrictEqual(banner.buttons.map((b) => b.text).sort(), ['Accept all', 'Reject all']);
        assert.ok(
            banner.buttons.every((b) => b.selector.includes('#reject') || b.selector.includes('#accept')),
            'buttons have unique selectors',
        );

        const dialog = result.potentialPopups.find((p) => p.selector.includes('#dialog'));
        assert.ok(dialog, 'role=dialog element is a potential popup even when not fixed-position');
        assert.deepStrictEqual(
            dialog.buttons.map((b) => b.text),
            ['Manage settings'],
        );
    });

    it('limits page-level buttons to the viewport', async () => {
        const result = await scrape(page);
        const texts = result.buttons.map((b) => b.text);
        assert.ok(texts.includes('Reject all'));
        assert.ok(!texts.includes('Do not sell my personal information'), 'footer link below the fold is excluded');
    });

    it('fails clearly when autoconsent is not loaded', async () => {
        await assert.rejects(scrape(page, false), /autoconsent content script is not loaded/);
    });
});
