/* eslint-disable max-lines */
/* eslint-disable max-classes-per-file */
const allBreakpoints = require('./breakpoints.js');
const URL = require('url').URL;

const MAX_ASYNC_CALL_STACK_DEPTH = 32;// max depth of async calls tracked

/**
 * @typedef {import('devtools-protocol/types/protocol').default.Runtime.BindingCalledEvent} RuntimeBindingCalledEvent
 */

/**
 * @typedef {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextId} ExecutionContextId
 */

/**
 * @typedef {import('devtools-protocol/types/protocol').Protocol.Runtime.StackTrace} RuntimeStackTrace
 */

/**
 * @typedef {import('devtools-protocol/types/protocol').Protocol.Debugger.BreakpointId} BreakpointId
 */

/**
 * @typedef {import('devtools-protocol/types/protocol').Protocol.Debugger.PausedEvent} DebuggerPausedEvent
 */

/**
 * @typedef {import('devtools-protocol/types/protocol').Protocol.Debugger.ScriptParsedEvent} DebuggerScriptParsedEvent
 */

/**
 * @typedef {(
 *     (import('./breakpoints').MethodBreakpointSpec & {type: 'method'})
 *   | (import('./breakpoints').PropertyBreakpointSpec & {type: 'property'})
 * ) & {
 *     description: string,
 *     saveArguments: boolean,
 * }} TypedBreakpointSpec
 */

/**
 * @typedef {{
 *     spec: TypedBreakpointSpec,
 *     cdpId: string, // breakpointID from CDP
 * }} TypedBreakpoint
 */

/** @returns {never} */
const abstract = () => {
    throw new Error("Cannot call method, is abstract.");
};

const SOURCE_PROTOCOL_URL_REGEX = /^(?:https?|file):\/\//i;

/**
 * Reduces a list of saved calls to a set of unique elements,
 * with a list of call positions found for each entry.
 *
 * @template {object} T
 * @param {T[]} calls
 * @param {{
 *   includePositions?: boolean,
 *   includeCount?: boolean,
 * }} [options]
 * @returns {(T & {positions?: number[], count?: number})[]}
 */
function reduceSavedCalls (calls, options = {}) {
    /**
     * @type {(T & {
     *     positions?: number[],
     *     count?: number,
     * })[]}
     */
    const resCalls = [];
    /** @type {Record<string, {positions?: number[], count?: number}>} */
    const resMap = {};

    const includePositions = 'includePositions' in options ? options.includePositions : true;
    const includeCount = 'includeCount' in options ? options.includeCount : true;

    for (let i = 0; i < calls.length; i++) {
        const idHash = JSON.stringify(calls[i]);
        if (idHash in resMap) {
            const entry = resMap[idHash];
            if (includePositions) {
                entry.positions ??= [];
                entry.positions.push(i);
            }
            if (includeCount) {
                entry.count ??= 0;
                entry.count++;
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

/**
 * @typedef {{
 *     ProcessedDebuggerPause: unknown,
 *     ProcessedRuntimePause: unknown,
 *     ProcessedCall: unknown, // represents a final, processed call
 *     Payload: {description: string},
 *     SummaryOptions: unknown,
 *     Result: unknown, // final result type
 * }} TysBase
 */

/**
 * @template {TysBase} Tys
 */
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
         * @type {Map<BreakpointId, TypedBreakpoint>}
         */
        this._idToBreakpoint = new Map();
        /**
         * @type {Map<string, TypedBreakpoint>}
         */
        this._descToBreakpoint = new Map();
        /**
         * @type {string}
         */
        this._mainURL = '';
        /**
         * @type {Map<string, DebuggerScriptParsedEvent>}
         */
        this._scripts = new Map();
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
     * @abstract
     * @param {{
     *     argumentCollection: string,
     *     description: string,
     *     saveArguments: boolean,
     * }} options
     * @returns {string}
     */
    // eslint-disable-next-line no-unused-vars
    _breakpointScriptTemplate (options) {
        return abstract();
    }

    /**
    * @param {TypedBreakpointSpec} breakpoint
    * @param {string} description
    * @returns {string}
    */
    getBreakpointScript (breakpoint, description) {
        const canSaveArgs = breakpoint.type === 'method' || breakpoint.setter;
        // only save arguments if requested for given breakpoint
        const argumentCollection = canSaveArgs ? `args: Array.from(arguments).map(a => a.toString())` : '';

        let breakpointScript = this._breakpointScriptTemplate({
            argumentCollection,
            description,
            saveArguments: breakpoint.saveArguments,
        });

        // if breakpoint comes with a condition only count it when this condition is met
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
     * @param {ExecutionContextId | undefined} contextId
     * @param {string} expression
     * @param {TypedBreakpointSpec} breakpoint
     */
    async _addBreakpoint(contextId, expression, breakpoint) {
        const description = breakpoint.description;
        try {
            /**
             * @type {import('devtools-protocol/types/protocol').Protocol.Runtime.EvaluateResponse}
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
                spec: breakpoint,
            });
            this._descToBreakpoint.set(description, {
                cdpId: cdpBreakpointResult.breakpointId,
                spec: breakpoint,
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
     * @param {BreakpointId} id
     * @returns {TypedBreakpoint | null}
     */
    _getBreakpointById(id) {
        return this._idToBreakpoint.get(id) ?? null;
    }

    /**
     * @param {string} breakpointDescription
     * @returns {TypedBreakpoint | null}
     */
    _getBreakpointByDescription(breakpointDescription) {
        return this._descToBreakpoint.get(breakpointDescription) ?? null;
    }

    /**
     * @param {ExecutionContextId | undefined} contextId
     */
    async setupContextTracking(contextId = undefined) {
        const allBreakpointsSet = allBreakpoints
            .map(async ({proto, global, props, methods}) => {
                const obj = global || `${proto}.prototype`;
                const propPromises = props.map(async prop => {
                    const expression = `Reflect.getOwnPropertyDescriptor(${obj}, '${prop.name}').${prop.setter === true ? 'set' : 'get'}`;
                    const description = prop.description ?? `${obj}.${prop.name}`;
                    const breakpointSpec = {
                        ...prop,
                        description,
                        saveArguments: prop.saveArguments ?? false,
                        type: /** @type {const} */ ('property'),
                    };
                    await this._addBreakpoint(contextId, expression, breakpointSpec);
                });

                await Promise.all(propPromises);

                const methodPromises = methods.map(async method => {
                    const expression = `Reflect.getOwnPropertyDescriptor(${obj}, '${method.name}').value`;
                    const description = method.description ?? `${obj}.${method.name}`;
                    const breakpointSpec = {
                        ...method,
                        saveArguments: method.saveArguments ?? false,
                        description,
                        type: /** @type {const} */ ('method'),
                    };
                    await this._addBreakpoint(contextId, expression, breakpointSpec);
                });

                await Promise.all(methodPromises);
            });

        await Promise.all(allBreakpointsSet);
    }

    /**
     * @param {DebuggerScriptParsedEvent} params
     */
    processScriptParsed(params) {
        if (this._scripts.has(params.scriptId)) {
            this._log('⚠️ duplicate scriptId', params.scriptId);
        }
        this._scripts.set(params.scriptId, params);
    }

    /**
     * Process the data payload returned from the injected breakpoint script.
     *
     * @abstract
     * @param {unknown} payload
     * @returns {Tys['Payload']}
     */
    // eslint-disable-next-line no-unused-vars
    _processBindingPausePayload(payload) {
        abstract();
    }

    /**
     * @param {RuntimeBindingCalledEvent} params
     * @returns {{
     *     breakpoint: TypedBreakpoint,
     *     payload: Tys['Payload'],
     * } | null}
     */
    _preProcessBindingPause(params) {
        let payload = null;

        try {
            payload = this._processBindingPausePayload(JSON.parse(params.payload));
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

    /**
     * @abstract
     * @param {RuntimeBindingCalledEvent} params
     * @returns {Tys['ProcessedRuntimePause'] | null}
     */
    // eslint-disable-next-line no-unused-vars
    processBindingPause(params) {
        abstract();
    }

    /**
     * @abstract
     * @param {DebuggerPausedEvent} params
     * @returns {Tys['ProcessedDebuggerPause'] | null}
     */
    // eslint-disable-next-line no-unused-vars
    processDebuggerPause(params) {
        abstract();
    }

    /**
     * @abstract
     * @param {Tys['ProcessedDebuggerPause'] | Tys['ProcessedRuntimePause']} breakpoint
     * @returns {Tys['ProcessedCall'] | null}
     */
    // eslint-disable-next-line no-unused-vars
    processBreakpointToCall(breakpoint) {
        abstract();
    }

    /**
     * @abstract
     * @param {Tys['ProcessedCall'][]} calls
     * @param {{
     *     urlFilter?: (url: string) => boolean
     *     options?: Tys['SummaryOptions'],
     * }} options
     * @returns {Tys['Result']}
     */
    // eslint-disable-next-line no-unused-vars
    produceSummary(calls, options) {
        abstract();
    }
}

/**
 * @typedef {{
 *   functionName: string | null,
 *   fileName: string | null,
 *   lineNumber: number | null,
 *   columnNumber: number | null,
 * }} CoreStackEntry
 */

/**
 * @typedef {CoreStackEntry[]} CoreStack
 */

/**
 * @typedef {CoreStackEntry & {
 *   typeName: string | null,
 *   methodName: string | null,
 *   evalOrigin: string | null,
 *   isToplevel: boolean | null,
 *   isEval: boolean | null,
 *   isNative: boolean | null,
 *   isConstructor: boolean | null,
 *   isAsync: boolean | null,
 *   isPromiseAll: boolean | null,
 *   promiseIndex: number | null,
 * }} V8StackEntry
 */

/**
 * @typedef {V8StackEntry[]} V8CallStack
 */

/**
 * @typedef {(V8StackEntry | CoreStackEntry)[]} V8CallStackAllowingAsync
 */

/**
 * @typedef {{
 *     stack: V8CallStack,
 *     description: string,
 *     saveArguments: boolean,
 *     arguments: string[]
 * }} V8ProcessedRuntimePause
 */

/**
 * @typedef {{
 *     id: BreakpointId,
 *     description: string,
 *     stack: CoreStack | null,
 *     saveArguments: boolean
 * }} V8ProcessedDebuggerPause
 */

/**
 * @typedef {{
 *     description: string,
 *     stack: V8CallStack,
 *     args: string[],
 * }} V8Payload
 */

/**
 * @typedef {{
 *     description: string,
 *     stack: CoreStack,
 *     arguments?: string[],
 * }} V8ProcessedCall
 */

/**
 * @typedef {{
 *     stack: string[],
 * }} V8ProcessedCallCompact
 */

/**
 * @typedef {{
 *     description: string,
 *     arguments: string[]
 * }} V8PendingCall
 */

/**
 * @typedef {{
 *     Payload: V8Payload,
 *     ProcessedDebuggerPause: V8ProcessedDebuggerPause,
 *     ProcessedRuntimePause: V8ProcessedRuntimePause,
 *     ProcessedCall: V8ProcessedCall,
 *     SummaryOptions: Parameters<typeof reduceSavedCalls>[1],
 *     Result: {
 *         savedCalls: {
 *             description: string,
 *             stack: string[],
 *             arguments?: string[],
 *             positions?: number[],
 *             count?: number
 *         }[],
 *     },
 * }} V8Tys
 */

/**
 * Use V8 to produce flexible stack traces with rich information.
 *
 * @extends APIProcessor<V8Tys>
 */
class APIProcessorV8 extends APIProcessor {
    constructor(sendCommand) {
        super(sendCommand);
        /**
         * @type {Map<string, V8PendingCall>}
         */
        this._pendingCalls = new Map();
    }

    /**
     * Note that an empty file name corresponds to <anonymous>.
     *
     * @param {V8Tys['ProcessedCall'][]} calls
     * @param {Parameters<typeof reduceSavedCalls>[1]} options
     */
    _reduceSavedCalls (calls, options) {
        /** @param {CoreStack} stack */
        const normaliseStack = stack => stack
            // only consider filenames. These correspond to trackers in a
            // meaningful way, so we pick only these to save space.
            .map(se => se.fileName)
            // group adjacent equal elements
            .reduce((acc, x) => {
                if (x === null) {
                    // filename is null
                    return acc;
                }
                if (acc.length && acc[acc.length - 1] === x) {
                    return acc;
                }
                acc.push(x);
                return acc;
            }, /** @type {string[]} */ ([]));
        const callsCompact = calls.map(entry => {
            const protoEntry = /** @type {typeof entry} */ (JSON.parse(JSON.stringify(entry)));
            return {
                ...protoEntry,
                stack: normaliseStack(JSON.parse(JSON.stringify(entry.stack)))
            };
        });
        return reduceSavedCalls(callsCompact, options);
    }

    /**
     * @param {{
     *   argumentCollection: string,
     *   description: string,
     * }} arg
     */
    _breakpointScriptTemplate ({
        argumentCollection,
        description,
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
window.registerAPICall(JSON.stringify(data));
`;
    }

    /**
     * @param {unknown} payload
     * @returns {V8Tys['Payload']}
     */
    _processBindingPausePayload(payload) {
        return payload;
    }

    /**
     * @param {RuntimeBindingCalledEvent} params
     * @returns {V8Tys['ProcessedRuntimePause'] | null}
     */
    processBindingPause(params) {
        const {payload, breakpoint} = this._preProcessBindingPause(params) || {};
        if (!breakpoint || !payload) {
            return null;
        }

        if (!payload.stack) {
            if (breakpoint.spec.saveArguments) {
                // just save the arguments, the stack will be analyzed with CDP later
                if (!this._pendingCalls.has(breakpoint.cdpId)) {
                    this._log('Unexpected existing pending call', breakpoint.cdpId);
                }
                this._pendingCalls.set(breakpoint.cdpId, {
                    arguments: payload.args,
                    description: payload.description,
                });
            }
            return null;
        }

        return {
            description: payload.description,
            saveArguments: breakpoint.spec.saveArguments,
            arguments: payload.args,
            stack: payload.stack,
        };
    }

    /**
     * @param {DebuggerPausedEvent} params
     * @returns {V8Tys['ProcessedDebuggerPause'] | null}
     */
    processDebuggerPause(params) {
        const breakpointId = (params.hitBreakpoints ?? [])[0];
        const breakpoint = this._getBreakpointById(breakpointId);
        if (!breakpoint) {
            this._log('️⚠️ unknown breakpoint', params);
            return null;
        }

        const stack = this._getStackFromPausedEvent(params);

        return {
            id: breakpointId,
            description: breakpoint.spec.description,
            saveArguments: breakpoint.spec.saveArguments,
            stack,
        };
    }

    /**
     * Return stack from the Debugger.paused event
     *
     * @param {DebuggerPausedEvent} params
     * @returns {CoreStack | null}
     */
    _getStackFromPausedEvent(params) {
        let stack = null;
        if (params.callFrames) {
            /** @type {CoreStack} */
            const cfStack = [];
            for (const frame of params.callFrames) {
                const locationUrl = frame.location && this._scripts.get(frame.location.scriptId)?.url;

                cfStack.push({
                    fileName: locationUrl ?? null,
                    functionName: frame.functionName,
                    lineNumber: frame.location.columnNumber ?? null,
                    columnNumber: frame.location.columnNumber ?? null,
                });
            }
            stack = cfStack;
        }

        if (!stack && params.asyncStackTrace) {
            stack = this._runtimeStackToStack(params.asyncStackTrace);
        }

        if (!stack) {
            this._log('⚠️ could not retrieve stack');
        }

        return stack;
    }

    /**
     * @param {RuntimeStackTrace} rst
     * @returns {CoreStack}
     */
    _runtimeStackToStack(rst) {
        /** @type {CoreStack} */
        const res = [];
        for (const frame of rst.callFrames) {
            res.push({
                functionName: frame.functionName,
                fileName: frame.url,
                lineNumber: frame.lineNumber,
                columnNumber: frame.columnNumber,
            });
        }
        return res;
    }

    /**
     * @param {V8Tys['ProcessedCall'][]} calls
     * @param {{options: V8Tys['SummaryOptions']}} opts
     * @returns {V8Tys['Result']}
     */
    produceSummary(calls, {options}) {
        // make the saved calls more compact to save space
        const callsCompact = this._reduceSavedCalls(calls, options);

        return {
            savedCalls: callsCompact,
        };
    }

    /**
     * @param {BreakpointId} breakpointId
     */
    _retrieveCallArguments(breakpointId) {
        const call = this._pendingCalls.get(breakpointId);
        this._pendingCalls.delete(breakpointId);
        return call;
    }

    /**
     * @param {V8Tys['ProcessedDebuggerPause' | 'ProcessedRuntimePause']} breakpoint
     * @returns {V8Tys['ProcessedCall'] | null}
     */
    processBreakpointToCall (breakpoint) {
        if (breakpoint.stack) {
            if ('id' in breakpoint) {
                // debugger pause, we don't know the arguments yet
                const call = this._retrieveCallArguments(breakpoint.id);
                if (call) {
                    return {
                        description: call.description,
                        arguments: call.arguments,
                        stack: breakpoint.stack,
                    };
                }
                return {
                    // could not retrieve arguments (should be a property getter)
                    description: breakpoint.description,
                    stack: breakpoint.stack,
                };
            }
            // call pause, we have arguments already
            return {
                description: breakpoint.description,
                arguments: breakpoint.arguments,
                stack: breakpoint.stack,
            };
        }
        return null;
    }
}

/**
 * @typedef {{
 *     description: string,
 *     url: string,
 *     args: string[],
 * }} StackHeadPayload
 */

/**
 * @typedef {Object<string, number>} APICallData
 */

/**
 * @typedef {{
 *     id: BreakpointId,
 *     description: string,
 *     source: string,
 *     saveArguments: boolean
 * }} StackHeadProcessedDebuggerPause
 */

/**
 * @typedef {{
 *     description: string,
 *     source: string,
 *     saveArguments: boolean,
 *     arguments: string[]
 * }} StackHeadProcessedRuntimeBindingCalled
 */

/**
 * @typedef {{
 *     description: string,
 *     arguments: string[]
 * }} StackHeadPendingCall
 */

/**
 * @typedef {{
 *     arguments: string[],
 *     description: string,
 *     source: string,
 * }} StackHeadProcessedCall
 */

/**
 * @typedef {{
 *     Payload: StackHeadPayload,
 *     ProcessedDebuggerPause: StackHeadProcessedDebuggerPause,
 *     ProcessedRuntimePause: StackHeadProcessedRuntimeBindingCalled,
 *     ProcessedCall: StackHeadProcessedCall,
 *     SummaryOptions: Parameters<typeof reduceSavedCalls>[1],
 *     Result: {
 *         callStats: Record<string, APICallData>,
 *         savedCalls: {},
 *     },
 * }} StackHeadTys
 */

/**
 * Pick only the most recent non-anonymous entry from each stack.
 *
 * @extends APIProcessor<StackHeadTys>
 */
class APIProcessorStackHead extends APIProcessor {
    constructor(sendCommand) {
        super(sendCommand);
        /**
         * @type {Map<string, StackHeadPendingCall>}
         */
        this._pendingCalls = new Map();
    }

    /**
     * Return top non-anonymous source from Runtime.StackTrace.
     *
     * @param {RuntimeStackTrace} params
     * @returns {string | null}
     */
    _getScriptURLFromStackTrace(params) {
        if (params.callFrames) {
            for (const frame of params.callFrames) {
                const fileUrl = frame.scriptId && this._scripts.get(frame.scriptId)?.url;
                const frameUrl = frame.url;
                for (const u of [frameUrl, fileUrl]) {
                    if (u && u !== this._mainURL && u.match(SOURCE_PROTOCOL_URL_REGEX)) {
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
     * @param {DebuggerPausedEvent} params
     * @returns {string}
     */
    _getScriptURLFromPausedEvent(params) {
        let script = null;
        if (params.callFrames) {
            iterateAllFrames: for (const frame of params.callFrames) {
                const locationUrl = frame.location && this._scripts.get(frame.location.scriptId)?.url;
                const functionLocationUrl = frame.functionLocation && this._scripts.get(frame.functionLocation.scriptId)?.url;
                const frameUrl = frame.url; // this is usually empty in Debugger.CallFrame (unlike Runtime.CallFrame)

                for (const u of [frameUrl, functionLocationUrl, locationUrl]) {
                    if (u && u !== this._mainURL && u.match(SOURCE_PROTOCOL_URL_REGEX)) {
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
     * @param {BreakpointId} breakpointId
     */
    _retrieveCallArguments(breakpointId) {
        const call = this._pendingCalls.get(breakpointId);
        this._pendingCalls.delete(breakpointId);
        return call;
    }

    /**
     * @param {DebuggerPausedEvent} params
     * @returns {StackHeadTys['ProcessedDebuggerPause'] | null}
     */
    processDebuggerPause(params) {
        const breakpointId = (params.hitBreakpoints ?? [])[0];
        const breakpoint = this._getBreakpointById(breakpointId);
        if (!breakpoint) {
            this._log('️⚠️ unknown breakpoint', params);
            return null;
        }

        const source = this._getScriptURLFromPausedEvent(params);

        return {
            id: breakpointId,
            description: breakpoint.spec.description,
            saveArguments: breakpoint.spec.saveArguments,
            source,
        };
    }

    /**
     * @param {RuntimeBindingCalledEvent} params
     * @returns {StackHeadTys['ProcessedRuntimePause'] | null}
     */
    processBindingPause(params) {
        const {payload, breakpoint} = this._preProcessBindingPause(params) || {};
        if (!breakpoint || !payload) {
            return null;
        }

        if (!payload.url) {
            if (breakpoint.spec.saveArguments) {
                // just save the arguments, the stack will be analyzed with CDP later
                if (!this._pendingCalls.has(breakpoint.cdpId)) {
                    this._log('Unexpected existing pending call', breakpoint.cdpId);
                }
                this._pendingCalls.set(breakpoint.cdpId, {
                    arguments: payload.args,
                    description: payload.description,
                });
            }
            return null;
        }

        return {
            description: payload.description,
            saveArguments: breakpoint.spec.saveArguments,
            arguments: payload.args,
            source: payload.url,
        };
    }

    /**
     * @param {StackHeadTys['ProcessedDebuggerPause' | 'ProcessedRuntimePause']} breakpoint
     * @returns {StackHeadTys['ProcessedCall'] | null}
     */
    processBreakpointToCall(breakpoint) {
        if (breakpoint && breakpoint.source && breakpoint.description) {
            if ('id' in breakpoint) {
                // debugger pause, we don't know the arguments yet
                const call = this._retrieveCallArguments(breakpoint.id);
                if (call) {
                    return {
                        ...call,
                        source: breakpoint.source,
                    };
                }
            } else if (breakpoint.description) {
                return breakpoint;
            }
        }
        return null;
    }

    /**
     * @param {{
     *   argumentCollection: string,
     *   description: string,
     *   saveArguments: boolean,
     * }} arg
     */
    _breakpointScriptTemplate ({
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
     * @param {unknown} payload
     * @returns {StackHeadTys['Payload']}
     */
    _processBindingPausePayload(payload) {
        return payload;
    }

    /**
     * @param {StackHeadTys['ProcessedCall'][]} calls
     * @param {{
     *     urlFilter?: (url: string) => boolean,
     *     options?: StackHeadTys['SummaryOptions'],
     * }} [options]
     * @returns {StackHeadTys['Result']}
     */
    produceSummary(calls, options = {}) {
        // eslint-disable-next-line no-unused-vars
        const urlFilter = options.urlFilter ?? (_ => true);
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
        const callsCompact = reduceSavedCalls(calls, options.options);

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
