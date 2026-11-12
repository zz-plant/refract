---
title: "Tutorial: Non-English Wikipedia analysis"
description: "Use Refract to analyze pages on any language edition of Wikipedia. Refract works with any MediaWiki instance — English is just the default. This tutorial…"
---

## Goal

Use Refract to analyze pages on any language edition of Wikipedia. Refract works with
any MediaWiki instance — English is just the default. This tutorial uses German
Wikipedia (de.wikipedia.org) as an example.

## Why non-English wikis matter

Different language editions tell different versions of the same story. A claim that
appears in English Wikipedia may be absent, contested, or framed differently in German,
French, or Japanese. Refract's `--api` flag lets you run the same deterministic analysis
on any language edition and compare results.

## Step 1: Analyze a page on German Wikipedia

```bash
refract analyze "COVID-19" --api https://de.wikipedia.org/w/api.php --depth brief --json \
  | jq -r .eventType | sort | uniq -c | sort -rn | head -4
```

`brief` reads the latest 20 revisions. Output is identical in structure to English
Wikipedia — same event types, same `EvidenceEvent` schema. Only the page content
differs. A run on 2026-11-11 printed:

```
 157 section_reorganized
  23 template_parameter_changed
  17 sentence_removed
  12 sentence_modified
```

Titles are per wiki: the German article on Earth is "Erde". A title that does not
exist yields no events and no error.

## Step 2: Compare across editions

Export both language editions and compare:

```bash
refract analyze "COVID-19" \
  --api https://en.wikipedia.org/w/api.php \
  --depth brief --json > covid-en.jsonl

refract analyze "COVID-19" \
  --api https://de.wikipedia.org/w/api.php \
  --depth brief --json > covid-de.jsonl
```

`--json` is what makes the files NDJSON. For the changed text as well as the event
types, replace `--depth brief` with a `--from <revId> --to <revId>` range on each wiki.

Query for differences with DuckDB:

```sql
SELECT 'en' AS wiki, count(*) AS events FROM 'covid-en.jsonl'
UNION ALL
SELECT 'de', count(*) FROM 'covid-de.jsonl';
```

Or use `refract diff` for structured cross-wiki comparison:

```bash
refract diff "COVID-19" \
  --wiki-a https://en.wikipedia.org/w/api.php \
  --wiki-b https://de.wikipedia.org/w/api.php \
  --depth brief
```

`refract diff` prints side-by-side event counts for the same title on each wiki. Its
z-score outlier list cannot show anything with fewer than five wikis; see the
[cross-wiki tutorial](cross-wiki-diff.md#reading-the-output).

## Step 3: Track a claim across language editions

```bash
# English
refract claim "COVID-19" --text "originated in Wuhan" \
  --api https://en.wikipedia.org/w/api.php

# German
refract claim "COVID-19" --text "erstmals in Wuhan" \
  --api https://de.wikipedia.org/w/api.php
```

Compare when each edition first matched the passage and whether it later disappeared.
`claim` reads the latest 50 revisions unless you give `--limit` or a `--from`/`--to`
range, so "first" means first within those.

## Step 4: Forensic depth on non-English pages

All depth levels work identically:

```bash
refract analyze "COVID-19" \
  --api https://de.wikipedia.org/w/api.php \
  --from <revId> --to <revId> \
  --depth forensic --json
```

Forensic depth adds both revisions' full wikitext to every event. The analyzers and
event types are the same at every depth, regardless of language.

## Supported language editions

Refract has been tested against:

| Language | API endpoint | Example page |
|---|---|---|
| English | `https://en.wikipedia.org/w/api.php` | `Earth` |
| German | `https://de.wikipedia.org/w/api.php` | `Erde` |
| French | `https://fr.wikipedia.org/w/api.php` | `Terre` |
| Japanese | `https://ja.wikipedia.org/w/api.php` | `地球` |

Any MediaWiki instance that exposes an `api.php` endpoint is supported. This includes:

- All 300+ Wikipedia language editions
- Fandom wikis (e.g., `https://starwars.fandom.com/api.php`)
- Independent MediaWiki installations
- Private/authenticated wikis (see [private wiki tutorial](private-wiki.md))

## Caching across wikis

The revision cache (`-c`) is skipped whenever `--api` is given, so a run against
another language edition always fetches from the wiki.

`refract cron` keeps its observations by page title only. When monitoring the same
title on two wikis, give each its own `--cache-dir`:

```bash
refract cron pages.txt --api https://de.wikipedia.org/w/api.php --cache-dir ~/.refract-cron/de
refract cron pages.txt --api https://fr.wikipedia.org/w/api.php --cache-dir ~/.refract-cron/fr
```

## Next steps

- [Cross-wiki comparison tutorial](cross-wiki-diff.md) — structured multi-wiki diff
- [Private wiki tutorial](private-wiki.md) — authenticated MediaWiki instances
- [Combat revisionism tutorial](combating-revisionism.md) — reproducible event records
- [Comparison page](../compare.md) — Refract vs other tools
