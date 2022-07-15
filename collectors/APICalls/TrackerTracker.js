const MAX_ASYNC_CALL_STACK_DEPTH = 32;// max depth of async calls tracked
const allBreakpoints = require('./breakpoints.js');
const URL = require('url').URL;
const STACK_SOURCE_REGEX = /\((https?:\/\/.*?):[0-9]+:[0-9]+\)/i;

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
         * @type {string}
         */
        this._mainURL = '';
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
     * @param {string} expression 
     * @param {string} condition 
     * @param {string} description 
     * @param {boolean} saveArguments
     * @param {CDPContextId} contextId 
     */
    async _addBreakpoint(expression, condition, description, contextId, saveArguments) {
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

            let conditionScript = `
                const data = {
                    description: '${description}',
                    stack: (new Error()).stack
                };
            `;

            // only save arguments if requested for given breakpoint
            if (saveArguments) {
                conditionScript += `
                    data.args = Array.from(arguments).map(a => a.toString());
                `;
            }

            conditionScript += `
                window.registerAPICall(JSON.stringify(data));
                false;
            `;

            // if breakpoint comes with an condition only count it when this condition is met
            if (condition) {
                conditionScript = `
                    if (!!(${condition})) {
                        ${conditionScript}
                    }
                `;
            }

            await this._send('Debugger.setBreakpointOnFunctionCall', {
                objectId: result.result.objectId,
                condition: conditionScript
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
     * @param {CDPContextId} contextId 
     */
    async setupContextTracking(contextId = undefined) {
        const allBreakpointsSet = allBreakpoints
            .map(async ({proto, global, props, methods}) => {
                const obj = global || `${proto}.prototype`;

                const propPromises = props.map(async prop => {
                    const expression = `Reflect.getOwnPropertyDescriptor(${obj}, '${prop.name}').${prop.setter === true ? 'set' : 'get'}`;
                    const description = prop.description || `${obj}.${prop.name}`;
                    await this._addBreakpoint(expression, prop.condition, description, contextId, Boolean(prop.saveArguments));
                });
    
                await Promise.all(propPromises);
    
                const methodPromises = methods.map(async method => {
                    const expression = `Reflect.getOwnPropertyDescriptor(${obj}, '${method.name}').value`;
                    const description = method.description || `${obj}.${method.name}`;
                    await this._addBreakpoint(expression, method.condition, description, contextId, Boolean(method.saveArguments));
                });
    
                await Promise.all(methodPromises);
            });
        
        await Promise.all(allBreakpointsSet);
    }

    /**
     * Return top non-anonymous source from the stack trace.
     * 
     * @param {string} stack JS stack trace 
     * @returns {string}
     */
    _getScriptURL(stack) {
        if (typeof stack !== "string") {
            this._log('⚠️ stack is not a string');
            return null;
        }

        const lines = stack.split('\n');

        for (let line of lines) {
            const lineData = line.match(STACK_SOURCE_REGEX);

            if (lineData) {
                return lineData[1];
            }
        }

        return null;
    }

    /**
     * @param {string} breakpointName
     * @returns {import('./breakpoints').MethodBreakpoint|import('./breakpoints').PropertyBreakpoint} 
     */
    _getBreakpointByName(breakpointName) {
        for (let breakpoint of allBreakpoints) {
            const {proto, global, props, methods} = breakpoint;
            const obj = global || `${proto}.prototype`;
            const matchingProp = props.find(prop => (prop.description || `${obj}.${prop.name}`) === breakpointName);

            if (matchingProp) {
                return matchingProp;
            }

            const matchingMethod = methods.find(method => (method.description || `${obj}.${method.name}`) === breakpointName);

            if (matchingMethod) {
                return matchingMethod;
            }
        }

        return null;
    }

    /**
     * @param {{payload: string, description: string, executionContextId: number}} params
     * @returns {{description: string, source: string, saveArguments: boolean, arguments: string[]}}
     */
    processDebuggerPause(params) {
        let payload = null;
        
        try {
            payload = JSON.parse(params.payload);
        } catch(e) {
            this._log('🚩 invalid brakpoint payload', params.payload);
            return null;
        }

        const breakpoint = this._getBreakpointByName(payload.description);
        let script = this._getScriptURL(payload.stack);

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

        if (!breakpoint) {
            this._log('️⚠️ unknown breakpoint', params);
            return null;
        }

        // this._log('breakpoint', params, script);

        return {
            description: payload.description,
            saveArguments: breakpoint.saveArguments,
            arguments: payload.args,
            source: script
        };
    }
}

module.exports = TrackerTracker;

/**
 * @typedef {string} CDPContextId
 */

/**
 * @typedef {string} CDPBreakpointId
 */