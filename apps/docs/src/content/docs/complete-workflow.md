---
title: "Complete workflow: From nothing to insight"
description: "This page ties together the parts of Refract into a single end-to-end workflow. Follow along to go from zero install to a data-backed reading of how a…"
---

This page ties together the parts of Refract into a single end-to-end workflow.
Follow along to go from zero install to a data-backed reading of how a Wikipedia
page changed.

## What we're doing

On 24 August 2006 the International Astronomical Union reclassified Pluto. We'll
analyze the 43 revisions Wikipedia's Pluto article went through in the following hour,
track one passage across them, export the events, and query them. The outputs shown
are from that fixed revision range, so your run prints the same counts.

Every command below names the range with `--from` and `--to`. Without a range,
`detailed` and `forensic` analysis and `export` read a page's whole history.

## Step 1: Zero-install analysis

```bash
npx @refract-org/cli analyze "Pluto" --from 71593043 --to 71601937 --depth detailed --json | wc -l
```

`--json` prints one JSON event per line; without it, `analyze` prints a text summary
or, in an interactive terminal, opens the explorer. Progress goes to stderr:

```
Analyzing "Pluto" at depth: detailed...
Coverage: complete; 43 revisions (71593043 → 71601937).
Correlated 43 talk page discussions.
    1372
```

Each of the 1,372 events has a type, a revision pair, a section, before/after text,
and the deterministic facts that triggered it.

## Step 2: Track a specific passage

```bash
refract claim "Pluto" --text "ninth and smallest" --from 71593043 --to 71601937
```

Refract prints the sentence that matched in each revision of the range, then a
summary. The last lines:

```
[2006-08-24T14:37:04Z] EXACT MATCH (rev 71601937)
  Matched text: "Pluto was considered the ninth and smallest of the planets of the Solar system by the International Astronomical Union (IAU) and the general public for much of the twentieth century, and into the early 21st."

=== Passage History Summary ===
Claim ID:    f914f34dbb918e2f
Page:        Pluto
Status:      contested
Latest revision: 71601937
Latest match:    exact
Tracked "ninth and smallest" across 43 revisions. First matched within this selection at 2006-08-24T13:39:15Z (rev 71593043). Multiple changes detected; latest version at 2006-08-24T14:37:04Z (rev 71601937). …
Note: Matching covers 43 fetched revisions, not the page's entire history.
Note: The legacy contested label records repeated wording changes or disappearance and return, not an observed discussion dispute.
```

`Status` is `present`, `modified`, `contested`, `absent` or `unknown`. `contested` here
means the wording changed repeatedly within the range.

Without `--from` and `--to`, `claim` reads the latest 50 revisions (`--limit` changes
the number), and "first matched" is relative to those.

![Claim lifecycle](claim-lifecycle.svg)

## Step 3: Export for analysis

```bash
refract export "Pluto" --from 71593043 --to 71601937 --format ndjson > pluto-events.jsonl
```

The file holds the same 1,372 events, each with an added `eventId`.

## Step 4: Query the events

```bash
duckdb -c "
SELECT \"eventType\", count(*) AS cnt
FROM 'pluto-events.jsonl'
GROUP BY \"eventType\"
ORDER BY cnt DESC;
"
```

The same count with `jq`:

```bash
jq -r .eventType pluto-events.jsonl | sort | uniq -c | sort -rn
```

Output:

| eventType | cnt |
|-----------|-----|
| wikilink_removed | 296 |
| wikilink_added | 289 |
| sentence_removed | 255 |
| sentence_reintroduced | 246 |
| section_reorganized | 97 |
| talk_page_correlated | 43 |
| sentence_modified | 30 |
| citation_added | 22 |
| citation_removed | 21 |
| template_removed | 20 |
| template_added | 20 |
| sentence_first_seen | 11 |
| talk_reply_added | 6 |
| template_parameter_changed | 4 |
| category_removed | 4 |
| category_added | 4 |
| talk_thread_opened | 2 |
| revert_detected | 1 |
| edit_cluster_detected | 1 |

Sentences were removed and reintroduced about as often (255 and 246): text was taken
out and put back many times within the hour.

Find the sections with the most sentence changes:

```sql
SELECT section, count(*) AS sentence_events
FROM 'pluto-events.jsonl'
WHERE "eventType" LIKE 'sentence_%'
GROUP BY section
ORDER BY sentence_events DESC
LIMIT 5;
```

```bash
jq -r 'select(.eventType | startswith("sentence_")) | .section' pluto-events.jsonl \
  | sort | uniq -c | sort -rn | head -5
```

| section | sentence_events |
|---------|-----------------|
| Charon | 93 |
| (lead) | 81 |
| Minor planet? | 50 |
| Name | 47 |
| Heliocentric distance | 36 |

`revert_detected` events have an empty `section`: a revert is detected from the edit
summary, which names no section. Group them by `timestamp` instead.

## Step 5: Check for talk page activity

The export already holds one `talk_page_correlated` event for each article revision
that had a talk page edit within 7 days before or 3 days after it. The `detail` names
the nearest talk edit's summary and its distance in hours:

```bash
jq -r 'select(.eventType == "talk_page_correlated") | .deterministicFacts[0].detail' pluto-events.jsonl \
  | sort | uniq -c | sort -rn | head -3
```

```
  10 time_delta_hours=0.1 talk_comment=/* Not a Planet Anymore! */
   9 time_delta_hours=0 talk_comment=/* Not a Planet Anymore! */
   7 time_delta_hours=0 talk_comment=Owned
```

All 43 article revisions had a talk page edit within minutes, so the rewriting was
accompanied by discussion.

The same run reports threads opened and replies added on the talk page while the
article was being rewritten:

```bash
jq -r 'select(.eventType | test("talk_thread|talk_reply")) | [.eventType, .section] | @tsv' pluto-events.jsonl
```

`refract analyze "Talk:Pluto"` treats the talk page as an ordinary page and reports
its sections and sentences.

## The complete picture

After these 5 steps you know:

1. **What changed** in that hour (1,372 events across 43 revisions)
2. **How one passage fared** ("ninth and smallest" matched in the first and last revision, with repeated rewording between)
3. **Which sections changed most** (Charon and the lead)
4. **Whether the talk page was active** (an edit within minutes of every article revision)
5. **How sourcing moved** (22 citations added, 21 removed)

The same commands over the same revision range produce the same events.

## What to do next

- **Automate monitoring**: Set up `refract cron` to re-observe daily ([cron guide](cron.md))
- **Compare across wikis**: Run `refract diff` on Bitcoin across English and Simple
  Wikipedia ([cross-wiki tutorial](tutorials/cross-wiki-diff.md))
- **Build a dashboard**: Load events into DuckDB and connect to Grafana or
  Observable ([analytics guide](analytics.md))
- **Integrate with RAG**: Use claim stability signals to filter retrieval results
  ([downstream guide](downstream.md))
- **Check expectations**: Score events against test cases or labels
  ([eval guide](eval.md))

## The same workflow for any page

The commands take any MediaWiki page — Wikipedia, Fandom, or a private wiki — through
`--api`:

```bash
refract analyze "Midi-chlorian" --api https://starwars.fandom.com/api.php --depth brief --json
refract claim "Midi-chlorian" --text "midi-chlorians" --api https://starwars.fandom.com/api.php --limit 10
refract export "Midi-chlorian" --api https://starwars.fandom.com/api.php --from <revId> --to <revId> --format ndjson > midi-chlorian.jsonl
```

The output format is the same. Redirects are not followed: a redirect title, such as
"Darth_Vader" on that wiki, yields the history of the redirect page itself.
