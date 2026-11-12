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
refract analyze "Midi-chlorian" --api https://starwars.fandom.com/api.php --depth brief --json
```

`brief` reads the latest 20 revisions and prints one event per line, without the
changed text.

Use the title of the page itself. Redirects are not followed: "Darth_Vader" on this
wiki redirects to "Anakin Skywalker", and analyzing it reports the redirect page's
own history.

### 2. Bound each run

Fandom API rate limits differ from Wikipedia, and the revision cache (`-c`) is not
used with `--api`: every run fetches from the wiki. Give a revision range to keep the
run small and repeatable:

```bash
refract analyze "Midi-chlorian" --api https://starwars.fandom.com/api.php --from 15147177 --to 15819492 --json
```

This range holds 20 revisions. Without `--from` and `--to`, `detailed` depth reads
the page's whole history.

### 3. Export for comparison

```bash
refract export "Midi-chlorian" --api https://starwars.fandom.com/api.php --from 15147177 --to 15819492 --format ndjson > canon-events.jsonl
```

### 4. Track a specific lore claim

```bash
refract claim "Midi-chlorian" \
  --text "midi-chlorians" \
  --api https://starwars.fandom.com/api.php --limit 20
```

This prints the matching sentence in each of the latest 20 revisions, then when the
passage was first matched, changed, removed or reintroduced within them. Without
`--limit` the latest 50 are read; `--from` and `--to` select an earlier range.

### 5. Watch for new edits

```bash
refract watch "Midi-chlorian" --api https://starwars.fandom.com/api.php --interval 60000
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
  △ category removed (rev 123456→123457)
    category=canon characters

  △ category added (rev 123456→123457)
    category=legends characters
```

The revision IDs and categories above are illustrative; the layout is `refract
analyze`'s text output.

## Cross-wiki comparison

For the same fictional universe across competing wikis, use `refract diff`:

```bash
refract diff "Darth_Vader" \
  --wiki-a https://lego.fandom.com/api.php \
  --wiki-b https://battlefront.fandom.com/api.php \
  --depth brief
```

This prints side-by-side counts for the two wikis over their latest 20 revisions:
events by type, sections, citations, templates, categories and wikilinks. The title
has to be a page, not a redirect, on both.

## Troubleshooting

- **Fandom rate limits**: Fandom APIs may throttle more aggressively than Wikipedia.
  The cache (`-c`) is not used with `--api`; bound runs with `--depth brief` or
  `--from`/`--to`, and add `--interval 120000` for `watch` mode if you hit limits.
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
