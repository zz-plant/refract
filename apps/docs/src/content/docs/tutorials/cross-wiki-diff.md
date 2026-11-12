---
title: "Tutorial: Cross-wiki comparison with refract diff"
description: "Compare how the same topic is covered across two or more MediaWiki instances — different language Wikipedias, competing Fandom wikis, or independent vs.…"
---

## Goal

Compare how the same topic is covered across two or more MediaWiki instances — different
language Wikipedias, competing Fandom wikis, or independent vs. official wikis — and
detect where they diverge.

## Why cross-wiki comparison matters

The same topic framed differently across wikis reveals editorial perspective, regional
bias in sourcing, canon disputes in fictional universes, and institutional differences
in how knowledge is maintained. Refract can detect these divergences mechanically.

## Steps

### 1. Compare two Wikipedia language editions

```bash
refract diff "Douglas_Adams" \
  --wiki-a https://en.wikipedia.org/w/api.php \
  --wiki-b https://de.wikipedia.org/w/api.php \
  --depth brief
```

Refract fetches both pages, runs the full deterministic pipeline on each, and prints
side-by-side counts of sections, citations, templates, reverts, categories, wikilinks,
and event types.

At `brief`, the latest 20 revisions of each wiki are compared. `detailed` (the default)
and `forensic` read each wiki's whole history; `diff` has no `--from` or `--to`.

### 2. Compare competing Fandom wikis

```bash
refract diff "Darth_Vader" \
  --wiki-a https://lego.fandom.com/api.php \
  --wiki-b https://battlefront.fandom.com/api.php \
  --depth brief
```

The title must be a page on every wiki. Redirects are not followed: on
`starwars.fandom.com`, "Darth_Vader" redirects to "Anakin Skywalker", and `diff` would
compare the redirect page's own history.

### 3. Compare three wikis at once

```bash
refract diff "Bitcoin" \
  --wiki-a https://en.wikipedia.org/w/api.php \
  --wiki-b https://de.wikipedia.org/w/api.php \
  --wiki-c https://fr.wikipedia.org/w/api.php \
  --depth brief
```

Up to six wikis can be compared (`--wiki-a` to `--wiki-f`). A wiki that has no page
under the title shows zeros in its column; the command does not fail.

### 4. Measure shared text

```bash
refract diff "Bitcoin" \
  --wiki-a https://en.wikipedia.org/w/api.php \
  --wiki-b https://simple.wikipedia.org/w/api.php \
  --depth brief \
  --detect-borrowing
```

`--detect-borrowing` compares the latest
wikitext of each pair of wikis using five-token shingles, and reports Jaccard similarity,
shared tokens, and contiguous shared spans of at least eight tokens. A pair is flagged
`[SIGNIFICANT BORROWING]` at 15% similarity or at 16 shared tokens. That second bar is low:
citation templates and markup can reach it. The flag reports the rule, and shared text does
not establish which wiki copied which, or whether either did.

## Reading the output

`refract diff` prints a summary for people; it has no JSON mode. An excerpt from a live run
on 2026-11-04, whose counts will differ from yours:

```text
  Wiki A: https://en.wikipedia.org/w/api.php (HHI: 0.036)
  Wiki B: https://simple.wikipedia.org/w/api.php (HHI: 0.056)

── Overview ──
  Total events      413     54
  Sections           30     10
  Citations         228     17
  Templates          11      4
  Reverts             2      1
  Categories          3      2
  Wikilinks         283     57

── Cross-Wiki Text Propagation & Borrowing ──
  Wikis A ↔ B: 3.6% Jaccard similarity (2784 shared tokens, 190 spans) [SIGNIFICANT BORROWING]
```

HHI is the source concentration of each wiki's citations; `[concentrated]` marks a high
value. An event-type breakdown follows.

An outliers section lists counts whose z-score across the wikis exceeds 2 in absolute
value. It needs at least three wikis, and with the population standard deviation the
largest possible |z| among n wikis is √(n−1): 1.41 for three, 1.73 for four, 2 for five.
In practice nothing is listed below five wikis, and with five only by rounding.

The summary holds counts. To compare individual events, export each wiki and compare the files:

```bash
refract export "Bitcoin" --api https://en.wikipedia.org/w/api.php --from <revId> --to <revId> --format ndjson > a.ndjson
refract export "Bitcoin" --api https://simple.wikipedia.org/w/api.php --from <revId> --to <revId> --format ndjson > b.ndjson
```

Revision IDs are per wiki. Without a range, `export` reads the whole history.

Differences to look for in those events:
- **Event present on one wiki but not the other** → content divergence
- **Same section, different content** → framing divergence
- **Different categories** → classification divergence (canon vs. non-canon, different rating systems)
- **Different citation sources** → evidence base divergence (English-language sources vs. local sources)

## Use cases

These examples show kinds of difference to find in the exported events; `refract diff` itself prints counts.

### Detecting canon divergence (Fandom)

When two Fandom wikis cover the same fictional universe with different canon policies,
the exported events show the moment of divergence:

```
Wiki A: category_removed "Canon characters" at rev 1234
Wiki B: no corresponding event

→ Wiki A reclassified canon. Wiki B didn't. Canon divergence detected.
```

### Detecting framing divergence (Wikipedia)

The same topic across English and German Wikipedia often differs in what's emphasized:

```
Wiki A: citation_added (section "Regulation") — SEC filing from 2023
Wiki B: citation_added (section "Regulierung") — BaFin statement from 2023

→ Each wiki uses locally-relevant primary sources. The evidence base is jurisdiction-specific.
```

### Detecting editorial depth divergence

Simple Wikipedia vs. English Wikipedia shows how a topic is explained at different
complexity levels:

```
Wiki A (English): 340 events, 26 revisions, forensic depth
Wiki B (Simple): 45 events, 8 revisions, detailed depth

→ Simple Wikipedia has fewer events, fewer citations, fewer contested claims.
→ The complexity difference is measurable from the event stream alone.
```

## Troubleshooting

- **One wiki returns no results**: Verify the page title is exact — different wikis
  may use different titles (English "Climate change" is German "Klimawandel"), and a
  missing title yields a column of zeros, not an error. Try the title on each wiki
  first with `refract analyze --depth brief`.
- **Rate limits when hitting 3+ wikis**: `refract diff` does not use the revision
  cache. Use `--depth brief` to keep each wiki to 20 revisions.
- **Custom API endpoints**: Any public MediaWiki instance works. `refract diff` has no
  auth flags; for a private wiki, run `refract export` with `--api-key` on each wiki
  and compare the files.

## Next steps

- [Track Wikipedia changes](wikipedia-history.md)
- [Monitor citation churn](citation-churn.md)
- [Build a dispute timeline](dispute-timeline.md)
