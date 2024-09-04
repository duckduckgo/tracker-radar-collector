const fs = require('fs');

/**
 * @param {string} url 
 * @returns {string}
 */
function addProtocolIfNeeded(url) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    return `http://${url}`;
}


const trackingParams = {
    "gclid": "529804",
    "msclkid": "087859",
    "fbclid": "284031",
    "utm_campaign": "684273",
    "utm_term": "931917",
    "utm_medium": "270153",
    "utm_source": "975441",
    "utm_content": "895038",
    "fb_action_ids": "323190",
    "fb_action_types": "027738",
    "fb_source": "141927",
    "fb_ref": "509702",
    "ga_source": "144396",
    "ga_medium": "347205",
    "ga_term": "124250",
    "ga_content": "050787",
    "ga_campaign": "702125",
    "ga_place": "110673",
    "action_object_map": "202674",
    "action_type_map": "561470",
    "action_ref_map": "464659",
    "gs_l": "364895",
    "mkt_tok": "459073",
    "hmb_campaign": "876268",
    "hmb_source": "284429",
    "hmb_medium": "951835",
    "aff": "942477",
    "KNC": "811482",
    "oq": "883933",
    "prmd": "042185",
    "not_a_param": "825833"
}

function addParameters(url) {
    try {
        const urlObj = new URL(url);
        const params = new URLSearchParams(urlObj.search);
        Object.entries(trackingParams).forEach(([param, value]) => {
            params.set(param, value);
        });
        urlObj.search = params.toString();
        return urlObj.toString();
    } catch (e) {
        console.error('Invalid URL:', url);
        return url;
    }
}

/**
 * Looks at CLI flags, JSON config etc. to figure out the final crawl config
 * 
 * @param {{config?: string, verbose?: boolean, forceOverwrite?: boolean, only3p?: boolean, mobile?: boolean, disableAntiBot?: boolean, output?: string, logPath?: string, crawlers?: string, proxyConfig?: string, regionCode?: string, chromiumVersion?: string, dataCollectors?: string, reporters?: string, url?: string, inputList?: string}} flags 
 * @returns {CrawlConfig}
 */
function figureOut(flags) {
    /**
     * @type {CrawlConfig}
     */
    let crawlConfig = {};

    if (typeof flags.config === 'string') {
        crawlConfig = JSON.parse(fs.readFileSync(flags.config).toString());
    }

    // settings passed via CLI flags override settings passed via config file

    // boolean settings that are false by default
    if (crawlConfig.verbose === undefined || flags.verbose !== undefined) {
        crawlConfig.verbose = Boolean(flags.verbose);
    }
    if (crawlConfig.forceOverwrite === undefined || flags.forceOverwrite !== undefined) {
        crawlConfig.forceOverwrite = Boolean(flags.forceOverwrite);
    }
    if (crawlConfig.filterOutFirstParty === undefined || flags.only3p !== undefined) {
        crawlConfig.filterOutFirstParty = Boolean(flags.only3p);
    }
    if (crawlConfig.emulateMobile === undefined || flags.mobile !== undefined) {
        crawlConfig.emulateMobile = Boolean(flags.mobile);
    }
    if (crawlConfig.disableAntiBot === undefined || flags.disableAntiBot !== undefined) {
        crawlConfig.disableAntiBot = Boolean(flags.disableAntiBot);
    }

    // string/number settings
    if (flags.output) {
        crawlConfig.output = flags.output;
    }
    if (flags.logPath) {
        crawlConfig.logPath = flags.logPath;
    }
    if (flags.crawlers) {
        crawlConfig.crawlers = Number(flags.crawlers);
    }
    if (flags.proxyConfig) {
        crawlConfig.proxyConfig = flags.proxyConfig;
    }
    if (flags.regionCode) {
        crawlConfig.regionCode = flags.regionCode;
    }
    if (flags.chromiumVersion) {
        crawlConfig.chromiumVersion = flags.chromiumVersion;
    }

    // array settings
    if (flags.dataCollectors) {
        crawlConfig.dataCollectors = flags.dataCollectors.split(',').map(n => n.trim()).filter(n => n.length > 0);
    }
    if (flags.reporters) {
        crawlConfig.reporters = flags.reporters.split(',').map(n => n.trim()).filter(n => n.length > 0);
    }

    /**
     * @type {Array<string>}
     */
    let cliUrls = null;

    if (flags.url) {
        cliUrls = [flags.url];
    } else if(flags.inputList) {
        cliUrls = fs.readFileSync(flags.inputList).toString().split('\n').map(u => u.trim());
    }

    if (cliUrls) {
        // ‼️ interesting thing happens if url is passed from both CLI and config - CLI list is used, but with a twist
        // if url in the config had a custom configuration it will override matching item on the CLI list
        if (crawlConfig.urls) {
            /**
             * @type {Array<{url:string, dataCollectors:string[]}>}
             */
            // @ts-ignore typescript doesn't understand that we filtered out all strings
            const urlsWithConfig = crawlConfig.urls.filter(i => (typeof i !== 'string'));
            crawlConfig.urls = cliUrls.map(url => urlsWithConfig.find(i => i.url === url) || url);
        } else {
            crawlConfig.urls = cliUrls;
        }
    }
    

    crawlConfig.urls = crawlConfig.urls.map(item => {
        if (typeof item === 'string') {
            return addParameters(addProtocolIfNeeded(item));
        } else if (item.url) {
            item.url = addParameters(addProtocolIfNeeded(item.url));
            return item;
        }

        throw new Error('Unknown url item: ' + item);
    });

    return crawlConfig;
}

module.exports = {
    figureOut
};

/**
 * @typedef CrawlConfig
 * @property {string} output
 * @property {Array<string|{url:string, dataCollectors:Array<string>}>} urls
 * @property {Array<string>} dataCollectors
 * @property {Array<string>} reporters
 * @property {string} logPath
 * @property {number} crawlers
 * @property {string} proxyConfig
 * @property {string} regionCode
 * @property {string} chromiumVersion
 * @property {boolean} filterOutFirstParty
 * @property {boolean} forceOverwrite
 * @property {boolean} verbose
 * @property {boolean} emulateMobile
 * @property {boolean} disableAntiBot
 * @property {number} maxLoadTimeMs
 * @property {number} extraExecutionTimeMs
 */
