# @refract-org/eval

Evaluation harness for ground truth validation and benchmark pages.

```bash
bun add @refract-org/eval
```

## Exports

### Harness

- `createEvalHarness()` — returns an `EvalHarness` with `evaluate()`, `benchmarkPages()`, and `computeScores()`
- `EvalHarness` — interface for running test cases against evidence events
- `EvalTestCase` — a single benchmark case (page, revision range, expected events)
- `EvalResult` — per-test result with precision, matches, misses, false positives
- `EvalScoreSummary` — aggregate scores across all tests

### Ground Truth

- `validateAgainstGroundTruth()` — validate events against outcome labels
- `GROUND_TRUTH_LABELS` — built-in ground truth labels
- `getGroundTruthById()` / `getGroundTruthForPage()` — lookup helpers
- `OutcomeLabel` — ground truth label type
- `L3ValidationResult` / `L3ValidationSummary` — validation result types

```ts
import { createEvalHarness, validateAgainstGroundTruth } from "@refract-org/eval";
```

[Refract](https://github.com/refract-org/refract) · [Docs](https://zz-plant.github.io/refract/) · [npm](https://www.npmjs.com/package/@refract-org/eval)
