---
title: "Architecture decisions"
description: "This page explains the rationale behind key architecture choices in Refract. Knowing why decisions were made helps contributors understand the boundaries…"
---

This page explains the rationale behind key architecture choices in Refract. Knowing
why decisions were made helps contributors understand the boundaries and constraints.

## Two-knowledge split (not three)

**Decision**: Two layers — deterministic observation + independent ground truth.
Model interpretation happens downstream, not inside the engine.

**Why**: Models introduce non-determinism, drift, and vendor dependency. If the
observation layer calls a model, the output is no longer byte-reproducible. If the
ground truth layer calls a model, the "independent" validation becomes circular.
By keeping both layers purely mechanical and placing model interpretation downstream
(in NextConsensus, in consumer applications), Refract preserves its core guarantee:
deterministic, reproducible, auditable output.

**Alternative considered**: A three-layer architecture (deterministic → model → validation).
Rejected because the model layer would introduce irreproducibility into the engine's
output, making it impossible to audit the pipeline independently.

## NDJSON as the event format

**Decision**: Newline-delimited JSON (NDJSON) for all event output.

**Why**: NDJSON is the lowest-common-denominator format. Every language can parse it
without schema libraries. DuckDB reads it natively. Unix tools (`grep`, `head`, `wc`,
`jq`) can filter and query it. It streams — a million events don't require holding
the full payload in memory. It's human-readable for debugging. There's no schema
registry, no version negotiation overhead.

**Alternative considered**: Protocol Buffers/Avro/Parquet (faster, smaller, but
require schema libraries and are not human-readable), CSV (loses nesting, can't
represent arrays or nested objects), plain JSON array (must be fully loaded in memory).

Parquet export is available via `--format parquet` for analytical workloads.

## SQLite for caching (via bun:sqlite)

**Decision**: SQLite as the local cache backend, accessed through Bun's built-in
`bun:sqlite` module.

**Why**: SQLite is zero-config, self-contained, and runs in-process. No server to
manage. No port to open. The cache is a local database (`~/.wikihistory/refract.db`)
that users can delete, copy, or inspect. Bun's `bun:sqlite` module is compiled into
the runtime — no native addons, no node-gyp, no install failures.

**Alternative considered**: LevelDB (requires C++ toolchain), PostgreSQL/MySQL
(requires external server — breaks zero-config), plain JSON files (no transactional
integrity, slow query performance for large caches).

## TypeScript via tsc (no bundler)

**Decision**: TypeScript compiled with `tsc --build` using project references.
No webpack, esbuild, rollup, or vite.

**Why**: Bun resolves TypeScript directly, so the published packages don't need
bundling — they ship as compiled `.js` + `.d.ts` files. Project references (`tsc -b`)
handle monorepo dependency ordering. No bundler means no sourcemap issues, no chunk
splitting bugs, no plugin compatibility problems.

## ESM-only

**Decision**: All packages are `"type": "module"` (ESM). No CommonJS compatibility.

**Why**: ESM is the future of the Node.js ecosystem. Bun 1.x supports ESM natively.
Maintaining dual CJS/ESM exports doubles the complexity of `package.json` exports,
type resolution, and interop. Refract targets Bun and modern Node.js — both support
ESM without polyfills.

## Bun as the primary runtime

**Decision**: Bun is the required runtime for development, testing, and building.
Node.js 20+ is supported for running the CLI and importing packages.

**Why**: Bun ships with a fast package manager (`bun install`), a built-in SQLite
binding (`bun:sqlite`), native TypeScript support (no `ts-node`, no `tsx` needed for
scripts), and faster test execution than Jest or Mocha. The persistence layer depends
on `bun:sqlite`, which is only available in Bun.

**Alternative considered**: Node.js with `better-sqlite3` (requires native addon
compilation, `node-gyp`, and OS-specific build tools — breaks zero-config),
Node.js with `sql.js` (WebAssembly SQLite, slower and more complex).

## AGPL-3.0 license

**Decision**: Affero GPL v3 for all published packages.

**Why**: AGPL requires anyone who modifies the software and deploys it as a network
service to release their modifications. This prevents a cloud provider from taking
the open-source engine, adding proprietary improvements, and offering a competing
service without contributing back. It also creates a natural commercial licensing
path — enterprises that can't accept AGPL obligations can purchase a commercial license.

**Alternative considered**: MIT (too permissive — allows proprietary forks with no
contribution back, undermines the open-core business model), Apache 2.0 (no network
service copyleft), GPLv3 (doesn't cover SaaS/network use — AGPL closes this gap).

## No model in the pipeline

**Decision**: The deterministic pipeline never calls a model. No LLM, no ML, no
randomness. Pure functions of wikitext.

**Why**: Reproducibility is the foundation. If the engine calls a model, the same
revision range produces different output on different runs (different model versions,
different hyperparameters, model deprecation). This makes the output non-auditable.
Deterministic analyzers (regex, word overlap, structural parsing) produce identical
output every time. The model-only boundaries (BYO-inference) are explicit and auditable:
every event records whether it used the default heuristic or a model, and with what
parameters.

## BYO-inference boundaries (not pluggable model layer)

**Decision**: Configurable thresholds at specific analyzer boundaries, not a
general-purpose model adapter layer.

**Why**: A generic "model adapter" would encourage shipping model calls as part of
the core pipeline. By keeping each boundary as a typed function signature with a
mechanical default, Refract forces every model call to be explicit: "I am replacing
the revert detector heuristic with a model call, and this will be recorded." This
prevents model calls from entering the pipeline unnoticed.

## Synthetic benchmark data

**Decision**: The eval harness uses synthetic revision histories (Xanoleptin pages),
not real Wikipedia data, for benchmarking.

**Why**: Real Wikipedia data has no ground truth — we can't know whether a revert
should have been detected or a citation change should have been classified as
"replaced." Synthetic data gives us controlled, hand-labeled ground truth for every
event. It also avoids licensing and attribution issues when publishing benchmark data.

The datasets are maintained in the core repository's [demo-data directory](https://github.com/refract-org/refract/tree/main/demo-data).
