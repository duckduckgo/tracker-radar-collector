/* eslint-disable max-lines */
/* eslint-disable max-classes-per-file */
const MAX_ASYNC_CALL_STACK_DEPTH = 32;// max depth of async calls tracked
const allBreakpoints = require('./breakpoints.js');
const URL = require('url').URL;

const abstract = () => {
    throw new Error("Cannot call method, is abstract.");
};

class APIProcessor {
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
    * Reduces a list of saved calls to a set of unique elements,
    * with a list of call positions found for each entry.
    */
    static reduceSavedCalls (calls, options = {}) {
        const resCalls = [];
        const resMap = {};

        const includePositions = 'includePositions' in options ? options.includePositions : true;
        const includeCount = 'includeCount' in options ? options.includeCount : true;

        for (let i = 0; i < calls.length; i++) {
            const idHash = JSON.stringify(calls[i]);
            if (idHash in resMap) {
                if (includePositions) {
                    resMap[idHash].positions.push(i);
                }
                if (includeCount) {
                    resMap[idHash].count++;
                }
            } else {
                const entry = {
                    ...calls[i],
                    ...(includePositions ? {positions: [i]} : {}),
                    ...(includeCount ? {count: 1} : {}),
                };
                resCalls.push(entry);
                resMap[idHash] = entry;
            }
        }
        return resCalls;
    }

    static _breakpointScriptTemplate () {
        abstract();
    }

    /**
    * @param {import('./breakpoints').Breakpoint} breakpoint
    * @param {string} description
    * @returns string
    */
    getBreakpointScript(breakpoint, description) {
        const canSaveArgs = breakpoint.type === 'method' || breakpoint.setter;
        // only save arguments if requested for given breakpoint
        const argumentCollection = canSaveArgs ? `args: Array.from(arguments).map(a => a.toString())` : '';

        let breakpointScript = this.constructor._breakpointScriptTemplate({
            argumentCollection,
            description,
            saveArguments: breakpoint.saveArguments,
        });

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

            const conditionScript = this.getBreakpointScript(breakpoint, description);

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
                !error.includes('Target closed.') && // we don't care if tab was closed during this operation
                !error.includes('Session closed.') && // we don't care if tab was closed during this operation
                !error.includes('Breakpoint at specified location already exists.') &&
                !error.includes('Cannot find context with specified id') &&
                !error.includes('API unavailable in given context.') // some APIs are unavailable on HTTP or in a worker
            ) {
                this._log('setting breakpoint failed', description, e);
            }
        }
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
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextId} contextId
     */
    async setupContextTracking(contextId = undefined) {
        const allBreakpointsSet = allBreakpoints
            .map(async ({proto, global, props, methods}) => {
                const obj = global || `${proto}.prototype`;
                const propPromises = props.map(async prop => {
                    const expression = `Reflect.getOwnPropertyDescriptor(${obj}, '${prop.name}').${prop.setter === true ? 'set' : 'get'}`;
                    const description = prop.description || `${obj}.${prop.name}`;
                    const breakpointSpec = {
                        ...prop,
                        type: 'property',
                    };
                    await this._addBreakpoint(contextId, expression, description, breakpointSpec);
                });

                await Promise.all(propPromises);

                const methodPromises = methods.map(async method => {
                    const expression = `Reflect.getOwnPropertyDescriptor(${obj}, '${method.name}').value`;
                    const description = method.description || `${obj}.${method.name}`;
                    const breakpointSpec = {
                        ...method,
                        type: 'method',
                    };
                    await this._addBreakpoint(contextId, expression, description, breakpointSpec);
                });

                await Promise.all(methodPromises);
            });

        await Promise.all(allBreakpointsSet);
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
    _preProcessBindingPause(params) {
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

        return {breakpoint, payload};
    }
}

/**
 * Use V8 to produce flexible stack traces with rich information.
 */
class APIProcessorV8 extends APIProcessor {
    /**
     * Note that an empty file name corresponds to <anonymous>.
     */
    static reduceSavedCalls (calls, options) {
        const normaliseStack = stack => {
            // only consider filenames. These correspond to trackers in a
            // meaningful way, so we pick only these to save space.
            return stack.map(se => se.fileName).filter(x => x != null)
                // group adjacent equal elements
                .reduce((acc, x) => {
                    if (acc.length && acc[acc.length-1] === x) {
                        return acc;
                    }
                    acc.push(x);
                    return acc;
                }, []);
        };
        const callsCompact = calls.map(entry => {
            const protoEntry = JSON.parse(JSON.stringify(entry));
            protoEntry.stack = normaliseStack(protoEntry.stack);
            return protoEntry;
        });
        return super.reduceSavedCalls(callsCompact, options);
    }

    static _breakpointScriptTemplate ({
        argumentCollection,
        description,
        saveArguments,
        }) {
        return `
// https://v8.dev/docs/stack-trace-api
const oldTrace = Error.prepareStackTrace;
Error.prepareStackTrace = (err, sst) => {
    return sst.map(st => ({
        typeName: st.getTypeName(),
        functionName: st.getFunctionName(),
        methodName: st.getMethodName(),
        fileName: st.getFileName(),
        lineNumber: st.getLineNumber(),
        columnNumber: st.getColumnNumber(),
        evalOrigin: st.getEvalOrigin(),
        isToplevel: st.isToplevel(),
        isEval: st.isEval(),
        isNative: st.isNative(),
        isConstructor: st.isConstructor(),
        isAsync: st.isAsync(),
        isPromiseAll: st.isPromiseAll(),
        // this one doesn't work at the moment (2023-04-03)
        //isPromiseAny: st.isPromiseAny(),
        promiseIndex: st.getPromiseIndex(),
    }));
};
const stack = (new Error()).stack;
Error.prepareStackTrace = oldTrace;
const data = {
    description: '${description}',
    stack,
    ${argumentCollection}
};
window.registerAPICall(JSON.stringify(data));`;
    }

    /**
     * @param {{payload: string, description: string, executionContextId: number}} params
     * @returns {{description: string, source: string, saveArguments: boolean, arguments: string[]}}
     */
    processBindingPause(params) {
        const {payload, breakpoint} = this._preProcessBindingPause(params) || {};
        if (!breakpoint || !payload) {
            return null;
        }

        return {
            stack: payload.stack,
            description: payload.description,
            saveArguments: breakpoint.saveArguments,
            arguments: payload.args,
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

    static canResolve (breakpoint) {
        return breakpoint && breakpoint.description;
    }

    static produceSummary(calls, {options}) {
        // make the saved calls more compact to save space
        const callsCompact = this.reduceSavedCalls(calls, options);

        return {
            savedCalls: callsCompact,
        };
    }

    processBreakpointToCall(breakpoint) {
        if (this.constructor.canResolve(breakpoint)) {
            return breakpoint;
        }
    }

}

class APIProcessorStackHead extends APIProcessor {
    constructor(sendCommand) {
        super(sendCommand);
        /**
         * @type {Map<string, SavedCall>}
         */
        this._pendingCalls = new Map();
    }

    static reduceSavedCalls (calls) {
        // no reduction performed
        return calls;
    }

    static SOURCE_PROTOCOL_URL_REGEX = /^(?:https?|file):\/\//i;

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
                    if (u && u !== this._mainURL && u.match(this.constructor.SOURCE_PROTOCOL_URL_REGEX)) {
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
                    if (u && u !== this._mainURL && u.match(this.constructor.SOURCE_PROTOCOL_URL_REGEX)) {
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
    _retrieveCallArguments(breakpointId) {
        const call = this._pendingCalls.get(breakpointId);
        this._pendingCalls.delete(breakpointId);
        return call;
    }

    /**
     * @param {{payload: string, description: string, executionContextId: number}} params
     * @returns {{description: string, source: string, saveArguments: boolean, arguments: string[]}}
     */
    processBindingPause(params) {
        const {payload, breakpoint} = this._preProcessBindingPause(params) || {};
        if (!breakpoint || !payload) {
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

    processBreakpointToCall(breakpoint) {
        if (this.constructor.canResolve(breakpoint)) {
            const call = this._retrieveCallArguments(breakpoint.id);
            if (call) {
                return {
                    ...call,
                    source: breakpoint.source,
                };
            }
            return breakpoint;
        }
    }

    static canResolve (breakpoint) {
        return breakpoint && breakpoint.source && breakpoint.description;
    }

    static _breakpointScriptTemplate ({
        argumentCollection,
        description,
        saveArguments,
        }) {
        return `
const stack = (new Error()).stack;
if (typeof stack === "string") {
    const lines = stack.split('\\n');
    const STACK_SOURCE_REGEX = /(\\()?((?:https?|file):[^)]+):[0-9]+:[0-9]+(\\))?/i;
    let url = null;

    for (let line of lines) {
        const lineData = line.match(STACK_SOURCE_REGEX);

        if (lineData) {
            url = lineData[2];
            break;
        }
    }

    if (url || ${saveArguments}) {
        const data = {
            description: '${description}',
            stack,
            url,
            ${argumentCollection}
        };
        window.registerAPICall(JSON.stringify(data));
    }

    if (!url) {
        shouldPause = true;
    }
} else {
    shouldPause = true;
}`;
    }

    /**
     * @param {{finalUrl: string, urlFilter?: function(string):boolean}} options
     * @returns {{callStats: Object<string, APICallData>, savedCalls: SavedCall[]}}
     */
    static produceSummary(calls, {urlFilter, options}) {
        /**
         * @type {Object<string, APICallData>}
         */
        const callStats = {};
        const callsFiltered = calls.filter(call => urlFilter(call.source));

        for (const call of callsFiltered) {
            callStats[call.source] ||= {};
            callStats[call.source][call.description] ||= 0;
            callStats[call.source][call.description]++;
        }

        // make the saved calls more compact to save space
        const callsCompact = this.reduceSavedCalls(callsFiltered, options);

        return {
            callStats,
            savedCalls: callsCompact,
        };
    }
}

module.exports = {
    APIProcessor,
    APIProcessorV8,
    APIProcessorStackHead,
};
