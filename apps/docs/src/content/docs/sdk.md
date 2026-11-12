---
title: "SDK / package reference"
description: "Refract's SDK is a set of packages that compose into a pipeline: ingest → analyze → persist."
---

## Overview

Refract's SDK is a set of packages that compose into a pipeline: ingest → analyze → persist.

![Package dependency graph](packages.svg)

Packages are published on npm under the `@refract-org` scope, except `@refract-org/persistence`. All packages are ESM-only and written in TypeScript.

## Basic pipeline

The events `refract analyze` produces, from revisions you fetch yourself. `buildRevisionEvents` and `annotateEvents` need `@refract-org/analyzers` 0.5.1 or later.

```typescript
import { MediaWikiClient } from "@refract-org/ingestion";
import { annotateEvents, buildRevisionEvents } from "@refract-org/analyzers";
import { createEventIdentity } from "@refract-org/evidence-graph";

const client = new MediaWikiClient({ apiUrl: "https://en.wikipedia.org/w/api.php" });
const revisions = await client.fetchRevisions("Earth", { limit: 50 }); // the 50 latest

// Section, citation, wikilink, category, template, revert and sentence events
// for each consecutive pair of revisions, ordered by timestamp.
const events = annotateEvents(buildRevisionEvents(revisions));
for (const event of events) event.eventId = createEventIdentity(event);
```

`annotateEvents` adds `schemaVersion` and the semantic fields the CLI's output carries (`certaintyProfile`, `directionSignal`, `quantitativeFindings` and others). `buildRevisionEvents` takes `depth` (`"brief"`, `"detailed"`, `"forensic"`), `similarityThreshold` and the page's `protectionLogs`. It reads no network and no filesystem, so it runs in a Worker too (with `nodejs_compat`). For page moves and talk-page correlation as well, follow the recipe in the [analyzers README](https://github.com/refract-org/refract/tree/main/packages/analyzers#event-pipeline-051).

## Storage

`@refract-org/persistence` is not on npm: import it from a source checkout, under Bun. It stores revisions and claim records, which is what the CLI's `--cache` uses. It has no event table: write events to NDJSON, or to your own table (see [Downstream](downstream.md#production-ingestion)).

```typescript
import { Persistence } from "@refract-org/persistence";

const db = new Persistence({ dbPath: "refract.db" });
db.insertRevisions(revisions);
const saved = db.getRevisions("Earth"); // newest first, up to 100 unless you pass `limit`
db.close();
```

## Package reference

### `@refract-org/evidence-graph`

Core types, event schemas, and utilities. Zero runtime dependencies.

```typescript
import type { EvidenceEvent, EventType, Revision, ClaimLedger, ClaimLedgerEntry, ObservationReport } from "@refract-org/evidence-graph";
import { createClaimIdentity, createEventIdentity } from "@refract-org/evidence-graph";
```

`EventType` now includes `sentence_modified` (26 event types total).

Key exports:
- Interfaces: `EvidenceEvent`, `Revision`, `DeterministicFact`, `ModelInterpretation`, `ClaimLedger`, `ClaimLedgerEntry`, `ObservationReport`
- Types: `EventType`, `EvidenceLayer`, `PolicyDimension`, `Depth`, `AnalyzerConfig`
- Utilities: `createClaimIdentity`, `createEventIdentity`
- Merkle tree: `createReplayManifest`, `buildMerkleTree`, `getMerkleProof`, `verifyMerkleProof`
- `AnalyzerConfig`: the shape of the thresholds and windows analyzers take — similarity threshold for sentence matching, time windows for clusters and talk correlation, revert patterns, spike factors. Each analyzer function takes its own part of it as an options argument (see [`@refract-org/analyzers`](#refract-organalyzers)).
- `DEFAULT_ANALYZER_CONFIG`: frozen default values for all configurable parameters
- `FactProvenance`: a shape for recording which analyzer, version and parameters produced a fact. Refract's own events do not fill it in; a consumer that needs it records it when storing events (see [Downstream](downstream.md#3-factprovenance-for-auditability)).

No prompt engineering, no interpretation schema — consumers define their own taxonomy at each configurable boundary.

### `@refract-org/ingestion`

Wikimedia API adapters. Fetches revision history and parses wikitext.

```typescript
import { MediaWikiClient } from "@refract-org/ingestion";
import type { RevisionFetcher, AuthConfig } from "@refract-org/ingestion";

const client = new MediaWikiClient({ apiUrl: "https://en.wikipedia.org/w/api.php" });
const revisions = await client.fetchRevisions("Earth", { limit: 50 });
```

`fetchRevisions` returns the newest revisions first. Without `limit` (or a `start`/`end` or revision-ID range) it pages through the page's whole history.

Key exports: `MediaWikiClient` (class), `RevisionFetcher` (interface), `AuthConfig`

**Wayback Machine, Git and snapshot revision sources**:

```typescript
import {
  WaybackRevisionSource,
  GitRevisionSource,
  SnapshotDirectorySource,
} from "@refract-org/ingestion";

// 1. Ingest snapshots from the Wayback Machine for any public URL
const wayback = new WaybackRevisionSource();
for await (const rev of wayback.revisions("https://example.gov/public-policy")) {
  console.log(rev.timestamp, rev.size);
}

// 2. Ingest commit history from a local Git repository
const git = new GitRevisionSource({ repoPath: "/path/to/repo" });
for await (const rev of git.revisions("specs/standard.md")) {
  console.log(rev.comment, rev.timestamp);
}

// 3. Ingest timestamped document files from a directory
const snapshots = new SnapshotDirectorySource({ baseDir: "/path/to/archives" });
for await (const rev of snapshots.revisions("document-title")) {
  console.log(rev.revId, rev.content.length);
}
```

Key exports: `MediaWikiClient`, `WaybackRevisionSource`, `GitRevisionSource`, `SnapshotDirectorySource`, `XmlDumpRevisionSource`

**Wikidata entity mapping**:

```typescript
import { fetchWikidataId, mapPageToEntity, mapPagesToEntities } from "@refract-org/ingestion";
import type { PageToEntityMap, WikidataEntity, WikidataClaim } from "@refract-org/ingestion";

const qid = await fetchWikidataId("Douglas_Adams"); // "Q42"
const mapping = await mapPageToEntity("Douglas_Adams"); // { pageTitle, qid, entity }
```

Key exports: `fetchWikidataId`, `fetchWikidataEntity`, `mapPageToEntity`, `mapPagesToEntities`, `wikidataEntityToEvents`

### `@refract-org/analyzers`

Deterministic analyzers for section diffs, citation tracking, text propagation, revert detection, and template analysis. Exported as lowercase singleton instances and pure analysis functions.

```typescript
import {
  sectionDiffer,
  citationTracker,
  analyzeCitationNetwork,
  detectTextPropagation,
  revertDetector,
  templateTracker,
} from "@refract-org/analyzers";
```

**Text propagation**: the Jaccard similarity of two texts' token shingles, and the verbatim token spans they share:

```typescript
const result = detectTextPropagation(sourceDocument, targetDocument, {
  minSpanTokens: 8,
  shingleSize: 5,
});

if (result.isSignificantBorrowing) {
  console.log("Shared tokens:", result.sharedTokenCount);
  console.log("Borrowed spans:", result.borrowedSpans);
}
```

**Citation concentration**: citation counts per domain and per source, and a Herfindahl-Hirschman index over the domain shares:

```typescript
const citations = citationTracker.extractCitations(wikitext);
const network = analyzeCitationNetwork(citations);

console.log("Unique sources:", network.uniqueSourceCount);
console.log("Concentration index:", network.sourceConcentrationIndex);
console.log("Domain breakdown:", network.domainDistribution);
```

The section, citation and template analyzers share a pattern: extract from wikitext, then diff two extractions. The diffs are change records (`SectionChange`, `CitationChange`, `TemplateChange`), not events; `buildRevisionEvents` (0.5.1+) turns a revision history into `EvidenceEvent`s.

The functions that take thresholds, patterns or windows take the matching part of `AnalyzerConfig` as their last argument:

| Function | Options |
|---|---|
| `buildRevisionEvents(revisions, options)` | `similarityThreshold` for sentence matching (default 0.8), `depth`, `protectionLogs`, `revertPatterns`, `sectionRename` |
| `sectionDiffer.diffSections(before, after, options)` | `renameDetection` (`exact` by default, `similarity` or `none`), `similarityThreshold` (default 0.8) |
| `revertDetector.isRevert(comment, options)`, `revertDetector.detectRevertChain(revisions, options)` | `patterns` (`RegExp[]`) |
| `classifyHeuristic(comment, sizeDelta, options)` | `AnalyzerConfig["heuristic"]`: size thresholds, vandalism and sourcing patterns |
| `detectEditClusters(revisions, options)` | `windowMs` (default 1 hour), `minSize` (default 3) |
| `detectTalkActivitySpikes(talkRevisions, articleRevisions, options, referenceTime)` | `AnalyzerConfig["talkSpike"]`: lookback window, spike factor. `referenceTime` ends the lookback window; without it the window ends now |
| `correlateTalkRevisions(articleRevisions, talkRevisions, options)` | `windowBeforeMs` (default 7 days), `windowAfterMs` (default 3 days) |
| `parseTalkThreads(wikitext, options)` | `AnalyzerConfig["talkParser"]` |

`citationTracker.diffCitations` and `templateTracker.diffTemplates` take no options.

```typescript
import { detectEditClusters, revertDetector } from "@refract-org/analyzers";
import type { AnalyzerConfig } from "@refract-org/evidence-graph";

const config: AnalyzerConfig = {
  revert: { patterns: [/\brevert/i, /\brv\b/i] },
  editCluster: { windowMs: 30 * 60 * 1000, minSize: 2 },
};

const isRevert = revertDetector.isRevert("rv unexplained removal", config.revert); // true
const clusters = detectEditClusters(revisions, config.editCluster); // edit_cluster_detected events
```

The events do not record which options produced them. Store the options with the events if you need to reproduce a run.

Key exports:
- **Event pipeline** (0.5.1+): `buildRevisionEvents`, `annotateEvents`, and the per-pair steps `parseContent`, `computeStructuralDiffs`, `detectEditorialSignals`
- Instances: `sectionDiffer`, `citationTracker`, `revertDetector`, `templateTracker`, `protectionTracker`
- Builders: `buildSectionLineage`, `buildSourceLineage`, `buildWikilinkEvents`, `buildPageMoveEvents`, `buildTalkThreadEvents`, `buildCategoryEvents`, `buildParamChangeEvents`
- Classifiers: `classifyHeuristic`
- Parsers: `sanitizeWikitext`, `extractHeadingMap`, `extractWikilinks`, `extractCategories`, `countCitations`, `countKeywordMentions`, `deriveSectionHeading`, `findSectionForText` and `buildSectionCharMap` (0.5.1+)
- Cross-revision: `correlateTalkRevisions`, `diffObservations`, `parseTalkThreads`, `diffTalkThreads`, `diffTemplateParams`, `diffCategories`, `diffWikilinks`
- Clusters & activity: `detectEditClusters`, `detectTalkActivitySpikes`
- **Semantic enrichment** (v0.5.0+): `computeCertaintyProfile`, `computeDirectionSignal`, `computeEditMagnitude`, `computeContentChange`, `extractKeyTerms`, `extractQuantitativeFindings`

### `@refract-org/cli`

The `refract` / `wikihistory` CLI tool (17 commands: analyze, claim, classify, cron, delegation, diff, eval, explore, export, init, mcp, review, snapshot, stream, verify, visualize, watch). See [CLI reference](./cli).

### `@refract-org/persistence`

SQLite storage adapter for revisions and claim records (uses `bun:sqlite`). Not published to npm: import it from a
source checkout, under Bun.

```typescript
import { Persistence } from "@refract-org/persistence";

const db = new Persistence({ dbPath: "refract.db" });
db.insertRevisions(revisions);
const cached = db.getRevisions("Earth", { limit: 50, direction: "older" }); // newest first
const known = db.hasRevision(cached[0].revId);
db.close();
```

Methods: `insertRevision`, `insertRevisions`, `getRevisions`, `hasRevision`, `getLatestTimestamp`, `insertClaim`, `getClaims`, `close`. All are synchronous.

Key exports: `Persistence` (class), `PersistenceAdapter` (interface), `PersistenceConfig`

### Observable Framework data loader

Recipe for embedding Refract queries in [Observable Framework](https://observablehq.com/framework/) dashboards. Copy the loader pattern directly — it is not a published npm package.

```typescript
import { readFileSync } from "node:fs";

export interface RefractLoaderOptions {
  path: string;
  format?: "json" | "sqlite";
}

export class RefractLoader {
  private path: string;
  private format: "json" | "sqlite";

  constructor(options: RefractLoaderOptions) {
    this.path = options.path;
    this.format = options.format ?? (options.path.endsWith(".db") ? "sqlite" : "json");
  }

  async load(): Promise<Record<string, unknown>> {
    if (this.format === "json") {
      const raw = readFileSync(this.path, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    }
    const { Database } = await import("bun:sqlite");
    const db = new Database(this.path, { readonly: true });
    // The tables @refract-org/persistence creates.
    const revisions = db.query("SELECT * FROM revisions").all();
    const claims = db.query("SELECT * FROM claims").all();
    db.close();
    return { revisions, claims };
  }
}

export function refractLoader(options: RefractLoaderOptions): RefractLoader {
  return new RefractLoader(options);
}
```

Usage in Observable:

```js
import { refractLoader } from "./data-loader.ts";
const data = await refractLoader({ path: "./bitcoin-analysis.json" }).load();
```

---

### `@refract-org/eval`

Evaluation harness for measuring analyzer accuracy against ground truth labels.

```typescript
import { createEvalHarness, validateAgainstGroundTruth } from "@refract-org/eval";
```

Key exports: `createEvalHarness`, `validateAgainstGroundTruth`, `EvalHarness`, `GROUND_TRUTH_LABELS`, `getGroundTruthById`, `getGroundTruthForPage`
