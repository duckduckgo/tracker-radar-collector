/* eslint-disable no-process-env */
const fs = require('fs').promises;
const path = require('path');
const Clickhouse = require('../reporters/ClickhouseReporter');

const ch = new Clickhouse();
const crawlName = process.env.CRAWL_NAME || '';
const crawlRegion = process.env.REGION || '';
const crawledPagePath = process.argv[2];
console.log(crawledPagePath);

(async () => {
    await ch.createCrawl(crawlName, crawlRegion);
    const pages = await fs.readdir(crawledPagePath);
    // const pages = ['accounts.quickbooks.com_8c2b.json'];
    for (const page of pages) {
        console.log(`import ${page}...`);
        // eslint-disable-next-line no-await-in-loop
        const contents = await fs.readFile(path.join(crawledPagePath, page), {encoding: 'utf-8'});
        const data = JSON.parse(contents.toString());
        if (!data.initialUrl) {
            continue;
        }
        // eslint-disable-next-line no-await-in-loop
        ch.processSite(data);
    }
    await ch.cleanup();
})();
