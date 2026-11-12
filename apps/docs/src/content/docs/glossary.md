---
title: "Glossary"
---

**Claim** — A distinct statement of fact within an article, identified by its text content. Claims are tracked across revisions via `createClaimIdentity` in `@refract-org/evidence-graph`. Not to be confused with "claim" in a legal or insurance context.

**BYO-inference boundary** — A point in the pipeline where a heuristic (e.g., regex revert detection, word-overlap threshold) can be replaced by a model call. Each boundary is a typed function signature with a mechanical default. When a model is plugged in, the event's `FactProvenance.parameters` records which path was taken. This is the architectural spine: Refract stays mechanical, but the points where judgment enters are explicit, typed, and auditable.

**Deterministic fact** — A structured statement produced by an analyzer explaining why an event was emitted. Each fact has a `fact` name and a `detail` string. The schema also allows a `provenance` object (analyzer name, version, input hashes, parameters); events from `refract analyze` and `refract export` do not carry it.

**Deterministic observation engine** — Refract's core design: given the same revision range, the same events are always produced. No model, no randomness, no variance.

**Downstream consumer** — A system that consumes Refract's event stream without modifying it, to attach domain-specific interpretation. Examples include healthcare claim review (NextConsensus), AI training data curation pipelines, provenance-aware RAG systems, regulatory/policy change monitors, competitive intelligence platforms, fact-checking tools, academic research on knowledge dynamics, journalism forensics tooling, and fan wiki canon tracking.

**Edit cluster** — A group of 3+ edits within a configurable time window, reported as an `edit_cluster_detected` event by `refract analyze` and by the library function `detectEditClusters()`. High cluster activity signals concentrated contestation — the same claim being edited repeatedly by one or more editors. Window size and minimum group size are configurable via `AnalyzerConfig`.

**Event** — A unit of change between two revisions. Every event has an `eventType`, revision range (`fromRevisionId` → `toRevisionId`), section context, before/after snapshots, and deterministic facts. See [schema](schema.md).

**Evidence layer** — A classification of how an event was produced: `observed` (directly from diff), `policy_coded` (matched against a rule), `model_interpretation` (set by downstream), `speculative` (inferred), or `unknown`.

**Ground truth** — Independently verified outcome labels (talk page consensus, RFC closures, ArbCom decisions) stored in the `@refract-org/eval` package. Used to validate pipeline output, never redefined by it.

**L1 / L2** — Legacy terminology for Refract's two architectural layers: deterministic analysis (formerly L1 — what changed, byte-for-byte reproducible) and independent ground truth (formerly L2 — talk page consensus, RFC closures, ArbCom decisions). The preferred terms are "deterministic" and "ground truth."

**MediaWiki** — The open-source wiki engine used by Wikipedia, Fandom, and thousands of other wikis. Refract works with any MediaWiki instance that exposes an `api.php` endpoint.

**ObservationReport** — A structured aggregate produced by the pipeline that groups events by claim, with a `ClaimLedger` tracking each claim's lifecycle (first seen, removed, modified, reintroduced) across revision history. Output via `--report` flag.

**`sentence_modified`** — An event type emitted when sentence text changes but remains above the similarity threshold (word-overlap ratio, default 0.8). Captures rewording, minor edits, and phrasing changes without treating the sentence as removed-and-reintroduced.

**Provenance** — Optional metadata on a deterministic fact (`FactProvenance`) recording which analyzer produced it, what version, and which input data was used. The CLI leaves it unset; revision IDs, section and timestamp on each event identify its source.

**Revision** — A single version of a page. Revisions are identified by numeric IDs and ordered by timestamp.

**Revision range** — A contiguous span of revisions between a `fromRevisionId` and `toRevisionId`. Refract diffs adjacent revisions within the range to produce events.
