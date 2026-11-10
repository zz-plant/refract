---
title: "Interpreting Refract output"
description: "Refract emits a deterministic event stream. This page explains how to read it."
---

Refract emits a deterministic event stream. This page explains how to read it.

## The event envelope

Every event has the same structure:

```json
{
  "eventId": "a3f5c2e1b7d409fa",
  "eventType": "sentence_first_seen",
  "claimId": "c7d8e9f0a1b23456",
  "fromRevisionId": 1280110001,
  "toRevisionId": 1280110100,
  "section": "Geology",
  "before": "",
  "after": "Earth's crust consists of tectonic plates...",
  "deterministicFacts": [
    {
      "fact": "New sentence detected",
      "detail": "First appearance of this text across revision range",
      "provenance": {
        "analyzer": "section-differ",
        "version": "0.5.1",
        "inputHashes": ["sha256:abc123..."]
      }
    }
  ],
  "layer": "observed",
  "timestamp": "2024-11-25T12:00:00Z",
  "schemaVersion": "0.4.0"
}
```

### Field meanings

| Field | What it tells you |
|-------|-------------------|
| `eventType` | Kind of change — sentence, citation, template, revert, section, etc. See [event taxonomy](events.md). |
| `fromRevisionId` / `toRevisionId` | The revision boundary where this change occurred. `from` is the parent revision; `to` is the revision containing the change. |
| `section` | Which section the change belongs to. `(lead)` means the page introduction. Not all event types use this field. |
| `before` / `after` | The text before and after the change. For additions, `before` is empty. For removals, `after` is empty. For modifications, both are present. |
| `deterministicFacts` | Why the engine produced this event. Always mechanical — pure functions of the wikitext. The `provenance` field identifies which analyzer, what version, and what parameters. |
| `layer` | Where the evidence came from: `"observed"` (deterministic), `"policy_coded"` (rules-based), `"model_interpretation"` (downstream only), `"speculative"` (low confidence), `"unknown"`. |
| `schemaVersion` | Which schema version produced this event. Use this for compatibility checks when consuming events across package versions. |

## Event types by category

### Claim lifecycle (`sentence_*`)

These events track propositional content across revisions. A sentence is identified
by its text; Refract detects when the same sentence appears, disappears, changes, or
returns.

![Claim lifecycle across revisions](claim-lifecycle.svg)

- **`sentence_first_seen`**: This text has never appeared before in the revision range.
- **`sentence_removed`**: This text was present in the previous revision and is absent now.
- **`sentence_modified`**: The text changed but is similar enough (above the similarity threshold) to be considered the same sentence.
- **`sentence_reintroduced`**: Text that was previously removed has returned.

### Source changes (`citation_*`)

Citations are extracted from `<ref>` tags in wikitext.

- **`citation_added`**: A new reference was added.
- **`citation_removed`**: An existing reference was deleted.
- **`citation_replaced`**: One reference was swapped for another at the same position.

### Policy signals (`template_*`)

Templates like `{{citation needed}}`, `{{NPOV}}`, `{{BLP sources}}` are Wikipedia's
dispute signals. Refract tracks them mechanically.

- **`template_added`**: A template was inserted into the page.
- **`template_removed`**: A template was taken out.
- **`template_parameter_changed`**: A template's parameters were modified (e.g., date updated on a maintenance tag).

### Structural changes (`section_*`, `lead_*`, `page_moved`)

- **`section_reorganized`**: Sections were added, removed, or reordered.
- **`lead_promotion`**: Content was moved from the body into the lead section.
- **`lead_demotion`**: Content was moved from the lead into the body.
- **`page_moved`**: The entire page was renamed.

### Dispute signals (`revert_*`, `edit_cluster_*`)

- **`revert_detected`**: An edit was reverted, detected from the edit summary matching revert patterns.
- **`edit_cluster_detected`**: Multiple edits occurred within a tight time window (default: 3+ edits in 1 hour).

### Talk page activity (`talk_*`)

These events correlate article revisions with their associated talk pages.

- **`talk_page_correlated`**: An article revision has a nearby talk page revision.
- **`talk_thread_opened`**: A new discussion thread was started.
- **`talk_thread_archived`**: A thread was closed or archived.
- **`talk_reply_added`**: A reply was posted in an existing thread.
- **`talk_activity_spike`**: Talk page activity exceeded the threshold (default: 3× the moving average).

## Reading patterns across events

### Stability signal

A claim that has `sentence_first_seen` early in the timeline, no `sentence_modified`
events, and is still present at the end of the revision range is stable.

### Contestation signal

A claim with frequent `sentence_modified` events, `revert_detected` in its section,
and `template_added` with dispute templates (`{{NPOV}}`, `{{citation needed}}`) is
actively contested.

### Source fragility signal

A citation that was added and then removed within a short revision window (or was
replaced multiple times) is source-fragile — the page's evidence base for that claim
is unstable.

### Canon change signal (Fandom wikis)

`category_removed` immediately followed by `category_added` with a different category
in the same revision boundary is a canon reclassification. `sentence_removed` on a
long-standing claim followed by `sentence_first_seen` with different text in the same
section is a retcon.

## Downstream consumption

When building on Refract's event stream:

1. **Filter by `eventType`** to isolate the signal you care about (e.g., citation
   events for source churn analysis).
2. **Group by `section`** to find which parts of the page are most active.
3. **Chain by `claimId`** to trace a specific proposition across its full lifecycle.
4. **Sort by `timestamp`** to reconstruct the chronological sequence.
5. **Never interpret `layer` values you didn't set** — `model_interpretation` is for
   downstream use only. Refract never sets it.

The event stream is pure NDJSON — pipe it, filter it, join it, archive it.
