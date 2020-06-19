const BaseCollector = require('./BaseCollector');

class DynamicDOMCollector extends BaseCollector {

    id() {
        return 'dynamic-dom';
    }

    /**
     * @param {import('./BaseCollector').CollectorInitOptions} options 
     */
    init({
        log,
    }) {
        /**
         * @type {import('puppeteer').CDPSession}
         */
        this._cdpClient = null;
        this._log = log;
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('puppeteer').TargetType}} targetInfo 
     */
    async addTarget({cdpClient, type}) {
        if (type === 'page') {
            this._cdpClient = cdpClient;
            await cdpClient.send('DOM.enable');
            await cdpClient.send('DOM.setNodeStackTracesEnabled', {enable: true});

            // does nothing really
            cdpClient.on('DOM.childNodeInserted', data => this._log('DOM.childNodeInserted'));
            cdpClient.on('DOM.childNodeRemoved', data => this._log('DOM.childNodeRemoved'));
            cdpClient.on('DOM.setChildNodes', data => this._log('DOM.setChildNodes'));
            cdpClient.on('DOM.childNodeCountUpdated', data => this._log('DOM.childNodeCountUpdated'));
            cdpClient.on('DOM.documentUpdated', data => this._log('DOM.documentUpdated'));
            cdpClient.on('DOM.distributedNodesUpdated', data => this._log('DOM.distributedNodesUpdated'));
        }
    }

    /**
     * @param {DOMNode} node 
     * @param {function} callback 
     */
    async walkDOM(node, callback) {
        // eslint-disable-next-line callback-return
        await callback(node);

        if (!node.children || node.children.length === 0) {
            return;
        }

        for (let i = 0; i < node.children.length; i++) {
            // eslint-disable-next-line no-await-in-loop
            await this.walkDOM(node.children[i], callback);
        }
    }

    /**
     * @param {DOMNode} node 
     * @returns {Promise<string|null>} 
     */
    async getNodeCreatorUrl(node) {
        let creation;

        if (node.nodeType !== 1) { // we can only color elements
            return null;
        }

        try {
            const result = await this._cdpClient.send('DOM.getNodeStackTraces', {nodeId: node.nodeId});
            creation = result.creation;
        } catch (e) {
            this._log('Error while looking for a node', e);
            return null;
        }

        if (creation) {
            if (creation.callFrames && creation.callFrames.length > 0) {
                const frame = creation.callFrames.find(f => f.url.length > 0);//reverse()
                const script = frame ? frame.url : '';
                
                return script;
            }
        }

        return null;
    }

    async getData() {
        /**
         * @type {{root: DOMNode}}
         */
        // @ts-ignore
        const result = await this._cdpClient.send('DOM.getDocument', {depth: -1});

        const urls = new Set();

        // eslint-disable-next-line arrow-parens
        await this.walkDOM(result.root, async (/** @type {DOMNode} **/ node) => {
            const url = await this.getNodeCreatorUrl(node);

            if (url) {
                urls.add(url);
            }

        });

        return Array.from(urls);
    }
}

module.exports = DynamicDOMCollector;

/**
 * @typedef {object} DOMNode
 * @property {number} nodeId
 * @property {number} nodeType
 * @property {DOMNode[]} children
 */