---
title: "Security"
description: "When using --cache, revision content is persisted to ~/.wikihistory/refract.db (SQLite). This file contains full wikitext from every revision fetched. On…"
---

## Credential exposure

CLI flags containing credentials (`--api-key`, `--api-password`) are visible in process listings.

### MediaWiki auth (`--api-key`)

Used for authenticated API access to private wikis. `analyze`, `claim`, `export`, `cron`, `snapshot`, `watch`, `review`, `visualize`, `explore` and `delegation` accept the flags; `diff` does not.

| CLI flag | Sent as |
|----------|---------|
| `--api-key` | `Authorization: Bearer <token>` |
| `--api-user` with `--api-password` | `Authorization: Basic <base64>` |

The CLI reads these credentials from the flags only. To keep a token out of shell history and scripts, hold it in a variable of your own and pass it on the command line:

```bash
refract analyze "Page" --api https://wiki.example.org/w/api.php --api-key "$MY_WIKI_TOKEN"
```

The expanded value still appears in the process listing while the command runs.

Two environment variables are read: `REFRACT_OAUTH_CLIENT_ID` and `REFRACT_OAUTH_CLIENT_SECRET`. When both are set they are sent as `X-OAuth-Client-Id` and `X-OAuth-Client-Secret` headers on every request.

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

Refract makes outbound requests to the configured MediaWiki API. Authentication tokens are sent in the `Authorization` header. Traffic is encrypted when the `--api` URL is `https://`; an `http://` URL is accepted and sends credentials in the clear.

Bundled evidence files (`--bundle`) are neither signed nor encrypted — they contain plaintext event data and a SHA-256 hash of their contents, which anyone who edits the file can recompute.

## Data retention

Cached revision data persists indefinitely in `~/.wikihistory/refract.db`. Clear it manually:

```bash
rm -rf ~/.wikihistory/
```

There is no automatic data retention policy. The cache only contains data you explicitly fetched.
