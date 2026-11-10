---
title: "Tutorial: BYO-inference with real models"
description: "Replace Refract's default mechanical heuristics with a model at any BYO-inference boundary. Compare model output against the default, and audit which path…"
---

## Goal

Replace Refract's default mechanical heuristics with a model at any BYO-inference
boundary. Compare model output against the default, and audit which path was taken.

## What BYO-inference means

Every analyzer threshold encodes an interpretive judgment — what counts as a revert,
what sentence similarity means "modified," what activity level constitutes a spike.
Refract ships with mechanical defaults that work offline. But at any of 5 typed
boundaries, you can plug in a model.

The event records which path was taken in `FactProvenance.parameters`. The audit
trail is transparent regardless of who supplied the judgment.

## Step 1: See the default heuristics

Run a classification without a model:

```bash
refract classify revert --input '{"comment":"reverted vandalism"}'
```

Output:
```json
{
  "boundary": "revert",
  "output": { "isRevert": true, "rationale": "comment matches revert pattern" },
  "source": "default"
}
```

`source: "default"` means the mechanical heuristic (6 regex patterns) made the
decision. No API call was made.

## Step 2: Plug in a model

Set your API key and endpoint:

```bash
export REFRACT_INFERENCE_API_KEY="sk-..."
export REFRACT_INFERENCE_ENDPOINT="https://api.openai.com/v1/chat/completions"
export REFRACT_INFERENCE_MODEL="gpt-4o-mini"
```

Or pass them as flags:

```bash
refract classify revert \
  --input '{"comment":"reverted vandalism"}' \
  --endpoint https://api.openai.com/v1/chat/completions \
  --model gpt-4o-mini
```

Output:
```json
{
  "boundary": "revert",
  "output": { "isRevert": true, "rationale": "The edit comment explicitly states 'reverted vandalism'" },
  "source": "model",
  "confidence": 0.98
}
```

`source: "model"` + `confidence` — the model classified the boundary, and you know
how confident it was.

## Step 3: Try different providers

Refract works with any OpenAI-compatible API:

### DeepSeek

```bash
refract classify revert \
  --input '{"comment":"rv unexplained removal"}' \
  --endpoint https://api.deepseek.com/v1/chat/completions \
  --model deepseek-chat
```

### Local Ollama

```bash
# Start Ollama locally
ollama serve

# Run with a local model
refract classify revert \
  --input '{"comment":"undo previous edit"}' \
  --endpoint http://localhost:11434/v1/chat/completions \
  --model llama3
```

### Anthropic (via proxy)

```bash
refract classify revert \
  --input '{"comment":"rvv"}' \
  --endpoint https://your-anthropic-proxy/v1/chat/completions \
  --model claude-3-haiku
```

No provider lock-in. Any endpoint that speaks `chat/completions` works.

## Step 4: Compare model vs default

Run the same classification with and without a model and compare:

```bash
# Default
refract classify sentence_similarity \
  --input '{"before":"Earth is the third planet from the Sun","after":"Earth orbits the Sun as the third planet"}'

# Model
refract classify sentence_similarity \
  --input '{"before":"Earth is the third planet from the Sun","after":"Earth orbits the Sun as the third planet"}' \
  --model gpt-4o-mini
```

The default uses word-overlap ratio (threshold 0.8). The model considers semantic
meaning. Same input, different reasoning, both recorded.

## Step 5: Audit which path was taken

When a model classifies a boundary during a full page analysis, the event records
the path:

```bash
refract analyze "COVID-19" --depth forensic --report > report.json
```

Check `FactProvenance.parameters` in the output:

```json
{
  "deterministicFacts": [{
    "fact": "revert_detected",
    "provenance": {
      "analyzer": "revert-detector",
      "version": "0.5.1",
      "parameters": {
        "similaritySource": "model",
        "modelName": "gpt-4o-mini"
      }
    }
  }]
}
```

`similaritySource: "model"` means the model was used. `similaritySource: "default"`
means the mechanical heuristic was used. Every event carries this audit trail — you
always know who made the judgment.

## Step 6: Use the MCP server for agent-driven classification

AI coding agents can call `refract classify` via the MCP server's sampling capability.
The agent's host LLM classifies the boundary, and the result includes `source: "model"`
for auditability:

```bash
refract mcp
```

Connect any MCP client and ask:

> "Classify the most recent edit to the ChatGPT page — is it a revert, a major addition,
> or a minor edit? Use the model for classification."

The agent calls `refract classify heuristic` via MCP, the host LLM classifies, and
the result is recorded with provenance.

## The 5 BYO-inference boundaries

| Boundary | Default (mechanical) | Model question |
|---|---|---|
| `revert` | 6 regex patterns | "Is this edit comment a revert?" |
| `sentence_similarity` | Word-overlap ratio (0.8) | "Are these two sentences the same claim?" |
| `heuristic` | Size thresholds + comment patterns | "What kind of edit is this?" |
| `template_signal` | Name-to-type lookup | "What policy signal does this template represent?" |
| `activity_spike` | 3x moving average | "Is this a meaningful spike in talk activity?" |

## Next steps

- [MCP agent tutorial](mcp-agent.md) — connect AI coding agents to Refract
- [CLI classify reference](../cli.md#refract-classify) — all boundaries and flags
- [Concepts: BYO-inference](../concepts.md#configurable-heuristics--byo-inference-boundaries) — architectural rationale
