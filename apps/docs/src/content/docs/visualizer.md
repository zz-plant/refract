---
title: "Refract UI — Visualizer"
description: "Browser-only app for exploring exported Refract event lines. The file is read in your browser; the viewer does not fetch source histories or send uploaded…"
---

Browser-only app for exploring exported Refract event lines. The file is read in your browser; the viewer does not fetch source histories or send uploaded data to a backend. Evidence bundles and saved review reports are separate formats.

![Refract UI: timeline, word-level diff, and citation panels](assets/refract-ui-screenshot.png)

## Open the viewer

Open [the hosted viewer](https://zz-plant.github.io/refract/viewer/). Sample data loads immediately. Drag your own `.jsonl` file onto the upload zone to inspect it. The page is static: the file is parsed in your browser tab and never uploaded.

To link directly from an external report or research site to a hosted `.ndjson`, `.jsonl`, or `refract-verification-bundle/v1` JSON file (with optional `ExternalTimelineMarker[]` context overlays), pass HTTPS URLs via query parameters:

```text
https://zz-plant.github.io/refract/viewer/?src=https://example.org/events.ndjson&markers=https://example.org/markers.json
```

## Develop the viewer

To change the viewer, run it from a clone of the repository:

```bash
git clone https://github.com/refract-org/refract
cd refract
bun install
cd apps/ui
bun run dev
```

The dev server runs at `http://localhost:5173`.

## Generate data to visualize

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > bitcoin-events.ndjson
```

The bounds select a two-revision span. The event types depend on the analyzers
and available inputs; choosing a depth does not ensure every type appears.

## Panels

### Timeline

Every event in the order the file lists them. Click any event to see the diff. Filter by event type with the tag buttons in the toolbar.

### Diff Viewer

Word-level diff of `before` → `after` for the selected event. Removed text is shown struck-through in red, added text in green.

### Citation Churn

Bar chart of citation additions, removals, and replacements per revision, plus a source change table showing citation domains (`citation_source`) and `citation_anchor_status` (`kept` vs. `unsourced`) badges.

### Certainty Timeline

Plots model confidence (`modelInterpretation.confidence`) when downstream model records are present, and automatically falls back to deterministic `certaintyProfile` markers (`high`, `medium`, `low`, `hedging`) for CLI-exported `observed` events.

### Disputes

Revert clusters with run-scoped pseudonymous actor pairs (`Actor_1 ↺ Actor_2` from `actorCohort`), edit velocity per day with optional `ExternalTimelineMarker` context overlays, and talk page activity timeline.

### Language Changes

Card grid of sentence observations — first seen, modified, removed, or reintroduced.

### Schema Inspector

Every JSON key in the loaded data with inferred types and presence percentage.

## Export

Download filtered data as JSON, JSONL, or CSV using the toolbar buttons. Filters apply to exports — narrow by event type first, then export.

## Source

[Source: `apps/ui`](https://github.com/refract-org/refract/tree/main/apps/ui) · [Full tutorial](tutorials/refract-ui)
