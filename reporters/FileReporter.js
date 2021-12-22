const fs = require('fs');
const path = require('path');
const BaseReporter = require('./BaseReporter');

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
        this.logFile.close();
        return Promise.resolve();
    }
}

module.exports = FileReporter;