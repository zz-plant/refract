---
title: "Complete workflow: From nothing to insight"
description: "This page ties together every part of Refract into a single end-to-end workflow. Follow along to go from zero install to a data-backed conclusion about how…"
---

This page ties together every part of Refract into a single end-to-end workflow.
Follow along to go from zero install to a data-backed conclusion about how a Wikipedia
page has changed.

## What we're doing

We'll analyze the Bitcoin Wikipedia page, track a specific claim across its revision
history, export the data, query it with DuckDB, and draw a conclusion about claim
stability — all using deterministic, byte-reproducible output.

## Step 1: Zero-install analysis

```bash
npx @refract-org/cli analyze "Bitcoin" --depth forensic
```

This fetches 20 recent revisions and runs all 26 deterministic analyzers, including wikilink and category diffing, talk page correlation, and edit cluster detection.
Output is one JSON event per line — the full event stream:

```
Analysis of "Bitcoin" at depth detailed found 330 events across 20 revisions.

[2009-03-08T16:41:44Z] wikilink_added (rev 275832581→275832690)
  Section: body
  • target: cryptography

[2009-12-10T14:15:09Z] citation_added (rev 308164432→308164529)
  Section: (lead)
  • ref: href=http://sourceforge.net/projects/bitcoin/

...
```

Every event has a type, a revision range, a section, before/after snapshots, and
deterministic facts explaining why it was produced.

## Step 2: Track a specific claim

Now let's trace a specific claim through the page's history:

```bash
refract claim "Bitcoin" --text "decentralized" -c
```

Refract finds every revision where the word "decentralized" appears in the page text,
tracks when it was first added, modified, or removed, and prints a claim lifecycle:

```
Claim: "decentralized" on Bitcoin
  • first_seen: 2009-01-03 (rev 275832581)
  • revisions present: 18 of 20
  • modifications: 2 (spelling correction, phrasing change)
  • removed: never
  • status: STABLE
```

This claim is stable — it appeared early, persisted through most revisions, and was
never removed. Contrast with a contested claim:

```
Claim: "completely anonymous" on Bitcoin
  • first_seen: 2010-04-15 (rev 308200000)
  • revisions present: 3 of 20
  • removed: 2010-05-01 (rev 308350000)
  • reintroduced: never
  • status: REMOVED
```

![Claim lifecycle](claim-lifecycle.svg)

## Step 3: Export for analysis

```bash
refract export "Bitcoin" --format ndjson > bitcoin-events.jsonl
```

Now we have a portable, queryable file of the complete event stream.

## Step 4: Query with DuckDB

```bash
duckdb -c "
SELECT "eventType", count(*) as cnt
FROM 'bitcoin-events.jsonl'
GROUP BY "eventType"
ORDER BY cnt DESC;
"
```

Output:

| event_type | cnt |
|------------|-----|
| sentence_modified | 85 |
| citation_added | 34 |
| sentence_first_seen | 28 |
| revert_detected | 15 |
| template_added | 12 |
| citation_removed | 8 |

The page has more `citation_added` (34) than `citation_removed` (8) — net source
accumulation, the page is becoming better-sourced over time.

Find the most contested section:

```sql
SELECT section,
       count(*) FILTER (WHERE "eventType" = 'revert_detected') as reverts,
       count(*) FILTER (WHERE "eventType" = 'edit_cluster_detected') as clusters
FROM 'bitcoin-events.jsonl'
GROUP BY section
HAVING reverts > 0 OR clusters > 0
ORDER BY reverts DESC;
```

| section | reverts | clusters |
|---------|---------|----------|
| Regulation | 6 | 2 |
| Scalability debate | 4 | 1 |
| History | 3 | 0 |

The "Regulation" section has the most reverts (6) and edit clusters (2) — this is the
most actively contested part of the page.

## Step 5: Correlate with talk page activity

Run the talk page analysis:

```bash
refract analyze "Talk:Bitcoin" --depth detailed
```

Compare revert days with talk activity days. Days with high reverts and no talk
activity suggest edit-warring. Days with reverts and active discussion suggest
genuine editorial deliberation:

```
2025-01-15: 2 reverts, 5 talk replies → deliberation
2025-02-03: 4 reverts, 0 talk replies → edit-warring
```

## The complete picture

After these 5 steps you know:

1. **What changed** on the Bitcoin page (330 deterministic events across 20 revisions)
2. **Which claims are stable** ("decentralized" — present in 18 of 20 revisions, never removed)
3. **Which claims were contested** ("completely anonymous" — added, then removed permanently)
4. **Which sections are most disputed** (Regulation: 6 reverts, 2 edit clusters)
5. **Whether disputes were discussed** (talk page correlation shows deliberation vs. edit-warring)
6. **How sourcing evolved** (net source accumulation — page is improving)

All of this is deterministic — run the same commands a year from now on the same
revision range and you get identical output.

## What to do next

- **Automate monitoring**: Set up `refract cron` to re-observe daily ([cron guide](cron.md))
- **Compare across wikis**: Run `refract diff` on Bitcoin across English and Simple
  Wikipedia ([cross-wiki tutorial](tutorials/cross-wiki-diff.md))
- **Build a dashboard**: Load events into DuckDB and connect to Grafana or
  Observable ([analytics guide](analytics.md))
- **Integrate with RAG**: Use claim stability signals to filter retrieval results
  ([downstream guide](downstream.md))
- **Verify accuracy**: Run `refract eval` to benchmark analyzer precision
  ([eval guide](eval.md))

## The same workflow for any page

This workflow works identically on any MediaWiki page — Wikipedia, Fandom, or a
private wiki:

```bash
refract analyze "Darth_Vader" --api https://starwars.fandom.com/api.php --depth detailed
refract claim "Darth_Vader" --text "midichlorians" --api https://starwars.fandom.com/api.php
refract export "Darth_Vader" --api https://starwars.fandom.com/api.php --format ndjson > vader.jsonl
```

The commands are the same. The output format is the same. The deterministic guarantee
is the same. Only the API endpoint changes.
