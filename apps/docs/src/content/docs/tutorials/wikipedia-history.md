---
title: "Track changes to a Wikipedia article over time"
description: "Use Refract to analyze the full revision history of a Wikipedia page and understand what changed, when, and what kind of change it was."
---

## Goal

Use Refract to analyze the full revision history of a Wikipedia page and understand what
changed, when, and what kind of change it was.

The analysis is deterministic, and its output is reproducible byte for byte.

## Steps

### 1. Run your first analysis

Zero install:

```bash
npx @refract-org/cli analyze "Earth" --depth detailed
```

Or with a local install:

```bash
bun add @refract-org/cli
refract analyze "Earth" --depth detailed -c
```

The `-c` flag enables caching so subsequent runs skip already-fetched revisions. This
is essential for large pages or repeated analysis.

### 2. Read the output

`refract analyze` prints one JSON event per line to stdout. Each event represents a
single observed change at a revision boundary. For example:

```json
{
  "eventId": "a3f5c2e1b7d409fa",
  "eventType": "section_reorganized",
  "fromRevisionId": 1280110001,
  "toRevisionId": 1280110100,
  "section": "Geology",
  "before": "",
  "after": "== Geology ==\nEarth's crust consists of tectonic plates...",
  "timestamp": "2024-11-25T12:00:00Z",
  "layer": "observed",
  "deterministicFacts": [
    {
      "fact": "Section Geology added with 3 paragraphs",
      "provenance": {
        "analyzer": "section-differ",
        "version": "0.5.1",
        "inputHashes": []
      }
    }
  ]
}
```

Key fields to read:
- **`eventType`**: what kind of change (sentence, citation, template, revert, section, etc.)
- **`section`**: where in the page the change happened
- **`before` / `after`**: the text before and after the change
- **`deterministicFacts`**: why the engine produced this event — always mechanical
- **`layer`**: `"observed"` means directly extracted from the diff; other layers
  (`"policy_coded"`, `"model_interpretation"`) are set by downstream consumers

### 3. Scope to a specific revision range

Large pages can produce thousands of events. Narrow the range with `--from` and `--to`:

```bash
refract analyze "Earth" --from 1250000000 --to 1260000000 --depth detailed
```

Or filter by time with `--since`:

```bash
refract analyze "Earth" --since 2024-01-01 --depth detailed
```

### 4. View results in a browser

```bash
refract explore "Earth"
```

Opens a local web server (default port 8899) with an interactive timeline, evidence
table, and diff viewer. Press Ctrl+C to stop.

### 5. Export structured output

```bash
# Line-delimited JSON for tools
refract export "Earth" --format ndjson > earth-events.jsonl

# CSV for spreadsheets
refract export "Earth" --format csv > earth-events.csv

# Bundle with a SHA-256 hash of its contents
refract export "Earth" --bundle > earth-bundle.json
```

### 6. Track a specific claim

```bash
refract claim "Earth" --text "Earth is the third planet from the Sun" -c
```

This shows every revision where that sentence was added, modified, removed, or
reintroduced — the full lifecycle of a claim.

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

- **Rate limits**: Wikipedia's API limits request frequency. Use `-c` to cache
  revisions and avoid re-fetching on repeat runs.
- **Large pages**: Pages with thousands of revisions produce many events. Use
  `--from` / `--to` or `--since` to scope to a date range.
- **Other wikis**: Point `--api` to any MediaWiki instance:
  ```bash
  refract analyze "Erde" --api https://de.wikipedia.org/w/api.php
  ```
- **Too much output**: Pipe to a file instead of stdout, or use `refract export`
  for structured formats.

## Next steps

- [Track canon changes on Fandom](fandom-canon.md)
- [Monitor citation churn on contested pages](citation-churn.md)
- [Build a dispute timeline](dispute-timeline.md)
- [Analyze with DuckDB](../analytics.md)
- [Work with notebooks](../notebooks.md)
