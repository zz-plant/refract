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

Run a Refract analysis and export it as NDJSON:

```bash
refract analyze "Bitcoin" --depth forensic > bitcoin-events.jsonl
```

Use `--depth forensic` to get the full 26 event types (citation changes, reverts, edit
clusters, talk page activity, category shifts — everything the visualizer can display).

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

Drag `bitcoin-events.jsonl` from your file manager onto the upload zone in the browser
toolbar. Refract UI parses the file, validates event types against the
`@refract-org/evidence-graph` schema, and populates every panel.

## What you see

### Timeline (top-left)

Every event plotted on a horizontal axis by revision timestamp. Hover for event type and
section. Click any event to populate the diff panel. Filter by event type using the
dropdown in the toolbar.

### Diff (top-right, middle-right)

When you click an event, `before` and `after` snapshots appear side by side. For
`sentence_modified` events, the changed text is highlighted.

### Citation churn (top-center-right)

Bar chart of citation activity over time — additions in green, removals in red. Watch for
spikes that correlate with revert clusters — a page edit war where sources are being
added and stripped in rapid succession.

### Certainty timeline (top-right)

When you export events with `--depth forensic` on Refract v0.5.0+, each event carries
enrichment fields (`certaintyProfile`, `directionSignal`, `editMagnitude`). The certainty
timeline plots how confident the language was over time. Drops in certainty often precede
reverts or disputes.

### Row 2 — Disputes, Sources, Word-level diffs, Schema

| Panel | What it shows |
|-------|--------------|
| **Revert clusters** | Groups of edits reverted together, with timestamps and revision IDs |
| **Edit velocity** | Edits-per-day bar chart — spikes indicate concentrated editing activity |
| **Talk page timeline** | Thread activity over time, correlated against main-page event density |
| **Source change table** | Every citation added, removed, or replaced, with the URL and revision |
| **Wording diff card** | When a sentence was modified in-place, see the exact text change |
| **Schema viewer** | Raw event count by type — quick glance at which analyzers fired most |

## Interpretation example

Say you run `refract diff "Bitcoin" --wiki-a ... --wiki-b ...` and load the output into
Refract UI:

1. **Timeline** shows the two wikis' events overlaid — one color per wiki.
2. **Citation churn** reveals Wiki B has 3× more citation turnover.
3. **Revert clusters** in Wiki A's timeline align with edit velocity spikes — edit-warring
   without resolution.
4. **Certainty timeline** drops sharply on Wiki B after a controversial edit, then slowly
   recovers as more sources appear.

Without the visualizer, you would spot these patterns by reading raw JSON. With it, the
relationships between event types become visible at a glance.

## Troubleshooting

- **"No events loaded"**: Make sure your file uses NDJSON format (`--format ndjson`).
  Refract UI expects one JSON object per line with `eventType` and `timestamp` fields.
- **Empty panels**: Some panels require specific event types. Citation churn needs
  `citation_added` or `citation_removed` events. Run `--depth forensic` to get the full
  set.
- **File size**: Very large analyses (1000+ revisions) may load slowly. Use `--depth
  detailed` instead and export a narrower revision range with `--from` and `--to`.

## Next steps

- [Complete end-to-end workflow](../complete-workflow.md) — analyze, export, query, visualize
- [Track Wikipedia changes](wikipedia-history.md) — build a claim timeline
- [Analytics with DuckDB](../analytics.md) — query the raw data
- [Refract UI source](https://github.com/refract-org/refract/tree/main/apps/ui) — run it locally
