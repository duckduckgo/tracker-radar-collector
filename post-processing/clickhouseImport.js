/* eslint-disable no-process-env */
const fs = require('fs').promises;
const path = require('path');
const program = require('commander');
const Clickhouse = require('../reporters/ClickhouseReporter');

program
    .description(`Import a crawl into clickhouse, or create a row in the crawl table.
    
Examples:
    # import crawl with default crawlId and no metadata
    clickhouse.js /path/to/crawl

    # Create an entry in the crawl table with ID "mycrawl" and import nothing
    clickhouse.js -c mycrawl --name "This is a crawl" --region US
    `)
    .option('-c, --crawlid <id>', 'Crawl ID')
    .option('--name <crawlname>', 'Name of the crawl')
    .option('--region <region>', 'Crawl region code')
    .option('-d --crawldir <dir>', 'Directory of crawl output to import')
    .parse(process.argv);

console.log(program.crawldir, program.crawlid, program.name);
const ch = new Clickhouse();
const crawlName = program.crawlname;
const crawlRegion = program.region;
const crawledPagePath = program.crawldir;

(async () => {
    /**
     * @type {string[]}
     */
    let pages = [];
    if (crawledPagePath) {
        pages = await fs.readdir(crawledPagePath);
    }
    ch.init({verbose: true, startTime: new Date(), urls: pages.length, logPath: ''});
    if (program.crawlId) {
        ch.crawlId = program.crawlId;
    }
    await ch.createCrawl(crawlName, crawlRegion);
    if (crawledPagePath) {
        for (const page of pages) {
            // eslint-disable-next-line no-await-in-loop
            const contents = await fs.readFile(path.join(crawledPagePath, page), {encoding: 'utf-8'});
            const data = JSON.parse(contents.toString());
            if (!data.initialUrl) {
                continue;
            }
            // eslint-disable-next-line no-await-in-loop
            await ch.processSite(data);
        }
    }
    await ch.cleanup();
})();
