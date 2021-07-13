/* eslint-disable max-lines */
const {getAllInitiators} = require('../helpers/initiators');
const {filterHeaders, normalizeHeaders} = require('../helpers/headers');
const BaseCollector = require('./BaseCollector');

const URL = require('url').URL;
const crypto = require('crypto');
const {Buffer} = require('buffer');

const DEFAULT_SAVE_HEADERS = ['etag', 'set-cookie', 'cache-control', 'expires', 'pragma', 'p3p', 'timing-allow-origin', 'access-control-allow-origin'];

class RequestCollector extends BaseCollector {

    /**
     * @param {{saveResponseHash?: boolean, saveHeaders?: Array<string>}} additionalOptions
     */
    constructor(additionalOptions = {saveResponseHash: true, saveHeaders: DEFAULT_SAVE_HEADERS}) {
        super();
        this._saveResponseHash = (additionalOptions.saveResponseHash === true);
        this._saveHeaders = DEFAULT_SAVE_HEADERS;

        if (additionalOptions.saveHeaders) {
            this._saveHeaders = additionalOptions.saveHeaders.map(h => h.toLocaleLowerCase());
        }
    }

    id() {
        return 'requests';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options 
     */
    init({
        log,
    }) {
        /**
         * @type {InternalRequestData[]}
         */
        this._requests = [];
        /**
         * @type {Map<string, InternalRequestData>}
         */
        this._unmatched = new Map();
        this._log = log;
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('./TargetCollector').TargetType}} targetInfo 
     */
    async addTarget({cdpClient}) {
        await cdpClient.send('Runtime.enable');
        await cdpClient.send('Runtime.setAsyncCallStackDepth', {maxDepth: 32});

        await cdpClient.send('Network.enable');

        await Promise.all([
            cdpClient.on('Network.requestWillBeSent', r => this.handleRequest(r, cdpClient)),
            cdpClient.on('Network.webSocketCreated', r => this.handleWebSocket(r)),
            cdpClient.on('Network.responseReceived', r => this.handleResponse(r)),
            cdpClient.on('Network.responseReceivedExtraInfo', r => this.handleResponseExtraInfo(r)),
            cdpClient.on('Network.loadingFailed', r => this.handleFailedRequest(r, cdpClient)),
            cdpClient.on('Network.loadingFinished', r => this.handleFinishedRequest(r, cdpClient))
        ]);
    }

    /**
     * @param {RequestId} id 
     */
    findLastRequestWithId(id) {
        let i = this._requests.length;

        while (i--) {
            if (this._requests[i].id === id) {
                return this._requests[i];
            }
        }

        return null;
    }

    /**
     * @param {RequestId} id 
     * @param {import('puppeteer').CDPSession} cdp
     */
    async getResponseBodyHash(id, cdp) {
        try {
            // @ts-ignore oversimplified .send signature
            let {body, base64Encoded} = await cdp.send('Network.getResponseBody', {requestId: id});

            if (base64Encoded) {
                body = Buffer.from(body, 'base64').toString('utf-8');
            }

            return crypto.createHash('sha256').update(body).digest('hex');
        } catch (e) {
            return null;
        }
    }

    /**
     * @param {{initiator: import('../helpers/initiators').RequestInitiator, request: CDPRequest, requestId: RequestId, timestamp: Timestamp, frameId?: FrameId, type?: ResourceType, redirectResponse?: CDPResponse}} data 
     * @param {import('puppeteer').CDPSession} cdp
     */
    handleRequest(data, cdp) {
        const {
            requestId: id,
            type,
            request,
            redirectResponse,
            timestamp: startTime
        } = data;

        let initiator = data.initiator;
        const url = request.url;
        const method = request.method;

        // for CORS requests initiator is set incorrectly to 'parser', thankfully we can get proper initiator
        // from the corresponding OPTIONS request
        if (method !== 'OPTIONS' && initiator.type === 'parser') {
            for (let i = this._requests.length - 1; i >= 0; i--) {
                const oldRequest = this._requests[i];

                if (oldRequest.method === 'OPTIONS' && oldRequest.url === url) {
                    initiator = oldRequest.initiator;
                    break;
                }
            }
        }

        /**
         * @type {InternalRequestData}
         */
        const requestData = {id, url, method, type, initiator, startTime};

        // if request A gets redirected to B which gets redirected to C chrome will produce 4 events:
        // requestWillBeSent(A) requestWillBeSent(B) requestWillBeSent(C) responseReceived()
        // responseReceived doesn't fire for each redirect, so we can't use it to save response for each redirect
        // thankfully response data for request A are available in requestWillBeSent(B) event, request B response is in requestWillBeSent(C), etc.
        // we can also easily match those requests togheter because they all have same requestId
        // so what we do here is copy those responses to corresponding requests
        if (redirectResponse) {
            const previousRequest = this.findLastRequestWithId(id);

            if (previousRequest) {
                this.handleResponse({
                    requestId: id,
                    type,
                    response: redirectResponse
                });
                this.handleFinishedRequest({
                    requestId: id,
                    timestamp: startTime
                }, cdp);

                // initiators of redirects are useless (they point to the main document), copy initiator from original request
                requestData.initiator = previousRequest.initiator;

                // we store both: where request was redirected from and where it redirects to
                previousRequest.redirectedTo = url;
                requestData.redirectedFrom = previousRequest.url;
            }
        }

        // even thought this is 'requestWillBeSent' event some other events (e.g. 'responseReceivedExtraInfo')
        // can arrive before it. We may already have some info about this request that we merge here.
        if (this._unmatched.has(id)) {
            const info = this._unmatched.get(id);
            this._unmatched.delete(id);

            Object.keys(info).forEach(key => {
                // eslint-disable-next-line no-prototype-builtins
                if (!requestData.hasOwnProperty(key)) {
                    // @ts-ignore
                    requestData[key] = info[key];
                }
            });
        }

        this._requests.push(requestData);
    }

    /**
     * @param {{requestId: RequestId, url: string, initiator: import('../helpers/initiators').RequestInitiator}} request 
     */
    handleWebSocket(request) {
        this._requests.push({
            id: request.requestId,
            url: request.url,
            type: 'WebSocket',
            initiator: request.initiator
        });
    }

    /**
     * @param {{requestId: RequestId, type: ResourceType, frameId?: FrameId, response: CDPResponse}} data 
     */
    handleResponse(data) {
        const {
            requestId: id,
            type,
            response
        } = data;
        let request = this.findLastRequestWithId(id);

        if (!request) {
            this._log('⚠️ unmatched response', id, response.url);
            request = {
                id,
                url: response.url,
                type
            };
            this._unmatched.set(id, request);
        }

        request.type = type || request.type;
        request.status = response.status;
        request.remoteIPAddress = response.remoteIPAddress;

        // prioritize raw headers received via handleResponseExtraInfo over response.headers received here
        // response.headers might be filtered (e.g. missing set-cookie header)
        if (!request.responseHeaders) {
            request.responseHeaders = normalizeHeaders(response.headers);
        }
    }

    /**
     * Network.responseReceivedExtraInfo
     * @param {{requestId: RequestId, headers: Object<string, string>}} data 
     */
    handleResponseExtraInfo(data) {
        const {
            requestId: id,
            headers
        } = data;
        let request = this.findLastRequestWithId(id);

        if (!request) {
            // this happens often so we don't issue a warning here
            request = {
                id,
                url: '<unknown>',
                type: 'Other'
            };
            this._unmatched.set(id, request);
        }

        // always override headers that may already exist here
        // handleResponseExtraInfo provides most details
        request.responseHeaders = normalizeHeaders(headers);
    }

    /**
     * @param {{errorText: string, requestId: RequestId, timestamp: Timestamp, type: ResourceType}} data 
     * @param {import('puppeteer').CDPSession} cdp
     */
    async handleFailedRequest(data, cdp) {
        let request = this.findLastRequestWithId(data.requestId);

        if (!request) {
            this._log('⚠️ unmatched failed response', data);
            request = {
                id: data.requestId,
                url: '<unknown>',
                type: data.type
            };
            this._unmatched.set(data.requestId, request);
        }

        request.endTime = data.timestamp;
        request.failureReason = data.errorText || 'unknown error';

        if (this._saveResponseHash) {
            request.responseBodyHash = await this.getResponseBodyHash(data.requestId, cdp);
        }
    }

    /**
     * @param {{requestId: RequestId, encodedDataLength?: number, timestamp: Timestamp}} data 
     * @param {import('puppeteer').CDPSession} cdp
     */
    async handleFinishedRequest(data, cdp) {
        let request = this.findLastRequestWithId(data.requestId);

        if (!request) {
            this._log('⚠️ unmatched finished response', data);
            request = {
                id: data.requestId,
                url: '<unknown>',
                type: 'Other'
            };
            this._unmatched.set(data.requestId, request);
        }

        request.endTime = data.timestamp;
        request.size = data.encodedDataLength;

        if (this._saveResponseHash) {
            request.responseBodyHash = await this.getResponseBodyHash(data.requestId, cdp);
        }
    }

    /**
     * @param {{finalUrl: string, urlFilter?: function(string):boolean}} options
     * @returns {RequestData[]}
     */
    getData({urlFilter}) {
        if (this._unmatched.size > 0) {
            this._log(`⚠️ failed to match ${this._unmatched.size} events`);
        }

        return this._requests
            .filter(request => {
                let url;

                try {
                    url = new URL(request.url);
                } catch (e) {
                    // ignore requests with invalid URL
                    return false;
                }

                if (url.protocol === 'data:') {
                    return false;
                }

                return urlFilter ? urlFilter(request.url) : true;
            })
            .map(request => ({
                url: request.url,
                method: request.method,
                type: request.type,
                status: request.status,
                size: request.size,
                remoteIPAddress: request.remoteIPAddress,
                responseHeaders: request.responseHeaders && filterHeaders(request.responseHeaders, this._saveHeaders),
                responseBodyHash: request.responseBodyHash,
                failureReason: request.failureReason,
                redirectedTo: request.redirectedTo,
                redirectedFrom: request.redirectedFrom,
                initiators: Array.from(getAllInitiators(request.initiator)),
                time: (request.startTime && request.endTime) ? (request.endTime - request.startTime) : undefined
            }));
    }
}

module.exports = RequestCollector;

/**
 * @typedef RequestData
 * @property {string} url
 * @property {HttpMethod} method
 * @property {ResourceType} type
 * @property {string[]=} initiator
 * @property {string=} redirectedFrom
 * @property {string=} redirectedTo
 * @property {number=} status
 * @property {string} remoteIPAddress
 * @property {object} responseHeaders
 * @property {string=} responseBodyHash
 * @property {string} failureReason
 * @property {number=} size in bytes
 * @property {number=} time in seconds
 */

/**
 * @typedef InternalRequestData
 * @property {RequestId} id
 * @property {string} url
 * @property {HttpMethod=} method
 * @property {ResourceType} type
 * @property {import('../helpers/initiators').RequestInitiator=} initiator
 * @property {string=} redirectedFrom
 * @property {string=} redirectedTo
 * @property {number=} status
 * @property {string=} remoteIPAddress
 * @property {Object<string,string>=} responseHeaders
 * @property {string=} failureReason
 * @property {number=} size
 * @property {Timestamp=} startTime
 * @property {Timestamp=} endTime
 * @property {string=} responseBodyHash
 */

/**
 * @typedef {string} RequestId
 */

/**
 * @typedef {number} Timestamp
 */

/**
 * @typedef {'Document'|'Stylesheet'|'Image'|'Media'|'Font'|'Script'|'TextTrack'|'XHR'|'Fetch'|'EventSource'|'WebSocket'|'Manifest'|'SignedExchange'|'Ping'|'CSPViolationReport'|'Other'} ResourceType
 */

/**
 * @typedef {string} FrameId
 */

/**
 * @typedef CDPRequest
 * @property {string} url
 * @property {HttpMethod} method
 * @property {object} headers
 * @property {'VeryLow'|'Low'|'Medium'|'High'|'VeryHigh'} initialPriority
 */

/**
 * @typedef CDPResponse
 * @property {string} url
 * @property {number} status
 * @property {Object<string, string>} headers
 * @property {string} remoteIPAddress
 * @property {object} securityDetails
 */

/**
 * @typedef {'GET'|'PUT'|'POST'|'DELETE'|'HEAD'|'OPTIONS'|'CONNNECT'|'TRACE'|'PATCH'} HttpMethod
 */