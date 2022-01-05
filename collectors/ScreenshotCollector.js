const BaseCollector = require('./BaseCollector');

class ScreenshotCollector extends BaseCollector {

    id() {
        return 'screenshots';
    }

    /**
     * @param {{cdpClient: import('puppeteer').CDPSession, url: string, type: import('./TargetCollector').TargetType}} targetInfo 
     */
    addTarget({cdpClient, type}) {
        if (type === 'page') {
            this._cdpClient = cdpClient;
        }
    }

    /**
     * @returns {Promise<string>}
     */
    async getData() {
        await this._cdpClient.send('Page.enable');

        const result = await this._cdpClient.send('Page.captureScreenshot', {format: 'jpeg', quality: 85});

        return result.data;
    }
}

module.exports = ScreenshotCollector;
