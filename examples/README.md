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

## Audience

Each script targets a specific migration audience:

- **WikiWho users** (02): "You get structured events + citation/template context instead of raw token diffs."
- **ORES consumers** (03): "Same classifications, byte-reproducible, with a 'why' for every label."
- **Manual API scraper rebuilders** (04): "Your pipeline already exists — in 3 imports."
- **Wikidata-oriented researchers** (05): "Edit history of claims, not just current state."

All scripts are fully deterministic — no API keys needed.

Each script runs against live Wikipedia API with a rate limiter
(200ms minimum delay between requests). They fetch a page's latest
10-20 revisions, so the output changes as the page is edited.
