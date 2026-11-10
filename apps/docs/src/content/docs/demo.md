---
title: "See a history change"
description: "This captured walkthrough shows changed wording, a removed reference, and returned text. Its five Rivergate Library revisions are fictional, and Refract's…"
---

This captured walkthrough shows changed wording, a removed reference, and returned text. Its five Rivergate Library revisions are fictional, and Refract's analyzers compute the observations shown below. No installation or external data fetch is needed to read the example.

![A fictional library history: hours change from six to eight, a reference disappears, and free-printing text returns](../core-onboarding.svg)

| Observation | What to inspect |
|-------------|-----------------|
| Wording changed | The closing time changes from six to eight |
| Reference removed | The opening-hours reference disappears from the record |
| Text returned | Previously observed free-printing wording appears again |

The engine records these transitions. Your review criteria determine whether they require action. The example does not establish how well Refract fits a real review process.

## Inspect the complete record

- [Computed sample events](https://github.com/refract-org/refract/blob/main/docs/examples/sample-events.ndjson) include text, revision IDs, and analyzer provenance.
- [Input revisions](https://github.com/refract-org/refract/blob/main/packages/cli/src/onboarding-sample.ts) define the fictional history.
- [Saved review report](https://github.com/refract-org/refract/blob/main/docs/examples/review.md) shows pending changes, coverage, and explicit acknowledgment.
- [Captured Pluto and Bitcoin changes](https://github.com/refract-org/refract/blob/main/docs/example-output.md) include actual source revision links.

## Try it yourself

[Review your sources](../../../../../docs/review.md) explains how to build the current CLI, run this sample without wiki access, acknowledge its report, and check again. [Quick start](quickstart.md) compares a pinned real revision pair with the published CLI.
