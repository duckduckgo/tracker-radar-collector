const assert = require('assert');
const sinon = require('sinon');
const CookiePopupCollector = require('../../collectors/CookiePopupCollector');

describe('CookiePopupCollector', () => {
    /** @type {CookiePopupCollector} */
    let collector;

    beforeEach(() => {
        collector = new CookiePopupCollector();
        collector.init(/** @type {any} */({
            log: () => {},
        }));
    });

    it('should have the correct id', () => {
        assert.strictEqual(collector.id(), 'cookiepopups');
    });

    describe('addTarget', () => {
        it('should enable Page and Runtime domains', async () => {
            const mockSession = {
                send: sinon.stub(),
                on: sinon.stub(),
            };
            await collector.addTarget(
                // @ts-expect-error passing mock objects
                mockSession,
                { type: 'page' }
            );
            assert.ok(mockSession.send.calledWith('Page.enable'));
            assert.ok(mockSession.send.calledWith('Runtime.enable'));
        });

        it('should not add target if not page or iframe', async () => {
            const mockSession = {
                send: sinon.stub(),
                on: sinon.stub(),
            };
            await collector.addTarget(
                // @ts-expect-error passing mock objects
                mockSession,
                { type: 'other' }
            );
            assert.ok(!mockSession.send.calledWith('Page.enable'));
        });
    });

    describe('getData', () => {
        beforeEach(() => {
            collector.cdpSessions = new Map();
        });

        it('should retrieve cookie popup data from the page', async () => {
            const mockSession = {
                send: sinon.stub(),
                on: sinon.stub(),
            };

            const fakePopupData = {
                potentialPopups: [
                    {
                        text: 'This website uses cookies',
                        selector: 'div.cookie-banner',
                        buttons: [{ text: 'Accept', selector: 'button.accept' }],
                        isTop: true,
                        origin: 'https://example.com'
                    }
                ]
            };

            mockSession.send.withArgs('Runtime.evaluate', sinon.match.any).resolves({
                result: {
                    type: 'object',
                    value: fakePopupData,
                }
            });

            // @ts-expect-error passing mock objects
            collector.cdpSessions.set(1, mockSession);

            const data = await collector.getData();
            assert.deepStrictEqual(data, fakePopupData.potentialPopups);
        });

        it('should handle evaluation errors gracefully', async () => {
            const mockSession = {
                send: sinon.stub(),
                on: sinon.stub(),
            };
            mockSession.send.withArgs('Runtime.evaluate', sinon.match.any).resolves({
                exceptionDetails: {
                    exceptionId: 1,
                    text: 'Uncaught',
                    lineNumber: 1,
                    columnNumber: 1,
                    exception: {
                        type: 'object',
                        description: 'Something went wrong'
                    }
                },
            });

            // @ts-expect-error passing mock objects
            collector.cdpSessions.set(1, mockSession);

            const data = await collector.getData();
            assert.strictEqual(data.length, 0);
        });
    });
});
