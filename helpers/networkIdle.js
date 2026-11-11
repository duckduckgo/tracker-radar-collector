/**
 * Counts network requests that are still in progress across all CDP sessions
 * (main page, iframes in other processes, workers) and tells when the whole page
 * had no requests in progress for some time.
 *
 * Chrome's own `networkIdle` lifecycle event looks only at the requests of one
 * frame. Most third-party content (ads, cookie syncing) loads in iframes, so
 * waiting only for the main frame stops the page load too early.
 */
class NetworkIdleTracker {
    /**
     * @param {{idleTimeMs?: number}} [options]
     */
    constructor({ idleTimeMs = 500 } = {}) {
        this._idleTimeMs = idleTimeMs;
        /**
         * request ID -> ID of the session that sent the most recent event for this request
         * @type {Map<string, string>}
         */
        this._inflight = new Map();
        /** @type {ReturnType<typeof setTimeout> | null} */
        this._idleTimer = null;
        /** @type {Array<() => void>} */
        this._waiters = [];
    }

    /**
     * Number of requests that are still in progress.
     */
    get inflightCount() {
        return this._inflight.size;
    }

    /**
     * Start to listen to the network events of a session.
     * Network domain must be enabled on the session for the events to arrive.
     *
     * @param {import('puppeteer-core').CDPSession} session
     */
    addSession(session) {
        const sessionId = session.id();
        session.on('Network.requestWillBeSent', (/** @type {{requestId: string}} */ e) => this.onRequestStarted(e.requestId, sessionId));
        session.on('Network.responseReceived', (/** @type {{requestId: string}} */ e) => this.onRequestProgress(e.requestId, sessionId));
        session.on('Network.loadingFinished', (/** @type {{requestId: string}} */ e) => this.onRequestEnded(e.requestId));
        session.on('Network.loadingFailed', (/** @type {{requestId: string}} */ e) => this.onRequestEnded(e.requestId));
    }

    /**
     * Forget the requests of a session that is gone. Their end events will never arrive.
     *
     * @param {string} sessionId
     */
    removeSession(sessionId) {
        for (const [requestId, ownerSessionId] of this._inflight) {
            if (ownerSessionId === sessionId) {
                this._inflight.delete(requestId);
            }
        }
        this._update();
    }

    /**
     * A redirect sends a new `requestWillBeSent` event with the same request ID, so it stays one request.
     *
     * @param {string} requestId
     * @param {string} sessionId
     */
    onRequestStarted(requestId, sessionId) {
        this._inflight.set(requestId, sessionId);
        this._update();
    }

    /**
     * A navigation request of an out-of-process iframe starts in the parent session
     * and continues in the iframe session. Keep the most recent session as the owner.
     *
     * @param {string} requestId
     * @param {string} sessionId
     */
    onRequestProgress(requestId, sessionId) {
        if (this._inflight.has(requestId)) {
            this._inflight.set(requestId, sessionId);
        }
    }

    /**
     * Request IDs are unique in the browser, so the end event can come from any session.
     *
     * @param {string} requestId
     */
    onRequestEnded(requestId) {
        if (this._inflight.delete(requestId)) {
            this._update();
        }
    }

    /**
     * Resolves when no requests were in progress for `idleTimeMs`.
     * New requests restart the countdown.
     *
     * @returns {Promise<void>}
     */
    waitForIdle() {
        return new Promise((resolve) => {
            this._waiters.push(resolve);
            this._update();
        });
    }

    dispose() {
        this._clearTimer();
        this._waiters = [];
        this._inflight.clear();
    }

    _clearTimer() {
        if (this._idleTimer) {
            clearTimeout(this._idleTimer);
            this._idleTimer = null;
        }
    }

    _update() {
        if (this._inflight.size > 0 || this._waiters.length === 0) {
            this._clearTimer();
            return;
        }
        if (this._idleTimer) {
            return;
        }
        this._idleTimer = setTimeout(() => {
            this._idleTimer = null;
            const waiters = this._waiters;
            this._waiters = [];
            waiters.forEach((resolve) => resolve());
        }, this._idleTimeMs);
    }
}

module.exports = NetworkIdleTracker;
