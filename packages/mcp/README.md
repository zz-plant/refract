# @refract-org/mcp

The tools behind `refract mcp`. They let an AI agent ask how a Wikipedia or other MediaWiki page changed, and get events tied to revision IDs.

This package is a library with no executable. To connect an agent, run the server from the CLI package:

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

Name the scoped package: the unscoped npm package `refract` is an unrelated project.

## Tools

| Tool | What it does |
|------|--------------|
| `analyze` | Returns a page's event stream: claims, citations, sections, templates, categories, wikilinks, and reverts |
| `claim` | Tracks a sentence across revisions: when it appeared, was removed, or returned |
| `get_statement_history` | Tracks a statement or close match, with an overall status and a short change summary |
| `export` | Returns all events as structured JSON |
| `cron` | Reads a pages file, runs analysis once, and reports new events |
| `snapshot` | Returns the revision live at a date, with its ID, section headings, and text |
| `review` | Observes pages since their last acknowledged review and returns the saved report; acknowledgment stays a CLI step for a person |
| `classify` | Asks a model to classify one observation boundary; it is the only tool that uses a model |

[MCP setup and parameters](https://zz-plant.github.io/refract/mcp/) · [Repository](https://github.com/refract-org/refract)
