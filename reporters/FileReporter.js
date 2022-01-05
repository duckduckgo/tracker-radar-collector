const fs = require('fs');
const path = require('path');
const BaseReporter = require('./BaseReporter');
const createDeferred = require('../helpers/deferred');

class FileReporter extends BaseReporter {

    id() {
        return 'file';
    }

    /**
     * @param {{verbose: boolean, startTime: Date, urls: number, logPath: string}} options 
     */
    init(options) {
        if (!options.logPath) {
            throw new Error('FileReporter requires log path to be set.');
        }
        this.logFile = fs.createWriteStream(path.join(options.logPath, 'log.txt'), {flags: 'w'});
    }

    /**
     * @param  {...any} msg 
     */
    log(...msg) {
        this.logFile.write(msg.join(' ') + '\n');
    }

    /**
     * @returns {Promise<void>}
     */
    cleanup() {
        const {resolve, promise} = createDeferred();

        this.logFile.once('close', () => resolve());
        this.logFile.close();

        return promise;
    }
}

module.exports = FileReporter;
