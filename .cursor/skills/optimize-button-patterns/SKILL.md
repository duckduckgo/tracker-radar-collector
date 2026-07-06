---
name: optimize-button-patterns
description: >-
  Iteratively improves cookie-popup button regex patterns in button-patterns.js
  against labelled-button-texts.csv. Use when labels are updated, benchmark
  coverage is low, or the user asks to optimize/fix button pattern regexes.
  Targets zero false positives and ≥90% weighted coverage per label (settings,
  accept, reject, acknowledge).
disable-model-invocation: true
---

# Optimize Button Patterns

Improve regex patterns in `post-processing/generate-autoconsent-rules/button-patterns.js` so `classifyButtonTextRegex` matches the labelled dataset.

## Prerequisites

1. Confirm `post-processing/generate-autoconsent-rules/labelled-button-texts.csv` has up-to-date labels. If the user added unlabelled rows, suggest running `label-button-texts.js` first.
2. Read [reference.md](reference.md) for classification semantics, file map, and known pitfalls.

## Success criteria

Stop when all three are met:

1. **Zero false positives** (occurrence-weighted total across labels)
2. **Per-label weighted coverage ≥ 90%** for each of `settings`, `accept`, `reject`, and `acknowledge` (`weightedCorrectRate` in benchmark JSON; `other` is excluded from optimization)
3. **Pattern consolidation** — merge literal clusters into regexes where safe; dedupe exact duplicates

## Benchmark

Run after every batch of edits:

```bash
node post-processing/benchmark-classify-button-text-regex.js \
  -o /tmp/button-pattern-benchmark.json
```

From stdout, read per-label weighted rates and false-positive total. From JSON (`byLabel`), read each label's `weightedCorrectRate`, `weightedCorrect`, `weightedSupport`, `falsePositiveExamples`, and `missedExamples` (sorted by `occurences` in the benchmark output).

A label passes when `weightedCorrectRate >= 0.90` (or `weightedCorrect / weightedSupport >= 0.90`). Check all four labels every iteration.

Count patterns before and after with:

```bash
node -e "const p=require('./post-processing/generate-autoconsent-rules/button-patterns'); for (const k of Object.keys(p)) console.log(k, p[k].length)"
```

## Run loop

Max ~10 iterations. Each iteration:

### 1. Measure

Run the benchmark. Record per-label `weightedCorrectRate` (and which labels are below 90%), weighted false positives, and pattern counts.

### 2. Fix false positives first

For each entry in `falsePositiveExamples` (any label where `predicted === label` but ground truth differs):

- Find the matching pattern in `button-patterns.js` (grep cleaned text; remember classification priority: reject → settings → acknowledge → accept).
- Fix by: removing the pattern, moving it to the correct list, narrowing with `^...$` anchors, or adding a `NEVER_MATCH_PATTERNS` guard.
- Re-run benchmark. **Do not add new coverage patterns while FPs remain.**

### 3. Improve coverage

While any label has `weightedCorrectRate < 0.90`, prioritize labels furthest below 90% (by gap in weighted correct count: `weightedSupport - weightedCorrect`).

For each iteration, take the top 15–25 `missedExamples` by `occurences` from **under-target labels only**.

For each miss:

- Add the smallest pattern that fixes it in the correct list (`REJECT_PATTERNS`, `SETTINGS_PATTERNS`, `ACKNOWLEDGE_PATTERNS`, or `ACCEPT_PATTERNS`).
- Prefer extending an existing regex over adding a literal string.
- Run the collision check (below) before committing.
- Re-run benchmark after each batch; FPs must not increase and no label's rate may drop below its previous value.

### 4. Merge patterns

Once FPs = 0 and **every** label has `weightedCorrectRate >= 0.90`:

- Remove exact duplicate literals within the same list.
- Replace clusters of 3+ similar literals with one anchored alternation regex, e.g. `/^(alles accepteren|accepteer alles|alles akzeptieren)$/i`.
- Re-run benchmark to confirm no regression.

### 5. Report

Use the output template at the end of this file.

## Pattern authoring rules

- Edit `button-patterns.js` only. Do not change `checkHeuristicPatterns` in `detection.js`.
- Classification priority: **reject → settings → acknowledge → accept → other** (see `classifyButtonTextRegex` in `detection.js`).
- Essential/necessary-only phrases → **reject**, even when "accept" appears.
- `allow` / `permit` + selection → **accept**; `customize` / `manage` / show details → **settings**.
- Neutral dismiss (OK, close, got it) → **acknowledge**.
- Use anchored regexes (`^...$`) for short action verbs to avoid substring false positives.
- Preserve language section comments (`// German`, `// Dutch`, etc.).
- Do not sync patterns to the autoconsent codebase (out of scope).

## Collision check

Before adding pattern `P` for label `L`:

1. Apply `cleanButtonText` when matching (same as runtime).
2. Scan labelled CSV rows: if `P` would match a row where `label !== L`, that is a collision.
3. If a high-occurrence collision exists, narrow `P` or skip it.
4. String patterns match exact cleaned text; regex patterns use `.test(cleanedText)`.

## Stop conditions

- All success criteria met (including per-label ≥ 90%), or
- No improvement in any under-target label's weighted rate for 2 consecutive iterations (report blockers per label), or
- User iteration budget reached

## Output template

End with:

```markdown
## Button pattern optimization results
- False positives: N → 0
- Per-label weighted coverage (target ≥90% each):
  - settings: X% → Y%
  - accept: X% → Y%
  - reject: X% → Y%
  - acknowledge: X% → Y%
- Pattern count: A → B
- Key changes:
  - ...
- Remaining top misses (if any, by label below target):
  - [label → predicted] "text" (xN)
```

## Additional reference

- Label definitions, file map, normalization rules: [reference.md](reference.md)
- Collect → label → benchmark workflow: [post-processing/README.md](../../post-processing/README.md)
