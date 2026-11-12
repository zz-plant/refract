---
title: "Evaluation harness"
description: "@refract-org/eval checks Refract's events against expectations you state. It has two modes: benchmark test cases, each listing event types a page's history…"
---

`@refract-org/eval` checks Refract's events against expectations you state. It has
two modes: benchmark test cases, each listing event types a page's history should
produce, and ground truth labels, each tying an independently recorded outcome to the
event types expected around it.

The harness makes no model calls. Its inputs are live pages, so results change as
those pages are edited.

## Quick start

```bash
refract eval --page "Earth"
```

This runs the one built-in benchmark test whose page is `Earth`. `refract eval`
without `--page` runs all six.

Every test analyzes the **whole history** of a live English Wikipedia page at
`detailed` depth. `eval` has no `--api`, `--from`, `--to` or `--since` flag, so a run
over the built-in pages fetches tens of thousands of revisions and can exhaust memory
on the largest ones. To evaluate a bounded range, use the [programmatic
harness](#programmatic-use) with events from your own `refract analyze` run.

## Built-in benchmark tests

| Test id | Page | Expects |
|---------|------|---------|
| `page-has-revisions` | `Earth` | `section_reorganized` in `(lead)` |
| `contentious-page-has-reverts` | `Donald_Trump` | `revert_detected` |
| `controversy-page-has-templates` | `COVID-19_pandemic` | `template_added` in `body` |
| `scientific-article-has-citations` | `CRISPR` | `citation_added` and `citation_removed` in `body` |
| `featured-article-has-template-cleanup` | `Shakespeare` | `template_added` in `body`, `section_reorganized` in `(lead)` |
| `events-has-citation-additions` | `Albert_Einstein` | `citation_added` in `body` |

`--page` must equal the page title in this table exactly. A title that matches no
test runs zero tests and exits 0.

## Reading the output

```
Running 1 benchmark tests...

[page-has-revisions] Any active Wikipedia page returns at least 2 revisions and generates section events...
  PASS precision=1.00 events=1520/1

=== Eval Summary ===
Passed: 1/1
Overall precision: 100.0%
```

The counts above are illustrative.

- **precision**: the fraction of the test's expected events for which an event with
  the same `eventType` and `section` was found.
- **events=actual/expected**: events the analysis produced, and expected events the
  test lists.
- **PASS**: precision is at least the test's `minPrecision` (0.5 unless the test sets
  it) and the event count is within its `minEventCount` and `maxEventCount`.
- **ERROR**: the page could not be analyzed; the test counts as failed.

There is no per-analyzer table and no recall or F1 figure in this mode. The command
exits 0 whether tests pass or fail.

## Ground truth labels

```bash
refract eval --ground-truth builtin
refract eval --ground-truth path/to/labels.json
```

`builtin` uses the five labels shipped in the package. A path loads a JSON array of
labels in this format:

```json
[
  {
    "id": "example-rfc-keep",
    "source": "rfc_closure",
    "pageTitle": "Example page",
    "description": "RFC closed with consensus to keep the article",
    "observedAt": "2022-03-15T00:00:00Z",
    "resolution": "keep",
    "referenceUrl": "https://en.wikipedia.org/wiki/Talk:Example_page",
    "expectedEventTypes": ["sentence_first_seen", "revert_detected"],
    "expectedSection": "body"
  }
]
```

The command reads `id`, `pageTitle`, `description`, `expectedEventTypes` and
`expectedSection`. `expectedEventTypes` is required: a label without it fails with a
`TypeError` as soon as the page yields events. `expectedSection` is optional; without
it, or when it is an empty string, events in any section match.

`source` is one of `talk_page_consensus`, `rfc_closure`, `arbcom_decision` or
`page_protection`. `resolution` is one of `keep`, `merge`, `delete`, `no_consensus`,
`redirect` or `other`.

For each label the command analyzes the whole history of `pageTitle` on English
Wikipedia, as above, then prints:

```
=== L3 Ground Truth Validation ===
  [PASS] example-rfc-keep: prec=0.50 recall=1.00 matched=412

  Total: 1/1 passed (0 failed)
  Avg precision: 50.0%
  Avg recall: 100.0%
```

- **PASS**: at least one event has an expected type, in the expected section.
- **prec**: the fraction of `expectedEventTypes` that occurred at least once.
- **recall**: 1.00 when anything matched, otherwise 0.00.
- **matched**: the number of matching events.

A page that does not exist yields no events and a `FAIL` line, not an error.

## Programmatic use

The harness does not fetch anything. Pass it events from a run of your own, over
whatever range you choose:

```typescript
import { createEvalHarness, validateAgainstGroundTruth } from "@refract-org/eval";
import type { EvalTestCase, OutcomeLabel } from "@refract-org/eval";
import type { EvidenceEvent } from "@refract-org/evidence-graph";

declare const events: EvidenceEvent[]; // e.g. parsed from `refract analyze … --json`

const harness = createEvalHarness();

const test: EvalTestCase = {
  id: "bitcoin-2010-citations",
  description: "The range adds and removes citations",
  pageTitle: "Bitcoin",
  pageId: 28249265,
  revisionRange: { from: 369361755, to: 369393212 },
  expectedEvents: [
    { eventType: "citation_added", section: "body" },
    { eventType: "citation_removed", section: "body" },
  ],
  tolerance: { minEventCount: 1, minPrecision: 1 },
};

const result = harness.evaluate(test, events);
console.log(result.passed, result.precision, result.misses);

const summary = harness.computeScores([result]);
console.log(`${summary.testsPassed}/${summary.totalTests} passed`);
```

`evaluate` returns `testId`, `passed`, `precision`, `eventCount`, `matches`, `misses`
and `falsePositives`. `computeScores` returns `overallPrecision`, `overallF1`,
`testsPassed`, `testsFailed`, `totalTests` and `perTest`; `overallF1` currently equals
`overallPrecision`.

`validateAgainstGroundTruth(labels, events)` scores `OutcomeLabel` objects against
events and returns `totalOutcomes`, `passed`, `failed`, `overallPrecision`,
`overallRecall`, `overallF1` and a `perOutcome` array.

The package also exports `GROUND_TRUTH_LABELS`, `getGroundTruthById` and
`getGroundTruthForPage`. `harness.benchmarkPages()` returns the six built-in test cases.

## Adding a test case

The built-in list is fixed in `packages/eval/src/index.ts`; `refract eval` has no flag
that loads extra benchmark tests. Two routes exist:

1. Write an `EvalTestCase` and call `harness.evaluate` on events you produced, as
   above. The [custom eval tutorial](tutorials/custom-eval.md) walks through it.
2. Write ground truth labels and pass the file to `--ground-truth`.

## Architecture

- **Input**: pipeline events, plus test cases or outcome labels written by a person.
- **Process**: matches events to expectations by event type and section.
- **Output**: pass or fail with precision, and recall for labels. Nothing feeds back
  into the pipeline.

The labels are not derived from analyzer output, and the analyzers do not read them.
