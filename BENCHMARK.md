# Model Evaluation Benchmark

Refract can serve as deterministic ground truth for AI model evaluation. This document defines the standard benchmark pages, submission format, and scoring methodology for temporal leakage, retrieval quality, and provenance hallucination benchmarks.

## Ground-truth corpus

The published corpus is attached to the [`benchmark-corpus-2026-08-27` release](https://github.com/refract-org/refract/releases/tag/benchmark-corpus-2026-08-27): one event-stream JSONL per benchmark page over a fixed window — 15,926 events, 82 MB uncompressed — with [`manifest.json`](benchmarks/ground-truth/manifest.json) tracked here in the repo recording the Refract version, the window bounds, each page's last analyzed revision ID, event count, and SHA-256. The manifest hashes bind the release artifact to this commit.

The window is fixed (start pinned in the manifest, end pinned per page by `lastRevisionId`) rather than full-history, for two reasons: a corpus that changes when the pages change isn't a benchmark, and full-history analysis of the largest pages exceeds any fixed heap. To verify the corpus, run the manifest's window against each page with `--since <windowStart> --to <lastRevisionId>` and compare hashes — analysis is deterministic, so a match is byte-for-byte.

## Standard benchmark pages

These 10 pages are selected for high editorial activity, diverse event types, and known revision history patterns that stress-test model evaluation:

| Page | Wiki | Why |
|---|---|---|
| `COVID-19` | en.wikipedia.org | Rapidly evolving medical page with high citation churn and frequent reverts |
| `Bitcoin` | en.wikipedia.org | Financial topic with contested claims and source disputes |
| `GPT-4` | en.wikipedia.org | AI topic — relevant to model knowledge cutoff testing |
| `Climate_change` | en.wikipedia.org | Politically contested, high talk page activity |
| `Donald_Trump` | en.wikipedia.org | High edit frequency, frequent reverts, talk page correlation |
| `CRISPR` | en.wikipedia.org | Scientific article — stable claims, academic citations |
| `COVID-19_pandemic` | en.wikipedia.org | Timeline-driven page structure reorganization |
| `Russia` | en.wikipedia.org | Geopolitically contested, cross-wiki divergence |
| `Tesla,_Inc.` | en.wikipedia.org | Corporate page — PR editing patterns, citation laundering |
| `Earth` | en.wikipedia.org | Stable reference page — baseline for normal editing patterns |

## Temporal leakage benchmark

### Setup

```bash
manifest=benchmarks/ground-truth/manifest.json
start=$(jq -r .windowStart "$manifest")
for page in COVID-19 Bitcoin GPT-4 Climate_change "Donald_Trump" CRISPR "COVID-19_pandemic" Russia "Tesla,_Inc." Earth; do
  last=$(jq -r --arg p "$page" '.pages[] | select(.page == ($p | gsub("_"; " "))) | .lastRevisionId' "$manifest")
  refract analyze "$page" --depth detailed --since "$start" --to "$last" --json > "benchmark-${page// /_}.jsonl"
done
```

`--json` makes the output one event per line. `--since` and `--to` hold each run to the
manifest's window; without them `analyze` reads the page's whole history.

### Submission format

```json
{
  "model": "gpt-4o-2024-08-06",
  "claimed_cutoff": "2024-06-01",
  "evaluated_at": "2024-09-15",
  "refract_version": "0.5.3",
  "benchmark_commit": "a1b2c3d4",
  "results": {
    "total_claims_tested": 500,
    "claims_after_cutoff_found": 12,
    "leakage_rate": 0.024,
    "per_page": [
      {
        "page": "COVID-19",
        "claims_tested": 50,
        "leaked": 3,
        "leakage_rate": 0.06
      }
    ]
  }
}
```

### Scoring

- **Leakage rate** = claims after cutoff correctly identified / total claims tested
- Lower is better. Zero is ideal.
- Results must include the Refract version and benchmark commit hash for reproducibility.
- A reviewer must be able to run the same commands and get identical event IDs.

## Retrieval quality benchmark

### Setup

1. Run Refract on all 10 benchmark pages
2. Score each claim by stability (revert count, citation churn, talk activity, template disputes)
3. Query each RAG system with 50 standard questions about the benchmark pages
4. For each retrieved passage, look up its stability score from Refract
5. Report the distribution of stability scores per system

### Submission format

```json
{
  "system": "RAG-System-A",
  "refract_version": "0.5.3",
  "benchmark_commit": "a1b2c3d4",
  "results": {
    "total_retrievals": 500,
    "mean_stability": 0.87,
    "contested_retrievals": 23,
    "contested_rate": 0.046,
    "stability_distribution": {
      "0.0-0.2": 5,
      "0.2-0.4": 8,
      "0.4-0.6": 10,
      "0.6-0.8": 45,
      "0.8-1.0": 432
    }
  }
}
```

## Provenance hallucination benchmark

### Setup

1. Generate 100 claims from a model, each with a cited source URL
2. For each claim, query the relevant page's citation events
3. Classify each source: verified (found, still present), outdated (found, now removed), hallucinated (never existed)
4. Report classification rates

### Submission format

```json
{
  "model": "gpt-4o-2024-08-06",
  "refract_version": "0.5.3",
  "benchmark_commit": "a1b2c3d4",
  "results": {
    "total_claims": 100,
    "verified": 72,
    "outdated": 18,
    "hallucinated": 10,
    "hallucination_rate": 0.10
  }
}
```

## Reproducibility

Every submission must include:

1. Refract version (`refract --version`)
2. Benchmark commit hash (the commit of this benchmark spec used)
3. The exact `refract analyze` commands run
4. SHA-256 of the combined events JSONL

A reviewer runs the same commands, gets the same hashes, and reproduces the benchmark. The evaluation is deterministic — not just the paper, but the data.

## Contributing

Submit results as a PR to the `benchmarks/` directory. Include your JSON submission file and a README with reproduction steps. Community-maintained leaderboard lives in `benchmarks/LEADERBOARD.md`.
