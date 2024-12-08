const BaseCollector = require('./BaseCollector');

class ScreenshotCollector extends BaseCollector {

    id() {
        return 'screenshots';
    }

    /**
     * @param {import('./BaseCollector').TargetInfo} targetInfo 
     */
    addTarget({session, type}) {
        if (type === 'page') {
            this._cdpClient = session;
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
