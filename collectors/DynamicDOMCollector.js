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

            // alternative solution (might be more performant)
            // await cdpClient.send('DOM.getDocument', {depth: -1});
            // cdpClient.on('DOM.childNodeInserted', data => this._log('DOM.childNodeInserted'));
            // cdpClient.on('DOM.documentUpdated', async data => {this._log('DOM.documentUpdated'); await cdpClient.send('DOM.getDocument', {depth: -1})});
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
     * @returns {Promise<{url: string, nodeName: string}|null>} 
     */
    async getNodeCreatorUrl(node) {
        let creation;

        if (node.nodeType !== 1) { // we can only color elements
            return null;
        }

        try {
            const result = await this._cdpClient.send('DOM.getNodeStackTraces', {nodeId: node.nodeId});
            // @ts-ignore
            creation = result.creation;
        } catch (e) {
            this._log('Error while looking for a node', e);
            return null;
        }

        if (creation) {
            if (creation.callFrames && creation.callFrames.length > 0) {
                // eslint-disable-next-line arrow-parens
                const frame = creation.callFrames.find((/** @type {{url:string}} **/f) => f.url.length > 0);//reverse()
                const script = frame ? frame.url : '';
                
                return {url: script, nodeName: node.localName};
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

        const urls = new Map();

        // eslint-disable-next-line arrow-parens
        await this.walkDOM(result.root, async (/** @type {DOMNode} **/ node) => {
            const creator = await this.getNodeCreatorUrl(node);

            if (creator) {
                const item = urls.get(creator.url) || {url: creator.url, nodeNames: new Set()};

                item.nodeNames.add(creator.nodeName);

                urls.set(creator.url, item);
            }

        });

        return Array.from(urls.values()).map(item => ({
            url: item.url,
            nodeNames: Array.from(item.nodeNames)
        }));
    }
}

module.exports = DynamicDOMCollector;

/**
 * @typedef {object} DOMNode
 * @property {number} nodeId
 * @property {number} nodeType
 * @property {DOMNode[]} children
 * @property {string} localName
 */