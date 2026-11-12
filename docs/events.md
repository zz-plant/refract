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
| `edit_cluster_detected` | 3+ edits within a configurable time window (default: 1 hour) |

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

Every event now carries 6 deterministic enrichment fields computed from the `before`/`after` text.

| Field | Type | Description |
|-------|------|-------------|
| `editMagnitude` | `"minor" \| "moderate" \| "major"` | Character count thresholds |
| `contentChange` | `"introduction" \| "removal" \| "expansion" \| "compression" \| "refinement" \| "rewrite"` | Nature of the text change |
| `keyTerms` | `string[]` | Extracted significant terms (6+ chars, filtered for noise) |
| `certaintyProfile` | `{ high: number, medium: number, low: number, hedging: number }` | Counts of certainty/hedging markers |
| `directionSignal` | `"strengthening" \| "weakening" \| "neutral"` | Computed from certainty shift between before/after |
| `quantitativeFindings` | `QuantitativeFinding[]` | Extracted numbers (p-values, hazard ratios, n-values, CIs) |

All fields are optional (`?`). Existing consumers ignore them. All computed deterministically — no model, no API, byte-reproducible.
