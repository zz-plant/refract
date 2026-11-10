---
title: "Tutorial: Connect to private and authenticated wikis"
description: "Use Refract to analyze pages on private MediaWiki instances — internal wikis, corporate knowledge bases, or restricted-access wikis that require…"
---

## Goal

Use Refract to analyze pages on private MediaWiki instances — internal wikis, corporate
knowledge bases, or restricted-access wikis that require authentication.

## Step 1: Identify the API endpoint

Every MediaWiki instance exposes an `api.php` endpoint. For private wikis, this is
typically behind authentication:

```bash
# Public wiki (no auth)
refract analyze "Page" --api https://en.wikipedia.org/w/api.php

# Private wiki (requires auth)
refract analyze "Page" --api https://internal.company.com/w/api.php
```

The API URL must end in `/api.php`. If your wiki uses a different path (e.g.,
`/w/api.php` for Wikimedia-hosted wikis), adjust accordingly.

## Step 2: Authenticate with a bearer token

Many private MediaWiki instances use OAuth2 or personal access tokens:

```bash
refract analyze "Internal_Page" \
  --api https://wiki.internal.example.com/w/api.php \
  --api-key "your-bearer-token-here"
```

Refract sends the token as an `Authorization: Bearer <token>` header. If your wiki
expects a different header format, use the environment variable approach and a
custom header injection.

Environment variable alternative (avoids exposing the token in shell history):

```bash
export REFRACT_API_KEY="your-bearer-token-here"
refract analyze "Internal_Page" --api https://wiki.internal.example.com/w/api.php
```

## Step 3: Authenticate with basic auth

Some wikis use HTTP basic authentication:

```bash
refract analyze "Restricted_Page" \
  --api https://restricted.wiki.example.com/api.php \
  --api-user "username" \
  --api-password "password"
```

Refract sends `Authorization: Basic <base64>` with the credentials. Use environment
variables for production:

```bash
export REFRACT_API_USER="username"
export REFRACT_API_PASSWORD="password"
refract analyze "Restricted_Page" \
  --api https://restricted.wiki.example.com/api.php
```

## Step 4: OAuth2 authentication

For wikis that use OAuth2 (common with enterprise MediaWiki deployments):

```bash
refract analyze "Enterprise_Page" \
  --api https://enterprise.wiki.example.com/api.php \
  --api-key "oauth2-access-token"
```

The OAuth2 flow itself (obtaining the token) is outside Refract's scope. Once you
have an access token, pass it as `--api-key`. Refract sends it as a bearer token.

## Step 5: Verify the connection

Test with a lightweight analysis:

```bash
refract analyze "Main_Page" --depth brief \
  --api https://private.wiki.example.com/api.php \
  --api-key "$REFRACT_API_KEY"
```

`brief` depth runs only the section differ — minimal API calls, fast feedback.
If you get events, the connection works. If you get an authentication error, check
the token scope and format.

## Step 6: Handle authentication errors

| Error | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` | Missing or invalid token | Check `--api-key` is correct and not expired |
| `403 Forbidden` | Token lacks read permission | Verify token scope with wiki admin |
| Connection refused | Wrong API URL | Ensure URL ends in `/api.php` and the wiki is reachable |
| `maxlag` errors | Database replicas lagging behind the `maxlag` you set on `MediaWikiClient` | Retried after the wiki's `Retry-After` (`@refract-org/ingestion` 0.3.2+); if they persist, wait |

## Step 7: Run regular analysis with auth

Once authenticated, all Refract commands work identically — just pass the auth flags:

```bash
# Full forensic analysis on a private wiki
refract analyze "Sensitive_Page" --depth forensic \
  --api https://private.wiki.example.com/api.php \
  --api-key "$REFRACT_API_KEY" \
  -c

# Track a specific claim
refract claim "Sensitive_Page" --text "specific claim text" \
  --api https://private.wiki.example.com/api.php \
  --api-key "$REFRACT_API_KEY"

# Export as NDJSON
refract export "Sensitive_Page" --format ndjson \
  --api https://private.wiki.example.com/api.php \
  --api-key "$REFRACT_API_KEY"
```

## Step 8: Cron monitoring with auth

For scheduled monitoring of private wikis, include auth in the cron command:

```bash
# crontab entry
0 */6 * * * refract cron /path/to/pages.txt --interval 6 \
  --api https://private.wiki.example.com/api.php \
  --api-key "$REFRACT_API_KEY" -c
```

Or with GitHub Actions:

```yaml
- run: refract cron pages.txt --interval 6 -c
  env:
    REFRACT_API_KEY: ${{ secrets.WIKI_API_KEY }}
```

## Security considerations

- Tokens in CLI flags are visible in `ps` / process listings. Use environment
  variables (`REFRACT_API_KEY`) for production.
- Cached revisions (SQLite in `~/.wikihistory/refract.db`) contain full wikitext
  content from the private wiki. On shared machines, set `--cache-dir` to an
  encrypted volume.
- Refract makes outbound HTTPS requests only. All traffic is encrypted in transit.

## Next steps

- [CLI reference](../cli.md) — all global auth flags
- [Scheduled monitoring tutorial](scheduled-monitoring.md) — cron and watch setup
- [Security reference](../security.md) — credential handling and data retention
