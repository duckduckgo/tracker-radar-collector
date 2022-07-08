/* eslint-disable no-process-env */
const fs = require('fs').promises;
const path = require('path');
const program = require('commander');
const ProgressBar = require('progress');
const chalk = require('chalk').default;
const Clickhouse = require('../reporters/ClickhouseReporter');

program
    .description(`Import a crawl into clickhouse, or create a row in the crawl table.
    
Examples:
    # import crawl with default crawlId and no metadata
    clickhouse.js -d /path/to/crawl

    # Create an entry in the crawl table with ID "mycrawl" and import nothing
    clickhouse.js -c mycrawl --name "This is a crawl" --region US
    `)
    .option('-c, --crawlid <id>', 'Crawl ID')
    .option('--crawlname <crawlname>', 'Name of the crawl')
    .option('--region <region>', 'Crawl region code')
    .option('-d --crawldir <dir>', 'Directory of crawl output to import')
    .option('--delete', 'Delete data for the given crawlid')
    .parse(process.argv);

const ch = new Clickhouse();
const crawlName = program.crawlname;
const crawlRegion = program.region;
const crawledPagePath = program.crawldir;

// Must provide at least one option
if ((!crawlName && !crawlRegion && !crawledPagePath && !program.crawlid) || (program.delete && !program.crawlid)) {
    program.outputHelp();
    process.exit(1);
}

(async () => {
    /**
     * @type {string[]}
     */
    let pages = [];
    if (crawledPagePath) {
        pages = (await fs.readdir(crawledPagePath)).filter(name => name.endsWith('.json') && name !== 'metadata.json');
    }
    ch.init({verbose: false, startTime: new Date(), urls: pages.length, logPath: ''});
    if (program.crawlid) {
        ch.crawlId = program.crawlid;
    }
    if (program.delete) {
        await ch.deleteCrawlData();
        return;
    }
    await ch.createCrawl(crawlName, crawlRegion);
    if (crawledPagePath) {
        const progressBar = new ProgressBar('[:bar] :percent ETA :etas :page', {
            complete: chalk.green('='),
            incomplete: ' ',
            total: pages.length,
            width: 30,
        });
        for (const page of pages) {
            // eslint-disable-next-line no-await-in-loop
            const contents = await fs.readFile(path.join(crawledPagePath, page), {encoding: 'utf-8'});
            const data = JSON.parse(contents.toString());
            if (!data.initialUrl) {
                progressBar.total -= 1;
                continue;
            }
            // eslint-disable-next-line no-await-in-loop
            await ch.processSite(data);
            progressBar.tick({
                page,
            });
        }
    }
    await ch.cleanup();
})();
