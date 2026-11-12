---
title: "Tutorial: Custom eval ground truth labels"
description: "Define your own ground truth labels, run Refract's evaluation harness against them, and interpret precision, recall, and F1 scores per analyzer. Extend the…"
---

## Goal

Define your own ground truth labels, run Refract's evaluation harness against them,
and interpret precision, recall, and F1 scores per analyzer. Extend the eval beyond
the built-in benchmark pages.

## How the eval works

The eval package compares Refract's pipeline output against independently verified
outcome labels — human-labeled ground truth about what actually happened on a page
at a specific time. Labels are stored separately from pipeline output. The pipeline
never modifies them.

Each label specifies:
- Which event types should appear on the page at a given time
- What section they should appear in (optional)
- The source of the ground truth (talk page consensus, RFC closure, ArbCom decision)

## Step 1: Create a ground truth labels file

Create a JSON file with your labels. Each label describes one known outcome:

```json
[
  {
    "id": "covid-origin-consensus",
    "source": "talk_page_consensus",
    "pageTitle": "COVID-19",
    "description": "Talk page consensus (Jan 2023) removed unsourced origin claims from lead",
    "observedAt": "2023-01-15T00:00:00Z",
    "resolution": "keep",
    "referenceUrl": "https://en.wikipedia.org/wiki/Talk:COVID-19/Archive_50#Origin_claims",
    "expectedEventTypes": ["sentence_removed", "section_reorganized"],
    "expectedSection": "(lead)"
  },
  {
    "id": "bitcoin-citation-dispute",
    "source": "rfc_closure",
    "pageTitle": "Bitcoin",
    "description": "RFC closed June 2022: Nakamoto whitepaper citation must remain in lead",
    "observedAt": "2022-06-20T00:00:00Z",
    "resolution": "keep",
    "referenceUrl": "https://en.wikipedia.org/wiki/Talk:Bitcoin/RFC_citation",
    "expectedEventTypes": ["citation_added"],
    "expectedSection": "(lead)"
  },
  {
    "id": "trump-protection-event",
    "source": "page_protection",
    "pageTitle": "Donald_Trump",
    "description": "Page protected Aug 2024 after edit war. Revert events expected in surrounding revisions.",
    "observedAt": "2024-08-10T00:00:00Z",
    "resolution": "other",
    "referenceUrl": "https://en.wikipedia.org/wiki/Special:Log?page=Donald_Trump",
    "expectedEventTypes": ["protection_changed", "revert_detected"]
  }
]
```

Each label requires:
- `id`: unique identifier
- `source`: one of `talk_page_consensus`, `rfc_closure`, `arbcom_decision`, `page_protection`
- `pageTitle`: exact Wikipedia page title
- `expectedEventTypes`: which event types the pipeline should detect
- `referenceUrl`: public permalink to the ground truth source

## Step 2: Run the eval with custom labels

```bash
refract eval --ground-truth my-labels.json
```

Refract loads the labels, analyzes each label's page at detailed depth, and compares
the events against your ground truth. It analyzes the page's whole history, so a
long page takes a long time. The output has this shape (the counts here are
illustrative):

```
Loaded 3 ground truth labels from my-labels.json
[covid-origin-consensus] Talk page consensus (Jan 2023) removed unsourced origin claims from lead...
  Fetched 5120 events for "COVID-19".
[bitcoin-citation-dispute] RFC closed June 2022: Nakamoto whitepaper citation must remain in lead...
  Fetched 3310 events for "Bitcoin".
[trump-protection-event] Page protected Aug 2024 after edit war. Revert events expected in surrounding revisions....
  Fetched 9875 events for "Donald_Trump".

=== L3 Ground Truth Validation ===
  [PASS] covid-origin-consensus: prec=1.00 recall=1.00 matched=412
  [PASS] bitcoin-citation-dispute: prec=1.00 recall=1.00 matched=57
  [PASS] trump-protection-event: prec=0.50 recall=1.00 matched=230

  Total: 3/3 passed (0 failed)
  Avg precision: 83.3%
  Avg recall: 100.0%
```

## Step 3: Interpret the results

A label passes when at least one event has an expected type (and the expected
section, if the label names one). `matched` counts those events. `prec` is the
share of the label's expected event types that appeared at least once. `recall`
is 1.00 for a pass and 0.00 for a fail.

| Outcome | What it means |
|---|---|
| **PASS, prec=1.00** | Every expected event type appeared at least once. |
| **PASS, prec<1.00** | Some expected event types appeared and others did not. In the third label above, `revert_detected` appeared and `protection_changed` did not. Check whether the missing type is one the pipeline emits for that page. |
| **FAIL (prec=0.00, recall=0.00)** | No event had an expected type in the expected section. The analyzer may not cover this scenario, or the section name does not match. |

The check does not use `observedAt`: an expected event anywhere in the page's
history counts.

## Step 4: Diagnose misses

When an outcome fails, investigate the missed events:

1. Run the same page manually over the revisions around the `observedAt` timestamp: `refract analyze "Page" --from <revId> --to <revId> --json`
2. Check which event types that range produces
3. Verify the `expectedEventTypes` match what the analyzer produces
4. If the `expectedSection` is specified, check that the event fired in that section

The eval doesn't tell you *why* a miss happened — it tells you *what* was missed.
Use the manual analysis to diagnose.

## Step 5: Contribute labels back

If you've curated labels for notable Wikipedia events, consider contributing them to
the built-in `GROUND_TRUTH_LABELS` in `packages/eval/src/ground-truth.ts`. Each label
is a coded observation of a real editorial process outcome. The more labels the eval
has, the better it measures analyzer accuracy across diverse scenarios.

Format for contribution:
- `id`: descriptive kebab-case (`covid-origin-consensus-2023`)
- `referenceUrl`: must be a public, permanent Wikipedia URL
- `source`: must be one of the 4 supported types
- `expectedEventTypes`: must be members of the current `EventType` union

## Next steps

- [Evaluation harness reference](../eval.md) — full eval API and benchmark pages
- [Schema reference](../schema.md) — all event types
- [Build a custom analyzer](custom-analyzer.md) — add new event types and test them
