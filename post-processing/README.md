# Button classification

This folder contains scripts for building labelled button text data from cookie popup crawls.

Popup and button classification (`checkHeuristicPatterns`, `classifyButtonTextRegex`, `cleanButtonText` and the regex patterns) comes from [autoconsent](https://github.com/duckduckgo/autoconsent) via `@duckduckgo/autoconsent/heuristics`. Pattern changes, the labelled dataset (`data/labelled-button-texts.csv`) and the accuracy benchmark all live in autoconsent. The scripts below produce the data that goes into that CSV. In the examples, `$AUTOCONSENT` is the path to an autoconsent checkout.

## Workflow

### 1. Collect button texts from a crawl

Use `collect-popup-button-texts.js` to extract normalized button strings from crawl output and merge them into the labelled CSV.

```bash
node post-processing/collect-popup-button-texts.js \
  -i /path/to/crawl/output \
  -o $AUTOCONSENT/data/labelled-button-texts.csv
```

The script:

- Reads JSON crawl files from the input directory (excluding `metadata.json`)
- Collects button text from `potentialPopups` where `regexMatch` or `llmMatch` is true
- Normalizes text with `cleanButtonText` (same normalization used at classification time)
- Counts one occurrence per site per distinct button text
- Merges with existing CSV data when `-o` points at an existing file (preserving labels and incrementing counts)
- Writes all rows with at least one occurrence (including newly seen single-site strings)

New strings are added with an empty `label` column.

### 2. Label new strings with the LLM

Use `label-button-texts.js` to fill in labels for any rows that do not yet have one.

```bash
export OPENAI_API_KEY=...
node post-processing/label-button-texts.js -i $AUTOCONSENT/data/labelled-button-texts.csv
```

Requires `OPENAI_API_KEY`.

Options:

- `-i, --input <path>` — CSV to label (required)
- `--limit <n>` — process at most _n_ unlabelled rows
- `--parallel <n>` — concurrent LLM requests (default: 10)

Labels are one of: `settings`, `accept`, `reject`, `acknowledge`, `other`.

After LLM labelling, manually review and correct labels in the CSV.

### 3. Benchmark and update patterns in autoconsent

In the autoconsent checkout, run `npm run benchmark-buttons` to see how `classifyButtonTextRegex` scores against the updated labels, and update `lib/heuristic-patterns.ts` there (the `optimize-button-patterns` agent skill in autoconsent automates this loop). `npm run test:lib` fails if any label gets a false positive or drops below 90% occurrence-weighted accuracy.

To try unreleased autoconsent changes here, link the checkout: run `npm run prepublish` in autoconsent, then `npm link $AUTOCONSENT --no-save` in this repo.
