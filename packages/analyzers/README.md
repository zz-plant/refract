# @refract-org/analyzers

Deterministic analyzers. Byte-for-byte reproducible, no model involved.

```bash
bun add @refract-org/analyzers
```

## Exports

### Analyzers

- `sectionDiffer` — section extraction and diffing between revisions
- `citationTracker` — citation extraction, diffing, and source lineage
- `revertDetector` — revert comment matching and revert chain detection
- `templateTracker` — template extraction and diffing (citation, neutrality, BLP, etc.)
- `classifyHeuristic` — heuristic edit classification (revert, vandalism, sourcing, cosmetic, minor)
- `detectTextPropagation(before, after)` (0.5.1+) — borrowed/boilerplate text between two revisions, via n-gram Jaccard similarity and token-span matching
- `analyzeCitationNetwork(citations)` (0.5.1+) — domain concentration (HHI), top sources, and diversity metrics over a page's citations

### Utilities

- `sanitizeWikitext`, `extractHeadingMap`, `deriveSectionHeading`, `countCitations`, `countKeywordMentions`, `extractAnchorSnippet` — wikitext parsing helpers
- `findSectionForText`, `buildSectionCharMap` — which section a sentence sits in

### Builders

- `buildSectionLineage` — full section ancestry chain across revisions
- `buildSourceLineage`, `buildSourceId` — citation ancestry

### Types

- `SectionDiffer`, `CitationTracker`, `RevertDetector`, `TemplateTracker` — analyzer interfaces
- `CitationRef`, `CitationChange`, `RevertChain`, `Template`, `TemplateChange`, `TemplateType` — domain types
- `HeuristicKind`, `SectionEvent`, `SectionLineage`, `HeadingPosition` — supporting types
- `ParsedContent`, `RevisionEventOptions`, `RevisionEventDepth`, `ProtectionLogRecord` — event pipeline types

```ts
import { sectionDiffer, citationTracker, revertDetector } from "@refract-org/analyzers";
```

### semantic-enrichment (v0.5.0+)

Deterministic text analysis for evidence events. No model, no API.

- `computeCertaintyProfile(text)` — counts certainty/hedging markers
- `computeDirectionSignal(beforeProfile, afterProfile)` — strengthening/weakening/neutral, from two `computeCertaintyProfile` results
- `computeEditMagnitude(beforeLen, afterLen)` — minor/moderate/major
- `computeContentChange(eventType, before, after)` — introduction/removal/expansion/etc.
- `extractKeyTerms(text)` — significant terms from text
- `extractQuantitativeFindings(text)` — p-values, HR, n-values, CIs

Exported from `@refract-org/analyzers`.

### Event pipeline (0.5.1+)

The events `refract analyze` derives from a page history, as library functions. The CLI calls these, so a consumer that imports them gets the same events the CLI emits, and no copy to keep in step. They read no network and no filesystem, so they run in a Worker (with `nodejs_compat`) as well as Node or Bun.

- `buildRevisionEvents(revisions, options?)` — structural diffs, editorial signals and sentence diffs for each consecutive pair of revisions, ordered by timestamp. Options: `depth` (`"brief"` blanks the changed text, `"forensic"` adds both revisions' wikitext as facts, default `"detailed"`), `similarityThreshold` (default 0.8), `protectionLogs`.
- `annotateEvents(events)` — adds `schemaVersion` and the semantic fields (`editMagnitude`, `contentChange`, `keyTerms`, `certaintyProfile`, `directionSignal`, `quantitativeFindings`) in place.
- `parseContent`, `computeStructuralDiffs`, `detectEditorialSignals` — the per-pair steps, for a caller that runs them itself.

```ts
import { annotateEvents, buildRevisionEvents } from "@refract-org/analyzers";
import { createEventIdentity } from "@refract-org/evidence-graph";

const events = annotateEvents(buildRevisionEvents(revisions, { protectionLogs }));
const ids = events.map((e) => createEventIdentity(e));
```

For everything `refract analyze` prints, add `buildPageMoveEvents(windowPageMoves(...))` before and `correlateTalkRevisions(revisions, talkRevisions)` after `buildRevisionEvents`, then annotate all of them together.

[Refract](https://github.com/refract-org/refract) · [Docs](https://zz-plant.github.io/refract/) · [npm](https://www.npmjs.com/package/@refract-org/analyzers)
