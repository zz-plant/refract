---
title: "Wikipedia & MediaWiki revision-history MCP server"
description: "refract mcp starts a stdio Model Context Protocol server that lets AI agents analyze page revision histories from Wikipedia or any MediaWiki API."
---

`refract mcp` starts a stdio Model Context Protocol server that lets AI agents analyze page revision histories from Wikipedia or any MediaWiki API.

The MCP server supports **sampling** — it can request the host's LLM to interpret events at any BYO-inference boundary without managing API keys.

![MCP protocol sequence](mcp-sequence.svg)

## Quick start

```bash
refract mcp
```

The server starts and waits for MCP client connections on stdio (`wikihistory mcp` also works). Connect any MCP-compatible client.

## Connecting AI coding agents

The server is the `mcp` command of the `@refract-org/cli` package, so that is the
package a client configuration names. `@refract-org/mcp` is a library with no
executable, and the unscoped npm package `refract` is an unrelated project —
`npx refract mcp` runs someone else's code.

### Claude Code

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

Then prompt Claude Code:

> "Analyze the Wikipedia page for Bitcoin and tell me when the most controversial edits happened."

Claude Code calls Refract's MCP tools to fetch the analysis, reads the structured events, and summarizes the findings.

### VS Code / Cursor / GitHub Copilot

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

## Tutorial: Ask an AI agent about claim history

1. **Start the MCP server** in one terminal:
   ```bash
   refract mcp
   ```

2. **Connect your AI agent** using one of the configs above.

3. **Ask the agent:**
   > "Use Refract to analyze the Wikipedia page for ChatGPT. Show me a timeline of when citations were added and removed. Which citations have survived the longest?"

   The agent calls `refract analyze` via MCP, receives structured events, and interprets the citation lifecycle.

4. **Track a specific claim:**
   > "Using Refract, check the claim 'GPT-4 was trained on 45TB of text data' on the ChatGPT Wikipedia page. When was it first added? Has it been removed or rewritten?"

   The agent calls `refract claim` via MCP, gets the claim's revision history, and reports.

5. **Use model-assisted classification:**
   > "Classify the most recent edit to the ChatGPT page — is it a revert, a major addition, or a minor edit?"

   The agent calls `refract classify heuristic` via MCP with the edit data.

## Available tools

### `analyze`

Analyze a MediaWiki page's full edit history. Returns structured events with `schemaVersion`, `FactProvenance`, and deterministic hashes.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `page` | string | required | Page title |
| `depth` | enum | | `brief`, `detailed`, `forensic` |
| `api` | string | | MediaWiki API base URL |
| `from` | string | | Start revision ID |
| `to` | string | | End revision ID |
| `since` | string | | Re-observe from ISO timestamp |
| `config` | object | | Analyzer overrides: `similarityThreshold`, `spikeFactor`, `clusterWindowMinutes`, `talkWindowBeforeDays`, `talkWindowAfterDays`, `renameDetection` |

### `claim`

Track a specific sentence across revisions. Shows first seen, modifications, removals, and reintroductions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `page` | string | required | Page title |
| `text` | string | required | Sentence text to track (partial match) |
| `api` | string | | MediaWiki API base URL |

### `export`

Export page analysis as structured JSON.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `page` | string | required | Page title |
| `depth` | enum | | `brief`, `detailed`, `forensic` |
| `api` | string | | MediaWiki API base URL |
| `since` | string | | Re-observe from ISO timestamp |

### `cron`

Re-observe pages for scheduled monitoring.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pagesFile` | string | required | File path with one page title per line |

### `classify`

Ask a model to classify a single observation boundary. See [CLI reference](cli) for the boundary table and all options.

The tool calls the configured inference provider when an API key is available, and otherwise asks the connected client through MCP sampling. With neither, the result has an empty `output` and a `note` saying no provider is configured; `refract classify` on the command line applies the boundary's default rule instead.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `boundary` | enum | required | `revert`, `sentence_similarity`, `heuristic`, `template_signal`, `activity_spike` |
| `input` | object | required | Input data (fields vary by boundary) |
| `apiKey` | string | | Inference provider API key (env: `REFRACT_INFERENCE_API_KEY`) |
| `endpoint` | string | | OpenAI-compatible endpoint (DeepSeek, Ollama, etc.) |
| `model` | string | | Model name |

### `get_statement_history`

Track normalized text or partial word matches across revisions. Returns matched revision IDs, timestamps, an overall status, the latest match, and a short change summary. A partial match does not establish equivalent meaning.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `statement` | string | required | Raw text statement to track |
| `page` | string | required | MediaWiki page title |
| `context` | string | | Optional use-context slug |
| `depth` | enum | | `brief`, `detailed` (default), `forensic` |
| `api` | string | | MediaWiki API base URL |

### `snapshot`

Return the revision that was live at a date: the newest revision at or before it, with its revision ID, timestamp, section headings, and text. The same lookup as `refract snapshot`, returned as JSON.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `page` | string | required | Page title |
| `at` | string | | ISO 8601 date or timestamp (default: now) |
| `api` | string | | MediaWiki API base URL |
| `revisionLimit` | number | | Revisions to fetch at or before the date (default 500) |
| `content` | enum | | `plain` (default), `wikitext`, `none` |

### `review`

Observe changes to pages since their last acknowledged review and return the saved review report as JSON: `refract review` for an agent. The response adds `reportPath`, a filtered `view`, and an `acknowledgment` field; it lists input revisions by ID, and the saved report keeps their text.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `stateDir` | string | required | Absolute path of the review state directory |
| `pages` | string[] | | Page titles to review |
| `api` | string | | MediaWiki API base URL |
| `from` | number | | Initial baseline for a page with no acknowledged review |
| `limit` | number | | New revisions per page per call (default 200) |
| `sample` | boolean | | Review the bundled fictional history offline |
| `eventTypes` | string[] | | Event types to show in `view` |
| `section` | string | | Section to show in `view` |
| `text` | string | | Text to match in `view` |

The tool never acknowledges a report. Acknowledgment moves the reviewed baseline past every revision in the report, including entries hidden by filters, and records that a person inspected them. When a report can be acknowledged, `acknowledgment.command` is the `refract review --ack` command for that person to run after reading it; an incomplete report has none. All state and reports are written inside `stateDir`. See the [CLI reference](cli) for the review statuses.

## Protocol

- **Transport:** stdio (stdin for requests, stdout for responses)
- **Format:** JSON-RPC 2.0 (protocol version `2025-06-18`)
- **Capabilities:** `tools`, `sampling`
- **Initialization:** Send `tools/list` to discover tools, `tools/call` to invoke

## Validation

To verify your MCP setup is working:

```bash
# Start the server
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | refract mcp | head -1
```

You should receive a JSON-RPC response listing the available tools. For interactive testing, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npx -y @refract-org/cli mcp
```
