---
title: "Analytics with DuckDB"
description: "Refract's event output is newline-delimited JSON (NDJSON). DuckDB can query it directly with SQL — no loading step, no schema definition, no extensions…"
---

Refract's event output is newline-delimited JSON (NDJSON). [DuckDB](https://duckdb.org)
can query it directly with SQL — no loading step, no schema definition, no extensions
needed.

**Quick start**: Refract ships a [`refract-analytics.sql`](https://github.com/refract-org/refract/blob/main/examples/refract-analytics.sql) file with pre-built views.
Load it and query immediately:

```bash
duckdb -c ".read examples/refract-analytics.sql" -c "SELECT * FROM contested_claims;"
```

Views included: `contested_claims`, `citation_churn_by_month`, `section_activity`,
`event_type_distribution`, `talk_content_ratio`.

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

Contested sections have both reverts and edit clusters:

```sql
SELECT section,
       count(*) FILTER (WHERE "eventType" = 'revert_detected') as reverts,
       count(*) FILTER (WHERE "eventType" = 'edit_cluster_detected') as clusters,
       count(*) FILTER (WHERE "eventType" LIKE 'sentence_%') as sentence_events,
       count(*) as total_events
FROM 'bitcoin-events.jsonl'
GROUP BY section
HAVING reverts > 0 OR clusters > 0
ORDER BY (reverts + clusters) DESC;
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
       count(*) OVER (PARTITION BY section ORDER BY to_revision_id)
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

# Batch analyze
refract analyze --pages-file pages.txt --depth detailed -c

# Export all
refract export "Bitcoin" --format ndjson > events.jsonl
refract export "Ethereum" --format ndjson >> events.jsonl
refract export "Dogecoin" --format ndjson >> events.jsonl
```

Then compare across pages:

```sql
SELECT page_title,
       count(*) as events,
       count(*) FILTER (WHERE "eventType" = 'revert_detected') as reverts,
       count(*) FILTER (WHERE "eventType" LIKE 'citation_%') as citation_churn
FROM 'events.jsonl'
GROUP BY page_title
ORDER BY events DESC;
```

## Validation

```bash
# Count events — should match refract analyze output
duckdb -c "SELECT count(*) FROM 'events.jsonl'"

# Verify event types are valid
duckdb -c "SELECT DISTINCT \"eventType\" FROM 'events.jsonl' ORDER BY \"eventType\""

# Check for empty sections
duckdb -c "SELECT count(*) FROM 'events.jsonl' WHERE section = ''"
```

All queries run on DuckDB 1.0+ with no extensions. Refract NDJSON follows the standard
format that DuckDB's JSON scanner reads out of the box.
