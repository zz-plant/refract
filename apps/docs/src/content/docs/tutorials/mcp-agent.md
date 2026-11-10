---
title: "Tutorial: MCP server for AI coding agents"
description: "Connect an AI coding agent (Claude Code, VS Code/Cursor, Claude Desktop) to Refract via its built-in MCP server. The agent calls Refract tools to analyze…"
---

## Goal

Connect an AI coding agent (Claude Code, VS Code/Cursor, Claude Desktop) to Refract
via its built-in MCP server. The agent calls Refract tools to analyze Wikipedia pages,
track claims, and cite provenance in its reasoning — without you running any commands.

## What the MCP server gives agents

`refract mcp` starts a JSON-RPC server over stdio that exposes Refract's engine as
typed tools. Any MCP-compatible agent can:

- Analyze a page and receive structured events with deterministic hashes
- Track a specific claim across revision history
- Export analysis as structured data
- Re-observe pages for scheduled monitoring
- Classify observation boundaries using a model

The agent reads events, not documentation. It cites provenance, not opinion.

## Step 1: Connect your agent

### Claude Code

Add to your Claude Code MCP config:

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

The server starts and waits for MCP client connections on stdio. No configuration
beyond pointing at the binary.

## Step 2: Ask the agent to analyze a page

Once connected, ask your agent:

> "Use Refract to analyze the Wikipedia page for ChatGPT. Show me a timeline of when
> citations were added and removed. Which citations have survived the longest?"

The agent calls `refract analyze` via MCP, receives structured events, and synthesizes:

> ChatGPT's Wikipedia page has 47 citation events across 20 revisions. The citation to
> the OpenAI blog post (added 2022-11-30) is the oldest surviving source — it has never
> been removed or replaced. In contrast, the citation to the "GPT-4 technical report"
> was replaced 3 times between March and June 2023, each time with a different arXiv
> preprint. The current citation has been stable since June 2023.

Every event the agent references carries a deterministic `eventId` and `FactProvenance`
— verifiable, not hallucinated.

## Step 3: Track a specific claim

> "Using Refract, check the claim 'GPT-4 was trained on 45TB of text data' on the
> ChatGPT page. When was it first added? Has it been removed or rewritten?"

The agent calls `refract claim` via MCP, gets the claim's revision history:

> The claim first appeared on March 14, 2024 (revision 1213800001). It was removed
> on March 20, 2024 by an edit that replaced the entire "Training" section. The claim
> was reintroduced on March 22, 2024 with softened language: "reports suggest GPT-4
> was trained on approximately 45TB of text data." The original unsourced version was
> never restored.

The agent can trace every mutation — addition, removal, reintroduction, softening —
with exact revision IDs and timestamps.

## Step 4: Classify a boundary with a model

The MCP server supports sampling — it can request the host's LLM to interpret events:

> "Classify the most recent edit to the ChatGPT page using a model. Is it a revert,
> a major content addition, or a minor edit?"

The agent calls `refract classify heuristic` via MCP with the edit data. If an API key
is configured, the model classifies the boundary. The result includes `source: "model"`
for auditability — the agent knows whether the classification came from a model or the
default heuristic.

## Step 5: Ask follow-up questions

The agent can chain multiple calls. Structure the conversation around the data:

> "Now analyze the talk page. Were there discussions about the training data claim
> before it was removed?"

The agent calls `refract analyze "Talk:ChatGPT"` and correlates talk page events with
the article timeline. It reports whether the removal was preceded by deliberation
(`talk_page_correlated` events) or was silent.

## Step 6: Verify the results

The agent can verify its own output. Ask it:

> "Run the same analysis again and compare the event hashes. Are the results identical?"

Because Refract's output is deterministic, the agent can compare `eventId` hashes
across runs and confirm they match — proving the observation is reproducible, not
stochastic.

## Available MCP tools

| Tool | What it does | Key parameters |
|---|---|---|
| `analyze` | Analyze a page's full edit history | `page`, `depth`, `api`, `from`, `to`, `since` |
| `claim` | Track a specific sentence across revisions | `page`, `text` |
| `export` | Export page analysis as structured JSON | `page`, `depth`, `api`, `since` |
| `cron` | Re-observe pages for scheduled monitoring | `pagesFile` |
| `classify` | Classify a boundary with a model | `boundary`, `input`, `apiKey`, `model` |

All tools return typed events with `schemaVersion`, `FactProvenance`, and deterministic
hashes — structured data the agent can reason about, not unstructured text.

## Validation

Verify your MCP setup is working:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | refract mcp | head -1
```

You should receive a JSON-RPC response listing the available tools. For interactive
testing:

```bash
npx @modelcontextprotocol/inspector npx -y @refract-org/cli mcp
```

## Next steps

- [MCP reference](../mcp.md) — full protocol, tool schemas, all parameters
- [RAG provenance tutorial](rag-provenance.md) — using stability signals in retrieval
- [Downstream integration](../downstream.md) — production patterns for consuming events
