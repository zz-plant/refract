---
name: refract
description: >-
  Analyze Wikipedia and MediaWiki revision histories: review source changes,
  track text and citations across revisions, and emit deterministic provenance
  events. Use when a task involves edit history, claim or citation tracking,
  knowledge-change observation, the refract CLI or MCP server, or
  @refract-org/* packages. Do NOT use for healthcare-specific interpretation,
  clinical judgment, or domain-specific source weighting; those belong in
  downstream applications.
license: AGPL-3.0
---

# Refract

git log for Wikipedia and other MediaWiki wikis.
It reports what changed; downstream applications decide what matters.

## Choose a command

Run `npx @refract-org/cli <command>`, or `refract <command>` after
`npm install -g @refract-org/cli`. `refract <command> --help` lists every option,
and the [CLI reference](https://zz-plant.github.io/refract/cli/) explains them.

| Question | Command |
|----------|---------|
| What does Refract do? (offline) | `refract init` |
| What changed since my last review? | `refract review --pages-file pages.txt` |
| When did this text appear or change? | `refract claim "Page" --text "exact text"` |
| What did the page say on a date? | `refract snapshot "Page" --at 2024-01-15` |
| What changed between two revisions? | `refract analyze "Page" --from ID --to ID --depth detailed --json` |
| I need the events as data | `refract export "Page" --format ndjson > events.ndjson` |
| How do two wikis differ? | `refract diff "Topic" --wiki-a URL --wiki-b URL` |
| Does this saved bundle agree with itself? | `refract export "Page" --proof > bundle.json`, then `refract verify bundle.json` |

Use a page title, not a URL. `--api URL` selects another MediaWiki instance.
Always pass `--json` to `analyze` from a terminal session: without it, `analyze`
opens the browser explorer and keeps its server running. `review` needs 0.6.1 or
later: [review guide](https://zz-plant.github.io/refract/review/).

## MCP tools

Configure the client with `@refract-org/cli` (`npx -y @refract-org/cli mcp`), never
the unscoped `refract` package, which is an unrelated project.

| Tool | Purpose |
|------|---------|
| `analyze` | Full page edit history with structured events |
| `claim` | Track a specific sentence's provenance across revisions |
| `export` | Export analysis as JSON |
| `cron` | One-shot re-observation of a list of pages |
| `classify` | Classify one observation boundary with a model |
| `get_statement_history` | When a statement or a close variant appeared, changed, or disappeared |

`review`, `snapshot`, `diff`, and `verify` are CLI-only.

## Event types

26 types across 8 categories. Every event can carry six deterministic enrichment
fields: `editMagnitude`, `contentChange`, `keyTerms`, `certaintyProfile`,
`directionSignal`, and `quantitativeFindings`.

| Category | Events |
|----------|--------|
| Sentences | `sentence_first_seen`, `sentence_removed`, `sentence_modified`, `sentence_reintroduced` |
| Citations | `citation_added`, `citation_removed`, `citation_replaced` |
| Templates | `template_added`, `template_removed`, `template_parameter_changed` |
| Sections | `section_reorganized`, `lead_promotion`, `lead_demotion` |
| Reverts | `revert_detected`, `edit_cluster_detected` |
| Links and categories | `wikilink_added`, `wikilink_removed`, `category_added`, `category_removed` |
| Metadata | `page_moved`, `protection_changed` |
| Talk | `talk_page_correlated`, `talk_thread_opened`, `talk_thread_archived`, `talk_reply_added`, `talk_activity_spike` |

## Using the packages

| Package | Purpose |
|---------|---------|
| `@refract-org/evidence-graph` | Core types and schemas (no dependencies) |
| `@refract-org/ingestion` | MediaWiki API adapters and rate limiting |
| `@refract-org/analyzers` | Section diffing, citation tracking, revert detection, template tracking, enrichment |
| `@refract-org/cli` | The `refract` command (alias: `wikihistory`) |
| `@refract-org/mcp` | MCP library; the executable is `refract mcp` |
| `@refract-org/eval` | Evaluation harness with benchmark pages |
| `persistence` | SQLite caching through `bun:sqlite`; not published |

Use a **single adapter file** as the import boundary. Re-export only what you need;
no other file imports from `@refract-org/*` directly.

```typescript
// adapter.ts
import { MediaWikiClient } from "@refract-org/ingestion";
import type { EvidenceEvent } from "@refract-org/evidence-graph";
import { citationTracker, computeCertaintyProfile, sectionDiffer } from "@refract-org/analyzers";

export type { EvidenceEvent };
export { MediaWikiClient, citationTracker, computeCertaintyProfile, sectionDiffer };
```

## Invariants

Every integration must respect these:

1. The deterministic pipeline never calls a model.
2. The same captured inputs, analyzer versions, and configuration produce the same event observations.
3. Every event is tagged with its revision, section, and timestamp.

## Forbidden features

When building on Refract, do NOT create features that:

- Target or identify individual editors
- Do sentiment analysis or toxicity scoring
- Predict or forecast future edits
- Automate Wikipedia editing
- Make truth or accuracy claims about content
- Use healthcare-specific vocabulary (drug names, FDA, clinical trials)

## Reference files

| Task | File |
|------|------|
| Architecture invariants and data flow | [references/architecture.md](references/architecture.md) |
| Core types | [references/types.md](references/types.md) |
| Eval harness and benchmark pages | [references/eval.md](references/eval.md) |
