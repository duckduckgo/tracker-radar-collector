# DuckDuckGo Tracker Radar Collector
🕸 Modular, multithreaded, [puppeteer](https://github.com/GoogleChrome/puppeteer)-based crawler used to generate third party request data for the [Tracker Radar](https://github.com/duckduckgo/tracker-radar).

## How do I use it?

### Use it from the command line

1. Clone this project locally (`git clone git@github.com:duckduckgo/tracker-radar-collector.git`)
2. Install all dependencies (`npm i`)
3. Run the command line tool:

```sh
npm run crawl -- -u "https://example.com" -o ./data/ -v
```

Available options:

- `-o, --output <path>` - (required) output folder where output files will be created
- `-u, --url <url>` - single URL to crawl
- `-i, --input-list <path>` - path to a text file with list of URLs to crawl (each in a separate line)
- `-d, --data-collectors <list>` - comma separated list (e.g `-d 'requests,cookies'`) of data collectors that should be used (all by default)
- `-c, --crawlers <number>` - override the default number of concurrent crawlers (default number is picked based on the number of CPU cores)
- `-v, --verbose` - log additional information on screen (progress bar will not be shown when verbose logging is enabled)
- `-l, --log-file <path>` - save log data to a file
- `-f, --force-overwrite` - overwrite existing output files (by default entries with existing output files are skipped)
- `-3, --only-3p` - don't save any first-party data (e.g. requests, API calls for the same eTLD+1 as the main document)
- `-m, --mobile` - emulate a mobile device when crawling
- `-p, --proxy-config <host>` - optional SOCKS proxy host
- `-r, --region-code <region>` - optional 2 letter region code. For metadata only
- `-a, --disable-anti-bot` - disable simple build-in anti bot detection script injected to every frame
- `--chromium-version <version_number>` - use custom version of Chromium (e.g. "843427") instead of using the default

### Use it as a module

1. Install this project as a dependency (`npm i git+https://github.com:duckduckgo/tracker-radar-collector.git`).

2. Import it:

```js
// you can either import a "crawlerConductor" that runs multiple crawlers for you
const {crawlerConductor} = require('tracker-radar-collector');
// or a single crawler
const {crawler} = require('tracker-radar-collector');

// you will also need some data collectors (/collectors/ folder contains all build-in collectors)
const {RequestCollector, CookieCollector, …} = require('tracker-radar-collector');
```

3. Use it:

```js
crawlerConductor({
    // required ↓
    urls: ['https://example.com', 'https://duck.com', …],
    dataCallback: (url, result) => {…},
    // optional ↓
    dataCollectors: [new RequestCollector(), new CookieCollector()],
    failureCallback: (url, error) => {…},
    numberOfCrawlers: 12,// custom number of crawlers (there is a hard limit of 38 though)
    logFunction: (...msg) => {…},// custom logging function
    filterOutFirstParty: true,// don't save any first-party data (false by default)
    emulateMobile: true,// emulate a mobile device (false by default)
    proxyHost: 'socks5://myproxy:8080',// SOCKS proxy host (none by default)
    antiBotDetection: true,// if anti bot detection script should be injected (true by default)
    chromiumVersion: '843427',// Chromium version that should be downloaded and used instead of the default one
});
```

**OR** (if you prefer to run a single crawler)

```js
// crawler will throw an exception if crawl fails
const data = await crawler(new URL('https://example.com'), {
    // optional ↓
    collectors: [new RequestCollector(), new CookieCollector(), …],
    log: (...msg) => {…},
    urlFilter: (url) => {…},// function that, for each request URL, decides if its data should be stored or not
    emulateMobile: false,
    emulateUserAgent: false,// don't use the default puppeteer UA (default true)
    proxyHost: 'socks5://myproxy:8080',
    browserContext: context,// if you prefer to create the browser context yourself (to e.g. use other browser or non-incognito context) you can pass it here (by default crawler will create an incognito context using standard chromium for you)
    runInEveryFrame: () => {window.alert('injected')},// function that should be executed in every frame (main + all subframes)
    executablePath: '/some/path/Chromium.app/Contents/MacOS/Chromium',// path to a custom Chromium installation that should be used instead of the default one
});
```

ℹ️ Hint: check out `crawl-cli.js` and `crawlerConductor.js` to see how `crawlerConductor` and `crawler` are used in the wild.

## Output format

Each successfully crawled website will create a separate file named after the website (when using the CLI tool). Output data format is specified in `crawler.js` (see `CollectResult` type definition).
Additionally, for each crawl `metadata.json` file will be created containing crawl configuration, system configuration and some high-level stats. 

## Data post-processing

Example post-processing script, that can be used as a template, can be found in `post-processing/summary.js`. Execute it from the command line like this:

```sh
node ./post-processing/summary.js -i ./collected-data/ -o ./result.json
```

ℹ️ Hint: When dealing with huge amounts of data you may need to increase nodejs's memory limit e.g. `node --max_old_space_size=4096`.

## Creating new collectors

Each collector needs to extend the `BaseCollector` and has to override following methods:

- `id()` which returns name of the collector (e.g. 'cookies')
- `getData(options)` which should return collected data. `options` have following properties:
    - `finalUrl` - final URL of the main document (after all redirects) that you may want to use,
    - `filterFunction` which, if provided, takes an URL and returns a boolean telling you if given piece of data should be returned or filtered out based on its origin.

Additionally, each collector can override following methods:

- `init(options)` which is called before the crawl begins
- `addTarget(targetInfo)` which is called whenever new target is created (main page, iframe, web worker etc.)

There are couple of build in collectors in the `collectors/` folder. `CookieCollector` is the simplest one and can be used as a template.

Each new collector has to be added in two places to be discoverable:
- `crawlerConductor.js` - so that `crawlerConductor` knows about it (and it can be used in the CLI tool)
- `main.js` - so that the new collector can be imported by other projects
