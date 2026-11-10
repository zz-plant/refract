# refract-py

Python adapter for [Refract](https://github.com/refract-org/refract), maintained in `clients/python`. The core engine reconstructs observations from source revision histories; this package calls its CLI and parses NDJSON into Python dataclasses or DataFrames.

## Install

```bash
pip install "git+https://github.com/refract-org/refract.git#subdirectory=clients/python"
npm install -g @refract-org/cli@0.6.0
```

Python 3.10+ and Node.js 20+ are required. The adapter looks for `refract` on PATH, then falls back to `npx @refract-org/cli`, which may download the CLI. Install the CLI explicitly when you need a controlled version. Fetching source histories requires network access.

For pandas, include the optional dependency:

```bash
pip install "refract-py[dataframe] @ git+https://github.com/refract-org/refract.git#subdirectory=clients/python"
```

## Inspect a bounded history

```python
from refract import Refract

r = Refract()
# "from" is a Python keyword, so pass revision bounds through a dictionary.
bounds = {"from": "369361755", "to": "369393212"}
events = r.analyze("Bitcoin", depth="detailed", **bounds)
for event in events:
    print(event.eventType, event.fromRevisionId, event.toRevisionId)
    print(event.before, event.after)
```

The kwargs become CLI flags; values should be strings. This span compares two Wikipedia revisions from 2010-06-21. Inspect `citation_removed` and the corresponding source diff. A citation change alone does not establish whether a statement is supported.

Use `Refract(binary="/absolute/path/to/refract")` to select an installed CLI. A built core entry point also works: `Refract(binary="/absolute/path/to/refract/packages/cli/dist/src/cli.js")` runs it with Node.

## Work with rows

```python
df = r.analyze("Bitcoin", depth="detailed", as_frame=True, **bounds)
print(df.groupby("event_type").size())

events = r.export("Bitcoin", format="ndjson", **bounds)
```

`as_frame=True` creates flattened rows with event type, revision IDs, section, timestamp, event ID, schema version, and the first fact's analyzer metadata. An empty result has no rows and may have no columns. The dataclasses expose selected event fields; they do not retain every enrichment field from the original NDJSON. Keep the original CLI export when you need the complete record.

## LangChain and evaluation modules

The wheel ships two more modules. `refract_langchain` loads events as LangChain documents:

```bash
pip install "refract-py[langchain] @ git+https://github.com/refract-org/refract.git#subdirectory=clients/python"
```

```python
from refract_langchain import RefractLoader

loader = RefractLoader(page="Bitcoin", depth="detailed", min_stability=0.5)
for doc in loader.load():
    print(doc.metadata["event_type"], doc.metadata["stability_score"])
```

The loader reads the page's available history, so try a short page first. Events with high revert counts, citation churn, or edit clusters score lower, and `min_stability` drops those below the value you pass.

`refract_eval` maps exported events to model-evaluation records, with `build_leakage_benchmark("events.jsonl", cutoff="2024-06-01")` and `check_provenance("events.jsonl", "example.org")`. See the [Python SDK guide](https://zz-plant.github.io/refract/python-sdk/) for more.

## Review workflow

The core `review` command has a separate saved-report format and acknowledgment loop. This adapter currently wraps `analyze` and `export`; it does not provide a review method. Use the CLI and the [review guide](https://zz-plant.github.io/refract/review/) for that workflow.

`RefractError` is raised for nonzero CLI exits. An analysis event list alone does not describe complete source coverage. For coverage-sensitive review, retain and inspect the core review report instead.

## Data integrations

| Tool | Interface |
|---|---|
| pandas / Jupyter | Dataclasses and flattened DataFrames from the methods above |
| DuckDB | Read original CLI NDJSON with `SELECT * FROM read_json_auto('events.ndjson')` |
| Browser viewer | Open original CLI NDJSON in [apps/ui](../../apps/ui/README.md) |

Event contracts and captured examples live with the engine in this repository. The former `refract-py.git` installation URL stays at its archived version; use the subdirectory target above for current development.

## Development

```bash
python -m pip install -e . pytest hatch
python -m pytest tests/ -v
hatch build
```

Build the core CLI at the repository root before running contract tests, or set `REFRACT_CLI` to a built `cli.js`. CI tests the installed wheel on Python 3.10 and 3.12 against the CLI built from the same commit.

## License

AGPL-3.0.
