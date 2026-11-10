# Refract Documentation

Refract is a git log for Wikipedia. See how Wikipedia text and citations
changed since your last review, with text and revision links to inspect.

The [documentation site](https://zz-plant.github.io/refract/) has the CLI reference,
tutorials, and integration guides. This directory holds the guides maintained with the engine.

## Getting Started

- [Review your sources](./review.md) — watchlists, saved baselines, coverage, and explicit acknowledgment

- [Quick Start](../README.md#quick-start) — first commands to try
- [Offline walkthrough](./recipes.md#try-the-offline-walkthrough) — changed wording, a removed reference, and returned text
- [History range and output guide](./usage.md) — what gets fetched and where results appear
- [Which command keeps checking a source](./usage.md#which-command-keeps-checking-a-source) — `review`, `cron`, `watch`, or `stream`
- [Core Concepts](../README.md#core-concepts) — observed transitions, identity, and replay
- [Claim-State Timelines](./concepts/claim-state-timelines.md) — observed transitions, identity, matching, and coverage limits

## Reference

- [Event Model](./events.md) — event types, enrichment fields, schema
- [Naming Conventions](./naming.md) — type names, file patterns, terminology
- [Architecture](../ARCHITECTURE.md) — two-knowledge-split, layers, data flow
- [Replay and Verification](../ARCHITECTURE.md#replay-and-verification) — bundle consistency and independent reconstruction
- [Repository Boundary](./repository-boundary.md) — what belongs in refract vs. downstream

## Guides

- [Bitcoin walkthrough](./example-output.md) — two captured observations with source revision links
- [Recipes](./recipes.md) — common workflows and patterns
- [Data and library integrations](./integrations.md) — adapters, event queries, and review feeds
- [MCP Server](./mcp.md) — using Refract as an MCP tool provider
- [Security](./security.md) — reporting vulnerabilities

## For Contributors

- [Contributing](../CONTRIBUTING.md) — how to get started
- [Roadmap](../ROADMAP.md) — planned work and priorities
- [Repository map and consolidation proposal](./repositories.md) — ownership, shared contracts, and staged migration
- [Refract vs. NextConsensus](./refract-and-nextconsensus.md) — how the two relate
