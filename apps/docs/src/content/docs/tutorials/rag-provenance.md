---
title: "Tutorial: AI provenance for RAG pipelines"
description: "Score the sentences in your retrieval corpus by their Wikipedia edit history, and use the scores to filter or weight retrieval results."
---

## Goal

Score the sentences in your retrieval corpus by their Wikipedia edit history, and use the scores to filter or weight retrieval results.
The history covers removals, rewordings and reverts. RAG systems treat every
sentence as equally stable. Refract makes instability visible.

## Why provenance matters for RAG

A RAG pipeline retrieves text and presents it as fact. If the retrieved text comes from
a Wikipedia sentence that was removed and restored five times in a day, the pipeline
is surfacing contested content without knowing it.

Refract's events record when each sentence appeared, was reworded, was removed, or
came back. Your RAG system can:
- Filter out contested sentences before they reach the model
- Weight retrieval results by edit history
- Surface provenance alongside generated text ("unchanged across the analyzed revisions")

## Step 1: Export the events

Export the pages your RAG pipeline sources from as NDJSON. Give a revision range
(`--from`, `--to`) or a start date (`--since`): without one, the export covers the
page's whole history.

```bash
refract export "Pluto" --from 71593043 --to 71601937 --format ndjson > pluto-events.jsonl
```

That range is 43 revisions from the day Pluto was reclassified. Each line is one
event with camelCase fields (`eventType`, `toRevisionId`, `before`, `after`).

## Step 2: Score sentences by their history

The events carry no claim identifier, so group the sentence events by their text.
Revert events apply to a revision, not a sentence; join them through `toRevisionId`.

```python
import json
from collections import Counter

with open("pluto-events.jsonl") as source:
    events = [json.loads(line) for line in source if line.strip()]

# Revisions whose edit summary matched a revert pattern
revert_revisions = {e["toRevisionId"] for e in events if e["eventType"] == "revert_detected"}

sentences = {}
for e in sorted(events, key=lambda e: e["timestamp"]):
    if not e["eventType"].startswith("sentence_"):
        continue
    text = e["after"] or e["before"]  # a removal carries the text in "before"
    row = sentences.setdefault(text, {
        "section": e["section"],
        "first_event": e["timestamp"],
        "removed": 0,
        "reintroduced": 0,
        "modified": 0,
        "changed_in_revert": 0,
    })
    row["last_event"] = e["timestamp"]
    row["present"] = e["eventType"] != "sentence_removed"
    kind = e["eventType"].removeprefix("sentence_")
    if kind in row:
        row[kind] += 1
    if e["toRevisionId"] in revert_revisions:
        row["changed_in_revert"] += 1

page_signals = Counter(e["eventType"].split("_")[0] for e in events)
print(f"Sentences with events: {len(sentences)}")
print(f"Citation events: {page_signals['citation']}, template events: {page_signals['template']}")
```

On the Pluto range this prints 282 sentences, 43 citation events and 44 template events.

Interpretation:

| Signal | Indicates |
|---|---|
| `removed > 0` | The sentence was deleted at least once in the range |
| `reintroduced > 0` | A removed sentence came back — the removal was contested |
| `modified > 0` | The wording changed while staying above the similarity threshold. The new wording is tracked under its own text |
| `changed_in_revert > 0` | The sentence changed in an edit whose summary matched a revert pattern |

Citation, template and talk-page events are not tied to a sentence. A citation event
names the section that holds the reference, template events carry the section `body`,
and talk-page correlations carry none. Use their counts as section-level or page-level
signals.

## Step 3: Filter your corpus

Use the counts to filter:

```python
stable = {
    text: row for text, row in sentences.items()
    if row["present"] and row["removed"] == 0 and row["changed_in_revert"] == 0
}

print(f"Present and never removed or reverted: {len(stable)}")
print(f"Filtered out: {len(sentences) - len(stable)}")
```

On the Pluto range, 32 sentences pass and 250 are filtered out. A sentence with no
events in the range does not appear in `sentences` at all: nothing happened to it.

## Step 4: Weight retrieval by provenance

Instead of binary filtering, use the history as a retrieval weight. The weights
here are a starting point; choose your own:

```python
def stability_score(row):
    churn = row["removed"] + row["reintroduced"] + row["modified"]
    penalty = 0.2 * churn + 0.4 * row["changed_in_revert"]
    return max(0.0, 1.0 - penalty)

ranked = sorted(sentences.items(), key=lambda item: stability_score(item[1]), reverse=True)
```

Use the score as a reranking feature in your RAG pipeline — sentences with higher
scores surface above contested ones, even if the embedding similarity is identical.

## Step 5: Surface provenance to the user

When your RAG system generates a response, include the provenance:

```python
def format_provenance(row):
    if row["changed_in_revert"]:
        return f"Changed in {row['changed_in_revert']} reverting edit(s)"
    if row["removed"]:
        return f"Removed {row['removed']} time(s), reintroduced {row['reintroduced']} time(s)"
    if row["modified"]:
        return f"Reworded {row['modified']} time(s), last on {row['last_event'][:10]}"
    return f"No removal or rewording since {row['first_event'][:10]} in the analyzed range"
```

The reader sees how the retrieved sentence has changed, next to the sentence. The
statement covers the analyzed revision range only, so say which range that was.

## Step 6: LangChain document loader

refract-py includes a LangChain document loader:

```python
from refract_langchain import RefractLoader

loader = RefractLoader(
    page="Pluto",
    depth="detailed",
    min_stability=0.7,
)
documents = loader.load()
```

Each `Document` is one event. `page_content` is the event's text, and `metadata`
holds the event type, revision IDs, section, timestamp, and a `stability_score` set
by event type. The loader takes no revision range: it analyzes the page's whole
history, which is slow on a long page.

## Next steps

- [Python SDK tutorial](python-sdk.md) — pandas integration and Jupyter workflows
- [Downstream integration](../downstream.md) — production DDL and repository pattern
- [Notebook analysis](../notebooks.md) — DuckDB and Observable workflows
- [Schema reference](../schema.md) — the full evidence event structure
