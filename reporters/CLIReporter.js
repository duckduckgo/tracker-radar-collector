const BaseReporter = require('./BaseReporter');
const ProgressBar = require('progress');
const chalk = require('chalk').default;

class CLIReporter extends BaseReporter {
    id() {
        return 'cli';
    }

    /**
     * @param {{verbose: boolean, startTime: Date, urls: number, logPath: string}} options 
     */
    init(options) {
        this.verbose = options.verbose;

        this.alwaysLog(chalk.cyan(`Start time: ${options.startTime.toUTCString()}`));
        this.alwaysLog(chalk.cyan(`URLs to crawl: ${options.urls}`));

        // show progress bar only if we are not printing all logs to screen (verbose)
        this.progressBar = (this.verbose || options.urls === 0) ? null : new ProgressBar('[:bar] :percent ETA :etas fail :fail% :site', {
            complete: chalk.green('='),
            incomplete: ' ',
            total: options.urls,
            width: 30
        });

        if (this.progressBar) {
            this.progressBar.render();
        }
    }

    /**
     * @param  {...any} msg 
     */
    alwaysLog(...msg) {
        // eslint-disable-next-line no-console
        console.log(...msg);
    }

    /**
     * @param  {...any} msg 
     */
    log(...msg) {
        if (this.verbose) {
            // eslint-disable-next-line no-console
            console.log(...msg);
        }
    }

    /**
     * @param {{site: string, failures: number, successes: number, urls: number}} data 
     */
    update(data) {
        const finished = data.failures + data.successes;
        if (this.progressBar) {
            this.progressBar.total = data.urls;
            this.progressBar.tick({
                site: data.site,
                fail: (data.failures / finished * 100).toFixed(1)
            });
        } else {

            this.log(`Site ${finished} / ${data.urls} (${(finished / data.urls * 100).toFixed(1)}%)`);
        }
    }

    /**
     * @param {{endTime: Date, successes: number, failures: number, urls: number}} data
     * @returns {Promise<void>}
     */
    cleanup({endTime, successes, failures, urls}) {
        this.alwaysLog(chalk.cyan(`Finish time: ${endTime.toUTCString()}`));
        this.alwaysLog(chalk.cyan(`Sucessful crawls: ${successes}/${urls} (${(successes / urls * 100).toFixed(2)}%)`));
        this.alwaysLog(chalk.cyan(`Failed crawls: ${failures}/${urls} (${(failures / urls * 100).toFixed(2)}%)`));

        return Promise.resolve();
    }
}

module.exports = CLIReporter;
