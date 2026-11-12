---
title: "Tutorial: BYO-inference summarization"
description: "Pipe Refract's deterministic event stream through an LLM to produce a human-readable summary of what changed on a Wikipedia page. The engine stays…"
---

## Goal

Pipe Refract's deterministic event stream through an LLM to produce a human-readable
summary of what changed on a Wikipedia page. The engine stays deterministic. The
model provides the narrative. Each one is auditable independently.

## Why summarize with a model

Refract produces 26 event types — raw, structured, queryable. Non-technical users
don't want an event stream. They want: "This week, 3 citations were removed from the
lead section, the origin claims were softened, and a dispute template was added."

The model doesn't change Refract's output. It reads it and summarizes.

## Step 1: Export the event stream

```bash
refract analyze "COVID-19" --since 2026-01-01 --depth detailed --json > covid-events.jsonl
```

`--json` writes one event per line. Without it, `analyze` prints a report for reading.
Detailed depth keeps each event to the changed text; forensic depth adds both
revisions' full wikitext to every event, which is too much to send to a model.

## Step 2: Summarize with a model

```bash
# Build the request from the first 100 events and send it to any
# OpenAI-compatible endpoint
head -100 covid-events.jsonl | \
  jq -s '{
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [{
      role: "system",
      content: "Summarize these Wikipedia revision events in 3-5 bullet points. Group by theme: citations, claims, disputes, structure. Mention which sections were affected. Be specific about what changed."
    }, {
      role: "user",
      content: (map({eventType, section, before, after, timestamp}) | tojson)
    }]
  }' | \
  curl -s https://api.openai.com/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d @- | jq -r '.choices[0].message.content'
```

Output of this kind (the model's wording varies):

```
• Citations: 2 sources removed from "Origins" section (WHO report dated 2023-01-15,
  Lancet study dated 2022-06-03). 1 new citation added to "Transmission" section
  (CDC update dated 2026-01-10).
• Claims: Origin language softened — "The virus originated in Wuhan" changed to
  "The earliest known cases were identified in Wuhan." 4 sentence modifications
  across "Origins" and "Timeline" sections.
• Disputes: NPOV template added to "Origins" section on 2026-01-12. 2 reverts
  detected in same section within 24 hours.
• Structure: "Variants" section reorganized — 2 new subsections added.
```

## Step 3: Use the MCP server for agent-driven summarization

```bash
refract mcp
```

Connect any MCP client and ask:

> "Analyze the COVID-19 Wikipedia page since January 2026. Give me a summary of
> what changed: citations, claims, disputes, structure. Be specific."

The agent calls `refract analyze` via MCP, receives structured events, and
synthesizes a summary. Every claim in the summary is backed by a deterministic
event with a hash — the agent can cite provenance.

## Step 4: Keep the events and the summary apart

When a model produces a summary, the original events are unchanged — the model
consumed the stream, it didn't modify it. The events do not record that a model
read them, so store the model name and prompt with the summary yourself.

To verify the events: compare the `eventId` hashes before and after summarization.
They match. The engine is deterministic. The narrative is interpretive. Each is
auditable independently.

## Available models

Any OpenAI-compatible endpoint works:

| Provider | Endpoint | Model |
|---|---|---|
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| Ollama (local) | `http://localhost:11434/v1/chat/completions` | `llama3` |
| Anthropic (proxy) | Your proxy endpoint | `claude-3-haiku` |
| Together | `https://api.together.xyz/v1/chat/completions` | `mistral` |

## Next steps

- [BYO-inference tutorial](byo-inference.md) — replacing heuristics with models at each boundary
- [MCP agent tutorial](mcp-agent.md) — connect AI coding agents to Refract
- [RAG provenance tutorial](rag-provenance.md) — stability signals for retrieval
