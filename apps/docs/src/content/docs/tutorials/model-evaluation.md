---
title: "Tutorial: Evaluate AI models with Refract"
description: "Use Refract as deterministic ground truth to evaluate frontier models. Test temporal leakage, compare retrieval quality, detect provenance hallucination…"
---

## Goal

Use Refract as deterministic ground truth to evaluate frontier models. Test temporal
leakage, compare retrieval quality, detect provenance hallucination, and measure
knowledge recency — all with reproducible evidence, not heuristic scores.

**Python users**: skip the CLI examples below and use `refract_eval` directly —
`build_leakage_benchmark()`, `check_provenance()`, `score_retrieval_quality()`.
[→ Python SDK tutorial](python-sdk.md)

Refract doesn't evaluate models. It provides the ground truth that makes evaluation
possible. Every claim is backed by a revision ID, timestamp, and deterministic
SHA-256 hash. Anyone can reproduce your results.

## 1. Temporal leakage: who knows things they shouldn't?

Every model has a training cutoff. Some "know" things past it. Refract proves it.

### Build a leakage benchmark

Pick 20 Wikipedia pages with known changes near model cutoffs:

```bash
cat > leakage-pages.txt << EOF
GPT-4
Gemini_(language_model)
Claude_(language_model)
OpenAI
Anthropic
Google_DeepMind
EOF
```

Analyze each at forensic depth:

```bash
while read page; do
  refract analyze "$page" --depth detailed -c > "events-${page// /_}.jsonl"
done < leakage-pages.txt
```

### Extract claims that appeared after a model's cutoff

For each model, find claims that first appeared after its training cutoff:

```sql
-- GPT-4o cutoff: June 2024
SELECT after as claim_text, timestamp, toRevisionId
FROM 'events-GPT-4.jsonl'
WHERE "eventType" = 'sentence_first_seen'
  AND timestamp > '2024-06-01'
ORDER BY timestamp;
```

A claim that first appeared in August 2024 should not be in GPT-4o's knowledge. If
the model cites it, the model leaked. Refract provides the deterministic proof:
revision ID, timestamp, SHA-256 hash.

### Compare leakage rates across models

```sql
-- Count claims per model that appeared after that model's cutoff
SELECT 'GPT-4o (cutoff Jun 2024)' as model,
  count(*) as claims_after_cutoff
FROM 'events-GPT-4.jsonl'
WHERE "eventType" = 'sentence_first_seen'
  AND timestamp > '2024-06-01'
UNION ALL
SELECT 'Claude (cutoff Apr 2024)',
  count(*)
FROM 'events-Claude_(language_model).jsonl'
WHERE "eventType" = 'sentence_first_seen'
  AND timestamp > '2024-04-01'
UNION ALL
SELECT 'Gemini (cutoff Nov 2023)',
  count(*)
FROM 'events-Gemini_(language_model).jsonl'
WHERE "eventType" = 'sentence_first_seen'
  AND timestamp > '2023-11-01';
```

Run the benchmark, test each model against the same claims, publish the leakage
rates per model per month past cutoff. The data is reproducible — include the
Refract version and commit hash in your paper.

## 2. Retrieval quality: who surfaces contested claims as fact?

Two RAG systems, same query, same corpus. One retrieves stable claims. The other
retrieves edit-warred sentences. Both show the same confidence. Refract makes the
difference visible.

### Score claims by stability

```sql
SELECT
  after as claim_text,
  count(*) FILTER (WHERE "eventType" = 'revert_detected') as reverts,
  count(*) FILTER (WHERE "eventType" LIKE 'citation_%') as citation_churn,
  count(*) FILTER (WHERE "eventType" LIKE 'talk_%') as talk_activity,
  count(*) FILTER (WHERE "eventType" LIKE 'template_%') as template_disputes,
  reverts + citation_churn + template_disputes as contestation_score
FROM 'events.jsonl'
WHERE "eventType" LIKE 'sentence_%'
GROUP BY after
ORDER BY contestation_score DESC;
```

Claims with high contestation scores are candidates for closer examination. A RAG
system that retrieves these as fact without hedging is measurably worse.

### Compare two RAG systems

1. Run both systems on the same 50 queries
2. For each retrieved passage, look up its stability score from Refract
3. Count how many contested claims each system retrieves
4. Publish the results: "System A retrieves contested claims 3x more often than System B"

```python
from refract import Refract

r = Refract()
stability = r.analyze("COVID-19", depth="forensic", as_frame=True)

# Score each claim by contestation signals
stability["score"] = (
    stability["event_type"].str.startswith("sentence_").astype(int) *
    (1.0 - 0.3 * (stability["fact"].str.contains("revert", na=False).astype(int)))
)

# Map retrieved passages to stability scores
for passage in rag_system_a_results:
    match = stability[stability["after"].str.contains(passage[:50], na=False)]
    passage.stability = match["score"].mean() if len(match) > 0 else None
```

## 3. Provenance hallucination: who makes up sources?

A model says "According to a 2022 WHO report, ..." Refract checks: was there a
citation to a WHO report on that page in 2022?

### Check if a source ever existed

```sql
SELECT timestamp, "eventType", before, after
FROM 'events.jsonl'
WHERE "eventType" IN ('citation_added', 'citation_removed', 'citation_replaced')
  AND (after LIKE '%who.int%' OR before LIKE '%who.int%')
ORDER BY timestamp;
```

If no results: the model hallucinated the source. If results show `citation_removed`:
the source existed but was removed — the model cited outdated evidence. Either way,
Refract provides the ground truth.

### Build a provenance hallucination benchmark

1. Generate 100 claims from a model, each with a cited source
2. Run Refract on the relevant Wikipedia pages
3. For each claimed source, query `citation_*` events
4. Classify each claim: verified (source found, still present), outdated (source
   found, now removed), hallucinated (no matching source ever existed)
5. Publish the rates per model

## 4. Interpretation divergence: same events, different stories

Feed the same Refract event stream into two models and ask each to summarize.
Same deterministic input — different outputs. The divergence is purely in the model.

### Generate a controlled comparison

```bash
refract analyze "Bitcoin" --depth detailed --since 2024-01-01 > bitcoin-events.jsonl
```

Feed `bitcoin-events.jsonl` to both models with the same prompt:

> "Summarize what changed on the Bitcoin Wikipedia page in 2024. Group by theme:
> citations, claims, disputes, structure. Be specific."

Model A says "3 citations removed, origin claim softened." Model B says "article
updated with new sources, minor structural changes." Same data, different narratives.

Quantify: for 50 pages, how often do models disagree on the same event stream?
On which event types? With what confidence? The events are deterministic — the
disagreement is purely interpretive.

## 5. Knowledge recency: who knows what's current?

A page changed in March. A model trained in January "knows" the January version.
A model trained in June "knows" the March version. Ask both the same question.
Refract shows exactly what the page said at each date.

### Check what a page said at a model's effective knowledge date

```bash
refract snapshot "COVID-19" --at 2024-01-15
refract snapshot "COVID-19" --at 2024-06-15
```

Compare the two snapshots. The difference is what changed between January and June.
Any model trained in January that answers with June information is leaking. Any
model trained in June that answers with January information is stale.

### Build a recency benchmark

1. Select 50 pages with known significant changes
2. Run `refract snapshot` at 3 knowledge dates (e.g., Jan 2024, Apr 2024, Jul 2024)
3. Test each model against each date
4. Score accuracy against the deterministic snapshot at that date
5. Publish: "Model X's effective knowledge is ~2 months behind its claimed cutoff.
   Model Y's knowledge is accurate to within 1 week of its cutoff."

## Using the Python eval adapter

All of the above workflows have a Python equivalent. Install `refract-py` and use
`refract_eval` directly — no CLI needed:

```python
from refract_eval import build_leakage_benchmark, check_provenance, score_retrieval_quality

# Temporal leakage
records = build_leakage_benchmark("events.jsonl", cutoff="2024-06-01")
leaked = [r for r in records if r.leaked]
print(f"Leakage rate: {len(leaked)}/{len(records)}")

# Provenance check
result = check_provenance("events.jsonl", "who.int")
print(f"Verified: {result.verified}, Outdated: {result.outdated}, Hallucinated: {result.hallucinated}")

# Retrieval quality
scores = score_retrieval_quality("events.jsonl", ["passage 1", "passage 2"])
for s in scores:
    print(f"{s['passage'][:50]}... → stability: {s['score']}")
```

The adapter source is in `clients/python/src/refract_eval.py`. See the [Python SDK
tutorial](python-sdk.md) for the full notebook workflow.

## Reproducibility

Every finding includes:

```bash
refract --version
# refract 0.5.3

git log -1 --format="%H" -- packages/evidence-graph packages/analyzers
# a1b2c3d4e5f6...

refract analyze "Page" --depth forensic > events.jsonl
# SHA-256 of events.jsonl: e7f8a9b0c1d2...
```

A reviewer runs the same commands on the same revisions, gets the same hashes.

## Next steps

- [Combat revisionism tutorial](combating-revisionism.md) — deterministic audit trail
- [RAG provenance tutorial](rag-provenance.md) — stability-weighted retrieval
- [BYO-inference tutorial](byo-inference.md) — model-augmented classification
- [MCP agent tutorial](mcp-agent.md) — connect AI agents to Refract
- [Summarization tutorial](summarization.md) — model-generated event summaries
