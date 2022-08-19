const program = require('commander');
const {getCollectorIds} = require('../helpers/collectorsList');
const {getReporterIds} = require('../helpers/reportersList');

program
    .option('-o, --output <path>', 'output folder')
    .option('-u, --url <url>', 'single URL')
    .option('-i, --input-list <path>', 'path to list of URLs')
    .option('-d, --data-collectors <list>', `comma separated list of data collectors: ${getCollectorIds().join(', ')} (all by default)`)
    .option('--reporters <list>', `comma separated list of reporters: ${getReporterIds().join(', ')}`)
    .option('-l, --log-path <path>', 'instructs reporters where all logs should be written to')
    .option('-v, --verbose', 'instructs reporters to log additional information (e.g. for "cli" reporter progress bar will not be shown when verbose logging is enabled)')
    .option('-c, --crawlers <number>', 'overwrite the default number of concurent crawlers')
    .option('-f, --force-overwrite', 'overwrite existing output files')
    .option('-3, --only-3p', 'don\'t save any first-party data')
    .option('-m, --mobile', 'emulate a mobile device')
    .option('-p, --proxy-config <host>', 'use an optional proxy configuration')
    .option('-r, --region-code <region>', 'optional 2 letter region code. Used for metadata only.')
    .option('-a, --disable-anti-bot', 'disable anti bot detection protections injected to every frame')
    .option('--config <path>', 'crawl configuration file')
    .option('--autoconsent-action <action>', 'dismiss cookie popups. Possible values: optout, optin')
    .option('--chromium-version <version_number>', 'use custom version of chromium');

module.exports = program;