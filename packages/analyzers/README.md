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

- `sanitizeWikitext`, `extractHeadingMap`, `deriveSectionHeading`, `countCitations`, `countCitationsByKind`, `matchShortFootnotes`, `countKeywordMentions`, `extractAnchorSnippet` — wikitext parsing helpers
- `findSectionForText`, `buildSectionCharMap` — which section a sentence sits in
- `stripWikitext`, `stripWikitextSections`, `stripLead`, `stripSection(wikitext, heading)` — a page's prose, whole, section by section, its lead, or one section with its subsections
- `contentWords`, `sameWording(a, b, { lang, threshold })` — a symmetric wording test: each phrase shares at least 80% of its content words with the other
- `definitionalSentence(wikitext, title, { lang })`, `definitionHead(sentence, { lang })`, `DEFINITION_COPULAS` — the lead sentence that defines the subject, and the dozen words after its copula, in English, German, Spanish and French

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

### Passage histories, dates and snapshots

The functions behind `refract claim` and `refract snapshot`, with no I/O: each takes revisions, or the functions that fetch them, so a Worker can call it with its own requests.

- `claimHistory(revisions, text, { page })` — a passage followed across revisions: where it matches in each, its `transitions` (`first_seen`, `text_changed`, `removed`, `reintroduced`) with the revisions either side, and a status. `findPassageMatch` and `nearestPassage` are its matching steps.
- `locateChange(candidates, isNew, fetchLeads, { k = 8 })` — the first of the revision IDs between two samples for which `isNew` holds, reading `k` per round through `fetchLeads(revIds)`. Assumes one change in the bracket; remove reverted states from `candidates` first. `locateTransitions(result, { between, fetchTexts })` narrows a passage history's non-adjacent transitions with it.
- `snapshotAt({ revisionsAround, fetchContent }, title, date, { scope, section, excludeRevertedStates, around })` — the latest revision at or before the end of `date`, stepping back past a reverted state found from the neighbours' `sha1`, with the lead, one section or the whole page as text. Returns the revision, its timestamp, any revisions skipped, and the text; null when none existed yet.

```ts
import { definitionalSentence, definitionHead, snapshotAt } from "@refract-org/analyzers";

const snapshot = await snapshotAt(
  {
    revisionsAround: (title, at, { around }) => myRevisionsAround(title, at, around), // metadata with sha1
    fetchContent: (revId) => myWikitext(revId),
  },
  "Pluto",
  "2015-07-15",
  { scope: "lead" },
);
const sentence = snapshot?.wikitext && definitionalSentence(snapshot.wikitext, "Pluto");
const head = sentence && definitionHead(sentence); // compare heads across dates with sameWording
```

For everything `refract analyze` prints, add `buildPageMoveEvents(windowPageMoves(...))` before and `correlateTalkRevisions(revisions, talkRevisions)` after `buildRevisionEvents`, then annotate all of them together.

[Refract](https://github.com/refract-org/refract) · [Docs](https://zz-plant.github.io/refract/) · [npm](https://www.npmjs.com/package/@refract-org/analyzers)
