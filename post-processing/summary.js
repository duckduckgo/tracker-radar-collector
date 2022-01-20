const fs = require('fs');
const URL = require('url').URL;
const path = require('path');
const program = require('commander');
const chalk = require('chalk').default;
const ProgressBar = require('progress');
const tldts = require('tldts');
const METADATA_FILE_NAME = 'metadata.json';

program
    .option('-i, --input <path>', 'path to folder with data')
    .option('-o, --output <path>', 'path to the output file')
    .parse(process.argv);

if (!program.input || !program.output) {
    program.help();
    process.exit(1);
}

const dataDir = program.input;

const dataFiles = fs.readdirSync(dataDir)
    .filter(file => {
        const resolvedPath = path.resolve(process.cwd(), `${dataDir}/${file}`);
        const stat = fs.statSync(resolvedPath);

        return stat && stat.isFile() && file.endsWith('.json') && file !== METADATA_FILE_NAME;
    });

const progressBar = new ProgressBar('[:bar] :percent ETA :etas :file', {
    complete: chalk.green('='),
    incomplete: ' ',
    total: dataFiles.length,
    width: 30
});

/**
 * @type {any}
 */
const stats = {
    global: {
        validFiles: 0,
        failingFiles: 0,
        timeouts: 0,
        totalTime: 0,
        avgTime: 0
    }
};

/**
 * @type {Map<string, number>}
 */
const topRequests = new Map();
/**
 * @type {Map<string, number>}
 */
const topDomains = new Map();
/**
 * @type {Map<string, number>}
 */
const topIps = new Map();
/**
 * @type {{url: string, count: number}}
 */
let mostRequests = null;
/**
 * @type {{url: string, count: number}}
 */
let leastRequests = null;

/**
 * @type {Map<string, number>}
 */
const topCookieNames = new Map();
/**
 * @type {{url: string, count: number}}
 */
let mostCookies = null;
/**
 * @type {{url: string, count: number}}
 */
let leastCookies = null;

/**
 * @type {string[]}
 */
const overOneTarget = [];
/**
 * @type {{url: string, count: number}}
 */
let mostTargets = null;

/**
 * @type {Map<string, number>}
 */
const apiPopularity = new Map();
/**
 * @type {Array<[string, number]>}
 */
const mostAPIsCalled = [];

dataFiles.forEach(file => {
    progressBar.tick({file});

    const resolvedPath = path.resolve(process.cwd(), `${dataDir}/${file}`);
    /**
     * @type {import('../crawler').CollectResult}
     */
    let data = null;

    try {
        const dataString = fs.readFileSync(resolvedPath, 'utf8');
        data = JSON.parse(dataString);
    } catch (e) {
        stats.global.failingFiles++;
        return;
    }

    stats.global.validFiles++;

    if (data.timeout) {
        stats.global.timeouts++;
    }

    const testTime = data.testFinished - data.testStarted;

    stats.global.totalTime += testTime;
    stats.global.avgTime = stats.global.totalTime / stats.global.validFiles;

    const finalURLTLD = tldts.getDomain(data.finalUrl);

    Object.keys(data.data).forEach(sectionName => {
        // general stats
        if (!stats[sectionName]) {
            stats[sectionName] = {
                failed: 0,
                empty: 0,
                totalEntries: 0,
                avgEntries: 0
            };
        }

        // @ts-ignore
        const sectionData = data.data[sectionName];

        if (sectionData === null) {
            stats[sectionName].failed++;
            return;
        }

        if (Array.isArray(sectionData)) {
            if (sectionData.length === 0) {
                stats[sectionName].empty++;
            }

            stats[sectionName].totalEntries += sectionData.length;
            stats[sectionName].avgEntries = stats[sectionName].totalEntries / stats.global.validFiles;
        }

        // section specific stats
        if (sectionName === 'requests') {
            // most popular urls / domains / IPs (don't count duplicate calls per website)
            const urls = new Set();
            const domains = new Set();
            const ips = new Set();

            
            // eslint-disable-next-line arrow-parens
            sectionData.forEach((/** @type {import('../collectors/RequestCollector').RequestData} */ request) => {
                urls.add(request.url);
                ips.add(request.remoteIPAddress);

                try {
                    const url = new URL(request.url);
                    domains.add(url.hostname);
                } catch(e) {
                    stats[sectionName].invalidUrls = stats[sectionName].invalidUrls || 0;
                    stats[sectionName].invalidUrls++;
                }
            });

            urls.forEach(url => {
                const count = topRequests.get(url) || 0;
                topRequests.set(url, count + 1);
            });

            domains.forEach(domain => {
                const count = topDomains.get(domain) || 0;
                topDomains.set(domain, count + 1);
            });

            ips.forEach(ip => {
                const count = topIps.get(ip) || 0;
                topIps.set(ip, count + 1);
            });

            // most/least 3p requests
            if (mostRequests === null || mostRequests.count < sectionData.length) {
                mostRequests = {url: data.finalUrl, count: sectionData.length};
            }
            if (leastRequests === null || leastRequests.count > sectionData.length) {
                leastRequests = {url: data.finalUrl, count: sectionData.length};
            }
        }

        if (sectionName === 'cookies') {
            // top cookie names
            // eslint-disable-next-line arrow-parens
            sectionData.forEach((/** @type {import('../collectors/CookieCollector').CookieData} */cookie) => {
                const count = topCookieNames.get(cookie.name) || 0;
                topCookieNames.set(cookie.name, count + 1);

                const cookieDomain = (cookie.domain).startsWith('.') ? ('a' + cookie.domain) : cookie.domain;
                const cookieTLD = tldts.getDomain(cookieDomain);

                if (cookieTLD !== finalURLTLD) {
                    stats.cookies.totalThirdParty = (stats.cookies.totalThirdParty || 0) + 1;
                }
            });

            // most/least cookies
            if (mostCookies === null || mostCookies.count < sectionData.length) {
                mostCookies = {url: data.finalUrl, count: sectionData.length};
            }
            if (leastCookies === null || leastCookies.count > sectionData.length) {
                leastCookies = {url: data.finalUrl, count: sectionData.length};
            }
        }

        if (sectionName === 'targets') {
            // sites with over one target
            if (sectionData.length > 1) {
                overOneTarget.push(data.finalUrl);
            }

            // most targets
            if (mostTargets === null || mostTargets.count < sectionData.length) {
                mostTargets = {url: data.finalUrl, count: sectionData.length};
            }
        }

        if (sectionName === 'apis') {
            Object.keys(sectionData.callStats).forEach(scriptName => {
                const calls = sectionData.callStats[scriptName];

                Object.keys(calls).forEach(api => {
                    const count = apiPopularity.get(api) || 0;
                    apiPopularity.set(api, count + 1);
                });

                mostAPIsCalled.push([scriptName, Object.keys(calls).length]);
            });
        }
    });
});

stats.requests.topRequests = Array.from(topRequests).sort(([, aCount], [, bCount]) => bCount - aCount).slice(0, 50);
stats.requests.topDomains = Array.from(topDomains).sort(([, aCount], [, bCount]) => bCount - aCount).slice(0, 50);
stats.requests.topIPs = Array.from(topIps).sort(([, aCount], [, bCount]) => bCount - aCount).slice(0, 50);
stats.requests.mostRequests = mostRequests;
stats.requests.leastRequests = leastRequests;

stats.cookies.topCookieNames = Array.from(topCookieNames).sort(([, aCount], [, bCount]) => bCount - aCount).slice(0, 50);
stats.cookies.mostCookies = mostCookies;
stats.cookies.leastCookies = leastCookies;
stats.cookies.avgThirdParty = stats.cookies.totalThirdParty / stats.global.validFiles;

stats.targets.overOneTarget = overOneTarget.slice(0, 50);
stats.targets.mostTargets = mostTargets;

stats.apis.popularity = Array.from(apiPopularity).sort(([, aCount], [, bCount]) => bCount - aCount);
stats.apis.mostAPIsCalled = mostAPIsCalled.sort(([, aCount], [, bCount]) => bCount - aCount).slice(0, 50);

fs.writeFileSync(program.output, JSON.stringify(stats, null, 2));