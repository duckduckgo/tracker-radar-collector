/**
 * Collects browser trace.
 * Based on https://github.com/GoogleChrome/puppeteer/blob/master/lib/Tracing.js and https://github.com/GoogleChrome/lighthouse/blob/master/lighthouse-core/gather/driver.js .
 * TODO we should use puppeteer's page.tracing.start() instead
 */
const BaseCollector = require('./BaseCollector');
const createDeferred = require('../helpers/deferred');

class TraceCollector extends BaseCollector {

    id() {
        return 'trace';
    }

    init() {
        /**
         * @type {boolean}
         */
        this._tracing = false;
        /**
         * @type {import('puppeteer').CDPSession}
         */
        this._cdpClient = null;
    }

    /**
    * @param {string} handle
    */
    async _readStream(handle) {
        let eof = false;
        const bufs = [];
        while (!eof) {
            /**
             * @type {{eof:boolean, data:string}}
             */
            // @ts-ignore oversimplified .send signature
            // eslint-disable-next-line no-await-in-loop
            const response = await this._cdpClient.send('IO.read', {handle});
            eof = response.eof;
            bufs.push(Buffer.from(response.data));
        }
        await this._cdpClient.send('IO.close', {handle});
        let resultBuffer = null;
        try {
            resultBuffer = Buffer.concat(bufs);
        } finally {
            // eslint-disable-next-line no-unsafe-finally
            return resultBuffer;
        }
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('./TargetCollector').TargetType}} targetInfo 
     */
    async addTarget({cdpClient, type}) {
        if (type === 'page' && !this._tracing) {
            this._cdpClient = cdpClient;
            this._tracing = true;

            const categories = [
                // Exclude default categories. We'll be selective to minimize trace size
                '-*',

                // Used instead of 'toplevel' in Chrome 71+
                'disabled-by-default-lighthouse',

                // All compile/execute events are captured by parent events in devtools.timeline..
                // But the v8 category provides some nice context for only <0.5% of the trace size
                'v8',
                // Same situation here. This category is there for RunMicrotasks only, but with other teams
                // accidentally excluding microtasks, we don't want to assume a parent event will always exist
                'v8.execute',

                // For extracting UserTiming marks/measures
                'blink.user_timing',

                // Not mandatory but not used much
                'blink.console',

                // Most the events we need come in on these two
                'devtools.timeline',
                'disabled-by-default-devtools.timeline',

                // Up to 450 (https://goo.gl/rBfhn4) JPGs added to the trace
                // 'disabled-by-default-devtools.screenshot',

                // This doesn't add its own events, but adds a `stackTrace` property to devtools.timeline events
                'disabled-by-default-devtools.timeline.stack',

                // CPU sampling profiler data only enabled for debugging purposes
                // 'disabled-by-default-v8.cpu_profiler',
                // 'disabled-by-default-v8.cpu_profiler.hires',
            ];

            await this._cdpClient.send('Tracing.start', {
                transferMode: 'ReturnAsStream',
                categories: categories.join(','),
                options: 'sampling-frequency=10000', // 1000 is default and too slow.
            });
        }
    }

    /**
     * @returns {Promise<TargetData[]>}
     */
    async getData() {
        const deferred = createDeferred();

        this._cdpClient.once('Tracing.tracingComplete', async event => {
            try {
                const buffer = await this._readStream(event.stream);
                const string = buffer.toString('utf8');
                /**
                 * @type {{traceEvents: {name: string, args: object}[], metadata: any}}
                 */
                const obj = JSON.parse(string);

                if (obj.traceEvents) {
                    // 'RunTask' events seem to be useless for our purposes so we are filtering them out to prserve space
                    // Ideally, we should avoid collecting them in the first place but we do need devtools.timeline category
                    obj.traceEvents = obj.traceEvents
                        .filter(e => e.name !== 'RunTask' || Object.keys(e.args).length > 0);
                }

                deferred.resolve(obj);
            } catch(e) {
                deferred.reject(e);
            }
        });
        await this._cdpClient.send('Tracing.end');
        
        this._tracing = false;

        return deferred.promise;
    }
}

module.exports = TraceCollector;

/**
 * @typedef TargetData
 * @property {string} url
 * @property {import('./TargetCollector').TargetType} type
 */
