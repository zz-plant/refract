---
title: "Tutorial: Explore your analysis in Refract UI"
description: "Take Refract's CLI output and explore it visually — timelines, diffs, citation graphs, and event breakdowns — using the standalone Refract UI."
---

## Goal

Take Refract's CLI output and explore it visually — timelines, diffs, citation graphs, and
event breakdowns — using the standalone Refract UI.

## Prerequisites

- [Node.js](https://nodejs.org) 20+ or [Bun](https://bun.sh) v1.2+
- [Refract CLI](https://www.npmjs.com/package/@refract-org/cli) (`npx @refract-org/cli` works)
- Clone of the [Refract repository](https://github.com/refract-org/refract); the viewer is in `apps/ui`

Refract UI is a zero-dependency web app (vanilla TS + Vite). It runs entirely in your
browser — no server, no API key, no data leaves your machine.

## Steps

### 1. Generate analysis data

Export a bounded history as NDJSON:

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > bitcoin-events.ndjson
```

The viewer reads one event per line. `refract analyze` writes the same lines when
given `--json`; without it the command prints a report the viewer cannot load.

The bounds select a two-revision span. Which of the 26 event types appear depends
on what changed in the span you export.

### 2. Start Refract UI

In a second terminal:

```bash
cd refract
bun install
cd apps/ui
bun run dev
```

Open `http://localhost:5173`. Sample data loads on first visit — you will see a populated
timeline immediately.

### 3. Load your data

Drag `bitcoin-events.ndjson` from your file manager onto the upload zone in the
toolbar, or click the zone to pick the file. Refract UI parses each line, checks the
event type against `@refract-org/evidence-graph` and the fields every event needs,
and fills every panel. Lines it rejects are listed under the upload zone.

## What you see

### Revision timeline (left)

A list of every event in the order the file has them, with its type, a one-line
summary, timestamp, revision IDs and section. Click an event to show it in the diff
panel. The tag buttons in the toolbar turn event types on and off; every panel and
the export follow the filter.

### Diff (right, top)

A word-level diff of the selected event's `before` and `after` text in one block.
Removed words are red and added words are green.

### Citation churn (right, middle)

A bar chart with one group per revision: citations added, removed and replaced.

### Model confidence (right, bottom)

One dot per event on the `model_interpretation` layer, placed by its
`modelInterpretation.confidence`. Events exported by the CLI are on the `observed`
layer and carry no confidence, so for a CLI export this panel reads "No model
interpretations with confidence scores found."

### Row 2 — Disputes, Wording changes, Source changes, Event schema

| Panel | What it shows |
|-------|--------------|
| **Revert clusters** | `revert_detected` events grouped by revision and section, with the count and the facts recorded |
| **Events per day** | Bar chart of events per day, with a second bar for that day's reverts |
| **Talk page activity** | Talk page events in the file, with timestamp and revision |
| **Wording changes** | One card per sentence event (first seen, modified, removed, reintroduced) with its before and after text |
| **Source changes** | A table of every citation added, removed, or replaced: date, type, section, detail |
| **Event schema** | Every top-level field in the loaded events, with its types and the share of events that have it |

### Export

The toolbar's export control downloads the filtered events as JSON, JSONL, or CSV.

## Interpretation example

Say you load an export that covers an edit war:

1. **Revert clusters** lists the reverted revisions; **Events per day** shows the days
   they fall on.
2. Turn on only the `citation_*` tags. **Citation churn** shows which revisions added
   and removed sources, and **Source changes** lists each one.
3. Click a `sentence_modified` event in the timeline. The diff panel shows the words
   that changed.

Without the visualizer, you would spot these patterns by reading raw JSON. With it, the
relationships between event types become visible at a glance.

## Troubleshooting

- **"No valid events found."**: The file has no line the viewer accepts. Export with
  `--format ndjson`, or pass `--json` to `refract analyze`. Each line must be one JSON
  object with `eventType`, `fromRevisionId`, `toRevisionId`, `timestamp`, `section`,
  `before`, `after` and `deterministicFacts`.
- **"Imported N events (M errors)"**: Some lines were rejected, such as a `#` comment
  line. The first ten are listed with their line numbers.
- **Empty panels**: Some panels need specific event types. Citation churn needs
  `citation_added`, `citation_removed` or `citation_replaced` events.
- **File size**: A long history may load slowly. Export a narrower revision range
  with `--from` and `--to`.

## Next steps

- [Complete end-to-end workflow](../complete-workflow.md) — analyze, export, query, visualize
- [Track Wikipedia changes](wikipedia-history.md) — build a claim timeline
- [Analytics with DuckDB](../analytics.md) — query the raw data
- [Refract UI source](https://github.com/refract-org/refract/tree/main/apps/ui) — run it locally
