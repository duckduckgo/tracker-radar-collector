const cp = require('child_process');
const path = require('path');
const fs = require('fs').promises;

const program = require('./options').parse(process.argv);
const crawlConfig = require('./crawlConfig');

// @ts-ignore
const config = crawlConfig.figureOut(program);
const MAX_RETRIES = 5;

async function testMetadataExists() {
    try {
        return Boolean(await fs.stat(path.join(config.output, 'metadata.json')));
    } catch (e) {
        return false;
    }
}

async function rerunUntilComplete(retry = 0) {
    const subProcessArgs = [...process.argv];
    subProcessArgs.splice(1, 1, path.join(path.dirname(__filename), '/crawl-cli.js'));
    if (retry > 0) {
        const siteListFile = path.join(config.output, `urls_retry${retry}.txt`);
        const remainingUrls = [...config.urls];
        for (const fileName of await fs.readdir(config.output)) {
            if (!fileName.endsWith('.json')) {
                continue;
            }
            // @ts-ignore
            // eslint-disable-next-line no-await-in-loop
            const {initialUrl} = JSON.parse(await fs.readFile(path.join(config.output, fileName), {encoding: 'utf-8'}));
            // remainingUrls.delete(initialUrl);
            if (remainingUrls.indexOf(initialUrl) !== -1) {
                remainingUrls.splice(remainingUrls.indexOf(initialUrl), 1);
            }
        }
        if (remainingUrls.length === 0) {
            console.info('No sites left to crawl');
            return;
        }
        await fs.writeFile(siteListFile, remainingUrls.join('\n'));
        console.info(`${remainingUrls.length} remaining sites written to ${siteListFile}`);
        subProcessArgs.splice(subProcessArgs.findIndex(v => ['-i', '--input-list'].includes(v.toLowerCase())) + 1, 1, siteListFile);
    }
    const crawl = cp.spawn(subProcessArgs[0], subProcessArgs.slice(1), {stdio: 'inherit'});
    crawl.on('close', async () => {
        const success = await testMetadataExists();
        if (!success && retry <= MAX_RETRIES) {
            console.warn('metadata.json not generated, retrying crawl with remaining sites');
            rerunUntilComplete(retry + 1);
        }
    });
}

(async () => {
    if (config.urls.length <= 0) {
        program.outputHelp();
    } else {
        // console.log(program.options);
        if (await testMetadataExists()) {
            console.warn('metadata.json already exists, we will not be able to test for crashes');
        }
        rerunUntilComplete();
    }
})();
