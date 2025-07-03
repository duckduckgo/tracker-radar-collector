const assert = require('assert');
const sinon = require('sinon');
const ContentScriptCollector = require('../../collectors/ContentScriptCollector');

describe('ContentScriptCollector', () => {
    /** @type {ContentScriptCollector} */
    let collector;

    beforeEach(() => {
        collector = new ContentScriptCollector();
        collector.init(/** @type {any} */({
            log: () => {},
        }));
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
});
