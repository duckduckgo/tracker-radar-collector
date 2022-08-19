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

function rerunUntilComplete(retry = 0) {
    const subProcessArgs = [...process.argv];
    subProcessArgs.splice(1, 1, path.join(path.dirname(__filename), '/crawl-cli.js'));
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
