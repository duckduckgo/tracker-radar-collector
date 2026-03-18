'use strict';

/**
 * @file harPostData.js
 *
 * Parses HAR `postData.params[]` from form-encoded request bodies.
 *
 * ## The problem
 *
 * `chrome-har` populates `postData.text` for POST requests but always leaves
 * `postData.params` as an empty array — it never decodes the body into
 * structured key/value pairs.
 *
 * For this project that gap is significant: the `emailFill` collector submits
 * newsletter sign-up forms, and those form submissions are precisely the
 * requests we most want structured data for.  A raw URL-encoded string like
 * `email=user%40example.com&list=newsletter` is far harder to query and index
 * than a proper `params` array.
 *
 * ## Scope
 *
 * Only two MIME types map cleanly to HAR params:
 *   - `application/x-www-form-urlencoded` — standard HTML form submission
 *   - `multipart/form-data`               — file-upload forms; text parts only
 *
 * `application/json` is intentionally excluded: its arbitrary nested structure
 * has no standard mapping to a flat key/value array.  The full body is already
 * captured in `postData.text`, which is more useful for JSON analysis.
 *
 * ## API
 *
 * All functions in this module are pure (no side effects, no I/O) and operate
 * only on plain strings.  The single public entry point is {@link enrichPostDataParams}.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * MIME types (base, without parameters) that we know how to decode into
 * structured HAR `params[]` arrays.
 *
 * @type {ReadonlySet<string>}
 */
const FORM_MIME_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data']);

// ── Internal parsers ──────────────────────────────────────────────────────────

/**
 * Parse an `application/x-www-form-urlencoded` body into HAR params.
 *
 * Delegates to the WHATWG `URLSearchParams` parser, which correctly handles:
 *   - `+` decoded as space (HTML form encoding convention)
 *   - Percent-encoded characters (`%20`, `%40`, …)
 *   - Duplicate keys (each occurrence becomes its own entry in the array)
 *   - Malformed or empty pairs (silently skipped by the parser)
 *
 * @param {string} body - Raw POST body text
 * @returns {HARPostParam[]}
 */
function parseUrlEncodedParams(body) {
    const params = [];
    for (const [name, value] of new URLSearchParams(body)) {
        params.push({ name, value });
    }
    return params;
}

/**
 * Parse a `multipart/form-data` body into HAR params.
 *
 * Multipart bodies are structured as:
 * ```
 * --<boundary>\r\n
 * Content-Disposition: form-data; name="fieldName"\r\n
 * \r\n
 * fieldValue\r\n
 * --<boundary>--
 * ```
 *
 * Each part is examined independently:
 *   - Text parts → `{ name, value }` with the decoded field value
 *   - Binary parts (identified by a `filename` attribute or a non-text
 *     Content-Type) → `{ name, value: '', fileName?, contentType? }` so the
 *     HAR remains informative without embedding raw binary blobs
 *
 * The boundary is extracted from the `Content-Type` header value that is
 * passed in as `contentType`.  If the boundary token is missing or malformed,
 * an empty array is returned rather than throwing.
 *
 * @param {string} body        - Raw POST body text
 * @param {string} contentType - Full `Content-Type` header value (must contain `boundary=`)
 * @returns {HARPostParam[]}
 */
function parseMultipartParams(body, contentType) {
    const params = [];

    // The boundary is embedded in the Content-Type header, e.g.:
    // "multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW"
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
        return params; // Malformed Content-Type — cannot parse safely
    }

    const boundary = boundaryMatch[1].trim();

    // Splitting on "--<boundary>" yields:
    //   [0] preamble (ignored)
    //   [1..n-1] actual parts
    //   [n] "--\r\n" epilogue (ignored)
    const parts = body.split(`--${boundary}`);

    for (const part of parts) {
        // Skip preamble, epilogue ("--\r\n"), and any empty segments
        if (!part || part.startsWith('--') || part.trim() === '') {
            continue;
        }

        // Each part is: <MIME headers block>\r\n\r\n<body>
        const headerBodySplit = part.indexOf('\r\n\r\n');
        if (headerBodySplit === -1) {
            continue; // Malformed part — skip rather than throw
        }

        const headerBlock = part.slice(0, headerBodySplit);
        // Strip the trailing \r\n that belongs to the boundary delimiter, not the value
        const partBody = part.slice(headerBodySplit + 4).replace(/\r\n$/, '');

        // `name` is required — parts without it are not form fields
        const nameMatch = headerBlock.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
        if (!nameMatch) {
            continue;
        }
        const name = nameMatch[1];

        // A `filename` attribute signals a file-upload part (binary)
        const filenameMatch = headerBlock.match(/filename="([^"]*)"/i);
        const contentTypeMatch = headerBlock.match(/Content-Type:\s*([^\r\n]+)/i);
        const partMime = contentTypeMatch ? contentTypeMatch[1].trim() : null;

        // Treat as binary if there is a filename or the part's MIME type is not text/*
        const isBinary = filenameMatch || (partMime && !partMime.startsWith('text/'));

        if (isBinary) {
            params.push({
                name,
                value: '',
                fileName: filenameMatch ? filenameMatch[1] : undefined,
                contentType: partMime || undefined,
            });
        } else {
            params.push({ name, value: partBody });
        }
    }

    return params;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enrich a HAR entry's `request.postData` with a decoded `params[]` array.
 *
 * Mutates `entry` in place.  Safe to call on any entry — returns immediately
 * if the entry has no POST body or the MIME type is not a form encoding we
 * support.
 *
 * @param {object} entry - HAR entry to enrich (mutated in place)
 * @returns {void}
 */
function enrichPostDataParams(entry) {
    const postData = entry.request?.postData;
    if (!postData?.text) {
        return; // No body to parse
    }

    // Normalise: strip parameters like "; charset=utf-8" to get the bare MIME type
    const rawMime = (postData.mimeType || '').toLowerCase();
    const mimeType = rawMime.split(';')[0].trim();

    if (!FORM_MIME_TYPES.has(mimeType)) {
        return; // Not a form encoding — leave postData.params untouched
    }

    let params = [];

    if (mimeType === 'application/x-www-form-urlencoded') {
        params = parseUrlEncodedParams(postData.text);
    } else if (mimeType === 'multipart/form-data') {
        // Pass the full rawMime (with boundary token) to the multipart parser
        params = parseMultipartParams(postData.text, rawMime);
    }

    // Only overwrite if we actually decoded something — avoids replacing a
    // meaningful existing array with an empty one on a parsing edge-case
    if (params.length > 0) {
        postData.params = params;
    }
}

/**
 * Parse the `_initiator` field on a HAR entry from a JSON string into a proper
 * nested object.
 *
 * ## The problem
 *
 * `chrome-har` copies the initiator data from the CDP `requestWillBeSent` event
 * but serialises the structured `initiator` object into a flat JSON string stored
 * in `_initiator_detail`, while setting the top-level `_initiator` field to just
 * the initiator URL string.  This means the full call stack — which is critical
 * for identity-graph research (knowing *which script* triggered a tracking
 * request) — is buried in an escaped string rather than being a queryable object.
 *
 * ## What this does
 *
 * Replaces the flat `_initiator` string and the escaped `_initiator_detail`
 * string with a single structured `_initiator` object matching the HAR viewer
 * convention, e.g.:
 * ```json
 * "_initiator": {
 *   "type": "script",
 *   "stack": { "callFrames": [...], "parent": { ... } }
 * }
 * ```
 *
 * If `_initiator_detail` is absent or unparseable the entry is left untouched —
 * the existing flat fields are still better than nothing.
 *
 * @param {object} entry - HAR entry to enrich (mutated in place)
 * @returns {void}
 */
function enrichInitiator(entry) {
    const raw = entry._initiator_detail;
    if (!raw) {
        return; // chrome-har didn't capture initiator detail for this entry
    }

    let parsed;
    try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return; // Malformed JSON — leave the entry as-is
    }

    // Fold the flat convenience fields into the structured object so everything
    // is in one place, then remove all the now-redundant flat fields.
    // lineNumber/columnNumber/functionName/scriptId point to the exact call site
    // that triggered the request — more precise than the first callFrame in the
    // stack, which may be an internal wrapper rather than the actual trigger.
    entry._initiator = {
        ...parsed,
        lineNumber: entry._initiator_line ?? parsed.lineNumber,
        columnNumber: entry._initiator_column ?? parsed.columnNumber,
        functionName: entry._initiator_function_name ?? undefined,
        scriptId: entry._initiator_script_id ?? undefined,
    };

    delete entry._initiator_detail;
    delete entry._initiator_type;
    delete entry._initiator_line;
    delete entry._initiator_column;
    delete entry._initiator_function_name;
    delete entry._initiator_script_id;
}

module.exports = { enrichPostDataParams, enrichInitiator };

// ── JSDoc-only typedefs (not runtime) ─────────────────────────────────────────

/**
 * A single decoded parameter from a form-encoded POST body.
 * Maps directly to an element of the HAR 1.2 `postData.params[]` array.
 *
 * @typedef {object} HARPostParam
 * @property {string}  name         - Field name
 * @property {string}  value        - Field value; empty string for binary file parts
 * @property {string=} fileName     - Original filename, present only for multipart file-upload parts
 * @property {string=} contentType  - MIME type of the part, present only for multipart file-upload parts
 */
