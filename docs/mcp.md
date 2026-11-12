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

### `snapshot`

Return the revision that was live at a date: the newest revision at or before
it. The same lookup as `refract snapshot`, returned as JSON.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `page` | string | ✅ | Page title |
| `at` | string | | ISO 8601 date or timestamp. Defaults to the current time |
| `api` | string | | MediaWiki API base URL. Defaults to English Wikipedia |
| `revisionLimit` | number | | Revisions to fetch at or before the date (default 500) |
| `content` | enum | | `plain` (markup stripped, default), `wikitext`, or `none` |

Response fields: `pageTitle`, `at`, `revisionId`, `pageId`, `timestamp`,
`daysBeforeTarget`, `minor`, `user`, `size`, `comment`, `sections` (heading
`level` and `name`), and `text` or `wikitext` as `content` selects.

### `review`

Observe changes to pages since their last acknowledged review and save a
review report — the [review workflow](./review.md) for an agent. The tool
observes; it never acknowledges.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `stateDir` | string | ✅ | Absolute path of the review state directory |
| `pages` | string[] | | Page titles to review |
| `api` | string | | MediaWiki API base URL. Defaults to English Wikipedia |
| `from` | number | | Initial comparison baseline for a page with no acknowledged review |
| `limit` | number | | New revisions per page per call (default 200); call again to resume |
| `sample` | boolean | | Review the bundled fictional history offline instead of `pages` |
| `eventTypes` | string[] | | Show only these event types in `view` |
| `section` | string | | Show only events in this section in `view` |
| `text` | string | | Show only events containing this text in `view` |

The response is the saved `refract-review/v1` report with three additions:

- `reportPath`: the saved report on disk. The response lists each page's input
  revisions as `inputRevisionIds`; the saved report keeps their full text.
- `view`: entries that match the filters. `pages` stays unfiltered.
- `acknowledgment`: whether the report can be acknowledged and, when it can,
  the `refract review --ack` command that does so.

**Acknowledgment stays with a person.** Acknowledging moves the reviewed
baseline past every revision in the report, including entries hidden by
filters, and asserts that someone inspected them. No MCP tool does it. Give the
person `reportPath` and the command; they run it after reading the report. An
incomplete report, or one with a page that failed, has no command: call
`review` again to resume.

`stateDir` holds `state.json`, `reports/`, and a `.lock` while a call runs. The
tool writes nothing outside it, and requires an absolute path because an MCP
server's working directory is the client's choice. Use the same directory for
the CLI acknowledgment, and a separate one for each independent review.

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

Use the `review` tool when you need an explicit review baseline; fetching a
statement history does not acknowledge a review.
