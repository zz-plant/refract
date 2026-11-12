# Architecture: Two-Knowledge-Split Design

Refract is a git log for Wikipedia and other MediaWiki wikis. It derives
structured, provenance-tagged observations from
available revision histories. The observation pipeline uses deterministic rules
and makes no model calls; downstream applications interpret the observations.

The central primitive is the observed transition, anchored to its source
revisions. Refract starts with externally maintained states and revision traces
and derives an event history that consumers can query and inspect.

This architecture lives in the **refract** repository (open-source, generic
public-knowledge observability). Healthcare-specific logic lives in private
repos, which consume this engine's output without modifying it.

Refract separates computation into two architecturally isolated layers. No
layer's output feeds into another layer's input in a way that would contaminate
evidence with interpretation.

## Deterministic Layer

**What it answers**: What changes were detected, when, where, and how, within the captured history.

**Implementation**: Wikipedia API fetch, diff computation, section extraction,
citation counting, revert detection, template tracking, pagination. No model
involved. The same captured revision inputs, supporting metadata, analyzer
versions, and configuration produce the same event observations. Generated
report and export timestamps can differ between runs.

**Output**: Evidence objects with `deterministicFacts` arrays.

**Why it matters on fandom wikis**: A Star Wars Legends page that had
`[[Category:Canon characters]]` removed and `[[Category:Legends characters]]`
added after the 2014 Disney acquisition. Refract represents the detected category
changes as `category_removed`/`category_added` events linked to the revision pair.
Their significance for canon is a downstream judgment.


### Semantic Enrichment (v0.5.0+)

Every `EvidenceEvent` now carries 6 deterministic enrichment fields computed from
the `before`/`after` text during the analyze pipeline. These are **not model outputs** —
they are deterministic text analysis, reproducible with the same inputs and parameters.

| Field | What it captures |
|-------|-----------------|
| `editMagnitude` | Character count thresholds (minor/moderate/major) |
| `contentChange` | Nature of the text change (introduction/removal/expansion/compression/refinement/rewrite) |
| `keyTerms` | Extracted significant terms from the edited text |
| `certaintyProfile` | Counts of certainty/hedging markers (high/medium/low/hedging) |
| `directionSignal` | Computed from certainty shift between before/after (strengthening/weakening/neutral) |
| `quantitativeFindings` | Extracted numbers (p-values, hazard ratios, n-values, confidence intervals) |

See `packages/analyzers/src/semantic-enrichment.ts` for the implementation.

Domain-specific classification (e.g., "is this edit about safety or efficacy?") belongs in
downstream consumers. Refract provides the deterministic substrate; applications add the interpretation.

## Independent Ground Truth Layer

**What it answers**: Did real-world editorial processes validate the signal?

**Implementation**: Independently sourced ground truth — talk page consensus, page protection events, RFC closures, Arbitration Committee decisions. Never redefined by observed or policy-coded layers. Stored separately from pipeline output.

**Output**: Outcome labels with public observability timestamps and source references.

**Why it matters on fandom wikis**: Fan wiki talk pages are where canon disputes
get resolved — not by authority, but by editorial consensus with timestamps and
public permalinks. A 2015 talk page consensus that "Clone Wars TV series is
canon, novelizations are secondary" might be overturned in 2024 by a new consensus
citing a different set of source policies. Refract captures both outcomes independently,
with temporal validity windows. The pipeline doesn't decide canon — it reports
that the editorial community reached a specific consensus at a specific time.
On Wikipedia the ground truth is RFC closures and ArbCom decisions; on fandom
wikis it's talk-page-archived consensus with revision links to the exact edit
that implemented the decision.

![Architecture Data Flow](https://zz-plant.github.io/refract/architecture-flow.svg)

## Data Flow (Text)

```
Wikipedia API
     │
     ▼
┌─────────────┐
│  Fetch       │ ← Deterministic: revisions, diffs, sections, citations
│  + Extract   │
└──────┬──────┘
       │ evidence objects
       ▼
┌─────────────┐
│  Analyze     │ ← Deterministic: section diffs, citation tracking, reverts,
│              │    templates, categories, wikilinks
└──────┬──────┘
       │ enriched evidence
       ▼
┌─────────────┐
│  Report      │ ← Assembles evidence into layered output
│  Assembly    │
└──────┬──────┘
       │ report
       ▼
┌─────────────┐
│  Validate    │ ← Independent: compares report against ground truth labels
│  + Measure   │    (eval package)
└─────────────┘
```

## Report Layers

Every user-facing output carries layer provenance:

| Label | Source | Reproducible? |
|-------|--------|---------------|
| **Observed** | Deterministic extraction rules | Yes, with the same captured inputs, versions, and configuration |
| **Policy-coded** | Deterministic + Wikipedia policy ontology | Yes, rules-based |

## Invariants

1. Deterministic pipeline never calls a model
2. Every event is provenance-tagged (revision, section, timestamp)
3. Event observations are reproducible from the same captured inputs, analyzer versions, and configuration

## Reconstruction Limits

The event stream describes changes detected in the captured revisions. It cannot
recover missing intermediate states, unrecorded actions, or editorial intent.
“First seen” means first observed within the analyzed range and matching rules.

Claim identities hash text together with page and section context. Sentence
matching associates wording by word overlap; the `claim` command uses its own
text-matching rules. Changes to wording or placement can produce different IDs,
and the lineage schemas do not guarantee continuous semantic identity through
arbitrary rewrites. State labels are rule-based summaries: for example, the
observation report maps `sentence_modified` to `contested`, which alone does not
establish that editors disputed the statement.

See [claim-state timelines](./docs/concepts/claim-state-timelines.md) for the
current identity and matching behavior.

## Replay and Verification

A replay manifest records input revision content hashes, analyzer versions,
output event hashes, a Merkle root, and a manifest hash. A verification bundle
contains the manifest, events, and proofs; it does not contain the source
revisions. `refract verify` checks manifest integrity, event identity hashes,
and proof consistency against the listed root. Event hashes cover the fields
used by `createEventIdentity`, rather than every field in the event envelope.

These checks establish internal consistency. They do not authenticate the
external source, establish complete history coverage, or rerun the analyzers.
Independent reconstruction requires retaining the revision inputs and any
supporting metadata, recording configuration, and running the same analyzer
versions. The manifest is not a complete capture of that execution environment.
Run timestamps such as `generatedAt`, `exportedAt`, and `observedAt` can differ
even when event observations match.

Implementation: [identity derivation](./packages/evidence-graph/src/hash-identity.ts)
and [replay manifests and bundle verification](./packages/evidence-graph/src/replay-manifest.ts).

## Consuming Deterministic Output

Refract's deterministic event stream is consumed by domain-specific interpretation
layers in downstream systems (e.g., NextConsensus). Those systems must:
- Never modify Refract's event types or schemas (consume, don't fork)
- Attribute provenance: "deterministic observation from Refract" vs. their own
  model-assisted interpretation
