const BaseCollector = require('./BaseCollector');

const ISOLATED_WORLD_PREFIX = 'iw_for_';

/**
 * @param {String|Error} e
 */
function isIgnoredCDPError(e) {
    // ignore evaluation errors (sometimes frames reload too fast)
    const error = (typeof e === 'string') ? e : e.message;
    return (
        error.includes('TargetCloseError:') ||
        error.includes('No frame for given id found') ||
        error.includes('Target closed') ||
        error.includes('Session closed') ||
        error.includes('Cannot find context with specified id') ||
        error.includes('uniqueContextId not found')
    );
}

/**
 * @abstract
 * Base class for collectors that need to create isolated worlds for each frame.
 */
class ContentScriptCollector extends BaseCollector {
    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options
     */
    init(options) {
        this.log = options.log;
        /**
         * maps isolated world uniqueId to page world uniqueId
         * @type {Map<import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription['uniqueId'], import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription['uniqueId']>}
         */
        this.isolated2pageworld = new Map();
        /**
         * maps isolated world uniqueId to CDPSession
         * @type {Map<import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription['uniqueId'], import('puppeteer-core').CDPSession>}
         */
        this.cdpSessions = new Map();
        this.iwPrefix = `${ISOLATED_WORLD_PREFIX}${this.id()}_`;
    }

    /**
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Target.TargetInfo} targetInfo
     */
    async addTarget(session, targetInfo) {
        if (targetInfo.type !== 'page' && targetInfo.type !== 'iframe') {
            return;
        }

        session.on('Runtime.executionContextDestroyed', async ({executionContextUniqueId}) => {
            this.isolated2pageworld.delete(executionContextUniqueId);
            this.cdpSessions.delete(executionContextUniqueId);
        });

        // inject the content script into every frame in isolated world
        session.on('Runtime.executionContextCreated', async ({context}) => {
            // new isolated world for our content script
            if (context.auxData.type === 'isolated' && context.name.startsWith(this.iwPrefix)) {
                const pageWorldUniqueId = context.name.slice(this.iwPrefix.length);
                this.isolated2pageworld.set(context.uniqueId, pageWorldUniqueId);
                this.cdpSessions.set(context.uniqueId, session);
                await this.onIsolatedWorldCreated(session, context);
                return;
            }

            // ignore other special contexts
            if (!context.origin || context.origin === '://' || context.auxData.type !== 'default') {
                return;
            }

            // request an isolated world for this frame
            try {
                await session.send('Page.createIsolatedWorld', {
                    frameId: context.auxData.frameId,
                    worldName: `${this.iwPrefix}${context.uniqueId}`,
                });
            } catch (e) {
                if (!this.isIgnoredCdpError(e)) {
                    this.log(`Error creating isolated world for ${context.uniqueId}: ${e}`);
                }
            }
        });
    }

    /**
     * @abstract
     * @param {import('puppeteer-core').CDPSession} session
     * @param {import('devtools-protocol/types/protocol').Protocol.Runtime.ExecutionContextDescription} context
     * @returns {Promise<void>}
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onIsolatedWorldCreated(session, context) {
        throw new Error('Not implemented');
    }

    /**
     * @param {Error|string} e
     */
    isIgnoredCdpError(e) {
        return isIgnoredCDPError(e);
    }
}

module.exports = ContentScriptCollector;