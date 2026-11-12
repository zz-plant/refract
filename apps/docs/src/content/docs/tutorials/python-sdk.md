---
title: "Tutorial: Python SDK notebook workflow"
description: "Use refract-py to analyze Wikipedia pages, load results into pandas DataFrames, plot citation churn and claim stability, and export findings — all from a…"
---

## Goal

Use `refract-py` to analyze Wikipedia pages, load results into pandas DataFrames,
plot citation churn and claim stability, and export findings — all from a Jupyter
notebook or Python script.

## Prerequisites

```bash
pip install "git+https://github.com/refract-org/refract.git#subdirectory=clients/python" pandas matplotlib  # not on PyPI
```

The Python SDK wraps the Refract CLI via subprocess. Install the CLI:

```bash
npm install -g @refract-org/cli
```

Or use `npx` — the SDK falls back to it automatically.

The client stops the CLI after 120 seconds. This tutorial uses `brief` depth, which
reads the latest 20 revisions. `detailed` and `forensic` read the whole history
unless you pass `since` or revision bounds, which is too long for a page this size.

## Step 1: Analyze a page and get typed objects

The SDK converts NDJSON `eventType` (camelCase) to pandas `event_type` (snake_case) for Python conventions. DataFrames use `event_type`, Python dataclasses use `eventType`.

```python
import json
from dataclasses import asdict

import pandas as pd
from refract import Refract

r = Refract()

# The latest 20 revisions
events = r.analyze("COVID-19", depth="brief")

print(f"Found {len(events)} events")
print(f"First event: {events[0].eventType} at {events[0].timestamp}")
```

Each event is a typed `EvidenceEvent` dataclass with `.eventType`, `.timestamp`,
`.section`, `.before`, `.after`, `.fromRevisionId`, `.toRevisionId`, and
`.deterministicFacts`. No manual JSON parsing needed.

## Step 2: Load into pandas as a DataFrame

```python
# The same events, one row each
df = r.analyze("COVID-19", depth="brief", as_frame=True)

print(df.columns)
# Index(['timestamp', 'event_type', 'from_revision_id', 'to_revision_id',
#        'section', 'event_id', 'schema_version', 'layer', 'fact',
#        'fact_detail', 'analyzer_name', 'analyzer_version'], dtype='object')

print(df.head())
```

The `as_frame=True` flag returns a pandas DataFrame. `fact` and `fact_detail` come
from the event's first deterministic fact.

`event_id` is empty for `analyze` and filled for `export`. `analyzer_name` and
`analyzer_version` are empty because the CLI attaches no provenance to facts today.
The frame has no `before` or `after` column; read the text from the dataclasses.

## Step 3: Analyze event type distribution

```python
# Count events by type
event_counts = df["event_type"].value_counts()
print(event_counts)

# Plot
import matplotlib.pyplot as plt

event_counts.head(10).plot(kind="barh", figsize=(10, 6))
plt.title("Top 10 Event Types — COVID-19 Wikipedia Page")
plt.xlabel("Event Count")
plt.tight_layout()
plt.show()
```

## Step 4: Plot citation churn over time

```python
# Filter to citation events
citations = df[df["event_type"].str.startswith("citation_")].copy()
citations["date"] = pd.to_datetime(citations["timestamp"]).dt.date

# Count by date and type
churn = citations.groupby(["date", "event_type"]).size().unstack(fill_value=0)

# Plot
churn.plot(kind="area", figsize=(14, 6), alpha=0.7, stacked=True)
plt.title("Citation Churn — COVID-19 Wikipedia Page")
plt.xlabel("Date")
plt.ylabel("Events per Day")
plt.legend(title="Event Type")
plt.tight_layout()
plt.show()
```

An area chart shows the rhythm of citation activity — when sources were being actively
added (expansion) vs removed (contraction) vs replaced (re-evaluation).

## Step 5: Identify the most contested sections

```python
# Count events per section
section_activity = df.groupby("section").agg(
    total_events=("event_type", "count"),
    reverts=("event_type", lambda x: (x == "revert_detected").sum()),
    citations=("event_type", lambda x: (x.str.startswith("citation_")).sum()),
    talk=("event_type", lambda x: (x.str.startswith("talk_")).sum()),
).sort_values("total_events", ascending=False)

print(section_activity.head(10))
```

`revert_detected`, `edit_cluster_detected` and `talk_page_correlated` describe a whole
revision, so they are counted on the row whose `section` is the empty string. The
named rows show where sentence and citation changes concentrate.

## Step 6: Export for further analysis

```python
# Save the flat rows as CSV
df.to_csv("covid-events.csv", index=False)

# Save the events as JSON Lines, with before and after text
with open("covid-events.jsonl", "w") as f:
    for event in events:
        f.write(json.dumps(asdict(event)) + "\n")
```

The dataclasses keep selected fields. For the complete record, including `eventId`
and the enrichment fields, write the CLI's own export for a bounded range:

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > bitcoin-events.jsonl
```

## Step 7: Error handling

```python
from refract import Refract, RefractError

r = Refract()

try:
    # Bounds in the wrong order make the CLI exit non-zero
    r.analyze("Bitcoin", depth="brief", **{"from": "369393212", "to": "369361755"})
except RefractError as e:
    print(f"Refract error: {e}")

# A page with no revisions is not an error: the result is an empty list
missing = r.analyze("ThisPageDoesNotExist", depth="brief")
print(len(missing))  # 0
```

`RefractError` carries the CLI's exit code and stderr. It is also raised when neither
`refract` nor Node.js can be found.

## Step 8: Use the model evaluation adapter

`refract_eval` maps Refract events to model evaluation records. It reads a JSON Lines
file and does not call the CLI:

```python
from refract_eval import build_leakage_benchmark, check_provenance

# The file written in step 6
records = build_leakage_benchmark("covid-events.jsonl", cutoff="2024-06-01")
leaked = [r for r in records if r.leaked]
print(f"Leakage rate: {len(leaked)}/{len(records)}")

# Check if a source ever existed on the page
result = check_provenance("covid-events.jsonl", "who.int")
print(f"Verified: {result.verified}, Outdated: {result.outdated}")
```

See the [model evaluation tutorial](model-evaluation.md) for full benchmark workflows and
the [benchmark specification](https://github.com/refract-org/refract/blob/main/BENCHMARK.md)
for standard pages and submission format.

## Next steps

- [RAG provenance tutorial](rag-provenance.md) — using stability signals in retrieval
- [Analytics with DuckDB](../analytics.md) — SQL queries on Refract NDJSON output
- [Notebook analysis](../notebooks.md) — DuckDB, Observable, and Marimo workflows
- [SDK reference](../sdk.md) — all packages and their APIs
