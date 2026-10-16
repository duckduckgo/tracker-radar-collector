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

// a banner in the normal page flow, which only hit-testing finds
const IN_FLOW_PAGE = `
<html><body style="margin: 0">
    <div id="inflow" style="height: 100px;">
        <p style="margin: 0">We use cookies to improve your experience. Read our <a href="#">Privacy Policy</a>.</p>
        <button>Reject all</button>
        <button>Accept all</button>
    </div>
    <div style="height: 3000px"></div>
</body></html>`;

/**
 * @param {import('puppeteer').Page} page
 * @param {boolean} [withAutoconsent] inject autoconsent first, as CookiePopupsCollector does
 * @param {string} [html]
 * @param {number} [scrollY] scroll the page before scraping
 * @returns {Promise<import('../../collectors/CookiePopupsCollector').ScrapeScriptResult>}
 */
async function scrape(page, withAutoconsent = true, html = PAGE, scrollY = 0) {
    await page.setContent(html);
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
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
        assert.strictEqual(result.scrapeVersion, 3);
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

    it('records the viewport and where the popups are', async () => {
        const result = await scrape(page);
        const { width, height } = page.viewport() ?? { width: 0, height: 0 };
        assert.deepStrictEqual(result.viewport, { width, height, scrollX: 0, scrollY: 0 });

        const banner = result.potentialPopups.find((p) => p.selector.includes('#banner'));
        assert.ok(banner?.rect);
        assert.strictEqual(banner.source, 'walk');
        assert.strictEqual(banner.cssPosition, 'fixed');
        assert.deepStrictEqual([banner.rect.x, banner.rect.width], [0, width]);
        assert.strictEqual(banner.rect.y + banner.rect.height, height);
        // the dense grid hits the fixed banner along the bottom edge
        assert.ok(banner.hitPoints && banner.hitPoints.length >= 11);
        assert.ok(banner.hitPoints.every(([, y]) => y >= banner.rect.y && y < height));
    });

    it('records positions on the page, not in the viewport', async () => {
        const result = await scrape(page, true, PAGE, 500);
        assert.strictEqual(result.viewport?.scrollY, 500);
        const banner = result.potentialPopups.find((p) => p.selector.includes('#banner'));
        assert.strictEqual(banner?.rect?.y, 500 + result.viewport.height - banner.rect.height);
    });

    it('hit-tests for banners in the normal page flow', async () => {
        const result = await scrape(page, true, IN_FLOW_PAGE);
        const banner = result.potentialPopups.find((p) => p.selector.includes('#inflow'));
        assert.ok(banner, 'in-flow banner is found by hit-testing');
        assert.strictEqual(banner.source, 'hitTest');
        assert.strictEqual(banner.cssPosition, 'static');
        assert.deepStrictEqual(banner.rect, { x: 0, y: 0, width: result.viewport?.width, height: 100 });
        // 11 columns at the rows 30, 60 and 90px from the top
        assert.deepStrictEqual([...new Set(banner.hitPoints?.map(([, y]) => y))], [30, 60, 90]);
        assert.strictEqual(banner.hitPoints?.length, 33);
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
