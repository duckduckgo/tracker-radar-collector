# Button Pattern Reference

## File map

| File | Purpose |
|------|---------|
| `post-processing/generate-autoconsent-rules/button-patterns.js` | Pattern arrays: `REJECT_PATTERNS`, `NEVER_MATCH_PATTERNS`, `SETTINGS_PATTERNS`, `ACCEPT_PATTERNS`, `ACKNOWLEDGE_PATTERNS` |
| `post-processing/generate-autoconsent-rules/detection.js` | `classifyButtonTextRegex`, `cleanButtonText`, `testButtonMatches` |
| `post-processing/generate-autoconsent-rules/labelled-button-texts.csv` | Ground truth (`button_text`, `occurences`, `label`) |
| `post-processing/benchmark-classify-button-text-regex.js` | Benchmark against labelled data |
| `post-processing/label-button-texts.js` | LLM labelling for unlabelled rows |
| `post-processing/collect-popup-button-texts.js` | Collect button texts from crawl output |

`button-patterns.js` exports five arrays. `detection.js` imports them and applies `NEVER_MATCH_PATTERNS` as a guard inside `testButtonMatches`.

## Classification priority

`classifyButtonTextRegex` in `detection.js` checks in this order:

1. `REJECT_PATTERNS` (via `isRejectButton`)
2. `SETTINGS_PATTERNS`
3. `ACKNOWLEDGE_PATTERNS`
4. `ACCEPT_PATTERNS`
5. `other` (no match)

A button is classified by the **first** matching list. When debugging mismatches, check higher-priority lists first.

## Matching semantics

`testButtonMatches(buttonText, matchPatterns, neverMatchPatterns)`:

1. Normalize with `cleanButtonText(buttonText)`.
2. If any `neverMatchPatterns` entry matches, return false.
3. If any `matchPatterns` entry matches, return true.

Match rules:

- **String pattern**: exact equality with cleaned text.
- **RegExp pattern**: `pattern.test(cleanedText)`.

## cleanButtonText normalization

Applied at classification time (same as CSV collection):

1. Lowercase
2. Remove punctuation/symbols: `"'/#&[]→✕×⟩❯><✗×''›«»`
3. Remove emojis
4. Collapse newlines and whitespace to single spaces
5. Trim

When adding patterns, evaluate against cleaned text, not raw CSV text.

## Label definitions

Aligned with `label-button-texts.js` / `classifyButtonTextLLM` in `detection.js`:

| Label | Meaning |
|-------|---------|
| **settings** | Opens cookie/consent preference customization (Cookie Settings, Manage preferences, Customize, More options, Show details). Site settings unrelated to cookies → `other`. |
| **accept** | Explicitly accepts cookies, permits consent, or agrees (Accept all, I agree, Allow selection). Must reference agreement/acceptance/permitting — not just dismissal. |
| **reject** | Rejects cookies or opts out, including essential-only and CCPA opt-outs (Reject all, Essential only, Do not sell my personal information). |
| **acknowledge** | Neutral dismissal without explicit accept/reject (OK, Got it, Close, Dismiss, Continue, I understand, ×). |
| **other** | None of the above: policy links, Impressum, payments, age checks, Cancel, etc. |

### Disambiguation rules

- Essential/necessary-only → **reject**, even if "accept" appears.
- `allow` / `permit` / `accept` + selection/selected → **accept**.
- `customize` / `manage` / `let me choose` / show details → **settings**.
- Short affirmatives ("yes", "yeah") → **accept**, not acknowledge.
- Standalone close/dismiss/× in any language → **acknowledge**.
- "Cancel" → **other**.
- If multiple categories fit: reject > accept > settings > acknowledge > other.

## Benchmark metrics

The benchmark excludes `other` labels. For each target label it reports:

- **Correctly labelled** — `predicted === label`
- **False positives** — `predicted === targetLabel` but `label !== targetLabel`
- **Missed** — `label === targetLabel` but `predicted !== targetLabel`

Occurrence weighting uses the `occurences` column. High-occurrence strings matter more than rare ones.

Per-label weighted coverage = `weightedCorrect / weightedSupport` for that label (reported as `weightedCorrectRate` in benchmark JSON).

Overall weighted coverage = sum of `weightedCorrect` / sum of `weightedSupport` across the four labels. **Optimization target is per-label ≥ 90%, not overall alone** — a high overall rate with one label at 75% does not pass.

## Known pitfalls

Patterns misplaced across lists cause false positives:

| Text | Correct label | Common mistake |
|------|---------------|----------------|
| `selectie toestaan` | accept | Listed in `REJECT_PATTERNS_DUTCH` |
| `akzeptieren schließen` | acknowledge | Listed in `ACCEPT_PATTERNS` |

When fixing FPs, search `button-patterns.js` for the literal or a regex that matches the cleaned text, then move/remove/narrow.

## NEVER_MATCH_PATTERNS

Guards against pay/subscribe flows that must never match reject (or other) patterns. Add here when a broad reject regex would incorrectly match payment-related button text.

## Pattern structure in button-patterns.js

- `REJECT_PATTERNS` — concatenation of language-specific arrays (`REJECT_PATTERNS_ENGLISH`, `REJECT_PATTERNS_DUTCH`, etc.)
- Other lists are single arrays with inline language comments
- Mix of literal strings and `RegExp` objects
- `REJECT_PATTERNS_EXTRA` — optional env var for temporary patterns (usually ignore during optimization)

## Workflow

See [post-processing/README.md](../../post-processing/README.md):

1. Collect button texts from crawl
2. Label with LLM
3. Benchmark
4. Optimize patterns (this skill)
