const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const ProgressBar = require('progress');
const chalk = require('chalk');
const Clickhouse = require('../reporters/ClickhouseReporter');
const { SCRAPED_FRAMES_TABLES } = Clickhouse;

program
    .description(
        `Import a crawl into clickhouse, or create a row in the crawl table.
    
Examples:
    # import crawl with default crawlId and no metadata
    clickhouse.js -d /path/to/crawl

    # Create an entry in the crawl table with ID "mycrawl" and import nothing
    clickhouse.js -c mycrawl --name "This is a crawl" --region US

    # Import only cookie popup scrapedFrames data for the already imported crawl "mycrawl"
    clickhouse.js -c mycrawl -d /path/to/crawl --frames-only

    # Replace previously imported scrapedFrames data (e.g. after re-running detect-cookie-popups.js)
    clickhouse.js -c mycrawl -d /path/to/crawl --frames-only --replace
    `,
    )
    .option('-c, --crawlid <id>', 'Crawl ID')
    .option('--crawlname <crawlname>', 'Name of the crawl')
    .option('--region <region>', 'Crawl region code')
    .option('-d --crawldir <dir>', 'Directory of crawl output to import')
    .option('--delete', 'Delete data for the given crawlid')
    .option('--frames-only', `Only import (or delete) scrapedFrames data (${SCRAPED_FRAMES_TABLES.join(', ')}) for an existing crawl`)
    .option('--replace', 'With --frames-only, delete previously imported scrapedFrames data before importing')
    .parse(process.argv);

const opts = program.opts();

const ch = new Clickhouse();
const crawlName = opts.crawlname;
const crawlRegion = opts.region;
const crawledPagePath = opts.crawldir;

// Must provide at least one option
if (
    (!crawlName && !crawlRegion && !crawledPagePath && !opts.crawlid) ||
    (opts.delete && !opts.crawlid) ||
    (opts.framesOnly && !opts.crawlid) ||
    (opts.framesOnly && !opts.delete && !crawledPagePath)
) {
    program.outputHelp();
    process.exit(1);
}

(async () => {
    /**
     * @type {string[]}
     */
    let pages = [];
    if (crawledPagePath) {
        pages = (await fs.readdir(crawledPagePath)).filter((name) => name.endsWith('.json') && name !== 'metadata.json');
    }
    ch.init({
        verbose: false,
        startTime: new Date(),
        urls: pages.length,
        logPath: '',
        tables: opts.framesOnly ? SCRAPED_FRAMES_TABLES : undefined,
    });
    if (opts.crawlid) {
        ch.crawlId = opts.crawlid;
    }
    if (opts.delete) {
        await ch.deleteCrawlData();
        return;
    }
    if (opts.framesOnly) {
        if ((await ch.countCrawlRows('pages')) === 0) {
            console.error(chalk.red(`Crawl ${ch.crawlId} has no pages in clickhouse. Import the full crawl first.`));
            process.exit(1);
        }
        const existingFrames = await ch.countCrawlRows('cookiePopupFrames');
        if (existingFrames > 0) {
            if (!opts.replace) {
                console.error(chalk.red(`Crawl ${ch.crawlId} already has ${existingFrames} scraped frames. Use --replace to overwrite.`));
                process.exit(1);
            }
            await ch.deleteCrawlData();
        }
    } else {
        await ch.createCrawl(crawlName, crawlRegion);
    }
    if (crawledPagePath) {
        const progressBar = new ProgressBar('[:bar] :percent ETA :etas :page', {
            complete: chalk.green('='),
            incomplete: ' ',
            total: pages.length,
            width: 30,
        });
        for (const page of pages) {
            const contents = await fs.readFile(path.join(crawledPagePath, page), { encoding: 'utf-8' });
            const data = JSON.parse(contents.toString());
            if (!data.initialUrl) {
                progressBar.total -= 1;
                continue;
            }

            await ch.processSite(data);
            progressBar.tick({
                page,
            });
        }
    }
    await ch.cleanup();
})();
