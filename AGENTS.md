# AGENTS.md

## Cursor Cloud specific instructions

This is a Node.js CLI tool (Puppeteer-based web crawler). No long-running dev server; the app is invoked via `npm run crawl -- <flags>`.

### Running the app

```sh
TRC_UNSAFE_DISABLE_SANDBOX=1 npm run crawl -- -u "https://example.com" -o ./data/ -v
```

The `TRC_UNSAFE_DISABLE_SANDBOX=1` env var is required in this environment to disable the Chrome sandbox (container lacks kernel support for it).

### Lint

```sh
npm run lint        # eslint + prettier --check
npm run lint-fix    # auto-fix
```

### Tests

```sh
npm test            # lint + unit tests
npm run unit        # unit tests only (custom runner + mocha)
npm run mocha       # mocha tests only
```

The custom test runner (`tests/runTests.js`) runs `*.test.js` files sequentially, each in a subprocess. In CI (`CI=1`), failed tests are retried up to 3 times; locally they run once.

### Known environment caveats

- **Chrome dbus errors**: Harmless `dbus/bus.cc` and `dbus/object_proxy.cc` errors are expected in container environments. They do not affect crawl results.
- **Concurrent browser launches**: The `crawlerConductor.test.js` integration test can fail on its first attempt when launching multiple Chrome instances simultaneously. Setting `CI=1` enables retries and the test passes reliably.
- **Chromium download**: Puppeteer auto-downloads Chrome to `~/.cache/puppeteer/`. The `npm ci` step handles this via the `puppeteer` postinstall script.
