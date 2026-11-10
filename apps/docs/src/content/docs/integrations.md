---
title: "Integrations"
description: "Refract produces a deterministic event stream — standard NDJSON with typed schemas, deterministic hashes, and provenance metadata. Anything that reads JSON…"
---

Refract produces a deterministic event stream — standard NDJSON with typed schemas, deterministic hashes, and provenance metadata. Anything that reads JSON or speaks HTTP can consume it. This page catalogs every supported integration.

## By pattern

| Pattern | Best for | Start here |
|---|---|---|
| **CLI pipeline** | Shell scripts, cron jobs, CI/CD | [CLI reference](cli.md) |
| **SDK (TypeScript)** | Node.js apps, custom analyzers | [SDK reference](sdk.md) |
| **SDK (Python)** | Jupyter, pandas, data science | [Python SDK tutorial](tutorials/python-sdk.md) |
| **MCP server** | AI coding agents (Claude Code, Cursor, VS Code) | [MCP agent tutorial](tutorials/mcp-agent.md) |
| **Direct NDJSON** | DuckDB, SQL, shell pipelines | [Analytics with DuckDB](analytics.md) |
| **HTTP/webhook** | Slack, email, custom alerting | [Scheduled monitoring tutorial](tutorials/scheduled-monitoring.md) |

## By tool

### Databases and query engines

| Tool | How | Docs |
|---|---|---|
| **DuckDB** | Query NDJSON directly: `SELECT * FROM 'events.jsonl'` | [Analytics](analytics.md) |
| **SQLite** | `@refract-org/persistence` wraps `bun:sqlite`. Stores events + revisions locally. | [SDK](sdk.md) |
| **PostgreSQL / D1** | Reference DDL with indexes for production ingestion. | [Downstream](downstream.md#production-ingestion) |
| **ClickHouse** | Columnar analytics on event streams. Query NDJSON via `file()` table function. | [Downstream](downstream.md#complementary-technologies) |

### AI and ML

| Tool | How | Docs |
|---|---|---|
| **LangChain** | `clients/python/src/refract_langchain.py` — loads events as `Document` objects with stability metadata for provenance-aware RAG. | [RAG tutorial](tutorials/rag-provenance.md) |
| **LlamaIndex** | Load events as nodes, use stability score as metadata filter. | [RAG tutorial](tutorials/rag-provenance.md) |
| **Vercel AI SDK** | Use stability signals as reranking features in retrieval chains. | [RAG tutorial](tutorials/rag-provenance.md) |
| **OpenAI / DeepSeek / Ollama** | Plug any OpenAI-compatible endpoint into `refract classify` at BYO-inference boundaries. | [BYO-inference tutorial](tutorials/byo-inference.md) |
| **MCP clients** | Claude Code, VS Code, Cursor, Claude Desktop connect via `refract mcp`. Agents call Refract tools directly. | [MCP agent tutorial](tutorials/mcp-agent.md) |

### Model evaluation

| Tool | How | Docs |
|---|---|---|
| **Temporal leakage detection** | `refract_eval.build_leakage_benchmark()` — find claims that appeared after a model's cutoff | [Model evaluation tutorial](tutorials/model-evaluation.md) |
| **Retrieval quality scoring** | `refract_eval.score_retrieval_quality()` — score passages by stability | [RAG tutorial](tutorials/rag-provenance.md) |
| **Provenance hallucination** | `refract_eval.check_provenance()` — verify if a source ever existed | [Model evaluation tutorial](tutorials/model-evaluation.md) |
| **Benchmark submission** | Standard 10-page benchmark, submission format, reproducibility requirements | [BENCHMARK.md](https://github.com/refract-org/refract/blob/main/BENCHMARK.md) |
| **Colab notebook** | Ready-to-run notebook — `pip install "git+https://github.com/refract-org/refract.git#subdirectory=clients/python"` and go | [notebooks/model-evaluation.ipynb](notebooks/model-evaluation.ipynb) |

### Notebooks and visualization

| Tool | How | Docs |
|---|---|---|
| **Jupyter** | `refract-py` → pandas DataFrame → matplotlib/Altair. | [Python SDK tutorial](tutorials/python-sdk.md) |
| **Observable Framework** | [Data loader recipe](./sdk.md#observable-framework-data-loader). | [Notebooks](notebooks.md) |
| **Marimo** | Reactive notebook runtime for live event stream analysis. | [Notebooks](notebooks.md) |
| **Mermaid / Graphviz** | `refract visualize --format mermaid` produces diagrams. | [CLI](cli.md#refract-visualize) |

### Monitoring and alerting

| Tool | How | Docs |
|---|---|---|
| **Cron / systemd timers** | `refract cron` — one-shot re-observation for scheduled monitoring. | [Scheduled monitoring tutorial](tutorials/scheduled-monitoring.md) |
| **GitHub Actions** | `.github/workflows/observe.yml` — daily scheduled observation with auto-commit. | [Scheduled monitoring tutorial](tutorials/scheduled-monitoring.md) |
| **Slack** | `--notify-slack` posts Block Kit-formatted messages with event summaries. | [Scheduled monitoring tutorial](tutorials/scheduled-monitoring.md) |
| **Email** | `--notify-email` sends SMTP alerts. | [Scheduled monitoring tutorial](tutorials/scheduled-monitoring.md) |
| **Webhooks** | `--notify-webhook` POSTs JSON event summaries to any endpoint. | [Scheduled monitoring tutorial](tutorials/scheduled-monitoring.md) |

### Infrastructure

| Tool | How | Docs |
|---|---|---|
| **Docker** | `Dockerfile` in the refract repo. `docker build -t refract .` | [Install](install.md) |
| **AWS Lambda** | Run `refract cron` in a Lambda function with a 15-minute timeout. | [Cron](cron.md) |
| **Cloudflare Workers** | Import the library packages in a Worker (`nodejs_compat`); the CLI cannot run there. Store events in D1, export to R2. | [Cron: serverless](cron.md#serverless-platforms) |
| **Private wikis** | Bearer token, basic auth, OAuth2. `--api-key`, `--api-user`, `--api-password`. | [Private wiki tutorial](tutorials/private-wiki.md) |

### Knowledge graphs and semantic web

| Tool | How | Docs |
|---|---|---|
| **RDF / SPARQL** | Convert `wikilink_added`/`category_added` events into triples. | [Downstream](downstream.md#complementary-technologies) |
| **Neo4j** | Build an evolving entity graph where each edge has a revision timestamp. | [Downstream](downstream.md#complementary-technologies) |
| **Vector databases** | Store claim embeddings alongside stability metadata for filtered retrieval. | [RAG tutorial](tutorials/rag-provenance.md) |

## Production patterns

### Adapter pattern

Use a single adapter file as the import boundary between Refract and your codebase:

```typescript
// adapter.ts — single import boundary
export type { EvidenceEvent, FactProvenance } from '@refract-org/evidence-graph';
export { sectionDiffer, citationTracker } from '@refract-org/analyzers';
export { computeCertaintyProfile, computeDirectionSignal, extractQuantitativeFindings } from '@refract-org/analyzers';
```

No other file imports from `@refract-org/*` directly. This isolates version upgrades to one file.

### Batch processing

```bash
refract analyze --pages-file topics.txt --depth detailed -c
```

Process hundreds of pages sequentially. Cache prevents re-fetching. Combine with `refract export` for structured output.

### Scheduled re-observation

```bash
refract cron pages.txt --interval 24 -c --notify-slack
```

Re-observe on a schedule. Detect changes since last run. Notify on new events.

### Hashed export

```bash
refract export "Page" --bundle > bundle.json
```

The bundle carries a SHA-256 hash of its contents. It is not signed: a downstream system that receives the hash separately can check that the file matches it. `--manifest` gives a Merkle root over the event hashes instead.

## Complementary technologies

A full list of compatible tools is in the [downstream integration](downstream.md#complementary-technologies) reference. The Refract event stream is standard JSON/NDJSON — anything that reads JSON or speaks HTTP can consume it.
