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
| `revert_detected` | Edit summary matches one of six default patterns: `revert…`, `undid revision`, `rvv`, `rollback`, `restore…`, `[[WP:ROLLBACK]]`. A bare "rv" or "undo" does not match |
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
