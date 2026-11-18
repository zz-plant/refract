# Refract — Claude Code Instructions

> **This project uses AGENTS.md as its primary instruction file.**
> Read `AGENTS.md` for full project instructions, commands, architecture,
> and repository boundary rules.

## Quick Start for Claude Code

```bash
# Analyze any Wikipedia page
refract analyze "PageTitle" --depth forensic --json

# Track a claim across revisions
refract claim "PageTitle" --text "exact claim text"

# Export as structured data
refract export "PageTitle" --format ndjson > events.ndjson

# Start MCP server for tool access
refract mcp
```

## Key Commands

```bash
bun run build      # tsc -b
bun run test       # vitest run
bun run typecheck  # tsc --noEmit
bun run lint       # biome lint packages/
```

## Tests and the network

The suite runs offline. `tests/support/fake-mediawiki.ts` serves the MediaWiki
action API for tests whose subject is Refract's own code — a self-diff comparing
a wiki against itself, or the throughput bound, which measures section and
citation diffing and never included the fetch that fed it.

Six tests are not faked, because a fixture cannot settle what they ask. They
check that this client still parses what Wikipedia actually returns, and
asserting that against a response this repo also wrote would only confirm the
fixture matches itself — while the failure they exist to catch, MediaWiki
changing its response shape, became invisible. They are gated by
`describeLive` (`tests/support/live.ts`), skipped by default, and run under
`REFRACT_TEST_LIVE=1`. Every run prints which way it went.

Skipped is not passed: a green suite here has **not** verified the API
contract. Run `REFRACT_TEST_LIVE=1 bun run test` somewhere with egress before
trusting a change to `mediawiki-client.ts`.

`.github/workflows/api-contract.yml` runs them daily and on demand, off the
pull-request path so a Wikipedia outage cannot redden an unrelated PR. Gating
them out of the PR gate without running them anywhere would have retired six
tests while the suite went green — check that workflow's last run before
trusting the parser.

## Repository Boundary

Refract is domain-neutral infrastructure. Do NOT add healthcare-specific logic,
clinical judgment, drug names, or domain-specific source weighting. Those
belong in NextConsensus. See `docs/repository-boundary.md`.
