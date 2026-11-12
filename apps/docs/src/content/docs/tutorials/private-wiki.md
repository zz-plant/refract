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

Refract sends the token as an `Authorization: Bearer <token>` header. No other
header format is available.

The CLI reads the token from the flag only; there is no environment variable for it.
To keep the token out of shell history and scripts, hold it in a variable of your own
and expand it on the command line:

```bash
export WIKI_TOKEN="your-bearer-token-here"
refract analyze "Internal_Page" \
  --api https://wiki.internal.example.com/w/api.php \
  --api-key "$WIKI_TOKEN"
```

## Step 3: Authenticate with basic auth

Some wikis use HTTP basic authentication:

```bash
refract analyze "Restricted_Page" \
  --api https://restricted.wiki.example.com/api.php \
  --api-user "username" \
  --api-password "password"
```

Refract sends `Authorization: Basic <base64>` with the credentials. These are read
from the flags only, so pass variables of your own the same way:

```bash
refract analyze "Restricted_Page" \
  --api https://restricted.wiki.example.com/api.php \
  --api-user "$WIKI_USER" \
  --api-password "$WIKI_PASSWORD"
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
  --api-key "$WIKI_TOKEN"
```

`brief` depth reads only the latest 20 revisions — few API calls, fast feedback.
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
# Analysis of one revision range on a private wiki
refract analyze "Sensitive_Page" --from <revId> --to <revId> --json \
  --api https://private.wiki.example.com/api.php \
  --api-key "$WIKI_TOKEN"

# Track a specific claim
refract claim "Sensitive_Page" --text "specific claim text" \
  --api https://private.wiki.example.com/api.php \
  --api-key "$WIKI_TOKEN"

# Export as NDJSON
refract export "Sensitive_Page" --from <revId> --to <revId> --format ndjson \
  --api https://private.wiki.example.com/api.php \
  --api-key "$WIKI_TOKEN"
```

`analyze`, `claim`, `export`, `cron`, `snapshot` and `watch` accept the auth flags.
`refract diff` does not.

## Step 8: Cron monitoring with auth

For scheduled monitoring of private wikis, include auth in the cron command:

```bash
# crontab entry
0 */6 * * * refract cron /path/to/pages.txt --interval 6 \
  --api https://private.wiki.example.com/api.php \
  --api-key "$WIKI_TOKEN" --cache-dir /path/to/state
```

`cron` has no `-c` flag; `--cache-dir` is where it keeps its state. Define `WIKI_TOKEN`
in the crontab or in a wrapper script, since cron jobs do not inherit your shell's
variables.

Or with GitHub Actions:

```yaml
- run: >
    refract cron pages.txt --interval 6
    --api https://private.wiki.example.com/api.php
    --api-key "$WIKI_TOKEN" --cache-dir .refract
  env:
    WIKI_TOKEN: ${{ secrets.WIKI_API_KEY }}
```

The [cron reference](../cron.md#scheduling-with-github-actions) shows how to carry
`.refract` from one run to the next.

## Security considerations

- Tokens in CLI flags are visible in `ps` / process listings while the command runs,
  including when the flag's value comes from a shell variable.
- The revision cache is not used with `--api`. `refract cron` observation files under
  `--cache-dir` (default `~/.wikihistory`) hold text from the private wiki. On shared
  machines, set `--cache-dir` to an encrypted volume.
- Use an `https://` API URL. An `http://` URL is accepted and sends the credentials
  unencrypted.

## Next steps

- [CLI reference](../cli.md) — all global auth flags
- [Scheduled monitoring tutorial](scheduled-monitoring.md) — cron and watch setup
- [Security reference](../security.md) — credential handling and data retention
