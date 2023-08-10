/* eslint-disable max-lines */
const fs = require('fs');
const path = require('path');
const MAX_ASYNC_CALL_STACK_DEPTH = 32;// max depth of async calls tracked
const allBreakpoints = require('./breakpoints.js');
const URL = require('url').URL;
const HTTP_URL_REGEX = /^https?:\/\//i;

const breakpointScriptTemplate = fs.readFileSync(path.join(__dirname, 'breakpointScript.template.js'), 'utf8');

/**
 * @param {import('./breakpoints').Breakpoint} breakpoint
 * @param {string} description
 * @returns string
 */
function getBreakpointScript(breakpoint, description) {
    // only save arguments if requested for given breakpoint
    const argumentCollection = breakpoint.saveArguments ? `args: Array.from(arguments).map(a => a.toString())` : '';

    let breakpointScript = breakpointScriptTemplate
        .replace('ARGUMENT_COLLECTION', argumentCollection)
        .replace('DESCRIPTION', description)
        .replace('SAVE_ARGUMENTS', breakpoint.saveArguments ? 'true' : 'false');

    // if breakpoint comes with an condition only count it when this condition is met
    if (breakpoint.condition) {
        breakpointScript = `
            if (!!(${breakpoint.condition})) {
                ${breakpointScript}
            }
        `;
    }
    breakpointScript = `
        let shouldPause = false;
        ${breakpointScript}
        shouldPause;
    `;

    return breakpointScript;
}

class TrackerTracker {
    /**
     * @param {function(string, object=): Promise<object>} sendCommand
     */
    constructor(sendCommand) {
        /**
         * @type {function(...any): void}
         */
        this._log = () => {};
        /**
         * @type {function(string, object=): Promise<object>}
         */
        this._send = sendCommand;
        /**
         * @type {Map<import('devtools-protocol/types/protocol').Protocol.Debugger.BreakpointId, import('./breakpoints').Breakpoint>}
         */
        this._idToBreakpoint = new Map();
        /**
         * @type {Map<string, import('./breakpoints').Breakpoint>}
         */
        this._descToBreakpoint = new Map();
        /**
         * @type {string}
         */
        this._mainURL = '';
        /**
         * @type {Map<string, string>}
         */
        this._scriptIdToUrl = new Map();
        /**
         * @type {Map<string, SavedCall>}
         */
        this._pendingCalls = new Map();
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.BreakpointId} id
     * @returns {import('./breakpoints').Breakpoint}
     */
    _getBreakpointById(id) {
        return this._idToBreakpoint.get(id) || null;
    }

    /**
     * @param {string} breakpointDescription
     * @returns {import('./breakpoints').Breakpoint}
     */
    _getBreakpointByDescription(breakpointDescription) {
        return this._descToBreakpoint.get(breakpointDescription) || null;
    }

    /**
     * @param {{log: function(...any): void}} options
     */
    async init({log}) {
        this._log = log;

        await this._send('Debugger.enable');
        await this._send('Runtime.enable');
        await this._send('Runtime.setAsyncCallStackDepth', {
            maxDepth: MAX_ASYNC_CALL_STACK_DEPTH
        });
    }

    /**
     * @param {string} command 
     * @param {object} payload
     * @returns {Promise<object>}
     */
    sendCommand(command, payload = {}) {
        return this._send(command, payload);
    }

    /**
     * @param {string} url 
     */
    setMainURL(url) {
        this._mainURL = url;
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextId} contextId
     * @param {string} expression
     * @param {string} description
     * @param {import('./breakpoints').Breakpoint} breakpoint
     */
    async _addBreakpoint(contextId, expression, description, breakpoint) {
        try {
            /**
             * @type {{result:{objectId: string, description: string}, exceptionDetails:{}}}
             */
            // @ts-ignore
            const result = await this._send('Runtime.evaluate', {
                expression,
                contextId,
                silent: true
            });

            if (result.exceptionDetails) {
                throw new Error('API unavailable in given context.');
            }

            const conditionScript = getBreakpointScript(breakpoint, description);

            const cdpBreakpointResult = /** @type {import('devtools-protocol/types/protocol').Protocol.Debugger.SetBreakpointOnFunctionCallResponse} */ (await this._send('Debugger.setBreakpointOnFunctionCall', {
                objectId: result.result.objectId,
                condition: conditionScript
            }));
            this._idToBreakpoint.set(cdpBreakpointResult.breakpointId, {
                cdpId: cdpBreakpointResult.breakpointId,
                ...breakpoint,
                description, // save concrete description
            });
            this._descToBreakpoint.set(description, {
                cdpId: cdpBreakpointResult.breakpointId,
                ...breakpoint,
                description, // save concrete description
            });
        } catch(e) {
            const error = (typeof e === 'string') ? e : e.message;
            if (
                !error.includes('Target closed.') && // we don't care if tab was closed during this opperation
                !error.includes('Session closed.') && // we don't care if tab was closed during this opperation
                !error.includes('Breakpoint at specified location already exists.') &&
                !error.includes('Cannot find context with specified id') &&
                !error.includes('API unavailable in given context.') // some APIs are unavailable on HTTP or in a worker
            ) {
                this._log('setting breakpoint failed', description, e);
            }
        }
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextId} contextId
     */
    async setupContextTracking(contextId = undefined) {
        const allBreakpointsSet = allBreakpoints
            .map(async ({proto, global, props, methods}) => {
                const obj = global || `${proto}.prototype`;
                const propPromises = props.map(async prop => {
                    const expression = `Reflect.getOwnPropertyDescriptor(${obj}, '${prop.name}').${prop.setter === true ? 'set' : 'get'}`;
                    const description = prop.description || `${obj}.${prop.name}`;
                    await this._addBreakpoint(contextId, expression, description, prop);
                });

                await Promise.all(propPromises);

                const methodPromises = methods.map(async method => {
                    const expression = `Reflect.getOwnPropertyDescriptor(${obj}, '${method.name}').value`;
                    const description = method.description || `${obj}.${method.name}`;
                    await this._addBreakpoint(contextId, expression, description, method);
                });
    
                await Promise.all(methodPromises);
            });
        
        await Promise.all(allBreakpointsSet);
    }

    /**
     * Return top non-anonymous source from Runtime.StackTrace.
     *
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.StackTrace} params
     * @returns {string}
     */
    _getScriptURLFromStackTrace(params) {
        if (params.callFrames) {
            for (const frame of params.callFrames) {
                const fileUrl = frame.scriptId && this._scriptIdToUrl.get(frame.scriptId);
                const frameUrl = frame.url;
                for (const u of [frameUrl, fileUrl]) {
                    if (u && u !== this._mainURL && u.match(HTTP_URL_REGEX)) {
                        return u;
                    }
                }
            }
        }
        if (params.parent) {
            return this._getScriptURLFromStackTrace(params.parent);
        }
        return null;
    }

    /**
     * Return top non-anonymous source from the Debugger.paused event
     *
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.PausedEvent} params
     * @returns {string}
     */
    _getScriptURLFromPausedEvent(params) {
        let script = null;
        if (params.callFrames) {
            iterateAllFrames: for (const frame of params.callFrames) {
                const locationUrl = frame.location && this._scriptIdToUrl.get(frame.location.scriptId);
                const functionLocationUrl = frame.functionLocation && this._scriptIdToUrl.get(frame.functionLocation.scriptId);
                const frameUrl = frame.url; // this is usually empty in Debugger.CallFrame (unlike Runtime.CallFrame)

                for (const u of [frameUrl, functionLocationUrl, locationUrl]) {
                    if (u && u !== this._mainURL && u.match(HTTP_URL_REGEX)) {
                        script = u;
                        break iterateAllFrames;
                    }
                }
            }
        }

        if (!script && params.asyncStackTrace) {
            script = this._getScriptURLFromStackTrace(params.asyncStackTrace);
        }

        try {
            // calculate absolute URL
            const urlObj = new URL(script, this._mainURL);
            script = urlObj.href;
        } catch(e) {
            this._log('⚠️ invalid source, assuming global', script);
            script = this._mainURL;
        }

        if (!script) {
            this._log('⚠️ unknown source, assuming global');
            script = this._mainURL;
        }

        return script;
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.BreakpointId} breakpointId
     */
    retrieveCallArguments(breakpointId) {
        const call = this._pendingCalls.get(breakpointId);
        this._pendingCalls.delete(breakpointId);
        return call;
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.ScriptParsedEvent} params
     */
    processScriptParsed(params) {
        if (this._scriptIdToUrl.has(params.scriptId)) {
            this._log('⚠️ duplicate scriptId', params.scriptId);
        }
        this._scriptIdToUrl.set(params.scriptId, params.embedderName);
    }

    /**
     * @param {{payload: string, description: string, executionContextId: number}} params
     * @returns {{description: string, source: string, saveArguments: boolean, arguments: string[]}}
     */
    processBindingPause(params) {
        let payload = null;

        try {
            payload = JSON.parse(params.payload);
        } catch(e) {
            this._log('🚩 invalid breakpoint payload', params.payload);
            return null;
        }

        const breakpoint = this._getBreakpointByDescription(payload.description);
        if (!breakpoint) {
            this._log('️⚠️ unknown breakpoint', params);
            return null;
        }

        if (!payload.url) {
            if (breakpoint.saveArguments) {
                // just save the arguments, the stack will be analyzed with CDP later
                if (!this._pendingCalls.has(breakpoint.cdpId)) {
                    this._log('Unexpected existing pending call', breakpoint.cdpId);
                }
                this._pendingCalls.set(breakpoint.cdpId, {
                    arguments: payload.args,
                    source: null,
                    description: payload.description,
                });
            }
            return null;
        }

        return {
            description: payload.description,
            saveArguments: breakpoint.saveArguments,
            arguments: payload.args,
            source: payload.url,
        };
    }

    /**
     * @param {import('devtools-protocol/types/protocol').Protocol.Debugger.PausedEvent} params
     * @returns {{id: import('devtools-protocol/types/protocol').Protocol.Debugger.BreakpointId, description: string, source: string, saveArguments: boolean}}
     */
    processDebuggerPause(params) {
        const breakpointId = params.hitBreakpoints[0];
        const breakpoint = this._getBreakpointById(breakpointId);
        if (!breakpoint) {
            this._log('️⚠️ unknown breakpoint', params);
            return null;
        }

        const source = this._getScriptURLFromPausedEvent(params);

        return {
            id: breakpointId,
            description: breakpoint.description,
            saveArguments: breakpoint.saveArguments,
            source,
        };
    }
}

module.exports = TrackerTracker;

/**
 * @typedef SavedCall
 * @property {string} source - source script
 * @property {string} description - breakpoint description
 * @property {string[]} arguments - preview or the passed arguments
 */
