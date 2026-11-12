---
title: "Analytics with DuckDB"
description: "Refract's event output is newline-delimited JSON (NDJSON). DuckDB can query it directly with SQL — no loading step, no schema definition, no extensions…"
---

Refract's event output is newline-delimited JSON (NDJSON). [DuckDB](https://duckdb.org)
can query it directly with SQL — no loading step, no schema definition, no extensions
needed.

**Quick start**: Refract ships a [`refract-analytics.sql`](https://github.com/refract-org/refract/blob/main/examples/refract-analytics.sql) file with pre-built views.
The views read `events.jsonl` in the working directory, so export to that name first:

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > events.jsonl
duckdb -c ".read examples/refract-analytics.sql" -c "SELECT * FROM section_activity;"
```

Views included: `contested_claims`, `citation_churn_by_month`, `section_activity`,
`event_type_distribution`, `talk_content_ratio`.

Events carry no claim identifier. `contested_claims` keys a sentence by its section
and text, and lists the ones that were modified, removed or reintroduced.

## Install DuckDB

```bash
brew install duckdb
```

Or download from [duckdb.org](https://duckdb.org/docs/installation/).

## Export events and query

```bash
# Export events
refract export "Bitcoin" --format ndjson > bitcoin-events.jsonl

# Quick count
duckdb -c "SELECT count(*) FROM 'bitcoin-events.jsonl'"
```

DuckDB's JSON scanner detects column names and types automatically from the first
batch of records. No CREATE TABLE or INSERT step.

Without `--from` and `--to`, `export` reads the page's whole history. Bound the
range, as in the quick start above, for a short run.

Column names are the event's own camelCase keys: `eventType`, `fromRevisionId`,
`toRevisionId`. The queries below quote them so results keep that spelling.

## Event type distribution

```sql
SELECT "eventType", count(*) as cnt
FROM 'events.jsonl'
GROUP BY "eventType"
ORDER BY cnt DESC;
```

Expected output for a typical Wikipedia page at `detailed` depth:

| "eventType" | cnt |
|------------|-----|
| sentence_modified | 85 |
| citation_added | 34 |
| sentence_first_seen | 28 |
| revert_detected | 15 |
| template_added | 12 |
| ... | ... |

## Citation churn over time

```sql
SELECT strftime(timestamp, '%Y-%m') as month,
       count(*) FILTER (WHERE "eventType" = 'citation_added') as added,
       count(*) FILTER (WHERE "eventType" = 'citation_removed') as removed,
       count(*) FILTER (WHERE "eventType" = 'citation_replaced') as replaced
FROM 'bitcoin-events.jsonl'
WHERE "eventType" LIKE 'citation_%'
GROUP BY month
ORDER BY month;
```

Months with more removals than additions indicate net citation loss — the page
is losing sources. Months with high replacement counts indicate active source
updating, not necessarily instability.

## Find the most contested sections

`revert_detected` and `edit_cluster_detected` describe a whole revision, so their
`section` is the empty string. This query lists that row beside the sections' own
counts:

```sql
SELECT section,
       count(*) FILTER (WHERE "eventType" = 'revert_detected') as reverts,
       count(*) FILTER (WHERE "eventType" = 'edit_cluster_detected') as clusters,
       count(*) FILTER (WHERE "eventType" LIKE 'sentence_%') as sentence_events,
       count(*) as total_events
FROM 'bitcoin-events.jsonl'
GROUP BY section
ORDER BY total_events DESC;
```

## Track a specific claim's lifecycle

```sql
SELECT "eventType", timestamp, section,
       before, after
FROM 'bitcoin-events.jsonl'
WHERE after LIKE '%decentralized%'
   OR before LIKE '%decentralized%'
ORDER BY timestamp;
```

## Section-level timeline

```sql
SELECT section, timestamp, "eventType",
       count(*) OVER (PARTITION BY section ORDER BY "toRevisionId")
         as cumulative_events
FROM 'bitcoin-events.jsonl'
ORDER BY section, timestamp;
```

## Talk page correlation

Pages with active talk page discussions alongside content changes suggest editorial
deliberation rather than edit-warring:

```sql
SELECT strftime(timestamp, '%Y-%m-%d') as day,
       count(*) FILTER (WHERE "eventType" LIKE 'talk_%') as talk_events,
       count(*) FILTER (WHERE "eventType" = 'revert_detected') as reverts
FROM 'bitcoin-events.jsonl'
GROUP BY day
HAVING talk_events > 0 OR reverts > 0
ORDER BY day;
```

## Multiple pages at once

```bash
# Create a pages file
echo "Bitcoin" > pages.txt
echo "Ethereum" >> pages.txt
echo "Dogecoin" >> pages.txt

# Export each page to its own file
mkdir -p pages
while read page; do
  refract export "$page" --format ndjson > "pages/$page.jsonl"
done < pages.txt
```

An event does not name its page, so keep one file per page and let DuckDB add the
file name as a column:

```sql
SELECT regexp_extract(filename, '([^/]+)\.jsonl$', 1) as page,
       count(*) as events,
       count(*) FILTER (WHERE "eventType" = 'revert_detected') as reverts,
       count(*) FILTER (WHERE "eventType" LIKE 'citation_%') as citation_churn
FROM read_json_auto('pages/*.jsonl', filename = true, union_by_name = true)
GROUP BY page
ORDER BY events DESC;
```

## Validation

```bash
# Count events — one per line of the export
duckdb -c "SELECT count(*) FROM 'events.jsonl'"

# Verify event types are valid
duckdb -c "SELECT DISTINCT \"eventType\" FROM 'events.jsonl' ORDER BY \"eventType\""

# Count events with no section (reverts, edit clusters, talk correlations)
duckdb -c "SELECT count(*) FROM 'events.jsonl' WHERE section = ''"
```

All queries run on DuckDB 1.0+ with no extensions. Refract NDJSON follows the standard
format that DuckDB's JSON scanner reads out of the box.
