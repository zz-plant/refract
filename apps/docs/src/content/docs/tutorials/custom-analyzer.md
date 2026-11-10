---
title: "Tutorial: Build a custom analyzer"
description: "Add a new deterministic analyzer to Refract — one that produces a new event type and integrates into the pipeline. This tutorial walks through the full…"
---

## Goal

Add a new deterministic analyzer to Refract — one that produces a new event type and
integrates into the pipeline. This tutorial walks through the full cycle: define the
event type, implement the analyzer, integrate with the CLI, write tests, add an eval
benchmark, and verify the build gate.

## Prerequisites

- Bun 1.2+
- Clone of the refract monorepo (`git clone https://github.com/refract-org/refract`)
- Passing build gate before you start: `bun run ci`

## Step 1: Define the event type

All event types live in `packages/evidence-graph/src/schemas/evidence.ts`. Add your
new type to the `EventType` union. This example adds a "redirect detected" event:

```typescript
export type EventType =
  // ... existing types ...
  | "redirect_detected";     // ← add here
```

Keep the union alphabetically grouped within its category. Bump the
`EVENT_SCHEMA_VERSION` minor version:

```typescript
export const EVENT_SCHEMA_VERSION = "0.5.0";
```

Build to verify the type propagates:

```bash
cd packages/evidence-graph && bun run build
```

## Step 2: Implement the analyzer

Create `packages/analyzers/src/redirect-detector.ts`:

```typescript
import type { EvidenceEvent, Revision } from "@refract-org/evidence-graph";

export function detectRedirects(revisions: Revision[]): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];

  for (let i = 1; i < revisions.length; i++) {
    const prev = revisions[i - 1];
    const curr = revisions[i];

    // A redirect is wikitext starting with #REDIRECT
    const wasRedirect = prev.content.trimStart().startsWith("#REDIRECT");
    const becameRedirect = curr.content.trimStart().startsWith("#REDIRECT");

    if (becameRedirect && !wasRedirect) {
      events.push({
        eventType: "redirect_detected",
        fromRevisionId: prev.revId,
        toRevisionId: curr.revId,
        section: "",
        before: prev.content.slice(0, 200),
        after: curr.content.slice(0, 200),
        deterministicFacts: [{
          fact: "redirect_detected",
          detail: `page converted to redirect in revision ${curr.revId}`,
          provenance: {
            analyzer: "redirect-detector",
            version: "0.5.0",
            inputHashes: [],
          },
        }],
        layer: "observed",
        timestamp: curr.timestamp,
      });
    }
  }

  return events;
}
```

Add the export to `packages/analyzers/src/index.ts`:

```typescript
export { detectRedirects } from "./redirect-detector.js";
```

## Step 3: Integrate with the CLI

In `packages/cli/src/commands/analyze.ts`, add the analyzer to the forensic depth
pipeline (or create a new depth level if appropriate):

```typescript
import { detectRedirects } from "@refract-org/analyzers";

// In the forensic depth block:
if (depth === "forensic") {
  const redirectEvents = detectRedirects(revisions);
  events.push(...redirectEvents);
}
```

## Step 4: Write tests

Create `packages/analyzers/src/__tests__/redirect-detector.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Revision } from "@refract-org/evidence-graph";
import { detectRedirects } from "../redirect-detector.js";

function makeRev(revId: number, content: string, timestamp = "2026-01-01T00:00:00Z"): Revision {
  return {
    revId, content, comment: "", timestamp,
    pageId: 1, pageTitle: "Test", user: undefined,
  };
}

describe("detectRedirects", () => {
  it("detects when a page becomes a redirect", () => {
    const revs = [
      makeRev(1, "Normal article text"),
      makeRev(2, "#REDIRECT [[Target page]]"),
    ];
    const events = detectRedirects(revs);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("redirect_detected");
  });

  it("does not fire when page stays a redirect", () => {
    const revs = [
      makeRev(1, "#REDIRECT [[Old target]]"),
      makeRev(2, "#REDIRECT [[New target]]"),
    ];
    const events = detectRedirects(revs);
    expect(events).toHaveLength(0);
  });

  it("does not fire when page stays normal", () => {
    const revs = [
      makeRev(1, "Normal text"),
      makeRev(2, "Updated normal text"),
    ];
    expect(detectRedirects(revs)).toHaveLength(0);
  });
});
```

Run the tests:

```bash
bun run test
```

## Step 5: Add an eval benchmark

In `packages/eval/src/index.ts`, the `benchmarkPages()` method returns test cases.
Add one for your analyzer:

```typescript
{
  id: "redirect-detection",
  description: "Pages that were converted to redirects produce redirect_detected events",
  pageTitle: "Wikipedia:Redirect",  // a known redirect
  pageId: 12345,
  revisionRange: { from: 0, to: 0 },
  expectedEvents: [{ eventType: "redirect_detected", section: "" }],
  tolerance: { minEventCount: 1, minPrecision: 0.0 },
},
```

Run the eval:

```bash
refract eval --page "Wikipedia:Redirect"
```

## Step 6: Verify the build gate

```bash
bun run ci
```

This runs: `build && lint && typecheck && check:boundaries && test`. All must pass.
If your analyzer introduces exports that cross package boundaries incorrectly,
`check:boundaries` will catch it.

## Step 7: Update documentation

- Add the new event type to `apps/docs/src/content/docs/schema.md`
- Add it to `apps/docs/src/content/docs/events.md` event taxonomy
- Add it to `EVENT_TYPE_RECORD` in `apps/ui/src/types.ts`; the viewer's build fails until you do
- If the CLI flag changed, update `apps/docs/src/content/docs/cli.md`

## Conventions checklist

- [ ] File: kebab-case (`redirect-detector.ts`)
- [ ] Function: camelCase (`detectRedirects`)
- [ ] Imports: `import type` for types, `.js` extension for intra-package
- [ ] Test file: `src/__tests__/redirect-detector.test.ts`
- [ ] Exports: only the public API from `index.ts`
- [ ] Event types: snake_case (`redirect_detected`)
- [ ] No model calls in the analyzer
- [ ] No comments explaining what code does (only non-obvious constraints)
- [ ] Commit: `feat(analyzers): add redirect detector`

## Next steps

- [SDK reference](../sdk.md) — all packages and their APIs
- [Architecture decisions](../architecture-decisions.md) — why deterministic-only
- [Workqueue protocol](https://github.com/refract-org/refract/blob/main/AGENTS.md) — how tasks are structured
