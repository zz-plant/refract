---
title: "Tutorial: AI provenance for RAG pipelines"
description: "Score each document in your retrieval corpus by its Wikipedia claim stability — revert count, citation churn, talk page activity, template disputes — and…"
---

## Goal

Score each document in your retrieval corpus by its Wikipedia claim stability — revert
count, citation churn, talk page activity, template disputes — and use those signals
to filter or weight retrieval results. RAG systems treat every sentence as equally
stable. Refract makes instability visible.

## Why provenance matters for RAG

A RAG pipeline retrieves text and presents it as fact. If the retrieved text comes from
a Wikipedia sentence that has been reverted 5 times, lost its citations, and generated
a talk page dispute, the pipeline is surfacing contested content without knowing it.

Refract attaches stability metadata to every sentence. Your RAG system can:
- Filter out contested claims before they reach the model
- Weight retrieval results by source stability
- Surface provenance alongside generated text ("this claim has been stable since 2019")

## Step 1: Export claim stability signals

Run forensic-depth analysis on the pages your RAG pipeline sources from:

```bash
refract analyze "COVID-19" --depth forensic -c > covid-events.jsonl
```

Forensic depth enables talk page correlation, edit cluster detection, and sentence
modification tracking — the signals that distinguish stable from contested claims.

## Step 2: Score claims by stability

Query the event stream for stability signals per claim:

```sql
SELECT
  claim_id,
  after as claim_text,
  min(timestamp) as first_seen,
  max(timestamp) as last_seen,
  count(*) FILTER (WHERE "eventType" = 'revert_detected') as revert_count,
  count(*) FILTER (WHERE "eventType" LIKE 'citation_%') as citation_churn,
  count(*) FILTER (WHERE "eventType" LIKE 'talk_%') as talk_activity,
  count(*) FILTER (WHERE "eventType" LIKE 'template_%') as template_disputes,
  count(*) FILTER (WHERE "eventType" = 'edit_cluster_detected') as edit_clusters
FROM 'covid-events.jsonl'
WHERE "eventType" LIKE 'sentence_%'
  AND claim_id IS NOT NULL
GROUP BY claim_id, after
ORDER BY revert_count DESC, citation_churn DESC;
```

Interpretation:

| Signal | Indicates |
|---|---|
| `revert_count > 0` | The claim was undone — contested by another editor |
| `citation_churn > 3` | Sources added/removed/replaced — evidentiary foundation unstable |
| `talk_activity > 0` | The claim was discussed on the talk page — deliberated, not just edited |
| `template_disputes > 0` | The section was tagged with policy templates (NPOV, citation needed, etc.) |
| `edit_clusters > 0` | The claim was in a rapid-edit cluster — possible edit war |

High revert + high citation churn + low talk activity = contested without deliberation.
High revert + high talk activity = actively deliberated. Knowing which is which matters
for retrieval.

## Step 3: Filter your training data

Use the stability scores to filter:

```python
import json
import duckdb

con = duckdb.connect()

# Load Refract output
events = con.execute("""
  SELECT * FROM 'covid-events.jsonl'
""").fetchdf()

# Score claims
stability = con.execute("""
  SELECT
    claim_id,
    after as claim_text,
    max(CASE WHEN "eventType" = 'revert_detected' THEN 1 ELSE 0 END) as was_reverted,
    count(*) FILTER (WHERE "eventType" LIKE 'citation_%') as citation_churn
  FROM events
  WHERE claim_id IS NOT NULL
  GROUP BY claim_id, after
""").fetchdf()

# Filter to stable, well-sourced claims
stable_claims = stability[
    (stability["was_reverted"] == 0) &
    (stability["citation_churn"] <= 2)
]

print(f"Total claims: {len(stability)}")
print(f"Stable claims: {len(stable_claims)}")
print(f"Filtered out: {len(stability) - len(stable_claims)} contested claims")
```

The filtered set contains only claims that have never been reverted and have minimal
citation churn. Feed these into your RAG corpus and the model sees stable content.

## Step 4: Weight retrieval by provenance

Instead of binary filtering, use stability as a retrieval weight:

```python
# Score each claim 0.0–1.0 by stability
stability["stability_score"] = 1.0 - (
    (stability["was_reverted"] * 0.4) +
    (min(stability["citation_churn"] / 10, 1.0) * 0.3) +
    # ... additional signals
)

# Boost stable claims, deprecate contested ones
stable_claims = stability.sort_values("stability_score", ascending=False)
```

Use the stability score as a reranking feature in your RAG pipeline — claims with higher
stability scores surface above contested ones, even if the embedding similarity is identical.

## Step 5: Surface provenance to the user

When your RAG system generates a response, include the provenance:

```python
def format_provenance(claim_row):
    if claim_row["was_reverted"]:
        return f"⚠️ Contested — reverted {claim_row['revert_count']} times"
    if claim_row["citation_churn"] > 3:
        return f"⚠️ Source-unstable — {claim_row['citation_churn']} citation changes"
    if claim_row["first_seen"]:
        return f"✅ Stable since {claim_row['first_seen'][:10]}"
    return "Unknown stability"
```

The generated response becomes: "COVID-19 was first identified in December 2019
(Source: Wikipedia, stable since 2020-03-15, 3 citations)." The user knows what
they're reading and how much to trust it.

## Step 6: LangChain document loader

refract-py includes a LangChain document loader that wraps this workflow:

```python
from refract_langchain import RefractLoader

loader = RefractLoader(
    page="COVID-19",
    depth="forensic",
    min_stability=0.7,
)
documents = loader.load()
```

Each `Document` has `page_content` (the claim text) and `metadata` (stability score,
revert count, citation churn, first seen, last seen). Integrate directly into a
LangChain retrieval chain.

## Next steps

- [Python SDK tutorial](python-sdk.md) — pandas integration and Jupyter workflows
- [Downstream integration](../downstream.md) — production DDL and repository pattern
- [Notebook analysis](../notebooks.md) — DuckDB and Observable workflows
- [Schema reference](../schema.md) — the full evidence event structure
