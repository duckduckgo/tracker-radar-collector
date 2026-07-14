# Button classification

This folder contains scripts for building and maintaining labelled button text data from cookie popup crawls, and for benchmarking regex-based button classification.

The labelled dataset lives at `generate-autoconsent-rules/labelled-button-texts.csv`. Regex patterns used by `classifyButtonTextRegex` are defined in `generate-autoconsent-rules/button-patterns.js`.

## Workflow

### 1. Collect button texts from a crawl

Use `collect-popup-button-texts.js` to extract normalized button strings from crawl output and merge them into the labelled CSV.

```bash
node post-processing/collect-popup-button-texts.js \
  -i /path/to/crawl/output \
  -o post-processing/generate-autoconsent-rules/labelled-button-texts.csv
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
node post-processing/label-button-texts.js
```

Requires `OPENAI_API_KEY`. By default this updates `generate-autoconsent-rules/labelled-button-texts.csv`.

Options:

- `-i, --input <path>` — CSV to label (default: `generate-autoconsent-rules/labelled-button-texts.csv`)
- `--limit <n>` — process at most _n_ unlabelled rows
- `--parallel <n>` — concurrent LLM requests (default: 10)

Labels are one of: `settings`, `accept`, `reject`, `acknowledge`, `other`.

After LLM labelling, manually review and correct labels in the CSV before optimizing patterns.

### 3. Benchmark regex classification

Use `benchmark-classify-button-text-regex.js` to compare `classifyButtonTextRegex` against the labelled data and find gaps in the regex patterns.

```bash
node post-processing/benchmark-classify-button-text-regex.js
```

By default this reads `generate-autoconsent-rules/labelled-button-texts.csv` and benchmarks against `settings`, `accept`, `reject`, and `acknowledge` (excluding `other`).

Options:

- `-i, --input <path>` — labelled CSV path
- `-o, --output <path>` — write detailed results as JSON
- `--limit <n>` — evaluate at most _n_ rows

For each label the report shows:

1. **Correctly labelled** — exact label match, row count and occurrence-weighted count with percentages
2. **False positives** — predicted as this label but ground truth is a different label
3. **Top examples** — highest-occurrence false positives and missed strings (ground truth is this label but prediction differs)

Occurrence weighting uses the `occurences` column from the CSV so common button texts count more than rare ones.

When the benchmark shows misses or false positives, update the patterns in `generate-autoconsent-rules/button-patterns.js` and re-run the benchmark until coverage is acceptable.

### 4. Optimize patterns (optional)

After updating labels, invoke the `optimize-button-patterns` Cursor skill to iteratively improve `button-patterns.js` against the benchmark. Targets: zero false positives, ≥90% weighted coverage for each of `settings`, `accept`, `reject`, and `acknowledge`.
