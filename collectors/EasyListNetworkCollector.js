/* eslint-disable max-lines */
const fs = require('fs');
const BaseCollector = require('./BaseCollector');
const {FiltersEngine, Request} = require('@cliqz/adblocker');

const URL = require('url').URL;

class RequestCollector extends BaseCollector {

    id() {
        return 'easylist';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options 
     */
    init({
        log,
    }) {
        /**
         * @type {EasyListData[]}
         */
        this._results = [];
        this._log = log;
        this.engine = FiltersEngine.parse(
            fs.readFileSync('fanboy-cookiemonster.txt', 'utf-8'),
            {
                enableMutationObserver: false,
                loadNetworkFilters: true,
                enableHtmlFiltering: false,
                loadCSPFilters: true,
                loadCosmeticFilters: false,
            }
        );
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('./TargetCollector').TargetType}} targetInfo 
     */
    async addTarget({cdpClient}) {
        await cdpClient.send('Runtime.enable');
        await cdpClient.send('Runtime.setAsyncCallStackDepth', {maxDepth: 32});

        await cdpClient.send('Network.enable');

        await Promise.all([
            cdpClient.on('Network.requestWillBeSent', r => this.handleRequest(r)),
            cdpClient.on('Network.webSocketCreated', r => this.handleWebSocket(r)),
        ]);
    }

    /**
     * @param {{initiator: import('../helpers/initiators').RequestInitiator, request: CDPRequest, requestId: RequestId, timestamp: Timestamp, frameId?: FrameId, type?: ResourceType, redirectResponse?: CDPResponse}} data
     */
    handleRequest(data) {
        const {request, type} = data;
        this.matchUrlAgainstEasylist(request.url, type);
    }

    /**
     * @param {{requestId: RequestId, url: string, initiator: import('../helpers/initiators').RequestInitiator}} request 
     */
    handleWebSocket(request) {
        this.matchUrlAgainstEasylist(request.url, 'WebSocket');
    }

    /**
     * @param {string} urlString
     * @param {ResourceType?} type
     */
    matchUrlAgainstEasylist(urlString, type) {
        try {
            const url = new URL(urlString);
            if (url.protocol === 'data:') {
                return;
            }
        } catch (e) {
            // ignore requests with invalid URL
            return;
        }

        const requestType = type.toLowerCase();
        const {match, filter} = this.engine.match(Request.fromRawDetails({
            // @ts-ignore
            type: requestType,
            url: urlString,
        }));

        if (match) {
            this._results.push({
                request: urlString,
                rule: filter.filter,
                type: requestType,
            });
        }
    }

    /**
     * @returns {EasyListData[]}
     */
    getData() {
        return this._results;
    }
}

module.exports = RequestCollector;

/**
 * @typedef EasyListData
 * @property {string} request
 * @property {string} rule
 * @property {string} type
 */

/**
 * @typedef {string} RequestId
 */

/**
 * @typedef {number} Timestamp
 */

/**
 * @typedef {'Document'|'Stylesheet'|'Image'|'Media'|'Font'|'Script'|'TextTrack'|'XHR'|'Fetch'|'EventSource'|'WebSocket'|'Manifest'|'SignedExchange'|'Ping'|'CSPViolationReport'|'Other'|'Preflight'|'Prefetch'} ResourceType
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