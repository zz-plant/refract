---
title: "Downstream integration"
description: "Refract produces a deterministic event stream. Downstream systems consume that stream to interpret what the changes mean for their domain."
---

Refract produces a deterministic event stream. Downstream systems consume that stream to interpret what the changes mean for their domain.

## Integration surfaces

### 1. Structured events via CLI

```bash
# Export events as NDJSON
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > bitcoin-events.jsonl

# Export as ObservationReport with Merkle root
refract analyze "Bitcoin" --from 369361755 --to 369393212 --report > bitcoin-report.json
```

Each event carries `schemaVersion` and an `eventId`, a deterministic hash of the event's type, revisions, section, text, timestamp and facts.

### 2. SDK events from your own revisions

```typescript
import { annotateEvents, buildRevisionEvents } from "@refract-org/analyzers";
import { createEventIdentity } from "@refract-org/evidence-graph";

const events = annotateEvents(buildRevisionEvents(revisions));
for (const event of events) event.eventId = createEventIdentity(event);
```

These are the events the CLI derives from each pair of revisions, from the same code: the CLI calls `buildRevisionEvents` too. Both functions are exported from `@refract-org/analyzers` 0.5.1 on. Before it, a consumer had to copy the CLI's diff code, and a copy drifts: import the export rather than keeping one. See the [SDK reference](sdk.md#basic-pipeline).

### 3. FactProvenance for auditability

`FactProvenance` in `@refract-org/evidence-graph` is the shape for recording which analyzer, at which version and with which parameters, produced a fact:

```json
{
  "analyzer": "section-differ",
  "version": "0.5.3",
  "inputHashes": [],
  "parameters": { "similarityThreshold": 0.8 }
}
```

Refract's own events do not fill it in: their facts carry `fact` and `detail`. A consumer that needs per-fact provenance records it when it stores the events, taking the version from the installed `@refract-org/analyzers` and the parameters from the options it passed.

### 4. Schema versioning

Every event carries `schemaVersion` matching `EVENT_SCHEMA_VERSION`. This prevents silent invalidation of historical observations when `EventType` gains new members.

### 5. Config version pinning

The CLI sets `AnalyzerConfig.$version` to its own version while it runs. The config is not written to the output, so record the flags you passed alongside the events. The version itself is in the output: `analyzerVersion` in an `ObservationReport`, `analyzerVersions` in a replay manifest.

```bash
refract analyze "Bitcoin" --from 369361755 --to 369393212 --similarity 0.85 --json > bitcoin-events.jsonl
# sentence matching ran at 0.85; store that with bitcoin-events.jsonl
```

### 6. ObservationReport for chain-of-custody

```json
{
  "pageTitle": "Bitcoin",
  "pageId": 28249265,
  "observedAt": "2026-05-15T10:00:00Z",
  "revisionRange": { "from": 100, "to": 200 },
  "claims": { ... },
  "eventCount": 47,
  "uniqueEditorCount": 9,
  "merkleRoot": "a1b2c3d4...",
  "analyzerVersion": "0.6.0",
  "coverage": { ... }
}
```

The Merkle root is from the replay manifest. A downstream system can verify events match the observation.

## Baseline superiority validation

When validating a signal built on Refract events, compare it against baselines counted from the same events, such as revert count and citation changes. A signal that does not outperform those counts adds nothing to them. Refract exports no function for this comparison; it belongs in the consumer's validation code.

```typescript
const baselines = {
  totalEvents: events.length,
  revertCount: events.filter((e) => e.eventType === "revert_detected").length,
  citationChanges: events.filter((e) => e.eventType.startsWith("citation_")).length,
};
```

## Principle

Refract's event stream is purely mechanical. All interpretation happens downstream. Refract provides the deterministic record; the consumer provides the judgment.

## What downstream systems build

| Consumer | Builds on Refract |
|----------|-------------------|
| **Healthcare claim review** | Feed structured events into a review pipeline that checks whether a claim still holds up against the current evidence. Store the analyzer version and thresholds with each event, since the events do not carry them. |
| **AI training data curation** | Score each claim by revert count, citation churn, talk page correlation, and template dispute history. Include only stable, well-sourced claims in training data. |
| **Provenance-aware RAG** | Enrich each retrieved chunk with its claim history — stable, recently changed, source-fragile, contested. Use the signal to weight or filter results. |
| **Regulatory monitoring** | Run `refract cron` on drug pages, guidelines, and regulatory topics. Alert on citation removal, template disputes, or section reorganization. |
| **Competitive intelligence** | Use `refract diff` to compare how the same topic is framed across wikis (English vs German Wikipedia, Fandom vs independent wiki). Track divergence over time. |
| **Fact-checking** | Given a claim, query its lifecycle — first appearance, source additions, revert history, talk page activity. Detect citation laundering (same claim, different source). Return a verifiable provenance timeline. See [tutorial](tutorials/combating-revisionism.md). |
| **Academic research** | Export `ObservationReport` with Merkle-verifiable claim histories. Combat revisionism with deterministic event streams that anyone can reproduce independently. Analyze claim stability across topics, time periods, and editorial environments. |
| **Journalism forensics** | Track how a specific claim about a person evolved. Detect coordinated editing (edit clusters), source softening (citation laundering), or removal without replacement. See [tutorial](tutorials/combating-revisionism.md). |
| **Fan wiki canon tracking** | Compare the same fictional universe across competing wikis. Detect retcon divergence and measure by how much. |
| **Knowledge graph engineering** | Use `--depth forensic` to capture category and wikilink change events. Build an entity graph that evolves with the public record. |

## Complementary technologies

Refract pairs naturally with these modern tools. The event stream is standard JSON/NDJSON — anything that reads JSON or speaks HTTP can consume it.

| Category | Technology | How they fit |
|----------|-----------|-------------|
| **Vector databases** | Pinecone, Weaviate, pgvector, Chroma | Store claim embeddings alongside stability metadata. Query: "find claims similar to X that are stable and well-sourced." |
| **RAG frameworks** | LangChain, LlamaIndex, Vercel AI SDK | Use Refract's stability/contestation signals as retrieval filters or reranking features. A [LangChain document loader](https://github.com/refract-org/refract/blob/main/clients/python/src/refract_langchain.py) is available in the `refract-py` package. |
| **AI coding agents** | Claude Code, Cline, Codex CLI, OpenClaw | Agents connect via Refract's built-in MCP server (`refract mcp`) to read claim histories, track changes, and cite provenance in their reasoning. |
| **Python SDK** | `refract-py` ([source](https://github.com/refract-org/refract/tree/main/clients/python)) | Typed dataclasses, pandas DataFrame integration, `RefractError` handling. Install: `pip install "git+https://github.com/refract-org/refract.git#subdirectory=clients/python"` (not on PyPI; needs the Refract CLI on `PATH`). |
| **MCP (Model Context Protocol)** | Any MCP client (Claude Desktop, VS Code, Cursor, ChatGPT) | `refract mcp` is a native MCP server exposing tools for analyze, claim, export, cron, and classify. AI agents use these tools to retrieve claim history directly. |
| **Data lakes & query** | DuckDB, Apache Parquet, ClickHouse | Query `refract export --format ndjson` output with SQL. DuckDB can query JSONL files directly: `SELECT "eventType", count(*) FROM 'events.jsonl' GROUP BY "eventType";` |
| **Streaming** | Apache Kafka, Redpanda, Cloudflare Queues | Feed event streams into real-time claim monitoring pipelines. Each `EvidenceEvent` is one message; key it by page title or `eventId`, since CLI events carry no `claimId`. |
| **Visualization** | Observable Framework, Mermaid, D3 | `refract visualize --format mermaid` produces Mermaid diagrams. Observable Framework has a [data loader recipe](./sdk.md#observable-framework-data-loader). D3 reads event JSONL directly. |
| **Knowledge graphs** | RDF, SPARQL, Neo4j | Convert `wikilink_added`/`category_added` events into triple statements. Build an evolving entity graph where each edge has a revision timestamp. |
| **Model serving** | OpenAI API, DeepSeek, Ollama, vLLM, Workers AI | Plug any OpenAI-compatible endpoint into `refract classify` at each BYO-inference boundary. Workers AI runs models at the edge without managing servers. |
| **Local inference** | WebGPU, MLX, llama.cpp | Run detection models directly on-device — no API key needed. Refract defaults are mechanical (zero inference), but any boundary can be replaced with a local model via MCP sampling or Ollama. |
| **Notebooks** | Jupyter, Marimo, Observable notebooks | Load event JSONL into a DataFrame: `pd.read_json("events.jsonl", lines=True)`. Analyze claim stability, citation churn, and edit cluster patterns interactively. Marimo's reactive runtime is particularly well-suited for live event stream analysis. |
| **Serverless** | Cloudflare Workers, D1, R2, Queues | Import the library packages in a Worker (`nodejs_compat`; they use `node:crypto`) to fetch and diff revisions at the edge, store events in D1, export to R2, queue re-observations. The CLI needs Node or Bun and a filesystem, so it runs on a scheduled runner, not in a Worker — see [cron](cron.md#serverless-platforms). |

## Production ingestion

When consuming Refract events in a production pipeline, persist them to a queryable table. The schema below is a reference DDL that works with any relational database (D1, PostgreSQL, SQLite):

```sql
CREATE TABLE refract_events (
    event_id TEXT PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    from_revision_id INTEGER NOT NULL,
    to_revision_id INTEGER NOT NULL,
    section TEXT NOT NULL,
    fact TEXT NOT NULL,
    fact_detail TEXT,
    analyzer_name TEXT,
    analyzer_version TEXT,
    input_hashes TEXT,       -- JSON array of input hashes
    parameters_json TEXT,    -- JSON: effective FactProvenance parameters
    observed_at TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    page_title TEXT NOT NULL,
    entity_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_refract_events_batch ON refract_events(batch_id);
CREATE INDEX idx_refract_events_type ON refract_events("eventType");
CREATE INDEX idx_refract_events_page ON refract_events(page_title);
CREATE INDEX idx_refract_events_observed ON refract_events(observed_at);
```

### Repository pattern

Use a single adapter file as the import boundary between Refract and your codebase. The adapter re-exports Refract functions and types; no other file imports from `@refract-org/*` directly.

```typescript
// adapter.ts — single import boundary
export type { EvidenceEvent, FactProvenance, AnalyzerConfig } from '@refract-org/evidence-graph';
export { EVENT_SCHEMA_VERSION, DEFAULT_ANALYZER_CONFIG, createEventIdentity } from '@refract-org/evidence-graph';
export { sectionDiffer, citationTracker, revertDetector, detectEditClusters } from '@refract-org/analyzers';
export { computeCertaintyProfile, computeDirectionSignal, extractQuantitativeFindings } from '@refract-org/analyzers';
export { annotateEvents, buildRevisionEvents } from '@refract-org/analyzers'; // 0.5.1+

// repository.ts — D1 insert
export async function insertRefractEvents(
  db: D1Database,
  events: EvidenceEvent[],
  batchId: string,
  pageTitle: string,
): Promise<number> {
  let count = 0;
  for (const event of events) {
    const fact = event.deterministicFacts?.[0];
    await db.prepare(`
      INSERT OR IGNORE INTO refract_events (...) VALUES (...)
    `).bind(/* event fields */).run();
    count++;
  }
  return count;
}
```

### Migration guide (0.3.x → 0.4.x)

When upgrading from `@refract-org/evidence-graph@0.3.x` to `0.4.x`:

1. Add `"sentence_modified"` to any `EventType` whitelists in your code
2. The `FactProvenance` interface now has an optional `parameters` field — consumers that read it gain provenance transparency but are not required to
3. The `EVENT_SCHEMA_VERSION` constant (`"0.4.0"`) and `CLAIM_IDENTITY_VERSION` (`"claimidentityv1"`) are new exports
4. Every event now carries `schemaVersion` — verify your DDL can store this field
5. `AnalyzerConfig` now supports `$version` for config pinning — optional, no migration action needed

### Migration guide (0.4.x → 0.5.x)

When upgrading from `@refract-org/cli@0.4.x` to `0.5.x`:

1. The CLI binary is now `refract` (primary) and `wikihistory` (alias). Both work; `refract` is preferred.
2. New commands: `refract explore` (web UI), `refract mcp` (MCP server), `refract visualize` (diagram export)
3. `refract export --flatten` produces flat column-oriented CSV for analytical tools
4. Optional dependencies: `apache-arrow` (Parquet export), `parquet-wasm` (WASM Parquet reader)
5. No schema changes to `EvidenceEvent` — existing event consumers are forward-compatible

See the [version compatibility table](schema#version-compatibility) for the full matrix.
