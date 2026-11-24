---
title: "Temporal Model"
description: "Refract is designed around time — not just \"what is the latest version?\" but \"how did this claim change across revisions?\""
---

Refract is designed around time — not just "what is the latest version?" but
"how did this claim change across revisions?"

## Why temporal infrastructure

Most document tools answer from the present corpus. Refract answers across
time:

- **Rewind**: What did this claim say two years ago?
- **Replay**: How did this claim drift across revisions?
- **Compare**: What changed between the 2024 and 2025 guideline versions?
- **Audit**: What was supportable at the time of a specific decision?
- **Forecast**: What would trigger re-review?

A vector database can find similar claims. It cannot do any of the above.
Refract fills that gap with deterministic, provenance-backed temporal
infrastructure.

## Claim-state events

Refract emits structured events that capture how claims change over time:

| Event | Meaning |
|-------|---------|
| `sentence_first_seen` | Claim appeared in the source for the first time |
| `sentence_modified` | Claim wording changed (with edit magnitude) |
| `sentence_removed` | Claim removed from the source |
| `citation_added` | New supporting citation attached |
| `citation_removed` | Citation removed or superseded |
| `revert_detected` | Edit summary matches a revert pattern, or the text restores an earlier revision's |

Each event carries deterministic enrichment fields:
- `editMagnitude` — minor / moderate / major
- `contentChange` — introduction / removal / expansion / compression / refinement / rewrite
- `directionSignal` — strengthening / weakening / neutral
- `certaintyProfile` — counts of hedging and certainty markers
- `quantitativeFindings` — extracted p-values, hazard ratios, and sample sizes

All fields are byte-reproducible. Same source, same events, every time.

## Claim trajectories

`refract claim` (`--json`) and the MCP `get_statement_history` tool return a
passage's `transitions`: each change in whether, or how, it appears —
`first_seen`, `text_changed`, `removed`, `reintroduced` — with the evidence a
consumer needs to weigh it:

| Field | Meaning |
|---|---|
| `previousRevisionId`, `revisionId` | The change lies after the first and at or before the second. Absent `previousRevisionId` means the first revision read, so a passage first seen there may be older |
| `adjacent` | The two are parent and child. When false, revisions not read lie between them and the change is in one of them |
| `before`, `after` | Matched text either side; empty when the passage was absent |
| `editSummary`, `revertSummary` | The edit summary, and whether it matches a default revert pattern |
| `restoresRevisionId` | The revision's text is identical to this earlier one: an identity revert |
| `heldRevisions`, `endedByRevisionId`, `endedAt` | How many revisions read the resulting state lasted, and the next transition that ended it; both end fields are absent when it held through the latest revision read |
| `nearest` | On a removal, the remaining sentence carrying at least half of the passage's words, with that share. Below the matching threshold; shown so a rewrite is not taken for a deletion unseen |
| `located` | With `refract claim --locate`, on a transition whose revisions are not adjacent: the edit inside the bracket that made the change (`revisionId`, `timestamp`), the surviving revision before it (`previousRevisionId`), and the batched reads it took (`requests`) |

`--locate` searches the revisions between the two that bracket a change, with
reverted states removed, for the first that holds the new state: for a
rewording, the new version's text, not merely the end of the old one. Tested
the other way, a search lands on intermediate drafts that match neither. It
assumes the passage changed once inside the bracket; if it came and went, the
edit found is one that brought it, not necessarily the first.

These are observations. Whether a state that held for N revisions counts as
settled, or a removal is a correction, is a downstream reading.

Wikidata statements have their own history in `@refract-org/ingestion`:
`wikidataStatementHistory` reads revisions of an entity's page and reports each
statement added, removed or changed (value, rank, qualifiers, references),
matched by Wikidata's statement ID. Qualifiers such as start time (P580) and end
time (P582) are dates the entity records, with their precision; when a
statement was edited is the revision that changed it. Refract reports both and
compares neither.

## Downstream use

Refract provides the timeline. Downstream systems provide the judgment.

[NextConsensus](https://nextconsensus.com), which maintains Refract, reads
these timelines as one input to its own work on how claims move across
institutions; what it concludes from them is its judgment, made downstream and
described on its own site. Refract itself remains domain-neutral — it works on
any versioned text source.

## See also

- [Events](./events.md) — full event type reference
- [Schema](./schema.md) — data model
- [Why Refract](./why-refract.md) — the problem Refract solves
