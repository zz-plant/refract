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
| `revert` | Edit was reverted (with cluster information) |

Each event carries deterministic enrichment fields:
- `editMagnitude` — minor / moderate / major
- `contentChange` — introduction / removal / expansion / compression / rewrite
- `directionSignal` — strengthening / weakening / neutral
- `certaintyProfile` — counts of hedging and certainty markers
- `quantitativeFindings` — extracted p-values, hazard ratios, and sample sizes

All fields are byte-reproducible. Same source, same events, every time.

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
