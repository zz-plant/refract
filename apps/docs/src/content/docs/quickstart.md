---
title: "Quick start"
description: "Compare two source revisions, inspect the observations, and save events for your tools. This walkthrough uses published CLI version 0.6.0."
---

Compare two source revisions, inspect the observations, and save events for your tools. This walkthrough uses published CLI version 0.6.0.

## Install

Use Node.js 20+ and npm:

```bash
npm install -g @refract-org/cli@0.6.0
refract --version
```

Fetching Wikipedia histories requires an internet connection. You can also run a command with `npx @refract-org/cli@0.6.0` without a global installation; npx downloads the package when needed. See [installation](install.md) for other options.

## Compare a known span

```bash
refract analyze "Bitcoin" --from 369361755 --to 369393212 --depth detailed --json
```

These two revisions are from 2010-06-21. Look for `citation_removed`: inspect `before`, `after`, `fromRevisionId`, and `toRevisionId`, then compare the [source revisions](https://en.wikipedia.org/w/index.php?title=Bitcoin&diff=369393212&oldid=369361755). The observation records a removed reference; it does not explain the editor's reason.

`--json` prints one event per line as NDJSON. In an interactive terminal, analysis without it opens the local explorer when there are events. `--depth brief` fetches the latest 20 revisions by default; detailed and forensic analysis can fetch the full history unless you provide bounds. Depth sets how much text each event carries (see [depth levels](depth.md)), while `--from`, `--to`, and `--since` scope the history.

## Browse the observations

The CLI includes a local explorer via `refract explore "Bitcoin"`. Add `--from`, `--to`, and `--depth` to reuse the bounds above. To inspect this exact export with the published version, use the file viewer in the next step.

## Save events

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > bitcoin-events.ndjson
```

Open this file in your data tools or the [browser viewer](visualizer.md). The viewer accepts event lines, rather than evidence bundles or saved review reports.

## Inspect an earlier record

```bash
refract snapshot "Bitcoin" --at "2010-06-21"
```

The command finds a revision at or before the date and prints its metadata and a text preview. The preview is truncated at 2,000 characters; use the revision ID to inspect the complete source.

## Track a passage in a window

```bash
refract claim "Bitcoin" --text "blockchain" --limit 50
```

This searches the latest 50 fetched revisions. A first match is relative to that window. Matching rules and partial or unavailable text can limit what the result establishes. See [history selection and output](../../../../../docs/usage.md) for current source-build behavior.

## Continue

- [Review sources you revisit](../../../../../docs/review.md)
- [CLI reference](cli.md) — flags and output formats
- [Data integrations](integrations.md) — use observations in your own process
