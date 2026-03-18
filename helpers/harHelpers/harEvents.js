'use strict';

/**
 * @file harEvents.js
 *
 * Chrome DevTools Protocol (CDP) constants used by the HAR collector.
 *
 * Centralising these here means the collector and any future test fixtures
 * share a single source of truth — no risk of the two lists drifting apart.
 */

/**
 * Every CDP event that `chrome-har` needs to reconstruct a spec-compliant
 * HAR 1.2 archive.
 *
 * ## Groups
 *
 * **Page lifecycle** — emitted only by the top-level `page` session.
 * `chrome-har` uses these to populate `har.log.pages[]` and its timing fields
 * (`onContentLoad`, `onLoad`).  Without them the pages array is empty and all
 * entries lack a `pageref`.
 *
 * **Core network** — emitted by every target type that has a network stack
 * (page, iframe, worker, service_worker).  These are the bread-and-butter
 * events that describe every request/response pair.
 *
 * **ExtraInfo** — a parallel event stream Chrome emits *in addition to* the
 * standard Network events.  They carry header data that Chrome deliberately
 * strips from the standard events for privacy reasons:
 *   - `requestWillBeSentExtraInfo` → actual `Cookie` header values sent on wire
 *   - `responseReceivedExtraInfo` → actual `Set-Cookie` header values received
 * Without these, cookie analysis in the HAR is incomplete — HttpOnly and Secure
 * cookies are invisible in the standard event stream.
 *
 * **WebSockets** — captured opportunistically.  `chrome-har` will include them
 * if its version supports them; older versions silently ignore unknown events,
 * so including them here is always safe.
 *
 * @type {readonly string[]}
 */
const OBSERVED_EVENTS = Object.freeze([
    // ── Page lifecycle (page session only) ────────────────────────────────────
    'Page.loadEventFired',
    'Page.domContentEventFired',
    'Page.frameStartedLoading',
    'Page.frameRequestedNavigation',
    'Page.frameAttached',
    'Page.frameNavigated',
    'Page.frameDetached',

    // ── Core network (all network-capable target types) ────────────────────────
    'Network.requestWillBeSent',
    'Network.requestServedFromCache',
    'Network.dataReceived',
    'Network.responseReceived',
    'Network.resourceChangedPriority',
    'Network.loadingFinished',
    'Network.loadingFailed',

    // ── ExtraInfo — real Cookie / Set-Cookie header values ────────────────────
    'Network.requestWillBeSentExtraInfo',
    'Network.responseReceivedExtraInfo',

    // ── WebSockets ────────────────────────────────────────────────────────────
    'Network.webSocketCreated',
    'Network.webSocketFrameSent',
    'Network.webSocketFrameReceived',
    'Network.webSocketClosed',
]);

/**
 * CDP target types that have an independent network stack and must each be
 * instrumented with their own `Network.enable` call.
 *
 * ## Why this matters
 *
 * Chrome does **not** bubble network events from child targets up to the page
 * session.  A cross-process iframe, a dedicated worker, or a service worker
 * each have their own CDP session, and their `Network.*` events are only
 * visible if that specific session has `Network.enable` called on it.
 *
 * Same-process iframes *are* covered by the page session already, but we
 * instrument them anyway because there is no reliable way to determine at
 * attach-time whether an iframe will be in-process or cross-process — Chrome
 * decides this based on origin, site isolation policy, and available renderer
 * processes.
 *
 * Target types **excluded** from this set (worklets, webviews, auction_worklet,
 * etc.) either cannot make network requests or are instrumented via their
 * parent context.
 *
 * @type {ReadonlySet<string>}
 */
const NETWORK_TARGET_TYPES = new Set([
    'page', // Main document — also the only source of Page.* events
    'iframe', // Cross-process frames (e.g. third-party ad/analytics embeds)
    'worker', // Dedicated workers (fetch() calls in worker scripts)
    'shared_worker', // Shared workers (same as above, shared across tabs)
    'service_worker', // Service workers — common vector for tracking beacons
]);

module.exports = { OBSERVED_EVENTS, NETWORK_TARGET_TYPES };
