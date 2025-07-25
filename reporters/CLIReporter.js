const BaseReporter = require('./BaseReporter');
const ProgressBar = require('progress');
const chalk = require('chalk');

class CLIReporter extends BaseReporter {
    id() {
        return 'cli';
    }

    /**
     * @param {{verbose: boolean, startTime: Date, urls: number, logPath: string}} options
     */
    init(options) {
        this.verbose = options.verbose;
        this.startTime = options.startTime;

        this.alwaysLog(chalk.cyan(`Start time: ${options.startTime.toUTCString()}`));
        this.alwaysLog(chalk.cyan(`URLs to crawl: ${options.urls}`));

        // eslint-disable-next-line no-process-env
        this.progressBar = (options.urls === 0 || process.env.IS_CI) ? null : new ProgressBar('[:bar] :percent :finished ETA :etas fail :fail% rate :ratePerMinute/min :site', {
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
        const currentTime = new Date();
        const elapsedMinutes = (currentTime.getTime() - this.startTime.getTime()) / (1000 * 60);
        const ratePerMinute = elapsedMinutes > 0 ? (finished / elapsedMinutes).toFixed(1) : '0.0';

        if (this.progressBar) {
            this.progressBar.total = data.urls;
            this.progressBar.tick({
                site: data.site,
                finished: `${finished} / ${data.urls}`,
                fail: (data.failures / finished * 100).toFixed(1),
                ratePerMinute,
            });
        } else {
            this.alwaysLog(`${currentTime.toUTCString()} | Finished: ${finished} | Failed: ${data.failures} | Total: ${data.urls} | Rate: ${ratePerMinute} sites/min | Last: ${data.site}`);
        }
    }

    /**
     * @param {{startTime: Date, endTime: Date, successes: number, failures: number, urls: number}} data
     * @returns {Promise<void>}
     */
    cleanup({startTime, endTime, successes, failures, urls}) {
        this.alwaysLog(chalk.cyan(`Start time: ${startTime.toUTCString()}`));
        this.alwaysLog(chalk.cyan(`Finish time: ${endTime.toUTCString()}`));
        const durationMs = endTime.getTime() - startTime.getTime();
        const totalSeconds = Math.floor(durationMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        this.alwaysLog(chalk.cyan(`Duration: ${hours}h ${minutes}m ${seconds}s`));
        this.alwaysLog(chalk.cyan(`Sucessful crawls: ${successes}/${urls} (${(successes / urls * 100).toFixed(2)}%)`));
        this.alwaysLog(chalk.cyan(`Failed crawls: ${failures}/${urls} (${(failures / urls * 100).toFixed(2)}%)`));

        return Promise.resolve();
    }
}

module.exports = CLIReporter;
