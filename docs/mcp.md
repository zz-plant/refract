# MCP — model context protocol

`refract mcp` starts a JSON-RPC server over stdio that exposes the Refract engine to AI agents via the Model Context Protocol.

## Usage

```bash
refract mcp
```

The server runs indefinitely on stdin/stdout. It accepts JSON-RPC 2.0 requests and returns structured responses.

## Connecting an AI agent

The server is the `mcp` command of the `@refract-org/cli` package. Name that
package in the config: the unscoped npm package `refract` is an unrelated
project, so `npx refract mcp` downloads and runs someone else's code.
`@refract-org/mcp` is a library with no executable, so it cannot be the command
either.

### Claude Desktop

```json
{
  "mcpServers": {
    "refract": {
      "command": "npx",
      "args": ["-y", "@refract-org/cli", "mcp"]
    }
  }
}
```

### Cline / VS Code

```json
{
  "mcpServers": {
    "refract": {
      "command": "bunx",
      "args": ["@refract-org/cli", "mcp"]
    }
  }
}
```

With a source checkout instead of npm, point the command at the build:
`"command": "node", "args": ["/path/to/refract/packages/cli/dist/src/cli.js", "mcp"]`.

## Available tools

### `analyze`

Analyze a MediaWiki page's revision history. Use `from` and `to` for a pinned
range; the default brief run reads a recent window. See [range and depth rules](./usage.md).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `page` | string | ✅ | Page title (e.g., "Bitcoin", "Climate change") |
| `depth` | enum | | `brief` (metadata only), `detailed` (text included), `forensic` (full wikitext) |
| `api` | string | | MediaWiki API base URL. Defaults to English Wikipedia |
| `from` | string | | Start revision ID |
| `to` | string | | End revision ID |
| `since` | string | | Re-observe from ISO timestamp |
| `config` | object | | Analyzer overrides: `similarityThreshold`, `spikeFactor`, `clusterWindowMinutes`, `talkWindowBeforeDays`, `talkWindowAfterDays`, `renameDetection` |

### `claim`

Track text matches across revisions. The result is bounded by the fetched
history and [text-matching rules](./concepts/claim-state-timelines.md#identity-and-matching).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `page` | string | ✅ | Page title |
| `text` | string | ✅ | Claim text to track (partial match supported) |
| `api` | string | | MediaWiki API base URL |

### `export`

Export page analysis as structured JSON.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `page` | string | ✅ | Page title |
| `depth` | enum | | `brief`, `detailed`, or `forensic` |
| `api` | string | | MediaWiki API base URL |
| `since` | string | | Re-observe from ISO timestamp |

### `cron`

Re-observe pages — for scheduled monitoring. Reports each page's event count from a
`brief` analysis of English Wikipedia; it keeps no state between calls and sends no
notifications. `refract cron` on the command line does both.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pagesFile` | string | ✅ | File path with one page title per line |

### `classify`

Classify one observation boundary. Uses the configured inference provider when an API
key is available, and otherwise asks the connected client through MCP sampling. With
neither a key nor a client that supports sampling, the result has an empty `output` and
a `note` saying no provider is configured; `refract classify` on the command line
applies the boundary's default rule instead.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `boundary` | enum | ✅ | `revert`, `sentence_similarity`, `heuristic`, `template_signal`, or `activity_spike` |
| `input` | object | ✅ | Input data; fields vary by boundary |
| `apiKey` | string | | Inference provider API key (env: `REFRACT_INFERENCE_API_KEY`) |
| `endpoint` | string | | OpenAI-compatible endpoint URL |
| `model` | string | | Model name (default: `gpt-4o-mini`) |

### `get_statement_history`

Track normalized text or partial word matches across revisions. Returns matched
revision IDs, timestamps, an overall status, and a short change summary. A
partial match is not a guarantee of equivalent meaning; state labels summarize
the matching rules. See [state labels](./concepts/claim-state-timelines.md#state-labels).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `statement` | string | ✅ | Raw text statement to track |
| `page` | string | ✅ | MediaWiki page title |
| `context` | string | | Optional use-context slug |
| `depth` | enum | | `brief`, `detailed` (default), or `forensic` |
| `api` | string | | MediaWiki API base URL. Defaults to English Wikipedia |

Response fields: `statement`, `page`, `context` (when one was passed), `revisions` (array of `revisionId` + `timestamp`), `status` (`present`, `absent`, `modified`, or `contested`), and `history_summary`.

## Protocol details

- **Transport:** stdio (stdin for requests, stdout for responses)
- **Format:** JSON-RPC 2.0
- **Initialization:** Send `tools/list` to discover tools, `tools/call` to invoke

## Authentication

MCP tools do not accept wiki credentials, so they reach only wikis that allow anonymous
reads. For a private wiki, use the CLI with [`--api-key` or `--api-user`](./usage.md#other-mediawiki-instances).
The `apiKey` parameter on `classify` is for the inference provider.

## Passage matching and latest state

`get_statement_history` now includes `latest_revision_id`, `latest_match`, and
`caveats`. Detailed results retain candidate text and each variant's match kind.
`latest_match` distinguishes exact text, a sentence word-overlap candidate, no
match, and unavailable source text. Status `unknown` covers partial latest
matches or withheld latest text. Disappearance is measured against the latest
fetched revision, not the last historical match.

Use [saved source reviews](./review.md) through the CLI when you need an explicit
review baseline; fetching a statement history does not acknowledge a review.
