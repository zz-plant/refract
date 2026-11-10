---
title: "Tutorial: Build a dispute timeline"
description: "Combine article revision history with talk page activity to build a timeline of an editorial dispute — when it started, how intense it was, whether it was…"
---

## Goal

Combine article revision history with talk page activity to build a timeline of
an editorial dispute — when it started, how intense it was, whether it was resolved,
and how talk page discussion correlated with content changes.

## What makes a dispute visible in the data

Refract detects three mechanical signals that, together, form a dispute signature:

1. **Reverts** — edits undone by another editor (`revert_detected`)
2. **Edit clusters** — 3+ edits in a tight time window (`edit_cluster_detected`)
3. **Talk page activity** — correlated discussion threads, reply chains, and activity
   spikes (`talk_page_correlated`, `talk_activity_spike`)

A section with revert clusters, no talk page activity, and rapid edit turnover is
likely edit-warring. A section with revert clusters, long talk threads, and slower
turnover is active deliberation. Refract distinguishes these patterns mechanically.

## Steps

### 1. Analyze the article at forensic depth

```bash
refract analyze "Global_warming" --depth forensic -c
```

Forensic depth enables edit cluster detection, talk page correlation, and sentence
modification tracking — all necessary for dispute detection.

### 2. Analyze the talk page

```bash
refract analyze "Talk:Global_warming" --depth detailed -c
```

Talk pages are fetched by prefixing the page title with `Talk:`. Refract detects
thread openings, replies, archival, and activity spikes from talk page revisions.

### 3. Visualize the combined timeline

```bash
refract visualize "Global_warming" --format mermaid --all
```

Shows all event types (not just claim events) as a timeline diagram. Reverts and
edit clusters will stand out visually.

### 4. Export for quantitative analysis

```bash
refract export "Global_warming" --format ndjson > events.jsonl
refract export "Talk:Global_warming" --format ndjson > talk-events.jsonl
```

### 5. Correlate reverts with talk page activity

```python
import json
from collections import defaultdict

# Load article reverts
article_reverts = []
with open("events.jsonl") as f:
    for line in f:
        event = json.loads(line)
        if event["eventType"] in ("revert_detected", "edit_cluster_detected"):
            article_reverts.append(event)

# Load talk activity
talk_days = defaultdict(int)
with open("talk-events.jsonl") as f:
    for line in f:
        event = json.loads(line)
        day = event["timestamp"][:10]
        talk_days[day] += 1

# Correlate: reverts per day vs talk activity per day
revert_days = defaultdict(int)
for event in article_reverts:
    day = event["timestamp"][:10]
    revert_days[day] += 1

# Days with high reverts but low talk → potential edit-warring
# Days with high reverts and high talk → active deliberation
for day in sorted(set(revert_days) | set(talk_days)):
    reverts = revert_days.get(day, 0)
    talk = talk_days.get(day, 0)
    if reverts > 0 or talk > 0:
        signal = "edit-warring?" if reverts > 2 and talk < 3 else \
                 "deliberation" if reverts > 0 and talk >= 3 else \
                 "discussion" if talk > 0 else ""
        print(f"{day}: {reverts} reverts, {talk} talk events → {signal}")
```

## Reading the patterns

```json
{
  "eventId": "3c5e7f9a1b2d4068",
  "eventType": "revert_detected",
  "fromRevisionId": 1280100100,
  "toRevisionId": 1280100200,
  "section": "Scientific consensus",
  "before": "The scientific consensus is settled",
  "after": "The scientific consensus is disputed",
  "timestamp": "2024-11-18T09:00:00Z",
  "layer": "observed",
  "deterministicFacts": [
    {
      "fact": "Edit reverted in section Scientific consensus",
      "detail": "Content replaced with previous version",
      "provenance": {
        "analyzer": "revert-detector",
        "version": "0.5.1",
        "inputHashes": []
      }
    }
  ]
}
```

Thirty minutes later, the same change was reverted back:

```json
{
  "eventId": "4d6f8a0b2c3e5179",
  "eventType": "revert_detected",
  "fromRevisionId": 1280100200,
  "toRevisionId": 1280100300,
  "section": "Scientific consensus",
  "before": "The scientific consensus is disputed",
  "after": "The scientific consensus is settled",
  "timestamp": "2024-11-18T09:30:00Z",
  "layer": "observed",
  "deterministicFacts": [
    {
      "fact": "Edit reverted in section Scientific consensus",
      "detail": "Content replaced with previous version",
      "provenance": {
        "analyzer": "revert-detector",
        "version": "0.5.1",
        "inputHashes": []
      }
    }
  ]
}
```

Two reverts in 30 minutes on the same sentence — `"settled"` → `"disputed"` →
`"settled"` — with the `before`/`after` fields showing the exact text that ping-ponged.

A correlated `talk_activity_spike` on the same day would indicate editors discussing
the change on the talk page while reverting on the article. A day with reverts but
no talk activity suggests edit-warring without discussion.

| Signal combination | Interpretation |
|--------------------|----------------|
| Revert cluster + no talk activity | Edit-warring |
| Revert cluster + talk thread opened | Dispute acknowledged and being discussed |
| Revert + talk reply chain | Active deliberation |
| Talk activity spike + no reverts | Pre-revert discussion (editors talking before acting) |
| `edit_cluster_detected` with 5+ editors | Coordinated editing or page under heavy revision |

## Troubleshooting

- **No talk page events?** Not all pages have active talk pages. Try pages with
  known controversies (climate change, political topics, technology disputes).
- **Talk: prefix not working?** Some wikis use different namespaces. Try
  `Discussion:` or check the wiki's namespace configuration. The `Talk:` prefix
  works for English Wikipedia and most Fandom wikis.

## Next steps

- [Monitor citation churn](citation-churn.md)
- [Export for analytics](../analytics.md)
- [Work with notebooks](../notebooks.md)
