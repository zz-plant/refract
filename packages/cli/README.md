# @refract-org/cli

`git log` for Wikipedia. Provides the `refract` command (alias: `wikihistory`).

```bash
npx @refract-org/cli claim Pluto --text "ninth and smallest" --from 71593043 --to 71601937
```

This prints one sentence of Wikipedia's Pluto article from each of 43 revisions made on the day Pluto was reclassified. To install it and try an offline sample:

```bash
npm install -g @refract-org/cli
refract init
```

[Documentation](https://zz-plant.github.io/refract/) · [CLI reference](https://zz-plant.github.io/refract/cli/)

## Commands

| Command | Description |
|---------|-------------|
| `init` | Inspect a bundled fictional history offline |
| `analyze <page>` | Full edit history analysis with configurable depth |
| `review [page]` | Inspect source changes since the last acknowledged review |
| `claim <page> --text "<text>"` | Track a specific claim across revisions |
| `snapshot <page> --at <date>` | Show page state at or before a date |
| `export <page> --format <format>` | Export analysis as json, csv, ndjson, parquet, or html |
| `verify <bundle>` | Check a verification bundle's events, manifest hash, Merkle root, and proofs |
| `delegation <page>` | Write STD-07 discrepancy records for another system to read |
| `visualize <page>` | Print the evidence graph as a Mermaid or DOT diagram |
| `explore <page>` | Open the local web explorer (localhost:8899) |
| `watch <page>` | Poll for new edits and print their events until stopped |
| `stream [page]` | Print live Wikimedia edits from EventStreams |
| `cron <pages-file>` | One-shot re-observation of a list of pages, for a scheduler to run; exits 1 when there are new events |
| `diff --wiki-a <url> --wiki-b <url> <topic>` | Cross-wiki comparison of a topic |
| `eval` | Run evaluation harness against benchmark pages |
| `classify <boundary>` | Classify one observation boundary with its default rule or an inference provider |
| `mcp` | Start Model Context Protocol server |

### Options

- `--depth brief|detailed|forensic` — analysis depth
- `--cache` — cache revisions in local SQLite (needs Bun and `@refract-org/persistence`, which is not published; from a source checkout only)
- `--from <revId>`, `--to <revId>` — scope to revision range
- `--pages-file <path>` — batch analyze multiple pages
- `--bundle` — export as evidence bundle with a SHA-256 hash of its contents (not signed)
- `--manifest` — export as replay manifest with Merkle tree of event hashes
- `--proof` — export as verification bundle with Merkle inclusion proofs (not signed); check it with `refract verify`
- `--api <url>` — override MediaWiki API endpoint
- `--api-key <token>` — API key for private wiki auth
- `--interval <ms>` — poll interval for watch (default: 60000)

### Examples

```bash
refract analyze "COVID-19 pandemic" --depth detailed
refract claim "Theranos" --text "revolutionary blood testing"
refract export "Bitcoin" --format ndjson
refract export "Bitcoin" --bundle
refract export "Bitcoin" --manifest
refract diff --wiki-a https://starwars.fandom.com/api.php --wiki-b https://memory-alpha.fandom.com/api.php "energy weapons"
refract eval
```

[Refract](https://github.com/refract-org/refract) · [npm](https://www.npmjs.com/package/@refract-org/cli)
