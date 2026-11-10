---
title: "Evaluation harness"
description: "@refract-org/eval is the evaluation harness for measuring how accurately Refract's deterministic analyzers detect real-world revision-history events. It…"
---

`@refract-org/eval` is the evaluation harness for measuring how accurately Refract's
deterministic analyzers detect real-world revision-history events. It compares the
pipeline's output against independently verified ground truth labels and produces
precision, recall, and F1 scores per analyzer.

The eval package is designed for two purposes:
1. **Benchmarking**: Run against built-in benchmark pages to verify analyzer accuracy
2. **Extension**: Add new ground truth labels for new pages or new analyzer features

## Quick start

```bash
refract eval
```

This runs the evaluation harness against all built-in benchmark pages and prints
a summary table with per-analyzer precision, recall, and F1 scores.

## Available benchmark pages

| Page | Domain | What it tests |
|------|--------|---------------|
| `Xanoleptin` | Synthetic healthcare-like | Sentence lifecycle, template tracking, dispute signals |
| `Xanoleptin_guideline` | Synthetic guideline | Policy-linked page with sourcing and template patterns |
| `Luke_Skywalker` (Fandom) | Fictional canon | Cross-wiki detection, category shifts, retcon patterns |

The Xanoleptin pages are synthetic — they contain controlled revision histories with
known ground truth labels. This means the eval produces deterministic, reproducible
scores. No model. No sampling. No variance.

## Reading the output

```
=== Refract Eval Results ===
Benchmark pages: 3
Total events analyzed: 487

Analyzer precision/recall:
  section-differ     P=0.98  R=0.97  F1=0.975
  citation-tracker   P=1.00  R=0.94  F1=0.969
  revert-detector    P=0.91  R=0.89  F1=0.900
  template-tracker   P=1.00  R=0.96  F1=0.980
```

- **Precision (P)**: Of the events the analyzer produced, what fraction matched a
  ground truth label? 1.00 means every event was verified.
- **Recall (R)**: Of all ground truth events, what fraction did the analyzer detect?
  0.89 means the analyzer missed 11% of real revert events.
- **F1**: Harmonic mean of precision and recall. Balances the tradeoff between
  over-producing events and missing real ones.

## Running against a specific page

```bash
refract eval --page "Xanoleptin"
```

## Running against custom ground truth

```bash
refract eval --ground-truth path/to/labels.json
```

Ground truth labels use this format:

```json
[
  {
    "id": "xanoleptin:rev-50:citation-added-geology",
    "pageTitle": "Xanoleptin",
    "eventType": "citation_added",
    "fromRevisionId": 50,
    "toRevisionId": 51,
    "section": "Geology",
    "fact": "Citation added in section Geology",
    "source": "hand-labeled",
    "labeler": "your-name",
    "labeledAt": "2025-01-15T00:00:00Z"
  }
]
```

## Adding a new benchmark page

1. Create a synthetic revision history (see `demo-data/` in the refract monorepo for examples)
2. Hand-label ground truth events for every deterministic change in the revision range
3. Add the page title and ground truth labels to the eval package's benchmark registry
4. Run `refract eval --page "NewPage"` to verify the analyzer detects your labeled events

## Programmatic use

```typescript
import { createEvalHarness, validateAgainstGroundTruth } from "@refract-org/eval";
import type { EvalHarness, EvalResult } from "@refract-org/eval";

const harness = createEvalHarness();
const result: EvalResult = await harness.evaluate({
  pageTitle: "Xanoleptin",
  events: pipelineOutput,
  groundTruth: labels,
});

console.log(`F1: ${result.f1.toFixed(3)}`);
```

## Architecture

The eval harness operates independently:
- **Input**: Pipeline events (from deterministic analyzers) + ground truth labels (hand-labeled)
- **Process**: Matches events to labels by page title, revision range, and fact content
- **Output**: Precision, recall, F1 per analyzer — no feedback into the pipeline

This separation prevents the eval from becoming a self-fulfilling prophecy: the
analyzers are not tuned to match the eval labels, and the eval labels are never
derived from analyzer output.

## Baseline superiority

When integrating Refract signals with other systems, use `computeBaselineSuperiority()`
to validate that your integrated signal outperforms simple Refract-derived baselines:

```typescript
import { computeBaselineSuperiority } from "@refract-org/eval";

const result = computeBaselineSuperiority({
  integratedLeadTimeDays: signal.leadTimeDays,
  mentionCount: snapshot.metrics.mentionCount,
  revertCount: snapshot.metrics.revertCount,
  refractEventSummary: { totalEvents: 47, revertCount: 12 },
});
// → { beatsBaseline: true, margin: 3.2 }
```

This prevents overfitting: if your downstream system's signals don't beat simple
counts from Refract's deterministic event stream, your interpretation layer adds
no value.
