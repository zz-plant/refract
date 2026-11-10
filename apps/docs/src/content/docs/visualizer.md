---
title: "Refract UI — Visualizer"
description: "Browser-only app for exploring exported Refract event lines. The file is read in your browser; the viewer does not fetch source histories or send uploaded…"
---

Browser-only app for exploring exported Refract event lines. The file is read in your browser; the viewer does not fetch source histories or send uploaded data to a backend. Evidence bundles and saved review reports are separate formats.

![Refract UI: timeline, word-level diff, and citation panels](assets/refract-ui-screenshot.png)

## Quick start

```bash
git clone https://github.com/refract-org/refract
cd refract
bun install
cd apps/ui
bun run dev
```

Open `http://localhost:5173`. Sample data loads immediately. Drag your own `.jsonl` file onto the upload zone to inspect it.

## Generate data to visualize

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > bitcoin-events.ndjson
```

The bounds select a two-revision span. The event types depend on the analyzers
and available inputs; choosing a depth does not ensure every type appears.

## Panels

### Timeline

Every event in chronological order. Click any event to see the diff. Filter by event type with the tag buttons in the toolbar.

### Diff Viewer

Word-level diff of `before` → `after` for the selected event. Removed text is shown struck-through in red, added text in green.

### Citation Churn

Bar chart of citation additions, removals, and replacements per revision, plus a sortable table of every citation change.

### Certainty Timeline

Confidence scores over time for model-interpreted events. Dots are color-coded: green (≥70%), yellow (40–69%), red (<40%).

### Disputes

Revert clusters, edit velocity per day, and talk page activity timeline.

### Language Changes

Card grid of sentence observations — first seen, modified, removed, or reintroduced.

### Schema Inspector

Every JSON key in the loaded data with inferred types and presence percentage.

## Export

Download filtered data as JSON, JSONL, or CSV using the toolbar buttons. Filters apply to exports — narrow by event type first, then export.

## Source

[Source: `apps/ui`](https://github.com/refract-org/refract/tree/main/apps/ui) · [Full tutorial](tutorials/refract-ui)
