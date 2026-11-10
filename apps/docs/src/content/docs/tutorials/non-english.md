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
refract analyze "COVID-19" --api https://de.wikipedia.org/w/api.php --depth detailed
```

Output is identical in structure to English Wikipedia — same 26 event types, same
`EvidenceEvent` schema, same deterministic guarantees. Only the page content differs:

```
Analysis Results
  Page:    COVID-19
  Events:  247

[2020-03-15T12:00:00Z] sentence_first_seen (rev 123456789→123456790)
  Section: Symptome
  • COVID-19 kann zu Symptomen wie Fieber, Husten und Atemnot führen.
```

## Step 2: Compare across editions

Export both language editions and compare:

```bash
refract analyze "COVID-19" \
  --api https://en.wikipedia.org/w/api.php \
  --depth detailed -c > covid-en.jsonl

refract analyze "COVID-19" \
  --api https://de.wikipedia.org/w/api.php \
  --depth detailed -c > covid-de.jsonl
```

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
  --depth detailed
```

`refract diff` compares the same topic across wikis and surfaces statistical outliers
via z-score detection.

## Step 3: Track a claim across language editions

```bash
# English
refract claim "COVID-19" --text "originated in Wuhan" \
  --api https://en.wikipedia.org/w/api.php

# German
refract claim "COVID-19" --text "erstmals in Wuhan" \
  --api https://de.wikipedia.org/w/api.php
```

Compare when each edition first added the claim, whether it was removed, and whether
talk page discussion accompanied the change.

## Step 4: Forensic depth on non-English pages

All depth levels work identically:

```bash
refract analyze "COVID-19" \
  --api https://de.wikipedia.org/w/api.php \
  --depth forensic -c
```

Forensic depth enables talk page correlation, edit cluster detection, and sentence
modification tracking — the same structural analysis, regardless of language.

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

The cache stores revisions per API endpoint, so analyzing the same page on different
wikis doesn't interfere:

```bash
refract analyze "Earth" --api https://en.wikipedia.org/w/api.php -c
refract analyze "Earth" --api https://de.wikipedia.org/w/api.php -c
```

Each wiki's data is stored separately. Use `--cache-dir` to change the cache location.

## Next steps

- [Cross-wiki comparison tutorial](cross-wiki-diff.md) — structured multi-wiki diff
- [Private wiki tutorial](private-wiki.md) — authenticated MediaWiki instances
- [Combat revisionism tutorial](combating-revisionism.md) — reproducible event records
- [Comparison page](../compare.md) — Refract vs other tools
