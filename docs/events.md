# Event taxonomy

Each Refract event represents an observed transition anchored to source revisions.
The same captured revision inputs, supporting metadata, analyzer versions, and
configuration produce the same event observations. Generated export timestamps
can differ between runs. Coverage is limited to the captured history and the
changes recognized by the analyzer rules.

## Sentence changes

| Event type | Trigger | Example |
|---|---|---|
| `sentence_first_seen` | Sentence has no match above the overlap threshold and has not been seen in the analyzed range | Wording about a company is first observed in the captured history |
| `sentence_removed` | Prior sentence has no match above the overlap threshold | Wording disappears or is rewritten beyond the matching threshold |
| `sentence_modified` | Matched sentence wording differs under the comparison rules | A sentence is reworded with enough word overlap to match |
| `sentence_reintroduced` | Previously observed normalized sentence text returns without a current match above the overlap threshold | Wording from an earlier captured revision returns |

Sentence matching uses word overlap (default threshold: 0.8) and filters out
sentence fragments of 20 characters or fewer. These events do not establish a
continuous semantic claim identity. See [claim-state timelines](./concepts/claim-state-timelines.md).

## Citation changes

| Event type | Trigger |
|---|---|
| `citation_added` | New `<ref>` tag, or new shortened-footnote template (`{{sfn}}`, `{{sfnp}}`, `{{sfnm}}`, `{{harvnb}}`, `{{harvtxt}}` and the rest of the sfn and harv families) outside a `<ref>`, added |
| `citation_removed` | Existing `<ref>` tag or shortened-footnote template removed |
| `citation_replaced` | One citation swapped for another in the same position |

A shortened footnote is matched between revisions by its whole text, as an
unnamed `<ref>` is, so changing its page number reads as one removed and one
added. One inside a `<ref>` is that reference's text and is not a second
citation. A bibliography's `{{cite book}}` entries outside any reference are
the sources the footnotes point to, not citations, and produce no citation
events. `countCitations` counts the same way: on 2026-11-24 Anarchism's
latest revision had 14 `<ref>` tags and 210 shortened footnotes.

Citation events carry facts about the source and the passage it supports:

- **`citation_source`**, on all three when the reference names a URL:
  `domain=<host> url=<url>`. The URL is the `url=` parameter, or else the first
  bare http(s) URL in the reference.
- **`citation_anchor`**, on all three except at `brief` depth: a passage the
  reference follows, from the start of its sentence up to the reference, in the
  later revision for an added or replaced reference and the earlier one for a
  removed one. One fact per passage, at most five. A reference inside a
  template, such as an infobox, follows no passage.
- **`citation_anchor_status`**, on `citation_removed`:
  `anchors=<n> kept=<k> unsourced=<u>`. Of the `n` passages the reference
  followed, `k` are still in the later revision's prose, and `u` of those no
  other reference follows any more.

`kept` above zero is a passage that outlived its citation; `unsourced` above
zero is one left with no reference after it. Both compare exact text, so a
passage reworded in the same edit counts as not kept. Find them with:

```bash
refract export "Page" --format ndjson |
  jq -c 'select(.eventType == "citation_removed")
         | select(any(.deterministicFacts[]; .fact == "citation_anchor_status" and (.detail | test("unsourced=[1-9]"))))'
```

## Template changes

| Event type | Trigger |
|---|---|
| `template_added` | New `{{template}}` added (e.g., `{{citation needed}}`, `{{NPOV}}`) |
| `template_removed` | Template removed |
| `template_parameter_changed` | Template parameters modified (e.g., date updated on a maintenance tag) |

## Section and page structure

| Event type | Trigger |
|---|---|
| `section_reorganized` | Sections added, removed, or reordered |
| `lead_promotion` | Content moves from body into the lead section |
| `lead_demotion` | Content moves from lead into the body |
| `page_moved` | Page renamed. Read from the move log and from the analyzed revisions' edit summaries; see below |

MediaWiki's move log is keyed by the title a page was moved from, so asking it
about the current title lists moves away from that title and never the moves
into it: Pluto's moves back from "(134340) Pluto" and "Pluto (dwarf planet)"
are not there. Each move also leaves a null revision in the moved page's
history whose summary reads `X moved page [[A]] to [[B]]` (before 2012,
`X moved [[A]] to [[B]]`), and those summaries give the rest. A move found
both ways is reported once, as the log has it; one found only in a summary
carries `page_move_source: edit_summary` and its `toRevisionId` is the null
revision, where a logged move's is the log entry's ID. Only English summaries
are read, and only those of the analyzed revisions, so a move whose null
revision falls outside them is found only if it left the current title.
Revisions read from `--dump` now report the moves their summaries name.

## Links and categories

| Event type | Trigger |
|---|---|
| `wikilink_added` | New `[[internal link]]` added |
| `wikilink_removed` | Internal link removed |
| `category_added` | New `[[Category:...]]` added |
| `category_removed` | Category removed |

## Content conflict

| Event type | Trigger |
|---|---|
| `revert_detected` | The edit summary matches one of six default patterns (`revert…`, `undid revision`, `rvv`, `rollback`, `restore…`, `[[WP:ROLLBACK]]`; a bare "rv" or "undo" does not match), or the revision's text is identical to an earlier analyzed revision other than the one directly before it. Facts say which: `revert_detected` carries the summary with editor names removed (see below), `identity_revert` names the revision restored (`restores=<revId>`). A revert to a state older than every analyzed revision is found only by its summary |
| `edit_cluster_detected` | 3+ edits within a configurable time window (default: 1 hour) |

An `edit_cluster_detected` event spans the cluster: `fromRevisionId` is its first revision and `toRevisionId` its last. `--cluster-window` sets the window in minutes.

### Edit summaries carry no editor names

Edit summaries name editors: MediaWiki's own revert summary reads
"Reverted edits by [[Special:Contributions/X|X]] ([[User talk:X|talk]]) to
last revision by Y", and tools write "Revert to revision 57480834 dated … by X
using popups". Wherever summary text reaches an event (`revert_detected`'s
`after` and fact, `protection_summary`, `page_moved`'s `comment=`, and
`talk_page_correlated`'s `talk_comment=`) and in the `editSummary` of
`refract claim` and `wikidataStatementHistory` transitions, Refract replaces with `[editor]`: links to user, user talk and
contributions pages (with any interwiki prefix, in English and Arabic);
`{{u|…}}`-style user templates; IPv4 and IPv6 addresses; the name after "by"
when "by" follows edit(s), revision(s) or version(s) (with or without an ID),
change(s), or a time of day; and the mover's name before "moved page". The
revert pattern, revision IDs and stated reason are kept. A name typed into
free prose without one of those markers is not caught.

## Talk page activity

| Event type | Trigger |
|---|---|
| `talk_page_correlated` | Article revision has a nearby talk page revision (default: 7 days before, 3 days after) |
| `talk_thread_opened` | New discussion thread created on talk page |
| `talk_thread_archived` | Thread closed/archived |
| `talk_reply_added` | Reply posted in an existing thread |
| `talk_activity_spike` | Talk page edits exceed 3x the moving average on a given day |

`refract analyze` and `refract export` read the ten talk-page edits that precede the last analyzed revision and emit all five events from them. Thread events cover the talk edits made since the first analyzed revision; their revision IDs are talk-page revisions. The CLI looks for spikes among the ten talk-page edits that precede the last analyzed revision, within the seven days before it, so most runs emit none. `--spike-factor` sets the multiplier. A spike event names a day, not a revision pair: both revision IDs are 0.

## Access control

| Event type | Trigger |
|---|---|
| `protection_changed` | Page protection level changed (protect, unprotect, modify) |

An event from the protection log carries `protection_log_event`
(`action=<action> logId=<id>`) and, when the entry has them:
`protection_level` (`level=semi|extended|full|template`), the edit protection
the entry set; `protection_reason`
(`category=content_dispute|vandalism|disruption|sockpuppetry|sourcing|other`);
and `protection_summary`, the comment with
[editor names removed](#edit-summaries-carry-no-editor-names).

The level comes from the entry's details or, in entries logged before about
2015, from the `[edit=…]` list in its description or comment. The category
comes from the policy page the comment links (`WP:PP#Content disputes`,
`WP:Vandalism`, `WP:Disruptive editing`, `WP:Sock puppetry`, `WP:INTREF` or
`WP:Verifiability`), or else from its wording ("edit war", "vandalism"), or is
`other`.

Both are categories of what the administrator wrote, not findings about the
page: `content_dispute` means the comment names an edit war or content dispute,
and an unprotection's comment is read the same way. English Wikipedia's policy
names and English wording are recognized; on another wiki, a comment that links
the same policy pages gets the same category, and one that does not is `other`.

## Event envelope

All events share a common structure:

```typescript
interface EvidenceEvent {
  eventType: EventType;       // one of the types above
  fromRevisionId: number;     // prior analyzed revision
  toRevisionId: number;       // next analyzed revision
  section: string;            // section name
  before: string;             // text/state before
  after: string;              // text/state after
  deterministicFacts: DeterministicFact[]; // why this event was produced
  layer: EvidenceLayer;       // observed, policy_coded, model_interpretation, speculative, unknown
  timestamp: string;          // ISO 8601
}
```

If intermediate revisions are missing, the pair represents the detected
difference between the captured states. It does not identify every intervening
edit or the exact revision where each change originated.

## Semantic Enrichment Fields (v0.5.0+)

Every event now carries deterministic enrichment fields computed from the `before`/`after` text (including English and Arabic certainty/hedging markers and Unicode key terms) and optional run-scoped actor cohort pseudonyms when input revisions include editor attributes.

| Field | Type | Description |
|-------|------|-------------|
| `editMagnitude` | `"minor" \| "moderate" \| "major"` | Character count thresholds |
| `contentChange` | `"introduction" \| "removal" \| "expansion" \| "compression" \| "refinement" \| "rewrite"` | Nature of the text change |
| `keyTerms` | `string[]` | Extracted significant terms (6+ ASCII chars or 4+ Arabic script chars, filtered for noise) |
| `certaintyProfile` | `{ high: number, medium: number, low: number, hedging: number }` | Counts of certainty/hedging markers (English and Arabic) |
| `directionSignal` | `"strengthening" \| "weakening" \| "neutral"` | Computed from certainty shift between before/after |
| `quantitativeFindings` | `QuantitativeFinding[]` | Extracted numbers (p-values, hazard ratios, n-values, CIs) |
| `actorCohort` | `ActorCohortSummary` | Ephemeral run-scoped pseudonymous actor labels (`Actor_1`, `Actor_2`) and distinct actor counts |

All fields are optional (`?`). Existing consumers ignore them. All computed deterministically — no model, no API, byte-reproducible.
