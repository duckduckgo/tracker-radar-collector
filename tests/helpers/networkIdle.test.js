const assert = require('assert');
const { EventEmitter } = require('events');
const NetworkIdleTracker = require('../../helpers/networkIdle');

const IDLE_MS = 50;

/**
 * @param {string} id
 */
function fakeSession(id) {
    const emitter = new EventEmitter();
    // @ts-ignore only the parts that the tracker uses
    emitter.id = () => id;
    return emitter;
}

/**
 * @param {Promise<void>} promise
 * @param {number} ms
 * @returns {Promise<boolean>} true if the promise resolved within ms
 */
function resolvesWithin(promise, ms) {
    return Promise.race([promise.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
}

async function run() {
    // no requests: idle after idleTimeMs
    {
        const tracker = new NetworkIdleTracker({ idleTimeMs: IDLE_MS });
        assert(await resolvesWithin(tracker.waitForIdle(), IDLE_MS * 3), 'resolves when there are no requests');
        tracker.dispose();
    }

    // requests in different sessions must all end
    {
        const tracker = new NetworkIdleTracker({ idleTimeMs: IDLE_MS });
        const page = fakeSession('page');
        const iframe = fakeSession('iframe');
        // @ts-ignore fake session
        tracker.addSession(page);
        // @ts-ignore fake session
        tracker.addSession(iframe);

        page.emit('Network.requestWillBeSent', { requestId: 'r1' });
        iframe.emit('Network.requestWillBeSent', { requestId: 'r2' });
        // redirect keeps the same request ID
        iframe.emit('Network.requestWillBeSent', { requestId: 'r2' });
        assert.strictEqual(tracker.inflightCount, 2);

        const idle = tracker.waitForIdle();
        page.emit('Network.loadingFinished', { requestId: 'r1' });
        assert.strictEqual(await resolvesWithin(idle, IDLE_MS * 3), false, 'waits for the iframe request');

        iframe.emit('Network.loadingFailed', { requestId: 'r2' });
        assert.strictEqual(tracker.inflightCount, 0);
        assert(await resolvesWithin(idle, IDLE_MS * 3), 'resolves when all requests ended');
        tracker.dispose();
    }

    // a new request restarts the countdown
    {
        const tracker = new NetworkIdleTracker({ idleTimeMs: IDLE_MS });
        const page = fakeSession('page');
        // @ts-ignore fake session
        tracker.addSession(page);

        const idle = tracker.waitForIdle();
        await new Promise((resolve) => setTimeout(resolve, IDLE_MS / 2));
        page.emit('Network.requestWillBeSent', { requestId: 'r1' });
        assert.strictEqual(await resolvesWithin(idle, IDLE_MS * 2), false, 'countdown stops while a request is in progress');
        page.emit('Network.loadingFinished', { requestId: 'r1' });
        assert(await resolvesWithin(idle, IDLE_MS * 3), 'resolves after the request ended');
        tracker.dispose();
    }

    // a request can start in one session and end in another (out-of-process iframe navigation)
    {
        const tracker = new NetworkIdleTracker({ idleTimeMs: IDLE_MS });
        const page = fakeSession('page');
        const iframe = fakeSession('iframe');
        // @ts-ignore fake session
        tracker.addSession(page);
        // @ts-ignore fake session
        tracker.addSession(iframe);

        page.emit('Network.requestWillBeSent', { requestId: 'nav' });
        iframe.emit('Network.loadingFinished', { requestId: 'nav' });
        assert.strictEqual(tracker.inflightCount, 0, 'end event from another session counts');

        page.emit('Network.requestWillBeSent', { requestId: 'nav2' });
        iframe.emit('Network.responseReceived', { requestId: 'nav2' });
        tracker.removeSession('page');
        assert.strictEqual(tracker.inflightCount, 1, 'request moved to the iframe session');
        tracker.removeSession('iframe');
        assert.strictEqual(tracker.inflightCount, 0, 'requests of a removed session are forgotten');
        tracker.dispose();
    }

    // removed session releases the wait
    {
        const tracker = new NetworkIdleTracker({ idleTimeMs: IDLE_MS });
        const worker = fakeSession('worker');
        // @ts-ignore fake session
        tracker.addSession(worker);
        worker.emit('Network.requestWillBeSent', { requestId: 'w1' });
        const idle = tracker.waitForIdle();
        tracker.removeSession('worker');
        assert(await resolvesWithin(idle, IDLE_MS * 3), 'resolves after the session is removed');
        tracker.dispose();
    }
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
