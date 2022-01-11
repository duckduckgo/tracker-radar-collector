const fs = require('fs');
const path = require('path');
const assert = require('assert');
const mockery = require('mockery');

const mockConfigFile = JSON.parse(fs.readFileSync(path.join(__dirname, './sampleConfig.json')).toString());

const mockList = [
    'one.test',
    'two.test',
    'https://three.protocol.test',
    'http://four.protocol.test'
];

mockery.enable({
    warnOnUnregistered: false
});
mockery.registerMock('fs', {
    readFileSync: (/** @type {string} */ filePath) => {
        if (filePath === 'config.json') {
            return JSON.stringify(mockConfigFile);
        } else if (filePath === 'list.txt') {
            return mockList.join('\n');
        }

        throw new Error('unknown mock path');
    }
});

const crawlConfig = require('../../cli/crawlConfig');

// test if all config options are passed from config
const result1 = crawlConfig.figureOut({
    config: 'config.json'
});

assert(result1.output === mockConfigFile.output, "Correct value for 'output'");
assert(result1.logPath === mockConfigFile.logPath, "Correct value for 'logPath'");
assert(result1.crawlers === mockConfigFile.crawlers, "Correct value for 'crawlers'");
assert(result1.verbose === mockConfigFile.verbose, "Correct value for 'verbose'");
assert(result1.forceOverwrite === mockConfigFile.forceOverwrite, "Correct value for 'forceOverwrite'");
assert(result1.filterOutFirstParty === mockConfigFile.filterOutFirstParty, "Correct value for 'filterOutFirstParty'");
assert(result1.emulateMobile === mockConfigFile.emulateMobile, "Correct value for 'emulateMobile'");
assert(result1.disableAntiBot === mockConfigFile.disableAntiBot, "Correct value for 'disableAntiBot'");
assert(result1.proxyConfig === mockConfigFile.proxyConfig, "Correct value for 'proxyConfig'");
assert(result1.regionCode === mockConfigFile.regionCode, "Correct value for 'regionCode'");
assert(result1.chromiumVersion === mockConfigFile.chromiumVersion, "Correct value for 'chromiumVersion'");
assert(result1.maxLoadTimeMs === mockConfigFile.maxLoadTimeMs, "Correct value for 'maxLoadTimeMs'");
assert(result1.extraExecutionTimeMs === mockConfigFile.extraExecutionTimeMs, "Correct value for 'extraExecutionTimeMs'");
assert.deepStrictEqual(result1.dataCollectors, mockConfigFile.dataCollectors, "Correct value for 'dataCollectors'");
assert.deepStrictEqual(result1.reporters, mockConfigFile.reporters, "Correct value for 'reporters'");

assert.deepStrictEqual(result1.urls, [
    "https://five.test",
    "http://six.test",
    {"url": "http://seven.test"},
    {"url": "http://one.test", "dataCollectors": ["targets"]}
], "Unexpected value for 'urls'");

// test if CLI flags override config and if list.txt is merged with urls from config.json

const flags = {
    config: 'config.json',
    inputList: 'list.txt',
    output: '/something/else',
    logPath: '/other/path',
    crawlers: '666',
    verbose: false,
    forceOverwrite: false,
    only3p: false,
    mobile: false,
    disableAntiBot: false,
    proxyConfig: 'something:else:13',
    regionCode: 'KA',
    chromiumVersion: '987654',
    dataCollectors: 'targets,cookies',
    reporters: 'html,file'
};

const result2 = crawlConfig.figureOut(flags);

assert(result2.output === flags.output, "Correct value for 'output'");
assert(result2.logPath === flags.logPath, "Correct value for 'logPath'");
assert(result2.crawlers === 666, "Correct value for 'crawlers'");
assert(result2.verbose === flags.verbose, "Correct value for 'verbose'");
assert(result2.forceOverwrite === flags.forceOverwrite, "Correct value for 'forceOverwrite'");
assert(result2.filterOutFirstParty === flags.only3p, "Correct value for 'filterOutFirstParty'");
assert(result2.emulateMobile === flags.mobile, "Correct value for 'emulateMobile'");
assert(result2.disableAntiBot === flags.disableAntiBot, "Correct value for 'disableAntiBot'");
assert(result2.proxyConfig === flags.proxyConfig, "Correct value for 'proxyConfig'");
assert(result2.regionCode === flags.regionCode, "Correct value for 'regionCode'");
assert(result2.chromiumVersion === flags.chromiumVersion, "Correct value for 'chromiumVersion'");
assert(result2.maxLoadTimeMs === mockConfigFile.maxLoadTimeMs, "Correct value for 'maxLoadTimeMs'");
assert(result2.extraExecutionTimeMs === mockConfigFile.extraExecutionTimeMs, "Correct value for 'extraExecutionTimeMs'");
assert.deepStrictEqual(result2.dataCollectors, ['targets', 'cookies'], "Correct value for 'dataCollectors'");
assert.deepStrictEqual(result2.reporters, ['html', 'file'], "Correct value for 'reporters'");

assert.deepStrictEqual(result2.urls, [
    {'url': 'http://one.test', 'dataCollectors': ['targets']},
    'http://two.test',
    'https://three.protocol.test',
    'http://four.protocol.test'
], "Unexpected value for 'urls'");

mockery.disable();