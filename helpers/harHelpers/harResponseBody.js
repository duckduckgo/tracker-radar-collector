'use strict';

/**
 * @file harResponseBody.js
 *
 * Manages eager response-body fetching and stitches the results back into
 * finished HAR entries.
 *
 * ## Why this exists as a separate module
 *
 * `chrome-har` builds the structural HAR (timings, headers, status codes) from
 * CDP events alone, but it cannot fetch response bodies — that requires a
 * separate async CDP command (`Network.getResponseBody`) per request.
 *
 * The bodies must be fetched *eagerly* — i.e. immediately when
 * `Network.loadingFinished` fires — because Chrome evicts them from its
 * internal buffer shortly after the response completes.  By the time the
 * crawler calls `getData()` (after navigation + idle wait + extra time), most
 * bodies would already be gone.
 *
 * This module owns the entire body lifecycle:
 *   1. **Register** — attach a `loadingFinished` listener to a CDP session
 *      that fires `getResponseBody` immediately for each completed request.
 *   2. **Drain** — await all in-flight fetches before HAR assembly.
 *   3. **Stitch** — walk the finished HAR entries and write the stored bodies
 *      into `entry.response.content`.
 *
 * ## Multi-session safety
 *
 * `getResponseBody` must be called on the *same session* that emitted the
 * `loadingFinished` event — bodies are not accessible cross-session.  Because
 * each call to {@link registerBodyFetching} closes over its own `session`
 * reference, this constraint is automatically satisfied even when the collector
 * instruments multiple sessions (page + iframes + workers).
 *
 * CDP `requestId` values are unique across all targets in a browser context
 * (Chrome guarantee), so the shared `responseBodies` Map has no key collisions
 * even when entries from multiple sessions are stored in it.
 */

/**
 * Attach a `Network.loadingFinished` listener to `session` that immediately
 * fetches and stores the response body for every completed request.
 *
 * Call this once per CDP session, **after** the session's event listeners have
 * been registered but **before** `Network.enable` is called — the listener
 * itself is synchronous and safe to register at any time, but we want it in
 * place before any events fire.
 *
 * @param {import('puppeteer-core').CDPSession} session
 *   The CDP session to instrument.  Bodies will be fetched via this session.
 *
 * @param {Map<string, StoredResponseBody>} responseBodies
 *   Shared map where fetched bodies are stored, keyed by CDP `requestId`.
 *   The same map should be passed to all sessions so that {@link stitchResponseBodies}
 *   can look up any request regardless of which session served it.
 *
 * @param {Set<Promise<void>>} pendingFetches
 *   Shared set of in-flight fetch Promises.  Each Promise removes itself
 *   from the set in its `.finally()` handler.  Pass the same set to
 *   {@link drainPendingFetches} in `getData()` to await stragglers.
 *
 * @returns {void}
 */
function registerBodyFetching(session, responseBodies, pendingFetches) {
    // Note: loadingFinished is also being listened to elsewhere (for the
    // chrome-har event log).  Node EventEmitter supports multiple listeners
    // on the same event; both fire in registration order.
    session.on('Network.loadingFinished', ({ requestId }) => {
        // getResponseBody MUST use the same session that received this event.
        // Chrome does not expose response bodies cross-session.
        const fetchPromise = session
            .send('Network.getResponseBody', { requestId })
            .then((result) => {
                // Only store non-empty bodies.
                // Redirects, 204 No Content, and cached responses all return
                // an empty body string — not worth storing.
                if (result?.body) {
                    responseBodies.set(requestId, {
                        body: result.body,
                        base64Encoded: result.base64Encoded ?? false,
                    });
                }
            })
            .catch(() => {
                // Body unavailable — expected for:
                //   - Disk-cache responses (Chrome evicts the buffer immediately)
                //   - Redirects / HEAD requests (no body by definition)
                //   - Requests cancelled before completion
                //   - Session closed mid-flight (e.g. worker terminated)
                // All are safe to skip silently.
            })
            .finally(() => {
                // Self-removing from the set prevents unbounded growth on long crawls
                pendingFetches.delete(fetchPromise);
            });

        pendingFetches.add(fetchPromise);
    });
}

/**
 * Wait for all in-flight `getResponseBody` calls to settle.
 *
 * Must be called in `getData()` before building or stitching the HAR, because
 * large responses may still be streaming when the crawler declares the page
 * idle.  Uses `Promise.allSettled` so a single failed fetch does not abort
 * the entire HAR — partial data is still valuable.
 *
 * @param {Set<Promise<void>>} pendingFetches - The same set passed to {@link registerBodyFetching}
 * @returns {Promise<void>}
 */
async function drainPendingFetches(pendingFetches) {
    if (pendingFetches.size > 0) {
        await Promise.allSettled([...pendingFetches]);
    }
}

/**
 * Write pre-fetched response bodies into the matching HAR entries.
 *
 * Must be called **after** `chrome-har` has built its final HAR object (not
 * during event collection) because `chrome-har` may reorder or deduplicate
 * entries internally, making it impossible to know the final entry index at
 * collection time.
 *
 * Uses the non-standard `_requestId` field that `chrome-har` attaches to each
 * entry to look up the stored body.
 *
 * @param {HAREntry[]}                    entries        - `har.log.entries` array (mutated in place)
 * @param {Map<string, StoredResponseBody>} responseBodies - Bodies stored by {@link registerBodyFetching}
 * @returns {void}
 */
function stitchResponseBodies(entries, responseBodies) {
    for (const entry of entries) {
        const requestId = entry._requestId;
        if (!requestId) {
            continue; // Synthetic / cache-only entry — no requestId to look up
        }

        const stored = responseBodies.get(requestId);
        if (!stored) {
            continue; // Body was unavailable or empty for this request
        }

        const { body, base64Encoded } = stored;

        // chrome-har should always initialise response.content, but guard
        // defensively against malformed entries to avoid TypeError
        if (!entry.response.content) {
            entry.response.content = {};
        }

        if (base64Encoded) {
            // Binary resource (image, font, wasm, …) — preserve encoding so
            // downstream consumers can correctly decode the body
            entry.response.content.encoding = 'base64';
            entry.response.content.text = body;
        } else {
            entry.response.content.text = body;
        }

        // Populate size only when chrome-har left it absent or invalid.
        // Buffer.byteLength gives true byte count (not character count),
        // which matters for multi-byte UTF-8 content.
        if (!entry.response.content.size || entry.response.content.size < 0) {
            entry.response.content.size = Buffer.byteLength(body, base64Encoded ? 'base64' : 'utf8');
        }
    }
}

module.exports = { registerBodyFetching, drainPendingFetches, stitchResponseBodies };

// ── JSDoc-only typedefs (not runtime) ─────────────────────────────────────────

/**
 * A response body as retrieved from Chrome's CDP buffer.
 *
 * @typedef {object} StoredResponseBody
 * @property {string}  body          - Raw body string (may be base64-encoded)
 * @property {boolean} base64Encoded - True when Chrome returned the body in base64
 */

/**
 * @typedef {object} HAREntry
 * @property {string}  startedDateTime
 * @property {number}  time
 * @property {object}  request
 * @property {object}  response
 * @property {object}  cache
 * @property {object}  timings
 * @property {string=} serverIPAddress
 * @property {string=} connection
 * @property {string=} pageref
 * @property {string=} _requestId - Non-standard chrome-har extension field
 */
