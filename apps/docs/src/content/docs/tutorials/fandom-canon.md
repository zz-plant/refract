---
title: "Tutorial: Track canon changes on a Fandom wiki"
description: "Monitor how a Fandom wiki's canon pages change over time: when lore-critical statements appear, disappear, or are rewritten — and how editorial consensus…"
---

## Goal

Monitor how a Fandom wiki's canon pages change over time: when lore-critical
statements appear, disappear, or are rewritten — and how editorial consensus shifts.

## Steps

### 1. Point Refract at a Fandom wiki

Fandom wikis use the standard MediaWiki API. Pass `--api` with the wiki's API endpoint:

```bash
refract analyze "Darth_Vader" --api https://starwars.fandom.com/api.php --depth detailed
```

### 2. Cache for repeated analysis

Fandom API rate limits differ from Wikipedia. Cache revisions to avoid re-fetching:

```bash
refract analyze "Darth_Vader" --api https://starwars.fandom.com/api.php --depth detailed -c
```

### 3. Export for comparison

```bash
refract export "Darth_Vader" --api https://starwars.fandom.com/api.php --format ndjson > canon-events.jsonl
```

### 4. Track a specific lore claim

```bash
refract claim "Darth_Vader" \
  --text "midichlorian count is over 20,000" \
  --api https://starwars.fandom.com/api.php -c
```

This produces a timeline of every revision where that claim was added, modified,
removed, or reintroduced.

### 5. Watch for new edits

```bash
refract watch "Darth_Vader" --api https://starwars.fandom.com/api.php --interval 60000
```

Polls the wiki every 60 seconds and prints new events as they appear. Press Ctrl+C to stop.

## Understanding what you see

Fandom wikis differ from Wikipedia in important ways:

| Signal | On Wikipedia | On Fandom wikis |
|--------|-------------|-----------------|
| **`sentence_first_seen`** | New factual claim | New character backstory, power level, or timeline entry |
| **`sentence_removed`** | Claim removed (possibly contested) | Retcon — lore being erased or rewritten |
| **`category_added` / `category_removed`** | Content tagging change | Canon classification shift (e.g., "Canon characters" → "Legends characters") |
| **`template_added`** | Policy template | "Citation needed" on lore claims, "Speculation" tags |
| **`revert_detected`** | Editorial dispute | Canon war — competing interpretations of what's official |

**Retcon detection pattern**: Watch for `sentence_removed` on a long-standing claim
followed by `sentence_first_seen` with different text in the same section. This is
the mechanical signature of a retcon — old lore replaced by new canon.

**Canon divergence across wikis**: Compare the same topic across two Fandom wikis with
`refract diff`. Divergence in categories or template usage between wikis signals
different interpretations of what's official.

## Example: 2014 Disney acquisition

After Disney acquired Lucasfilm in 2014, many characters and ships had their
canon status reclassified. Refract captures this as a pattern of:

- `category_removed`: `Canon characters`
- `category_added`: `Legends characters`
- `sentence_modified` events as backstories were rewritten to match new canon
- `template_added`: `{{Legends|canon}}` banners

```
[2014-04-25] category_removed (rev 123456→123457)
  Section: body
  target: Category:Canon characters

[2014-04-25] category_added (rev 123456→123457)
  Section: body
  target: Category:Legends characters
```

## Cross-wiki comparison

For the same fictional universe across competing wikis, use `refract diff`:

```bash
refract diff "Darth_Vader" \
  --wiki-a https://starwars.fandom.com/api.php \
  --wiki-b https://star-wars.fandom.com/api.php \
  --depth detailed
```

This produces a side-by-side analysis showing where the two wikis diverge on the same
topic — different backstories, different categorizations, different levels of detail.

## Troubleshooting

- **Fandom rate limits**: Fandom APIs may throttle more aggressively than Wikipedia.
  Use `-c` to cache and add `--interval 120000` for `watch` mode if you hit limits.
- **Private wikis**: Pass auth credentials for private or institutional MediaWiki
  instances: `--api-key <token>` or `--api-user <user> --api-password <pass>`.
- **Custom domain wikis**: Fandom wikis hosted on custom domains still expose the
  MediaWiki API at `https://<domain>/api.php`. Find the API endpoint by appending
  `?action=query&format=json` to the wiki's base URL.

## Next steps

- [Track Wikipedia changes](wikipedia-history.md)
- [Monitor citation churn](citation-churn.md)
- [Build a dispute timeline](dispute-timeline.md)
- [Analyze with DuckDB](../analytics.md)
