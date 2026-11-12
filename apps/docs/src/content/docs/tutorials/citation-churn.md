---
title: "Tutorial: Monitor citation churn on a contested page"
description: "Track citation additions, removals, and replacements on a Wikipedia page to detect sourcing instability — which sources appear, which disappear, and when…"
---

## Goal

Track citation additions, removals, and replacements on a Wikipedia page to detect
sourcing instability — which sources appear, which disappear, and when turnover
is highest.

## Why citation churn matters

Citation churn reveals source instability. When citations appear in one edit and
disappear in the next, sources are contested. When a journal article is replaced
with a news article, the evidence base is shifting. When churn concentrates in a
short period, a content dispute may be underway.

Refract reports each citation change as an event; reading the pattern is up to you.

## Steps

### 1. Analyze a revision range

```bash
refract analyze "COVID-19" --from 1367379656 --to 1384269315 --json
```

The range is 20 revisions from 2026. Citation events appear at every `--depth`;
`detailed`, the default, includes the reference text in `before` and `after`. Without
`--from` and `--to` the command reads the page's whole history, which for this page is
many thousands of revisions.

### 2. Filter to citation events

```bash
refract export "COVID-19" --from 1367379656 --to 1384269315 --format ndjson | grep '"citation_' > citations.jsonl
```

This gives you a file with only `citation_added`, `citation_removed`, and
`citation_replaced` events: 18 for this range.

### 3. Parse with a script

```python
import json

additions = 0
removals = 0
replacements = 0
days = {}

with open("citations.jsonl") as f:
    for line in f:
        event = json.loads(line)
        etype = event["eventType"]
        day = event["timestamp"][:10]
        if etype == "citation_added":
            additions += 1
        elif etype == "citation_removed":
            removals += 1
        elif etype == "citation_replaced":
            replacements += 1
        days[day] = days.get(day, 0) + 1

print(f"Additions: {additions}")
print(f"Removals: {removals}")
print(f"Replacements: {replacements}")
print(f"\nChurn by day:")
for day, count in sorted(days.items(), key=lambda x: -x[1])[:5]:
    print(f"  {day}: {count} events")
```

A citation event's `section` is the section that holds the reference: its title,
`(lead)` for the introduction, or `body` when no section's text contains it. Group the
events by section, day, revision or source domain (step 5).

### 4. Query with DuckDB

```bash
refract export "COVID-19" --from 1367379656 --to 1384269315 --format ndjson > covid-events.jsonl
```

```sql
SELECT "toRevisionId",
       count(*) FILTER (WHERE "eventType" = 'citation_added') as added,
       count(*) FILTER (WHERE "eventType" = 'citation_removed') as removed,
       count(*) FILTER (WHERE "eventType" = 'citation_replaced') as replaced
FROM 'covid-events.jsonl'
WHERE "eventType" LIKE 'citation_%'
GROUP BY "toRevisionId"
ORDER BY (added + removed + replaced) DESC
LIMIT 5;
```

### 5. Track a specific source domain

After export, filter by source domain to see which types of sources churn most
(official sources vs. news media vs. academic journals vs. primary sources):

```bash
grep -o 'https\?://[^"]*' covid-events.jsonl | cut -d'/' -f3 | sort | uniq -c | sort -rn | head -10
```

## Reading the patterns

| Pattern | What it means |
|---------|---------------|
| Citation added, never removed | Stable, uncontested source |
| Citation added, removed in next edit | Contested — likely debated on talk page |
| Citation replaced (journal → news) | Evidence base shifting in real time |
| High churn in a few revisions close together | Possible editorial dispute over sourcing |
| High churn spread across the range | Page undergoing major revision or cleanup |

## Example: a citation added, then replaced

The values below are illustrative; the fields are the ones `refract export` writes,
with the enrichment fields (`editMagnitude`, `keyTerms` and others) left out.

```json
{
  "eventType": "citation_added",
  "fromRevisionId": 1280090010,
  "toRevisionId": 1280090100,
  "section": "Vaccines",
  "before": "",
  "after": "<ref>{{cite journal |last1=Smith |title=Efficacy of mRNA vaccines...}}</ref>",
  "deterministicFacts": [
    { "fact": "citation_changed", "detail": "type=added" }
  ],
  "layer": "observed",
  "timestamp": "2024-11-20T10:00:00Z",
  "schemaVersion": "0.5.0",
  "eventId": "d1e3f5a7b9c2048a"
}
```

Twenty-four hours later:

```json
{
  "eventType": "citation_replaced",
  "fromRevisionId": 1280090100,
  "toRevisionId": 1280090200,
  "section": "Vaccines",
  "before": "<ref>{{cite journal |last1=Smith...}}</ref>",
  "after": "<ref>{{cite web |title=CDC Vaccine Report...}}</ref>",
  "deterministicFacts": [
    { "fact": "citation_changed", "detail": "type=replaced" }
  ],
  "layer": "observed",
  "timestamp": "2024-11-21T14:30:00Z",
  "schemaVersion": "0.5.0",
  "eventId": "2b4d6f8a0c1e3059"
}
```

The journal article was swapped for a government web report in under 24 hours.
`before` and `after` hold the two references; classifying them as journal or web is
left to your own parsing of the citation template.

## Troubleshooting

- **No citation events?** The page may use minimal citations. Try a page with
  active sourcing (medical, scientific, or controversial topics work best).
- **DuckDB version**: DuckDB 1.0+ required for the `FILTER` clause. For older
  versions, use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.

## Next steps

- [Build a dispute timeline](dispute-timeline.md)
- [Analyze with DuckDB](../analytics.md)
