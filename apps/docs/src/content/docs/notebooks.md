---
title: "Work with notebooks"
description: "Refract's event output is standard NDJSON — load it into any notebook environment for interactive analysis. This page shows a complete workflow in Python…"
---

Refract's event output is standard NDJSON — load it into any notebook environment for
interactive analysis. This page shows a complete workflow in Python (Jupyter, Marimo)
and R.

## Setup

```bash
pip install pandas altair
refract export "Bitcoin" --format ndjson > events.jsonl
```

This reads Bitcoin's whole history. Add `--from 369361755 --to 372972870` for a
25-revision span from 2010 that finishes in seconds.

## Load and explore

### Python (Jupyter / Marimo)

```python
import pandas as pd
import json

events = []
with open("events.jsonl") as f:
    for line in f:
        if line.strip():
            events.append(json.loads(line))

df = pd.json_normalize(events)
df["timestamp"] = pd.to_datetime(df["timestamp"])

print(f"Loaded {len(df)} events")
print(f"Event types: {df['eventType'].nunique()}")
```

### R

```r
library(jsonlite)
library(dplyr)
library(ggplot2)

events <- stream_in(file("events.jsonl")) %>%
  mutate(timestamp = as.POSIXct(timestamp))
```

## Event type distribution

### Python

```python
import altair as alt

dist = df["eventType"].value_counts().reset_index()
dist.columns = ["event_type", "count"]

alt.Chart(dist).mark_bar().encode(
    x=alt.X("event_type:N", sort="-y", title="Event type"),
    y=alt.Y("count:Q", title="Count"),
    color=alt.Color("event_type:N", legend=None)
).properties(width=600, height=300)
```

### R

```r
events %>%
  count(eventType) %>%
  ggplot(aes(reorder(eventType, n), n)) +
  geom_col() +
  coord_flip() +
  labs(x = "Event type", y = "Count")
```

## Citation churn over time

### Python

```python
citation_df = df[df["eventType"].str.startswith("citation")]
citation_df["month"] = citation_df["timestamp"].dt.to_period("M").astype(str)

churn = citation_df.groupby(["month", "eventType"]).size().reset_index(name="count")

alt.Chart(churn).mark_line(point=True).encode(
    x=alt.X("month:T", title="Month"),
    y=alt.Y("count:Q", title="Events"),
    color=alt.Color("eventType:N", title="Citation event")
).properties(width=600, height=300)
```

### R

```r
events %>%
  filter(grepl("^citation", eventType)) %>%
  mutate(month = format(timestamp, "%Y-%m")) %>%
  count(month, eventType) %>%
  ggplot(aes(as.Date(paste0(month, "-01")), n, color = eventType)) +
  geom_line() +
  geom_point(size = 2) +
  scale_x_date(date_breaks = "3 months", date_labels = "%b %Y") +
  labs(x = "Month", y = "Events", color = "Citation event") +
  theme_minimal()
```

## Claim stability scores

### Python

Define contested vs. stable events:

```python
contested_types = ["revert_detected", "edit_cluster_detected", "sentence_removed"]
df["stability"] = df["eventType"].apply(
    lambda t: "Contested" if t in contested_types else "Stable"
)

stability_counts = df["stability"].value_counts().reset_index()
stability_counts.columns = ["category", "count"]
stability_counts
```

### R

```r
events %>%
  mutate(stability = ifelse(
    eventType %in% c("revert_detected", "edit_cluster_detected", "sentence_removed"),
    "Contested", "Stable"
  )) %>%
  count(stability)
```

A high ratio of contested-to-stable events indicates an actively disputed page.
A page with mostly stable events (citations added, sections reorganized, categories
changed) is undergoing editorial improvement, not dispute.

## Section-level analysis

Which sections have the most activity?

### Python

```python
section_activity = df["section"].value_counts().head(10)
section_activity
```

### R

```r
events %>%
  count(section, sort = TRUE) %>%
  top_n(10)
```

Sections with high event counts combined with high revert ratios are the most
contested parts of the page. Drill into a specific section by filtering on
its name and re-running the stability analysis.

## Exporting results

### Python

```python
# Save stability analysis as CSV
stability_counts.to_csv("bitcoin-stability.csv", index=False)

# Save filtered events to new JSONL
contested = df[df["stability"] == "Contested"]
contested.to_json("contested-events.jsonl", orient="records", lines=True)
```

## Next steps

- [Analyze with DuckDB](analytics.md)
- [Monitor citation churn on specific pages](tutorials/citation-churn.md)
- [Build a dispute timeline](tutorials/dispute-timeline.md)

## Using the Python SDK (`refract-py`)

The [refract-py](https://github.com/refract-org/refract/tree/main/clients/python) package provides typed
dataclasses and pandas integration for Python workflows:

```bash
pip install "git+https://github.com/refract-org/refract.git#subdirectory=clients/python"  # not on PyPI
```

### Load events with typed dataclasses

```python
from refract import Refract, EvidenceEvent

client = Refract()
# "from" is a Python keyword, so pass revision bounds through a dictionary.
span = {"from": "369361755", "to": "372972870"}
events = client.analyze("Bitcoin", depth="detailed", **span)
# → list[EvidenceEvent] with typed fields: eventType, timestamp, section, etc.
```

The client stops the CLI after 120 seconds, and `detailed` without bounds reads the
whole history, so a page as long as Bitcoin needs the span.

### Load into pandas DataFrame

```python
import pandas as pd

# One row per event: event_type, timestamp, section, revision IDs, first fact
df = client.analyze("Bitcoin", depth="detailed", as_frame=True, **span)
df["timestamp"] = pd.to_datetime(df["timestamp"])

# Quick exploration
df["event_type"].value_counts()
df.groupby("section")["event_type"].count().sort_values(ascending=False)
```

### Analyze claim stability

```python
contested_types = ["revert_detected", "edit_cluster_detected", "sentence_removed"]
df["stability"] = df["event_type"].apply(
    lambda t: "Contested" if t in contested_types else "Stable"
)

print(df["stability"].value_counts())
```

### Export to Parquet for archival

```python
df.to_parquet("bitcoin-events.parquet", index=False)
```

### LangChain document loader

```python
from refract_langchain import RefractLoader

# The loader takes no revision bounds; "brief" reads the latest 20 revisions.
loader = RefractLoader(page="Bitcoin", depth="brief")
docs = loader.load()
# → list[Document]: page_content is the event's text, metadata holds the event
#   type, revision IDs, section, timestamp and a stability score
```

The Python SDK wraps the `@refract-org/cli` npm package — install both for full
functionality: `pip install "git+https://github.com/refract-org/refract.git#subdirectory=clients/python"` plus the Refract CLI. A
non-zero exit from the CLI raises `RefractError` with its stderr.
