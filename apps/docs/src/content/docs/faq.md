---
title: "Troubleshooting / FAQ"
description: "Refract spaces its requests to the MediaWiki API (100 ms apart by default) and retries a 429 or 5xx up to three times, waiting for the server's…"
---

## Rate limits

Refract spaces its requests to the MediaWiki API (100 ms apart by default) and retries a `429` or `5xx` up to three times, waiting for the server's `Retry-After`. If you still see `429 Too Many Requests`, wait a few minutes before retrying: Wikimedia rate-limits by client, and a shared IP (a CI runner, a cloud host) can exhaust it for everyone on it. The CLI does not send `maxlag`; the `MediaWikiClient` library takes a `maxlag` option (`@refract-org/ingestion` 0.3.2+). `-c` / `--cache` avoids re-fetching, but needs `@refract-org/persistence`, which is only available from a source checkout.

## "Page too large" errors

Without `--from`, `--to` or `--since`, `detailed` and `forensic` analysis reads a page's whole history. For a page with thousands of revisions that is slow and can exhaust memory. Scope the run:

```bash
# The latest 20 revisions
refract analyze "Earth" --depth brief --json

# One revision range
refract analyze "Earth" --from <revId> --to <revId> --json
```

`--from` alone reads from that revision to the newest one.

## Authentication errors

| Error | Likely cause | Fix |
|-------|-------------|-----|
| `401 Unauthorized` | Missing or invalid `--api-key` | Check the API token is correct |
| `403 Forbidden` | Token lacks permission | Verify token scope with wiki admin |
| Connection refused | Wrong API URL | Ensure URL ends in `/api.php` |

## Private wikis

For private or authenticated MediaWiki instances, provide credentials:

```bash
refract analyze "Page" \
  --api https://internal.wiki/api.php \
  --api-key <token>
```

Supported auth methods: bearer token (`--api-key`) and basic auth (`--api-user` + `--api-password`). An OAuth2 access token obtained elsewhere is passed as `--api-key`. `refract diff` takes no auth flags.

## Cache issues

If results seem stale, clear the cache:

```bash
rm -rf ~/.wikihistory/
```

Or use `--cache-dir` to point at a fresh location. The default cache directory is `~/.wikihistory/`. It also holds `refract cron` observations, so removing it resets cron's baseline.

The revision cache is read back only for a fixed `--from … --to` range on English Wikipedia. Open ranges, and every run with `--api`, fetch from the wiki each time.

## No events produced

If `refract analyze` returns no events, the page may not have changed in the requested revision range. Try expanding the range or removing `--from`/`--to` to fetch the most recent revisions.

## Cross-wiki diff returns no results

`refract diff` compares a topic across two or more MediaWiki instances. Each wiki must have a page with the given title, and redirects are not followed. A wiki without the page is not an error: its column shows zeros. Verify:

```bash
refract analyze "Topic" --api <wiki-a-url>
refract analyze "Topic" --api <wiki-b-url>
```

## Performance and scaling

### How many revisions per page?

All three depths run the same analyzers, so analysis time per revision is similar.
`brief` is faster in practice because it reads only the latest 20 revisions unless you
give a range. `forensic` writes both revisions' full wikitext into every event, which
makes its output tens of times larger than `detailed`. With `--pages-file`, four pages
are analyzed in parallel by default (`--batch-concurrency`).

### Memory usage

Memory is proportional to revision count, not revision size. Each revision's wikitext
is held in memory during diff comparison, then discarded. A page with 500 revisions at
`detailed` depth uses ~200 MB peak memory. For very large pages (5,000+ revisions),
use `--from` / `--to` to paginate into batches of ~500 revisions.

### When to paginate

Use `--from` / `--to` or `--since` when:
- The page has more than 1,000 revisions
- You need faster processing (narrower ranges process faster)
- You're running on a resource-constrained machine
- You want to process the page in parallel across multiple ranges

For batch processing many pages, use `--pages-file`:

```bash
refract analyze --pages-file topics.txt --depth brief
```

Batch mode prints per-page event counts, not the events. For the events, run `analyze --json` or `export` per page.

### Cache behavior

With `-c` under Bun in a source checkout, the cache stores fetched revisions in `~/.wikihistory/` (default: `~/.wikihistory/refract.db`). Under Node, `-c` prints `Cache write failed` and the run continues uncached. Each revision costs
~2–10 KB of disk space. A page with 500 revisions uses ~5 MB of cache. The cache is
persistent — clear it with `rm -rf ~/.wikihistory/` when disk space is tight.

### API rate limits

Refract sends at most one request per 100 ms from a client (about 10 per second) and
retries a `429` or `5xx` after the server's `Retry-After`. `maxlag` is a parameter a
client chooses to send; the CLI does not send it, and library users can set it on
`MediaWikiClient` (`@refract-org/ingestion` 0.3.2+). For non-Wikipedia MediaWiki instances, rate limits
vary. If you hit 429 errors consistently, increase poll intervals or contact the
wiki's administrator.
