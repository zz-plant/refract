---
title: "Event taxonomy"
description: "Each Refract event describes what changed at a revision boundary. Events are deterministic — the same input always produces the same output. Events chain…"
---

Each Refract event describes what changed at a revision boundary. Events are deterministic — the same input always produces the same output. Events chain into claim-state timelines across revisions — see [Temporal Model](./temporal-model.md) for how events form replayable history.

## Claim lifecycle

| Event type | Trigger | Example |
|---|---|---|
| `sentence_first_seen` | New sentence text appears | A sentence about a company appears for the first time |
| `sentence_removed` | Existing sentence deleted entirely | A controversial paragraph is removed |
| `sentence_modified` | Same sentence text changed (similarity threshold match) | Sentence rewording detected by word-overlap ratio |
| `sentence_reintroduced` | Previously removed sentence returns | A deleted sentence is restored in a later edit |

## Citation changes

| Event type | Trigger |
|---|---|
| `citation_added` | New `<ref>` tag added |
| `citation_removed` | Existing `<ref>` tag removed |
| `citation_replaced` | One citation swapped for another in the same position |

Citation events carry facts about the source and the passage it supports:

| Fact | On | Detail |
|---|---|---|
| `citation_source` | all three, when the reference names a URL | `domain=<host> url=<url>`. The URL is the `url=` parameter, or else the first bare http(s) URL in the reference |
| `citation_anchor` | all three, except at `brief` depth | A passage the reference follows: the text from the start of its sentence up to the reference, in the later revision for an added or replaced reference and the earlier one for a removed one. One fact per passage, at most five. A reference inside a template, such as an infobox, follows no passage |
| `citation_anchor_status` | `citation_removed` | `anchors=<n> kept=<k> unsourced=<u>`: of the `n` passages the reference followed, `k` are still in the later revision's prose, and `u` of those no other reference follows any more |

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
| `page_moved` | Page renamed (detected via logevents API) |

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
| `revert_detected` | The edit summary matches one of six default patterns (`revert…`, `undid revision`, `rvv`, `rollback`, `restore…`, `[[WP:ROLLBACK]]`; a bare "rv" or "undo" does not match), or the revision's text is identical to an earlier analyzed revision other than the one directly before it. Facts say which: `revert_detected` carries the summary, `identity_revert` names the revision restored (`restores=<revId>`). A revert to a state older than every analyzed revision is found only by its summary |
| `edit_cluster_detected` | 3+ edits within a configurable time window (default: 1 hour). The fact's `detail` gives `revisions`, `editors` (a count of unique editors; no identities recorded), `window_ms` and `single_editor` |

An `edit_cluster_detected` event spans the cluster: `fromRevisionId` is its first revision and `toRevisionId` its last. `--cluster-window` sets the window in minutes.

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

## Event envelope

All events share a common structure:

```typescript
interface EvidenceEvent {
  eventType: EventType;       // one of the types above
  fromRevisionId: number;     // parent revision
  toRevisionId: number;       // revision where the change occurred
  section: string;            // section name
  before: string;             // text/state before
  after: string;              // text/state after
  deterministicFacts: DeterministicFact[]; // why this event was produced
  layer: EvidenceLayer;       // observed, policy_coded, model_interpretation, speculative, unknown
  timestamp: string;          // ISO 8601
}
```
