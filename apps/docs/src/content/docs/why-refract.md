---
title: "Why Refract?"
description: "Refract is a deterministic observation engine for revision histories: it tells you what changed on a page, when, and in which revision."
---

Refract is a deterministic observation engine for revision histories: it tells you what
changed on a page, when, and in which revision.

## Who this is for

### Journalists and researchers

You need to trace how a claim about a person, company, event, or policy evolved across
Wikipedia's revision history. Refract gives you a deterministic timeline of every
change — when a sentence first appeared, when sources were added or removed, when
edits were reverted, and when talk page discussions accompanied the changes.

```bash
refract claim "Theranos" --text "revolutionary blood testing" -c
```

Result: a verifiable timeline of when the claim was added, who softened it, when
the sources disappeared, and when the article was tagged with dispute templates.

### Data scientists and OSINT analysts

You need structured, queryable data about page revision histories — no scraping, no
custom parsers, no fragile heuristics. Refract outputs standard NDJSON that DuckDB,
Python pandas, and any JSON tool can consume directly.

```bash
refract analyze "Bitcoin" --depth forensic --since 2024-01-01 > bitcoin.jsonl
duckdb -c "SELECT event_type, count(*) FROM 'bitcoin.jsonl' GROUP BY 1 ORDER BY 2 DESC"
```

### ML engineers building RAG or training data

You need provenance signals for retrieved text. Is this claim stable? Has it been
contested? Is the supporting source still in the article? Refract attaches claim
stability metadata to every chunk so your retrieval system can weight results by
provenance quality, not just embedding similarity.

```python
# Filter training data to stable, well-sourced claims
stable_claims = df[(df["eventType"] == "sentence_first_seen") 
                   & (df["is_contested"] == False)]
```

### Regulatory and policy monitors

You need to track changes to drug safety pages, guideline entries, or policy language
for early signals of institutional shifts. Refract's cron mode re-observes pages on a
schedule and notifies you when new events fire — citation removal, template disputes,
section reorganization.

```bash
refract cron pages.txt --notify-webhook https://hooks.example.com/refract
```

### AI agent developers

You need an MCP-native tool to give your agent claim-awareness. `refract mcp` starts
a JSON-RPC server that any MCP client can connect to. Your agent can call
`analyze`, `claim`, and `export` directly; no API key is needed.

```json
{
  "mcpServers": {
    "refract": {
      "command": "npx",
      "args": ["-y", "@refract-org/cli", "mcp"]
    }
  }
}
```

### Fan wiki maintainers

Your wiki's canon is contested. Headcanon, fan edits, and retcons overwrite
established lore. Refract tracks every change to every page — when a character's
backstory changed, when a category was reclassified, when one wiki's canon diverged
from another's.

```bash
refract diff "Darth_Vader" \
  --wiki-a https://starwars.fandom.com/api.php \
  --wiki-b https://clone-wars.fandom.com/api.php
```

## What makes Refract different

| Refract | Alternatives |
|---------|-------------|
| **Deterministic** — same input, same output, every run. Byte-for-byte identical. | Most tools depend on model calls, heuristic sampling, or non-reproducible computation |
| **Provenance-tagged** — every event records which analyzer, what version, what parameters | Most tools produce output without an audit trail |
| **26 event types** — sentence lifecycle, citations, templates, reverts, sections, categories, wikilinks, talk pages, edit clusters, protection changes | Most tools track 1–3 signal types |
| **BYO-inference** — every analyzer threshold is a pluggable function. Defaults work offline. Plug a model where you need one. | Most tools are either all-model or no-model, not selectable per boundary |
| **Hash-verifiable** — evidence bundles carry a SHA-256 hash, replay manifests a Merkle root | Most tools export no hash to check a copy against |
| **MCP-native** — AI agents connect via built-in MCP server | Most tools have no AI agent integration |

## When Refract is not the right tool

- **You need real-time monitoring**: Refract is polling-based (via cron or watch mode), not push-based. Use a MediaWiki webhook if you need sub-second latency.
- **You need sentiment analysis**: Refract is deterministic — it doesn't score, rank, or classify editor intent. Use a downstream tool for sentiment.
- **You need editor profiling**: Refract never records editor identities. Use a diff analytics tool if you need per-editor attribution.
- **You need a truth-verification system**: Refract reports what changed, not whether the change is correct. Truth assessment lives downstream.

## Quick evaluation

```bash
# Brief analysis
npx @refract-org/cli analyze "Earth" --depth brief

# Detailed analysis
npx @refract-org/cli analyze "Bitcoin" --depth detailed

# Browse the events in a local web UI
refract explore "Bitcoin"
```

The [complete workflow](complete-workflow.md) walks through one use case in 5 steps.
