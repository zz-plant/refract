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

## Step 1: Analyze a page and get typed objects

The SDK converts NDJSON `eventType` (camelCase) to pandas `event_type` (snake_case) for Python conventions. DataFrames use `event_type`, Python dataclasses use `eventType`.

```python
from refract import Refract

r = Refract()

# Analyze at forensic depth for maximum signal
events = r.analyze("COVID-19", depth="forensic")

print(f"Found {len(events)} events")
print(f"First event: {events[0].eventType} at {events[0].timestamp}")
```

Each event is a typed `EvidenceEvent` dataclass with `.eventType`, `.timestamp`,
`.section`, `.before`, `.after`, `.fromRevisionId`, `.toRevisionId`, and
`.deterministicFacts`. No manual JSON parsing needed.

## Step 2: Load into pandas as a DataFrame

```python
# Direct DataFrame export with flattened fields
df = r.analyze("COVID-19", depth="forensic", as_frame=True)

print(df.columns)
# Index(['timestamp', 'event_type', 'from_revision_id', 'to_revision_id',
#        'section', 'event_id', 'schema_version', 'layer', 'fact',
#        'fact_detail', 'analyzer_name', 'analyzer_version'], dtype='object')

print(df.head())
```

The `as_frame=True` flag returns a pandas DataFrame with nested fields (deterministic
facts, provenance) flattened into columns. No manual transformation needed.

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

Sections with high revert counts and low talk activity are edit-warred. Sections with
high revert counts and high talk activity are actively deliberated. The DataFrame
makes this distinction visible at a glance.

## Step 6: Export for further analysis

```python
# Export as flat CSV
df_flat = r.export("COVID-19", format="ndjson", flatten=True, as_frame=True)
df_flat.to_csv("covid-events.csv", index=False)

# Or export as raw NDJSON for DuckDB
events_raw = r.export("COVID-19", format="ndjson")
with open("covid-events.jsonl", "w") as f:
    for event in events_raw:
        f.write(json.dumps(event) + "\n")
```

## Step 7: Error handling

```python
from refract import Refract, RefractError

r = Refract()

try:
    events = r.analyze("ThisPageDoesNotExist", depth="brief")
except RefractError as e:
    print(f"Refract error: {e}")
    # Handle gracefully — the page may have been deleted, the API may be down,
    # or the CLI may not be installed
```

## Step 8: Use the model evaluation adapter

`refract_eval` maps Refract events to model evaluation records — no CLI needed:

```python
from refract_eval import build_leakage_benchmark, check_provenance

# Export events first, then use the adapter
r.export("COVID-19", format="ndjson", flatten=False)
# (events saved to stdout — pipe to file, then load with adapter)

# Or use pre-computed events:
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
