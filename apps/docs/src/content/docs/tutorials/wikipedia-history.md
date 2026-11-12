---
title: "Track changes to a Wikipedia article over time"
description: "Use Refract to analyze the revision history of a Wikipedia page and understand what changed, when, and what kind of change it was."
---

## Goal

Use Refract to analyze the revision history of a Wikipedia page and understand what
changed, when, and what kind of change it was.

The analysis is deterministic: the same revision range produces the same events.

## Steps

### 1. Run your first analysis

Zero install:

```bash
npx @refract-org/cli analyze "Earth" --depth brief --json
```

Or with a local install:

```bash
bun add @refract-org/cli
refract analyze "Earth" --depth brief --json
```

`--depth brief` reads the latest 20 revisions and leaves the changed text out of each
event. `detailed`, the default, includes the text, and without a range reads the whole
history: tens of thousands of revisions for this page. Step 3 shows how to give a range.

The `-c` flag caches revisions in SQLite. It needs Bun and a source checkout, and a
cached range is reused only when both `--from` and `--to` are given.

### 2. Read the output

With `--json`, `refract analyze` prints one JSON event per line to stdout. Without it
the command prints a text summary, or opens the explorer in an interactive terminal.
Each event represents a single observed change at a revision boundary. For example
(text values illustrative, enrichment fields left out):

```json
{
  "eventType": "section_reorganized",
  "fromRevisionId": 1250019297,
  "toRevisionId": 1251058746,
  "section": "Geology",
  "before": "Earth's crust consists of tectonic plates...",
  "after": "Earth's crust consists of several tectonic plates...",
  "deterministicFacts": [
    { "fact": "section_changed", "detail": "change=modified" }
  ],
  "layer": "observed",
  "timestamp": "2024-10-14T00:00:00Z",
  "schemaVersion": "0.5.0"
}
```

Key fields to read:
- **`eventType`**: what kind of change (sentence, citation, template, revert, section, etc.)
- **`section`**: where in the page the change happened
- **`before` / `after`**: the text before and after the change
- **`deterministicFacts`**: why the engine produced this event — always mechanical
- **`layer`**: `"observed"` means directly extracted from the diff; `"policy_coded"`
  marks events matched against a rule, such as `revert_detected`;
  `"model_interpretation"` is set by downstream consumers

### 3. Scope to a specific revision range

Large pages can produce thousands of events. Narrow the range with `--from` and `--to`:

```bash
refract analyze "Earth" --from 1250019297 --to 1258622167 --depth detailed --json
```

That range is 23 revisions from late 2024. Or filter by time with `--since`, which
reads every revision from that moment to the newest:

```bash
refract analyze "Earth" --since 2024-01-01 --depth detailed --json
```

### 4. View results in a browser

```bash
refract explore "Earth" --from 1250019297 --to 1258622167
```

Opens a local web server (default port 8899) with an interactive timeline, evidence
table, and diff viewer. Press Ctrl+C to stop.

### 5. Export structured output

```bash
# Line-delimited JSON for tools
refract export "Earth" --from 1250019297 --to 1258622167 --format ndjson > earth-events.jsonl

# CSV for spreadsheets
refract export "Earth" --from 1250019297 --to 1258622167 --format csv > earth-events.csv

# Bundle with a SHA-256 hash of its contents
refract export "Earth" --from 1250019297 --to 1258622167 --bundle > earth-bundle.json
```

`export` runs at `detailed` depth and, without a range, reads the whole history.

### 6. Track a specific claim

```bash
refract claim "Earth" --text "Earth is the third planet from the Sun"
```

This shows the matching sentence in each of the latest 50 revisions, and when the
passage was first matched, changed, removed or reintroduced within them. `--limit`
reads more revisions; `--from` and `--to` select an earlier range.

## Understanding what you see

**Citation events** (`citation_added`, `citation_removed`, `citation_replaced`) trace
source churn. A section with frequent citation turnover may indicate an actively
contested topic. A citation that survives many revisions without change is a
high-stability source.

**Revert events** (`revert_detected`) mark edits that were undone — either by the
same editor ("self-revert") or by another editor. Clusters of revert events in a
short time window often indicate edit-warring.

**Template events** (`template_added`, `template_removed`) reveal policy tagging.
Templates like `{{citation needed}}` or `{{NPOV}}` are Wikipedia's dispute signals.
Refract detects these mechanically from wikitext.

**Section events** (`section_reorganized`, `lead_promotion`) track structural
reorganization. When material moves from body to lead, the framing of the page has
changed — Refract flags this as a change in editorial emphasis.

## Troubleshooting

- **Rate limits**: Wikipedia's API limits request frequency. Keep runs to a revision
  range; Refract retries a `429` after the server's `Retry-After`.
- **Large pages**: Pages with thousands of revisions produce many events. Use
  `--from` / `--to` or `--since` to scope to a date range.
- **Other wikis**: Point `--api` to any MediaWiki instance:
  ```bash
  refract analyze "Erde" --api https://de.wikipedia.org/w/api.php --depth brief --json
  ```
- **Too much output**: Pipe to a file instead of stdout, or use `refract export`
  for structured formats.

## Next steps

- [Track canon changes on Fandom](fandom-canon.md)
- [Monitor citation churn on contested pages](citation-churn.md)
- [Build a dispute timeline](dispute-timeline.md)
- [Analyze with DuckDB](../analytics.md)
- [Work with notebooks](../notebooks.md)
