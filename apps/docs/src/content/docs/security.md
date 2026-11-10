---
title: "Security"
description: "When using --cache, revision content is persisted to ~/.wikihistory/refract.db (SQLite). This file contains full wikitext from every revision fetched. On…"
---

## Credential exposure

CLI flags containing credentials (`--api-key`, `--api-password`) are visible in process listings. Use environment variables instead:

### MediaWiki auth (global `--api-key`)

Used for authenticated API access to private wikis. Applies globally across `analyze`, `claim`, `export`, and `cron`:

| CLI flag | Environment variable |
|----------|---------------------|
| `--api-key` | `REFRACT_MEDIAWIKI_API_KEY` |
| `--api-user` | `REFRACT_MEDIAWIKI_API_USER` |
| `--api-password` | `REFRACT_MEDIAWIKI_API_PASSWORD` |

### Inference provider auth (`refract classify --api-key`)

Used only for `refract classify` to call an LLM at a BYO-inference boundary:

| CLI flag | Environment variable |
|----------|---------------------|
| `--api-key` | `REFRACT_INFERENCE_API_KEY` |
| `--endpoint` | `REFRACT_INFERENCE_ENDPOINT` |
| `--model` | `REFRACT_INFERENCE_MODEL` |

## Local storage

When using `--cache`, revision content is persisted to `~/.wikihistory/refract.db` (SQLite). This file contains full wikitext from every revision fetched. On shared machines, set `--cache-dir` to an encrypted volume.

## Network

Refract makes outbound HTTPS requests to the configured MediaWiki API. Authentication tokens are sent as `Authorization` or `x-api-key` headers. All traffic is encrypted in transit.

Bundled evidence files (`--bundle`) are neither signed nor encrypted — they contain plaintext event data and a SHA-256 hash of their contents, which anyone who edits the file can recompute.

## Data retention

Cached revision data persists indefinitely in `~/.wikihistory/refract.db`. Clear it manually:

```bash
rm -rf ~/.wikihistory/
```

There is no automatic data retention policy. The cache only contains data you explicitly fetched.
