# Refract UI

Standalone visualization for the [Refract](https://github.com/refract-org/refract) observation engine.

Load a JSONL file of Refract events to see them as a timeline with word-level diffs, citation and revert charts, talk page activity, and a list of the fields the events carry. Everything runs in the browser; there is no backend.

## Open it

The viewer is published at https://zz-plant.github.io/refract/viewer/. Sample data loads automatically. Drag a JSONL file onto the upload zone to inspect your own data; the file is parsed in the browser tab and never uploaded.

## Develop it

The viewer lives in `apps/ui` of the Refract repository:

```bash
git clone https://github.com/refract-org/refract.git
cd refract
bun install --frozen-lockfile
cd apps/ui
bun run dev
```

Open `http://localhost:5173`. `bun run build` writes a copy based at `/refract/viewer/`, the path the docs site serves it from; the docs build (`apps/docs/viewer.mjs`) builds it into the site.

Event types come from `@refract-org/evidence-graph` as types only, so `bun run build` here type-checks against the engine. Run `bun run build` at the repository root first, which emits those declarations.

### Using your own Refract data

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > bitcoin-events.ndjson
```

Then select or drag `bitcoin-events.ndjson` onto the upload zone. Both `.jsonl`
and `.ndjson` are accepted. The CLI explorer fetches histories; this viewer opens
previously exported event lines. Evidence bundles and saved `refract-review/v1`
reports have different structures. Use the CLI to review and acknowledge a report.

## What you'll see

**Timeline** — Every event, in the order the file lists them. Click an event to see the word-level diff of what changed. Filter by event type to narrow the view.

**Citations** — Bar chart of citation additions, removals, and replacements per revision, plus a table of every citation change.

**Model confidence** — The confidence score of each event on the `model_interpretation` layer.

**Disputes** — Revert clusters, events per day (with reverts), and talk page activity.

**Wording changes** — One card per sentence event (first seen, modified, removed, reintroduced), with the before and after text.

**Event schema** — Every top-level field in the loaded events, with its types and the share of events that have it.

**Export** — Download filtered data as JSON, JSONL, or CSV.

## Stack

- Vite + vanilla TypeScript
- No framework dependencies
- DOM-based rendering with CSS custom properties
- Loads nothing from other origins; an uploaded file is read in the browser and never sent anywhere

---

[Refract Engine](https://github.com/refract-org/refract) · [Docs](https://zz-plant.github.io/refract/) · [npm](https://www.npmjs.com/org/refract-org)
