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

Refract loads the labels, fetches the relevant pages, runs the pipeline, and compares
output against your ground truth:

```
Loaded 3 ground truth labels from my-labels.json

[1/3] COVID-19 — talk_page_consensus: Talk page consensus (Jan 2023)...
  PASS — precision=1.00 recall=1.00 f1=1.00
  2/2 expected events matched (sentence_removed, section_reorganized)

[2/3] Bitcoin — rfc_closure: RFC closed June 2022...
  PASS — precision=1.00 recall=1.00 f1=1.00
  1/1 expected events matched (citation_added)

[3/3] Donald_Trump — page_protection: Page protected Aug 2024...
  FAIL — precision=0.50 recall=1.00 f1=0.67
  1/2 expected events matched (revert_detected)
  Missed: protection_changed

=== Eval Summary ===
Total outcomes: 3
Passed: 2 / Failed: 1
Overall precision: 83.3%
Overall recall: 100.0%
Overall F1: 88.9%
```

## Step 3: Interpret the results

| Outcome | What it means |
|---|---|
| **Pass (P=1.0, R=1.0)** | Pipeline detected all expected events. The analyzer is working as intended. |
| **Pass (P<1.0, R=1.0)** | Pipeline found the expected events plus extras (false positives). Precision < 1.0 may indicate the analyzer is too sensitive. |
| **Fail (R=0.0)** | Pipeline missed all expected events. The analyzer may not cover this scenario, or the revision range doesn't include the event. |
| **Fail (P=0.5, R=1.0)** | Pipeline found some expected events but missed others. The analyzer is partially working — check if the missed event type is in scope. |

## Step 4: Diagnose misses

When an outcome fails, investigate the missed events:

1. Run the same page manually: `refract analyze "Page" --depth forensic`
2. Check the revision range around the `observedAt` timestamp
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
