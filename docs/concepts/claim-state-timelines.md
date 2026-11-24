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
  marker; they are not guaranteed to be equivalent statements. The matching
  and its state machine are `claimHistory(revisions, text, options)` in
  `@refract-org/analyzers`, which reads no network and no filesystem, so a
  Worker can follow a passage through revisions it fetched itself.

The `ClaimIdentity`, `ClaimLineage`, and `ClaimState` schemas describe objects
consumers can store. Their presence does not guarantee continuous semantic
identity through arbitrary rewrites, moves, merges, or splits.

Implementation: [identity derivation](../../packages/evidence-graph/src/hash-identity.ts),
[sentence matching](../../packages/analyzers/src/revision-events.ts),
[observation reports](../../packages/cli/src/commands/analyze.ts), and
[claim matching](../../packages/analyzers/src/claim-history.ts).

## State labels

State labels summarize rule-based observations. In the observation report,
`sentence_first_seen` maps to `emerging`, `sentence_reintroduced` to
`stabilizing`, `sentence_modified` to `contested`, and `sentence_removed` to
`absent`. The `claim` command applies separate matching and state rules.

A `contested` label alone does not establish an editorial dispute, and
`stabilizing` alone does not establish consensus or uninterrupted persistence.
Consumers should inspect the underlying events, revision coverage, and matching
rules before assigning meaning to a state.

## Transitions

`claimHistory` in `@refract-org/analyzers`, `refract claim --json` and the MCP
`get_statement_history` tool return `transitions`, oldest first: one per change in whether, or how, the
tracked passage appears in the revisions read. Each is an observation with its
evidence; none is a judgment about the passage.

- **`kind`**: `first_seen`, `text_changed`, `removed` or `reintroduced`.
- **Where it lies.** The change happened after `previousRevisionId` and at or
  before `revisionId`. `adjacent` is true when the first is the second's
  parent; when it is false, revisions that were not read lie between them, and
  the change is in one of them. A `first_seen` with no `previousRevisionId` is
  on the first revision read, so the passage may be older than the range.
- **`before` / `after`**: the matched text either side, empty when absent.
- **Revert evidence**: `editSummary`; `revertSummary`, true when the summary
  matches a default revert pattern; and `restoresRevisionId`, when the
  revision's text is byte-identical to an earlier revision read other than its
  predecessor (the same rule as `identity_revert`).
- **How long it held**: `heldRevisions` counts the revisions read, with text,
  in which the resulting state lasted, this one included; `endedByRevisionId`
  and `endedAt` name the next transition. Both are absent when the state held
  through the latest revision read.
- **`nearest`**, on a removal: the sentence left in the revision that carries
  the largest share, at least half, of the passage's words longer than three
  characters, and that share. It is below the matching threshold by
  construction. It exists so that a rewrite such as "is" becoming "was" is not
  read as a deletion without a look; it does not establish that the two say the
  same thing.

Revisions whose text was withheld are skipped, so they neither start nor end a
transition and make the pair around them non-adjacent.

## Locating the edit

A sampled history, such as `refract claim --sample 120`, brackets each change
between two revisions it read, and the change can be in any revision between
them. `locateChange(candidates, isNew, fetchLeads, { k = 8 })` in
`@refract-org/analyzers` finds the edit: given the revision IDs between the
two, oldest first and with reverted states removed (`findRevertedStates` finds
them from `sha1`), it reads `k` evenly spaced candidates per round through the
injected batch fetcher, narrows the range (k+1)-fold, and returns the first
candidate for which `isNew` holds. Three hundred candidates take three reads.
The fetcher is passed in, so the library makes no request of its own.

It assumes the change happened once inside the bracket. If the wording came
and went in between, the search lands on an edit that brought it, not
necessarily the first; a reverted state left among the candidates breaks the
assumption the same way.

Test for the new version. Dating definitions on ism.wiki, two other tests
both landed on intermediate drafts whose text matched neither version: "when
the old wording ended" and "closer to the new wording than the old". Asking
whether a candidate has the new version's wording finds the edit whose text the
dated version quotes. `sameWording(a, b)` is a symmetric test for that: each
phrase shares at least 80% of its content words with the other. A one-sided
test reads "is a planet" as matching "is a dwarf planet".

`locateTransitions(result, locator)` applies this to a passage history: each
transition whose revisions are not adjacent gains `located`, the edit that made
it and the surviving revision before it. A candidate holds the new state when
the passage matches (`first_seen`, `reintroduced`), does not (`removed`), or
matches with the transition's `after` text (`text_changed`). `refract claim
--locate` supplies the reads from the wiki.

## Definitional sentences

`definitionalSentence(wikitext, title, { lang })` returns the sentence of a
lead that defines its subject: the first sentence of the lead's prose that names
the subject before its copula, which "Anarchism is a political philosophy …"
does and "There are many types and traditions of anarchism" does not.
`definitionHead(sentence, { lang })` returns the dozen words after the copula,
the phrase to compare across revisions with `sameWording`. Copula lists cover
English, German, Spanish and French (`DEFINITION_COPULAS`; `copulas` takes a
list for another edition). The subject may come after an article or opening
phrase ("L'anarchisme … est", "Unter dem Begriff Konjunktur versteht man"),
and outside English it may follow the verb by a few words, as German word order
and naming verbs such as "se denomina" place it. The sentence is read from the
lead as `stripLead` strips it, the text sentence events see.

## What a page said on a date

`snapshotAt({ revisionsAround, fetchContent }, title, date, options)` reports
the latest revision at or before the end of a date, stepping back past a state
a later edit reverted (found from the `sha1` of the revisions around it), with
the lead, one section or the whole page as prose. It names any revision it
skipped and the one that restored the text. A section is found by its heading
in that revision, so a heading renamed later is found under its name then.
`refract snapshot` is built on it.

## Structured statements

`@refract-org/ingestion` reads Wikidata statements with their identity and
qualifiers: `parseWikidataEntity` gives each statement's ID (Wikidata's GUID,
stable across edits to the statement), property, rank, value, qualifiers and
reference count; time values keep their precision. `fetchWikidataEntity(qid,
{ revisionId })` reads an entity as it stood at a revision.

`wikidataStatementHistory(qid, revisions)` takes revisions of the entity's page,
as `MediaWikiClient` fetches them from `https://www.wikidata.org/w/api.php` with
the QID as the title, and reports the statements at the earliest revision and
each statement added, removed or changed after it (`value`, `rank`,
`qualifiers`, `references`), placed between the revisions it lies between as
sentence transitions are. `diffWikidataStatements` compares any two states.

A qualifier such as start time (P580) or end time (P582) is a date the entity
records; the revision that added it is when it was recorded. Refract reports
both and compares neither: what the interval between them means is a
downstream question. See [repository boundary](../repository-boundary.md).

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
