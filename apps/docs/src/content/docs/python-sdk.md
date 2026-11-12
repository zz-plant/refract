---
title: "Python SDK"
description: "The official Python SDK for Refract — wraps the CLI via subprocess and provides typed dataclasses, pandas integration, and notebook support."
---

The official Python SDK for Refract — wraps the CLI via subprocess and provides typed dataclasses, pandas integration, and notebook support.

## Install

```bash
pip install "git+https://github.com/refract-org/refract.git#subdirectory=clients/python"  # not on PyPI
```

Requires the Refract CLI (the SDK calls it via subprocess):

```bash
npm install -g @refract-org/cli
```

`npx @refract-org/cli` is used as a fallback if `refract` is not on PATH.
`Refract(binary=...)` takes the path to a particular CLI instead; a path ending in
`.js` is run with `node`.

## Quick start

```python
from refract import Refract

r = Refract()

# Analyze — get typed dataclasses. "brief" reads the latest 20 revisions.
events = r.analyze("Bitcoin", depth="brief")
for event in events:
    print(event.eventType, event.timestamp)

# "from" is a Python keyword, so pass revision bounds through a dictionary.
bounds = {"from": "369361755", "to": "369393212"}

# The same analysis as a pandas DataFrame
df = r.analyze("Bitcoin", depth="forensic", as_frame=True, **bounds)
print(df.groupby("event_type").size())
```

Without bounds, `detailed` and `forensic` read the page's whole history. The client
stops the CLI after 120 seconds with `subprocess.TimeoutExpired`, so bound a long page
with `from`/`to` or `since`.
The examples below reuse `r` and `bounds`.

## API reference

### `Refract`

The main client. With no arguments it finds the CLI itself; `binary` selects one.

```python
r = Refract()
r = Refract(binary="/absolute/path/to/refract/packages/cli/dist/src/cli.js")
```

### `analyze(page, depth, as_frame, as_polars, **flags)`

Analyze a page. Returns `list[EvidenceEvent]`, or a DataFrame if `as_frame=True` or `as_polars=True`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | `str` | required | Page title |
| `depth` | `str` | `"brief"` | `"brief"`, `"detailed"`, or `"forensic"` |
| `as_frame` | `bool` | `False` | Return a pandas DataFrame |
| `as_polars` | `bool` | `False` | Return a polars DataFrame |
| `**flags` | `str` | none | Other `refract analyze` flags, such as `since="2024-01-01"` or `api="https://…/api.php"`. Underscores become hyphens; values must be strings |

```python
events = r.analyze("Bitcoin", depth="forensic", **bounds)
df = r.analyze("Bitcoin", depth="forensic", as_frame=True, **bounds)
```

A page with no revisions returns an empty list. `RefractError` is raised when the CLI
exits non-zero, for example on revision bounds in the wrong order.

The client has no `claim` method. To follow one statement, use the CLI's
`refract claim "Bitcoin" --text "…"`, or filter events on `before` and `after`.

### `export(page, format, flatten, as_frame, as_polars, **flags)`

Run `refract export`, which analyzes at `detailed` depth.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | `str` | required | Page title |
| `format` | `str` | `"ndjson"` | `"ndjson"`, `"json"`, or `"csv"` |
| `flatten` | `bool` | `False` | With `format="csv"`, one flat column per field |
| `as_frame` | `bool` | `False` | With `format="ndjson"`, return a pandas DataFrame |
| `as_polars` | `bool` | `False` | With `format="ndjson"`, return a polars DataFrame |
| `**flags` | `str` | none | Other `refract export` flags, as for `analyze` |

`"ndjson"` returns `list[EvidenceEvent]` or a DataFrame. `"json"` and `"csv"` return
the CLI's output as a string.

```python
df = r.export("Bitcoin", format="ndjson", as_frame=True, **bounds)
csv_text = r.export("Bitcoin", format="csv", flatten=True, **bounds)
```

### `EvidenceEvent` dataclass

```python
@dataclass
class EvidenceEvent:
    schemaVersion: str | None = None
    eventId: str | None = None
    eventType: str = ""
    fromRevisionId: int = 0
    toRevisionId: int = 0
    section: str = ""
    before: str = ""
    after: str = ""
    deterministicFacts: list[DeterministicFact] = field(default_factory=list)
    modelInterpretation: dict | None = None
    layer: str = ""
    timestamp: str = ""
```

Every field has a default, so construct one by keyword. `eventId` is set on events
from `export`; `analyze` events have `None`. Other keys in the CLI's NDJSON, such
as `editMagnitude`, are not kept.

## Integrations

### pandas & polars

`analyze` and `export` (NDJSON format) accept `as_frame=True` for a pandas DataFrame or `as_polars=True` for a polars DataFrame, one row per event:

```python
# pandas
df_pandas = r.analyze("Bitcoin", depth="forensic", as_frame=True, **bounds)

# polars
df_polars = r.analyze("Bitcoin", depth="forensic", as_polars=True, **bounds)
print(df_polars.group_by("event_type").len())
```

The columns are `timestamp`, `event_type`, `from_revision_id`, `to_revision_id`,
`section`, `event_id`, `schema_version`, `layer`, `fact`, `fact_detail`,
`analyzer_name` and `analyzer_version`. `fact` and `fact_detail` come from the
event's first fact. There is no `before` or `after` column; read those from the
dataclasses. `event_id` is empty for `analyze`, and the two analyzer columns are
empty because the CLI attaches no provenance to facts today.

### Sentence survival (`compute_survival_records`)

How long each sentence stayed on the page. A span starts at `sentence_first_seen` or `sentence_reintroduced` and ends at `sentence_removed`, matched on section and the first 60 characters of the sentence. A sentence still present at the end is right-censored (`event_observed` 0, no end time):

```python
from refract import compute_survival_records

# 25 revisions from June and July 2010
span = {"from": "369361755", "to": "372972870"}
events = r.analyze("Bitcoin", depth="detailed", **span)
survival_data = compute_survival_records(events)

# One record per span:
# [
#   {
#     "statement_key": "Monetary and Financial Benefits::Hayek Institute of Canada]accepts Bitcoins as a form of dona",
#     "section": "Monetary and Financial Benefits",
#     "start_time": "2010-06-23T17:44:30Z",
#     "end_time": "2010-06-23T17:44:46Z",
#     "duration_days": 0.00018518518518518518,
#     "event_observed": 1
#   },
#   ...
# ]
```

### NetworkX (`to_networkx`)

A directed graph of revision transitions: a node per revision (`rev:<id>`) and an edge from each event's `fromRevisionId` to its `toRevisionId`, carrying that event's `eventType` and `timestamp` (a later event on the same pair overwrites them). It also adds a `cites` edge from a revision to any fact detail containing `url=`. No analyzer emits a citation URL as a fact, but at `forensic` depth the `full_wikitext_before`/`full_wikitext_after` facts contain `url=` whenever the page cites a web source, and each becomes a node holding a revision's whole wikitext, so build the graph from `brief` or `detailed` events:

```python
from refract import to_networkx

events = r.analyze("Bitcoin", depth="detailed", **bounds)
G = to_networkx(events)

import networkx as nx
print(f"Nodes: {G.number_of_nodes()}, Edges: {G.number_of_edges()}")
```

### LangChain

`refract_langchain.py` loads events as `Document` objects with stability metadata for provenance-aware RAG. The loader takes `page`, `depth`, `api_url` and `min_stability`, not revision bounds, so use `brief` on a long page:

```python
from refract_langchain import RefractLoader

loader = RefractLoader(page="Bitcoin", depth="brief")
documents = loader.load()

for doc in documents:
    print(doc.metadata["event_type"], doc.metadata["stability_score"])
```

`stability_score` is set by event type: removed sentences 0.0, reverts and edit
clusters 0.2, modified sentences 0.5, first-seen sentences 0.9, everything else 0.8.
`min_stability` drops documents below the value you pass.

### Jupyter / Marimo

Combine with `pandas` and `matplotlib` or `altair` for interactive exploration:

```python
df = r.analyze("Bitcoin", depth="forensic", as_frame=True, **bounds)
citations = df[df["event_type"].str.startswith("citation_")]
citations.groupby("event_type").size().plot(kind="bar")
```

## Domain boundary

This SDK wraps the Refract CLI. It does not add model logic, interpretation, or domain-specific judgment. It provides typed Python access to deterministic observation output.

## Source

[Source: `clients/python`](https://github.com/refract-org/refract/tree/main/clients/python)
