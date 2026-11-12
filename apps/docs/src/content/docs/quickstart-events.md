---
title: "Quickstart: common events"
description: "New to Refract? These are the 5 event types you'll see most often, what they mean, and how to query them. After 5 minutes, move on to the full event…"
---

New to Refract? These are the 5 event types you'll see most often, what they mean,
and how to query them. After 5 minutes, move on to the [full event taxonomy](events.md).

## The 5 most common events

### `sentence_first_seen` / `sentence_removed`

Content lifecycle. A sentence appeared or disappeared.

```bash
refract export "Pluto" --from 71593043 --to 71601937 --format ndjson > events.jsonl
```

That range is 43 revisions from the day Pluto was reclassified. The queries on this page read the file with DuckDB. Event fields are camelCase (`eventType`, `fromRevisionId`).

```sql
SELECT timestamp, section, after
FROM 'events.jsonl'
WHERE eventType = 'sentence_first_seen'
ORDER BY timestamp;
```

### `citation_added` / `citation_removed` / `citation_replaced`

Source changes. Added, removed, or swapped. `citation_replaced` means the claim
text stayed but the supporting source changed — the strongest revisionism signal.

```sql
SELECT timestamp, eventType, before, after
FROM 'events.jsonl'
WHERE eventType LIKE 'citation_%'
ORDER BY timestamp;
```

### `revert_detected`

An edit was undone. Refract checks edit comments against revert patterns. Multiple
reverts on the same section signal edit-warring.

```sql
SELECT timestamp, section
FROM 'events.jsonl'
WHERE eventType = 'revert_detected'
ORDER BY timestamp;
```

### `template_added` / `template_removed`

Policy templates. `NPOV`, `citation needed`, `dispute` — these are editorial signals
that someone flagged the content as problematic.

```sql
SELECT timestamp, eventType, after
FROM 'events.jsonl'
WHERE eventType LIKE 'template_%'
ORDER BY timestamp;
```

### `section_reorganized`

Section structure changed — sections were added, removed, or reordered. Often
accompanies major content rewrites.

```sql
SELECT timestamp, section
FROM 'events.jsonl'
WHERE eventType = 'section_reorganized'
ORDER BY timestamp;
```

## Your first 3 queries

```bash
refract analyze "Pluto" --from 71593043 --to 71601937 --depth detailed --json > pluto.jsonl
```

```sql
duckdb -c "
SELECT eventType, count(*) as n
FROM 'pluto.jsonl'
GROUP BY eventType
ORDER BY n DESC;
"

duckdb -c "
SELECT section, count(*) as n
FROM 'pluto.jsonl'
WHERE eventType LIKE 'citation_%'
GROUP BY section
ORDER BY n DESC
LIMIT 5;
"

duckdb -c "
SELECT timestamp, after
FROM 'pluto.jsonl'
WHERE eventType = 'sentence_first_seen'
ORDER BY timestamp
LIMIT 10;
"
```

## Next

- [Full event taxonomy](events.md) — all 26 event types
- [Analytics with DuckDB](analytics.md) — pre-built SQL views
- [Wikipedia history tutorial](tutorials/wikipedia-history.md) — first full walkthrough
