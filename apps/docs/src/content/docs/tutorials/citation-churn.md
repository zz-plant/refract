---
title: "Tutorial: Monitor citation churn on a contested page"
description: "Track citation additions, removals, and replacements on a Wikipedia page to detect sourcing instability — which sources appear, which disappear, and which…"
---

## Goal

Track citation additions, removals, and replacements on a Wikipedia page to detect
sourcing instability — which sources appear, which disappear, and which sections
have the highest turnover.

## Why citation churn matters

Citation churn reveals source instability. When citations appear in one edit and
disappear in the next, sources are contested. When a journal article is replaced
with a news article, the evidence base is shifting. When churn concentrates on one
section, a content dispute is likely underway.

Refract detects all three patterns mechanically.

## Steps

### 1. Analyze a page at forensic depth

```bash
refract analyze "COVID-19" --depth forensic -c
```

Forensic depth enables all event types including citation replacement tracking.

### 2. Filter to citation events

```bash
refract export "COVID-19" --format ndjson | grep '"citation_' > citations.jsonl
```

This gives you a file with only `citation_added`, `citation_removed`, and
`citation_replaced` events.

### 3. Parse with a script

```python
import json

additions = 0
removals = 0
replacements = 0
sections = {}

with open("citations.jsonl") as f:
    for line in f:
        event = json.loads(line)
        etype = event["eventType"]
        section = event["section"]
        if etype == "citation_added":
            additions += 1
        elif etype == "citation_removed":
            removals += 1
        elif etype == "citation_replaced":
            replacements += 1
        sections[section] = sections.get(section, 0) + 1

print(f"Additions: {additions}")
print(f"Removals: {removals}")
print(f"Replacements: {replacements}")
print(f"\nChurn by section:")
for sec, count in sorted(sections.items(), key=lambda x: -x[1])[:5]:
    print(f"  {sec}: {count} events")
```

### 4. Query with DuckDB

```bash
refract export "COVID-19" --format ndjson > covid-events.jsonl
```

```sql
SELECT section,
       count(*) FILTER (WHERE "eventType" = 'citation_added') as added,
       count(*) FILTER (WHERE "eventType" = 'citation_removed') as removed,
       count(*) FILTER (WHERE "eventType" = 'citation_replaced') as replaced
FROM 'covid-events.jsonl'
WHERE "eventType" LIKE 'citation_%'
GROUP BY section
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
| High churn in one section | Active editorial dispute in that section |
| High churn across all sections | Page undergoing major revision or cleanup |

## Example: vaccine efficacy section

```json
{
  "eventId": "d1e3f5a7b9c2048a",
  "eventType": "citation_added",
  "fromRevisionId": 1280090010,
  "toRevisionId": 1280090100,
  "section": "Vaccine efficacy",
  "before": "",
  "after": "<ref>{{cite journal |last1=Smith |title=Efficacy of mRNA vaccines...}}</ref>",
  "timestamp": "2024-11-20T10:00:00Z",
  "layer": "observed",
  "deterministicFacts": [
    {
      "fact": "Citation added in section Vaccine efficacy",
      "provenance": {
        "analyzer": "citation-tracker",
        "version": "0.5.1",
        "inputHashes": []
      }
    }
  ]
}
```

Twenty-four hours later:

```json
{
  "eventId": "2b4d6f8a0c1e3059",
  "eventType": "citation_replaced",
  "fromRevisionId": 1280090100,
  "toRevisionId": 1280090200,
  "section": "Vaccine efficacy",
  "before": "<ref>{{cite journal |last1=Smith...}}</ref>",
  "after": "<ref>{{cite web |title=CDC Vaccine Report...}}</ref>",
  "timestamp": "2024-11-21T14:30:00Z",
  "layer": "observed",
  "deterministicFacts": [
    {
      "fact": "Citation replaced: journal article → web report",
      "provenance": {
        "analyzer": "citation-tracker",
        "version": "0.5.1",
        "inputHashes": []
      }
    }
  ]
}
```

The journal article was swapped for a government web report — the evidence base
shifted in under 24 hours. This pattern is what Refract is built to detect at scale.

## Troubleshooting

- **No citation events?** The page may use minimal citations. Try a page with
  active sourcing (medical, scientific, or controversial topics work best).
- **DuckDB version**: DuckDB 1.0+ required for the `FILTER` clause. For older
  versions, use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`.

## Next steps

- [Build a dispute timeline](dispute-timeline.md)
- [Analyze with DuckDB](../analytics.md)
