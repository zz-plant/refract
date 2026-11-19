# Examples

Each script is a self-contained `bun` executable. Run any of them:

```bash
bun run examples/01-claim-provenance.ts
bun run examples/02-equivalent-to-wikiwho.ts
# ...etc
```

## Index

| # | Script | Problem It Solves |
|---|--------|-------------------|
| 01 | [claim-provenance.ts](01-claim-provenance.ts) | Track a specific sentence across revision history — first appearance, changes, and removal |
| 02 | [equivalent-to-wikiwho.ts](02-equivalent-to-wikiwho.ts) | Token attribution vs. structured evidence with citation + template context |
| 03 | [equivalent-to-ores.ts](03-equivalent-to-ores.ts) | Black-box ML scores vs. deterministic, reproducible edit classification with provenance |
| 04 | [from-scratch-to-refract.ts](04-from-scratch-to-refract.ts) | The ~800 lines of brittle Wikipedia analysis code you don't need to write |
| 05 | [wikidata-editorial-depth.ts](05-wikidata-editorial-depth.ts) | Current claim state vs. full editorial history — sources tried, replaced, removed |
| 06 | [pluto-in-the-loop.ts](06-pluto-in-the-loop.ts) | A model in the loop: where the sentence matcher splits a history, ask a model if it is one claim, and check each answer against the events before showing it |
| 07 | [longitudinal-multi-year-audit.ts](07-longitudinal-multi-year-audit.ts) | Multi-year longitudinal audit: scan 100% of revision metadata at 500 revs/request, compute pseudonymous revert pairs, and hydrate stratified checkpoints with SHA-1 deduplication |

## Audience

Each script targets a specific migration audience:

- **WikiWho users** (02): "You get structured events + citation/template context instead of raw token diffs."
- **ORES consumers** (03): "Same classifications, byte-reproducible, with a 'why' for every label."
- **Manual API scraper rebuilders** (04): "Your pipeline already exists — in 3 imports."
- **Wikidata-oriented researchers** (05): "Edit history of claims, not just current state."

Scripts 01–05 are fully deterministic — no API keys needed. Each runs against
the live Wikipedia API with a rate limiter (200ms minimum delay between
requests). They fetch a page's latest 10-20 revisions, so the output changes as
the page is edited.

## 06: a model in the loop

[06-pluto-in-the-loop.ts](06-pluto-in-the-loop.ts) replays the Pluto edits of
24 August 2006 from [the saved revisions](../docs/examples/pluto-revisions.json),
offline. Refract's sentence matcher pairs a reworded sentence with its earlier
wording only when word overlap reaches 0.8; below that it records one sentence
removed and another first seen, and the history splits. It splits three times
that day: once at 0.79, and once where one sentence was removed and two were
first seen.

At each split the script asks a model whether the two sentences are the same
claim, through `refract classify sentence_similarity`, so the question is
Refract's own prompt, provider and reading of the reply. Each answer names the
two events it is about. Before it is shown, it is checked against the events
derived from the saved revisions: both events must exist and hold the
sentences the answer quotes, the prompt must be the one those sentences give,
and the recorded verdict must be what the model's reply says. An answer that
fails is refused, and the script exits 1.

```bash
bun run build

# Observed events and the splits; no model.
bun run examples/06-pluto-in-the-loop.ts

# Ask a model and keep its answers. Any OpenAI-compatible endpoint works.
REFRACT_INFERENCE_API_KEY=… REFRACT_INFERENCE_ENDPOINT=… REFRACT_INFERENCE_MODEL=… \
  bun run examples/06-pluto-in-the-loop.ts --ask --save answers.json

# Replay those answers, checked again, with no model and no network.
bun run examples/06-pluto-in-the-loop.ts --answers answers.json --pace 2

# Change one saved answer's quoted sentence and watch the check refuse it.
bun run examples/06-pluto-in-the-loop.ts --answers answers.json --tamper

# NDJSON: the observed events, then each checked answer as a
# `"layer": "model_interpretation"` record naming the events it is based on.
bun run examples/06-pluto-in-the-loop.ts --answers answers.json --json
```

A model's answers can differ between runs, which is why `--save` keeps them
and each saved answer records the reply verbatim, the model that gave it, and
when. The repository ships no answers: run `--ask` with your own model. The
check also catches answers gone stale, for instance after an analyzer change
gives the events new IDs.
