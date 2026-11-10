# Contributing

## Getting started

1. **Clone and build**: `git clone https://github.com/refract-org/refract && cd refract && bun install && bun run build`
2. **Run the gate**: `bun run build && bun run typecheck && bun run test` — all must pass before you start
3. **Pick a task**: [Good first issues](https://github.com/refract-org/refract/labels/good%20first%20issue) are scoped for new contributors. If none fit, start a [discussion](https://github.com/refract-org/refract/discussions) about what you would like to work on.
4. **Read the architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md) — 5 minutes, saves hours of wrong turns
5. **Build a custom analyzer**: [Tutorial](https://zz-plant.github.io/refract/tutorials/custom-analyzer/) steps through the full cycle
6. **Run `bun run ci` before opening a PR**: build + lint + typecheck + boundaries + test. All must pass.

### What packages need what

| Package | Read first | Test command |
|---|---|---|
| `evidence-graph` | Types and schemas — no runtime deps | `bun run test` |
| `ingestion` | MediaWiki client, rate limiter | `bun run test` |
| `analyzers` | Deterministic analyzers — pure functions over wikitext | `bun run test` |
| `cli` | Commander-based CLI | `bun run build` |
| `eval` | Evaluation harness, ground truth labels | `bun run test` |

## Repository Boundary

Contributions must stay inside the open-source observability boundary described
in [docs/repository-boundary.md](./docs/repository-boundary.md). Refract must not
include healthcare-specific logic, domain-specific source weighting, or
customer-workflow rules.

## Commit Convention

Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.

## Code Style

- TypeScript throughout
- No comments unless explaining a non-obvious constraint (not what code does — what it must not do)

## Pull Requests

1. PR description must state what the code shows, not what it claims
2. New analyzers must include an eval (even a single sample page)
3. Architecture changes require an ARCHITECTURE.md update in the same PR

## Deprecation Policy

- Deprecated APIs are marked with a `@deprecated` JSDoc tag in the current minor version
- The deprecated API is removed after two minor version bumps (e.g., deprecated in 0.4.x, removed in 0.6.x)
- Removal is documented in CHANGELOG.md with a migration note
- TypeScript types are never removed without a prior deprecation cycle
- Schema-level changes (EventType, FactProvenance interface) follow the EVENT_SCHEMA_VERSION protocol documented in schema.md

## What Not to Contribute

- ❌ Features that target or identify individual editors
- ❌ Sentiment analysis or toxicity scoring of editor behavior
- ❌ Prediction or forecasting modules
- ❌ Automated Wikipedia editing or templating
- ❌ Claims about "truth" or "accuracy" of Wikipedia content
- ❌ Healthcare-specific vocabulary (drug names, FDA, clinical trials, payer language) — this repo is domain-agnostic

## What Belongs in Refract vs. NextConsensus

Refract is domain-neutral infrastructure for observing how knowledge changes.
It belongs in refract if it is:
- Deterministic (byte-reproducible, no model)
- Domain-neutral (works on any Wikipedia article, wiki, or document)
- A fact about what changed (not a judgment about whether it matters)

Domain-specific classification (e.g., healthcare safety vs. efficacy), materiality
scoring, and decision workflows belong in downstream applications like
[NextConsensus](https://nextconsensus.com) — not in this repository.

See [repository-boundary.md](./docs/repository-boundary.md) for the full boundary.