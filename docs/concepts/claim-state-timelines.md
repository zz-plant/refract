# Claim-State Timelines

Refract derives observations from available
revision histories. A claim-state timeline organizes those observations around
matched text, within the captured history and the rules used to match it.

The central primitive is the **observed transition, anchored to its source
revisions**. A sentence present today may have appeared recently, returned after
removal, or persisted throughout the observed period. Those trajectories supply
context that the current text alone cannot provide.

## From revisions to observations

Refract starts with externally maintained states and revision traces and derives
an event history:

`available revision history → deterministic observations → queryable event history`

This resembles event sourcing in reverse. The reconstruction is bounded by the
captured inputs and analyzer rules: a diff cannot recover missing intermediate
states, unrecorded actions, or editorial intent. If the analyzed pair skips
revisions, its events describe the difference between the captured states.

Within those limits, the history helps answer:

- When was this wording first observed in the analyzed range?
- Which matched wording changed between captured revisions?
- Which citations appeared, disappeared, or were replaced?
- Did previously observed text return?
- What did a captured revision say at its recorded time?

“First seen” is relative to the analyzed range and matching rules. Citation
presence records a reference in the document; it does not establish that the
referenced source supports the sentence or remains accessible.

## Identity and matching

The current implementation provides deterministic IDs and text-matching rules,
with different behavior in the observation report and the `claim` command:

- **Identity derivation.** `createClaimIdentity` hashes an identity version,
  page title, page ID, section, and lowercased, trimmed text. Changed wording,
  section, or page title can produce a different ID.
- **Observation reports.** Sentence events are grouped by the ID derived from
  their `after` text, or `before` text for a removal, and section. A modification
  does not automatically join the old and new IDs into one semantic lineage.
- **Sentence events.** The analyzer pairs sentences using word overlap (default
  threshold: 0.8). Reintroduction uses previously observed normalized text.
  Fragments of 20 characters or fewer are excluded from sentence matching.
- **The `claim` command.** The ID is derived from the requested text with an empty
  section. The command searches revisions for normalized text or partial word
  matches. Returned variants can include surrounding text or a partial-match
  marker; they are not guaranteed to be equivalent statements.

The `ClaimIdentity`, `ClaimLineage`, and `ClaimState` schemas describe objects
consumers can store. Their presence does not guarantee continuous semantic
identity through arbitrary rewrites, moves, merges, or splits.

Implementation: [identity derivation](../../packages/evidence-graph/src/hash-identity.ts),
[sentence matching](../../packages/analyzers/src/revision-events.ts),
[observation reports](../../packages/cli/src/commands/analyze.ts), and
[claim matching](../../packages/cli/src/commands/claim.ts).

## State labels

State labels summarize rule-based observations. In the observation report,
`sentence_first_seen` maps to `emerging`, `sentence_reintroduced` to
`stabilizing`, `sentence_modified` to `contested`, and `sentence_removed` to
`absent`. The `claim` command applies separate matching and state rules.

A `contested` label alone does not establish an editorial dispute, and
`stabilizing` alone does not establish consensus or uninterrupted persistence.
Consumers should inspect the underlying events, revision coverage, and matching
rules before assigning meaning to a state.

## Reproduction and verification

The same captured revision inputs, supporting metadata, analyzer versions, and
configuration produce the same event observations. Report and export timestamps
can differ between runs.

Replay manifests record input content hashes, analyzer versions, and output event
hashes. Verification bundles add events and Merkle proofs, but omit source
revisions. Bundle verification checks internal hash and proof consistency; it
does not rerun the analyzers, authenticate the source, or establish complete
history coverage. Independent reconstruction requires retaining the inputs and
recording the configuration separately. See [replay and verification](../../ARCHITECTURE.md#replay-and-verification).

## Relationship to downstream systems

Refract provides observations. Downstream systems decide their significance.

- **NextConsensus** interprets observations within its own decision context.
- **Review systems** compare captured wording and citations with their own
  review criteria.
- **Research tools** study patterns of detected changes across revisions.
- **Knowledge graph pipelines** ingest events and apply their own entity and
  claim-linking rules.

## Retrieval and history

Search can retrieve text from the current record or an archive. Answering how
that text changed requires versioned inputs and a way to compare them. Refract
supplies that comparison as revision-linked observations that a retrieval system
can use alongside the text.

## See also

- [Repository boundary](../repository-boundary.md) — what Refract does and does not do
- [Refract and NextConsensus](../refract-and-nextconsensus.md) — how the two systems fit together
- [Install](../../README.md#install) — get started with `refract analyze`
