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

**Multi-year longitudinal ingestion (fast metadata scan + SHA-1 deduplicated hydration)**:

For high-traffic articles with thousands of revisions across multiple years, `fetchLongitudinalHistory` scans 100% of revision metadata at 500 revisions/request (`fetchRevisionMetadata`), computes full-history monthly velocity, summary/SHA-1 reverts, and pseudonymous revert pairs (`computeFullHistoryTelemetry`), selects stratified monthly checkpoints, or with `timeCoverage` checkpoints evenly spaced in time, plus the largest structural deltas (`selectLongitudinalRevisions`), leaving out states a later edit reverted within 48 hours (`findRevertedStates`; `excludeRevertedStates: false` keeps them), and hydrates their wikitext in parallel `revids=` batches with SHA-1 deduplication (`fetchRevisionsByIds`):

```typescript
import { MediaWikiClient } from "@refract-org/ingestion";

const client = new MediaWikiClient({ apiUrl: "https://en.wikipedia.org/w/api.php" });
const history = await client.fetchLongitudinalHistory("Climate change", {
  start: new Date("2023-01-01T00:00:00Z"),
  maxContentRevisions: 60,
  concurrency: 3,
});

console.log("Total revisions scanned:", history.telemetry.totalRevisions);
console.log("Summary / SHA-1 reverts:", history.telemetry.summaryReverts, history.telemetry.sha1IdentityReverts);
console.log("Hydrated checkpoints:", history.revisions.length);
if (history.coverage.truncated) console.warn("Metadata scan stopped at maxMetadataRevisions");
```

The metadata scan reads the whole history in the window unless
`maxMetadataRevisions` is set; with a limit, `coverage.truncated` says whether
revisions were left out, and `direction` decides which end was kept
(`"older"`, the default, keeps the newest). Hydration keeps at most 3 requests
in flight by default, the limit Wikimedia asks API clients to keep to.
`coverage.revertedStatesExcluded` counts the revisions left out of the sample
as reverted states; telemetry is computed from every metadata row either way.

`findRevertedStates(metadata, { windowHours, nearRestorations })` finds a
reverted state two ways. A later revision whose `sha1` matches an earlier one
restored that text, and the revisions between were reverted. A size change of
30% or more from a surviving state, followed within the window by a revision
within 1% of the size before it, is damage repaired by hand, which no `sha1`
matches. The second rule also counts a large edit undone by hand and then
redone, and ordinary edits that end the window within 1% of where a large
change began; `excludeRevertedStates: { nearRestorations: false }` keeps the
exact rule alone.

`timeCoverage` (0 to 1) spends that share of `maxContentRevisions` on
checkpoints evenly spaced in time, each the revision live then, and the rest on
the largest structural changes. Without it, once a page has more months than
the sample has anchors, the anchors are spaced by position in the history, so
busy years take most of them: at 60 revisions, 10 of Anarchism's 26 years get
none. With `timeCoverage: 0.75`, every year gets at least one.

`yearlyPressure` counts, per calendar year (UTC), the page's edits and how many
were reverted states, talk-page edits, and protections:

```typescript
import { yearlyPressure } from "@refract-org/ingestion";

const talk = await client.fetchRevisionMetadata("Talk:Anarchism");
const protections = await client.fetchProtectionLogs("Anarchism");
const years = yearlyPressure(history.metadata, {
  talkTimestamps: talk.map((m) => m.timestamp),
  protections,
});
// [{ year: 2005, edits, revertedEdits, revertedShare, talkEdits, protections, contentDisputeProtections }, …]
```

Every year from the first to the last any input touches has a row, with zeros
in quiet years; `revertedShare` is null in a year without edits. `protections`
counts entries that set or changed protection, not unprotections. Pass
`revertedStates` to count reverted states found another way.

`fetchProtectionLogs` entries carry `level` (`semi`, `extended`, `full` or
`template`), the edit protection the entry set, read from its details or, in
entries logged before about 2015, from the `[edit=…]` list in its description
or comment; and `reasonCategory`, the kind of reason the administrator wrote.
Both are categories of the log's text; see [protection events](events.md#access-control).

**Lookups through the client's retries and rate limit**:

- `resolveTitle(title)` follows redirects to `{ pageId, title, ns }`, or null for a missing page, an invalid title, or a special page.
- `fetchSections(revIds, section)` reads one section of each revision (0 is the lead), 50 revisions a request, into a `Map` from revision ID to its text. A revision without the section has no entry.
- `revisionAt(title, isoDateTime, { around = 10 })` returns the revision live at that moment, the last made at or before it, with up to `around` revisions either side, each with `sha1` and size, so `findRevertedStates` can say whether the live one was soon undone.

Key exports: `MediaWikiClient` (class), `RevisionFetcher` (interface), `AuthConfig`, `computeFullHistoryTelemetry`, `selectLongitudinalRevisions`, `findRevertedStates`, `yearlyPressure`, `LongitudinalHistoryOptions`, `LongitudinalHistoryResult`, `LongitudinalCoverage`, `SelectLongitudinalOptions`, `RevertedStateOptions`, `FullHistoryTelemetry`, `YearlyPressure`, `RevisionMetadata`, `ResolvedTitle`, `RevisionAtResult`, `ProtectionLogEvent`, `ProtectionLevel`, `ProtectionReasonCategory`

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
  classifyCitationSource,
  extractCitationIdentifiers,
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

**Citation concentration, source tiers, and cross-language identifiers**: citation counts per domain, structural source-type breakdown (`academic`, `intergovernmental`, `ngo`, `government`, `news`), shared `DOI`/`ISBN` identifiers across language editions, and a Herfindahl-Hirschman index over the domain shares:

```typescript
const citations = citationTracker.extractCitations(wikitext);
const network = analyzeCitationNetwork(citations);

console.log("Unique sources:", network.uniqueSourceCount);
console.log("Concentration index:", network.sourceConcentrationIndex);
console.log("Source tiers:", network.sourceTypeDistribution);
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

**Passage histories and snapshots without the CLI.** `claimHistory` and `snapshotAt` do what `refract claim` and `refract snapshot` do, with the fetching left to the caller, so they run in a Worker. `snapshotAt` takes two functions: `revisionsAround(title, isoDateTime, { around })`, the revision metadata (with `sha1`) on either side of the moment, which `revisionAt` returns in three parts, and `fetchContent(revId, { section })`. `locateChange` takes a batch fetcher, `(revIds) => Map<revId, text>`.

```typescript
import { MediaWikiClient } from "@refract-org/ingestion";
import { claimHistory, snapshotAt } from "@refract-org/analyzers";

const client = new MediaWikiClient();
const history = claimHistory(await client.fetchRevisions("Recession", { limit: 50 }), "two consecutive quarters");

const snapshot = await snapshotAt(
  {
    revisionsAround: async (title, at, { around }) => {
      const { before, revision, after } = await client.revisionAt(title, at, { around });
      return [...before, ...(revision ? [revision] : []), ...after];
    },
    // The lead alone when snapshotAt asks for section 0, the whole page otherwise.
    fetchContent: async (revId, { section }) =>
      section === undefined
        ? ((await client.fetchRevisionsByIds([revId]))[0]?.content ?? null)
        : ((await client.fetchSections([revId], section)).get(revId) ?? null),
  },
  "Recession",
  "2022-07-29",
  { scope: "lead" },
);
```

`locateChange` reads leads through `fetchSections` as it is: `(ids) => client.fetchSections(ids, 0)`.

Key exports:
- **Event pipeline** (0.5.1+): `buildRevisionEvents`, `annotateEvents`, and the per-pair steps `parseContent`, `computeStructuralDiffs`, `detectEditorialSignals`
- Instances: `sectionDiffer`, `citationTracker`, `revertDetector`, `templateTracker`, `protectionTracker`
- Builders: `buildSectionLineage`, `buildSourceLineage`, `buildWikilinkEvents`, `buildPageMoveEvents`, `pageMovesFromEditSummaries`, `mergePageMoves`, `buildTalkThreadEvents`, `buildCategoryEvents`, `buildParamChangeEvents`
- Classifiers: `classifyHeuristic`
- Privacy: `redactEditorIdentity` (removes editor names from summary text)
- Parsers: `sanitizeWikitext`, `extractHeadingMap`, `extractWikilinks`, `extractCategories`, `countCitations`, `countCitationsByKind`, `matchShortFootnotes`, `countKeywordMentions`, `deriveSectionHeading`, `findSectionForText` and `buildSectionCharMap` (0.5.1+); `stripWikitext`, `stripWikitextSections`, `stripLead`, `stripSection`
- **Passage histories and dates**: `claimHistory(revisions, text, { page })` (what `refract claim` and `get_statement_history` report), `findPassageMatch`, `nearestPassage`; `locateChange(candidates, isNew, fetchLeads, { k })` and `locateTransitions` (the edit inside a bracket that made a change); `snapshotAt(fetchers, title, date, { scope, section, excludeRevertedStates })` (what `refract snapshot` reports)
- **Wording**: `sameWording`, `contentWords`, `definitionalSentence(wikitext, title, { lang })`, `definitionHead(sentence, { lang })`, `DEFINITION_COPULAS` (en, de, es, fr)
- Cross-revision: `correlateTalkRevisions`, `diffObservations`, `parseTalkThreads`, `diffTalkThreads`, `diffTemplateParams`, `diffCategories`, `diffWikilinks`
- Clusters & activity: `detectEditClusters`, `detectTalkActivitySpikes`
- **Semantic enrichment** (v0.5.0+): `computeCertaintyProfile`, `computeDirectionSignal`, `computeEditMagnitude`, `computeContentChange`, `extractKeyTerms`, `extractQuantitativeFindings`

### `@refract-org/cli`

The `refract` / `wikihistory` CLI tool (20 commands: analyze, claim, classify, cron, delegation, diff, drift, eval, explore, export, field, init, linksearch, mcp, review, snapshot, stream, verify, visualize, watch). See [CLI reference](./cli).

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
