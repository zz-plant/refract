# Compatibility Matrix

When updating `@refract-org/*` packages, downstream consumers — the apps in this repository and the projects outside it — must be checked for compatibility. This document defines the dependency chain and what breaks where.

## Dependency Order

```
@refract-org/evidence-graph      (types, schemas, hashing — no deps)
    ├── @refract-org/ingestion   (MediaWiki client, stream client, XML dumps)
    ├── @refract-org/analyzers   (deterministic analyzers)
    ├── @refract-org/eval        (evaluation harness)
    ├── @refract-org/mcp         (MCP tool definitions and server — also needs ingestion, analyzers)
    └── @refract-org/cli         (the `refract` command — needs all of the above; eval optional)
            └── clients/python   (Python SDK — wraps the CLI)

@refract-org/persistence         (bun:sqlite cache — private, loaded lazily by the CLI's --cache)
```

`bun run check:release` checks this order and the ranges along it: every internal
dependency names the sibling's version in this tree (`^x.y.z`), nothing published
depends on a private package, and a version already on npm carries the same source
as this tree. `publish.yml` publishes in the order the script prints.

## Version Matrix

| Package | In this tree | On npm (2026-11-11) | Downstream consumers |
|---|---|---|---|
| `@refract-org/evidence-graph` | 0.5.4 | 0.5.3 | every package; NextConsensus; `apps/ui` (types only, from this tree) |
| `@refract-org/ingestion` | 0.3.5 | 0.3.4 | mcp, cli; NextConsensus |
| `@refract-org/analyzers` | 0.5.4 | 0.5.3 | mcp, cli; NextConsensus |
| `@refract-org/mcp` | 0.1.1 | 0.1.0 | cli |
| `@refract-org/eval` | 0.2.3 | 0.2.2 | cli (optional) |
| `@refract-org/cli` | 0.6.1 | 0.5.17 | `clients/python`, Docker image, operators |
| `@refract-org/persistence` | 0.1.1 | private | cli `--cache` from a source checkout |

The npm column is what the registry served on that date. The 0.6.0 tag published
`evidence-graph`, `ingestion`, `analyzers` and `eval` and then failed on `mcp`, so
CLI 0.6.0 never reached npm. Once the 0.6.1 tag publishes, `npm install
@refract-org/cli@0.6.1` into an empty directory resolves the tree column, and
`refract --version` prints 0.6.1. The CLI on npm before 0.5.17 was 0.5.7,
which does not start: it declares `@refract-org/analyzers@^0.3.0` and imports code
that only analyzers 0.5.0 has.

## External Consumer Versions

| Repo/Dir | Depends On | Current Version | Update When |
|---|---|---|---|
| NextConsensus (`nextconsensus`, `nextconsensus-app`) | `@refract-org/analyzers@^0.5.0`, `@refract-org/evidence-graph@^0.5.0`, `@refract-org/ingestion@^0.3.1`, each through one adapter file per repo | 0.5.0 / 0.5.0 / 0.3.1 | any library release; see [docs/refract-and-nextconsensus.md](./docs/refract-and-nextconsensus.md) |
| `demo-data/` (monorepo) | JSONL format matching evidence-graph types | — | EvidenceEvent schema change |
| `apps/ui` (monorepo) | `EventType` and `EvidenceEvent` imported from `packages/evidence-graph` as types only | this tree | checked on every evidence-graph change by `viewer.yml` |
| `clients/python` (monorepo) | Wraps `@refract-org/cli` via subprocess | this tree | checked on every CLI, schema or `docs/examples` change by `python.yml` |
| `apps/docs` (monorepo) | References CLI examples and schema | — | CLI flag changes or schema version bumps |

## What Breaks When

### evidence-graph EventType changes

**If you add a new event type:**
- `apps/ui`: the build fails until the type is added to `EVENT_TYPE_RECORD` in `src/types.ts`
- `apps/docs`: update schema.md and events.md
- `clients/python`: no change (dataclasses are generic)
- `demo-data/`: update JSONL files if they should include the new type

**If you rename an event type:**
- BREAKING for all consumers. Create a migration guide.
- `apps/ui`: the build fails until `EVENT_TYPE_RECORD` and any CSS keyed to the old name are updated
- `apps/docs` schema reference must be updated

### CLI flag changes

- `clients/python` `_run()` calls the CLI with flags; `tests/test_engine_contract.py` fails when one it passes is renamed
- `apps/docs` CLI reference page must be updated

### AnalyzerConfig changes

- `AnalyzerConfig` is exported from evidence-graph and used by CLI + eval
- New config fields are backward-compatible (optional)
- Renamed/removed config fields are breaking

## Schema Version Negotiation

See [SCHEMA_VERSIONING.md](./SCHEMA_VERSIONING.md) for the full policy on breaking vs. non-breaking changes.

As documented in `schema.md`:

| refract CLI | `@refract-org/evidence-graph` | `EVENT_SCHEMA_VERSION` |
|---|---|---|
| 0.6.1 | 0.5.4 | `"0.5.0"` |
| 0.6.0 | 0.5.3 | `"0.5.0"` |
| 0.5.17 | 0.5.2 | `"0.5.0"` |
| 0.5.15–0.5.16 | 0.5.1 | `"0.5.0"` |
| 0.5.0–0.5.7 | 0.4.x–0.5.0 | `"0.4.0"` |
| 0.4.x | 0.3.x | `"0.3.0"` |
| 0.3.x | 0.2.x | `"0.2.0"` |

Consumers SHOULD accept events with the same minor schema version and MAY accept across minor versions if they handle unknown EventType members gracefully.
