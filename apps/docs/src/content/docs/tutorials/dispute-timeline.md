---
title: "Tutorial: Build a dispute timeline"
description: "Combine article revision history with talk page activity to build a timeline of an editorial dispute — when it started, how intense it was, whether it was…"
---

## Goal

Combine article revision history with talk page activity to build a timeline of
an editorial dispute — when it started, how intense it was, whether it was resolved,
and how talk page discussion correlated with content changes.

## What makes a dispute visible in the data

Three mechanical signals, together, form a dispute signature:

1. **Reverts** — edits undone by another editor (`revert_detected`)
2. **Edit clusters** — 3+ edits in a tight time window (`edit_cluster_detected`)
3. **Talk page activity** — talk edits near an article edit (`talk_page_correlated`),
   threads, replies and activity spikes (`talk_thread_opened`, `talk_reply_added`,
   `talk_activity_spike`)

`refract analyze` and `refract export` emit all of these. The talk events come from
the ten talk-page edits that precede the last analyzed revision.

Reverts with no talk page activity and rapid edit turnover suggest edit-warring.
Reverts alongside talk edits and slower turnover suggest deliberation. The events give
the counts; the reading is yours.

## Steps

### 1. Analyze a range of the article

```bash
refract analyze "Climate_change" --from 1374299339 --to 1383409984 --json
```

The range is 20 revisions from 2026. Reverts, sentence modifications and talk
correlation are reported at every `--depth`. Without `--from` and `--to` the command
reads the whole history.

Use the article's own title. "Global_warming" is a redirect to "Climate change" on
English Wikipedia, and Refract analyzes the redirect page's history, not its target's.

### 2. Analyze the talk page

```bash
refract analyze "Talk:Climate_change" --since 2026-08-01 --json
```

Talk pages are fetched by prefixing the page title with `Talk:`. The CLI treats a talk
page as an ordinary page: it reports section and sentence changes per talk revision,
not threads or replies.

### 3. Browse the timeline

```bash
refract explore "Climate_change" --from 1374299339 --to 1383409984
```

Opens the local explorer on the same range, with every event type on a timeline.

`refract visualize "<page>" --format mermaid --all` prints a Mermaid diagram of a
page's events. It has no range flags and reads the whole history, so keep it for
pages with short histories.

### 4. Export for quantitative analysis

```bash
refract export "Climate_change" --from 1374299339 --to 1383409984 --format ndjson > events.jsonl
refract export "Talk:Climate_change" --since 2026-08-01 --format ndjson > talk-events.jsonl
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
        if event["eventType"] == "revert_detected":
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

A `revert_detected` event is raised from the edit summary. The values below are
illustrative; the shape is what `refract export` writes, with the enrichment fields
left out:

```json
{
  "eventType": "revert_detected",
  "fromRevisionId": 1280100100,
  "toRevisionId": 1280100200,
  "section": "",
  "before": "",
  "after": "Undid revision 1280100100: please propose this change on the talk page",
  "deterministicFacts": [
    { "fact": "revert_detected", "detail": "Undid revision 1280100100: please propose this change on the talk page" },
    { "fact": "policy_signal", "detail": "dimension=edit_warring signal=revert_detected" }
  ],
  "layer": "policy_coded",
  "timestamp": "2024-11-18T09:00:00Z",
  "schemaVersion": "0.5.0",
  "eventId": "3c5e7f9a1b2d4068"
}
```

`section` and `before` are empty, and `after` is the edit summary. The text that was
undone is in the `sentence_removed`, `sentence_modified` and `sentence_reintroduced`
events with the same `fromRevisionId` and `toRevisionId`.

A second `revert_detected` thirty minutes later on the following revision pair is the
back-and-forth pattern. `talk_page_correlated` events on the same revisions show that
talk edits were made nearby in time; a day with reverts and none suggests edit-warring
without discussion.

| Signal combination | Interpretation |
|--------------------|----------------|
| Several reverts + no talk activity | Edit-warring |
| Several reverts + talk edits the same day | Dispute acknowledged and being discussed |
| Talk edits + no reverts | Discussion before acting |
| Many revisions within an hour | Coordinated editing or page under heavy revision |

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
