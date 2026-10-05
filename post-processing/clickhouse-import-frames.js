const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const ProgressBar = require('progress');
const chalk = require('chalk');
const Clickhouse = require('../reporters/ClickhouseReporter');
const { SCRAPED_FRAMES_TABLES } = require('../reporters/ClickhouseReporter');

program
    .description(
        `Import cookie popup scrapedFrames data (${SCRAPED_FRAMES_TABLES.join(', ')}) for a crawl that was already imported into clickhouse.

Examples:
    # import scraped frames for crawl "mycrawl"
    clickhouse-import-frames.js -c mycrawl -d /path/to/crawl

    # replace previously imported scraped frames (e.g. after re-running detect-cookie-popups.js)
    clickhouse-import-frames.js -c mycrawl -d /path/to/crawl --replace
    `,
    )
    .requiredOption('-c, --crawlid <id>', 'ID of the existing crawl')
    .requiredOption('-d --crawldir <dir>', 'Directory of crawl output to import')
    .option('--replace', 'Delete any scraped frames data already imported for this crawl before importing')
    .parse(process.argv);

const opts = program.opts();

/**
 * @param {Clickhouse} ch
 * @param {string} table
 * @returns {Promise<number>}
 */
async function countCrawlRows(ch, table) {
    const result = await ch.client.query({
        query: `SELECT count() AS n FROM ${table} WHERE crawlId = {crawlId:String}`,
        query_params: { crawlId: ch.crawlId },
        format: 'JSONEachRow',
    });
    const rows = /** @type {{n: string}[]} */ (await result.json());
    return Number(rows[0].n);
}

(async () => {
    const pages = (await fs.readdir(opts.crawldir)).filter((name) => name.endsWith('.json') && name !== 'metadata.json');

    const ch = new Clickhouse();
    ch.init({ verbose: false, startTime: new Date(), urls: pages.length, logPath: '', tables: SCRAPED_FRAMES_TABLES });
    ch.crawlId = opts.crawlid;
    await ch.ready;

    if ((await countCrawlRows(ch, 'crawls')) === 0 && (await countCrawlRows(ch, 'pages')) === 0) {
        console.error(chalk.red(`Crawl ${ch.crawlId} not found in clickhouse. Use clickhouse.js to import the full crawl.`));
        process.exit(1);
    }

    const existingFrames = await countCrawlRows(ch, 'cookiePopupFrames');
    if (existingFrames > 0) {
        if (!opts.replace) {
            console.error(
                chalk.red(`Crawl ${ch.crawlId} already has ${existingFrames} scraped frames imported. Use --replace to overwrite.`),
            );
            process.exit(1);
        }
        console.log(`Deleting existing scraped frames data for crawl ${ch.crawlId}`);
        await Promise.all(
            SCRAPED_FRAMES_TABLES.map((table) =>
                ch.client.command({
                    query: `ALTER TABLE ${table} DELETE WHERE crawlId = {crawlId:String}`,
                    query_params: { crawlId: ch.crawlId },
                    // wait for the delete to complete on all replicas before inserting new data
                    clickhouse_settings: { mutations_sync: '2' },
                }),
            ),
        );
    }

    const progressBar = new ProgressBar('[:bar] :percent ETA :etas :page', {
        complete: chalk.green('='),
        incomplete: ' ',
        total: pages.length,
        width: 30,
    });
    for (const page of pages) {
        const contents = await fs.readFile(path.join(opts.crawldir, page), { encoding: 'utf-8' });
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
    await ch.cleanup();
    await ch.client.close();
})();
