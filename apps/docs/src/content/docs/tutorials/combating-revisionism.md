---
title: "Tutorial: Combat revisionism with deterministic provenance"
description: "Use Refract to detect revisionist edits — claim laundering, citation swapping, coordinated rewrites — and produce an event record, with a Merkle root, that…"
---

## Goal

Use Refract to detect revisionist edits — claim laundering, citation swapping,
coordinated rewrites — and produce an event record, with a Merkle root, that
anyone can reproduce by running the same analysis.

## What Refract gives historians that Wikipedia's UI doesn't

Wikipedia's page history shows you diffs. Refract shows you patterns across diffs:
which claims survived, which sources got swapped, whether edits were debated or
silent, whether two wikis tell different stories, and a Merkle root that anyone
re-running the analysis can reproduce.

Revisionism works by making the old version disappear. Refract makes the
disappearance visible as a structured, queryable event. Every change becomes a
timestamped, provenance-tagged record. The edit may vanish from the page — it
cannot vanish from the event stream.

## Step 1: Claim provenance — when did this sentence enter the record?

A contested historical claim appears on Wikipedia. When was it first added?

```bash
refract claim "Battle of X" --text "civilian casualties were minimal" --from <revId> --to <revId>
```

Output: one entry per revision in the range where a sentence matched, with the revision
ID, timestamp and matched text, then a summary with a `Claim ID` and the times the
passage was first matched, changed, removed and reintroduced. The output is text, not
JSON. An illustrative excerpt:

```
[2021-04-03T12:00:00Z] EXACT MATCH (rev 1280110100)
  Matched text: "Civilian casualties were minimal according to official sources."

=== Passage History Summary ===
Claim ID:    c7d8e9f0a1b23456
Page:        Battle of X
Status:      present
```

Without `--from` and `--to`, `claim` reads the latest 50 revisions, so "first matched"
means first within those. To find when a sentence entered an old article, give a range
that reaches back far enough.

## Step 2: Citation laundering — same claim, different source

A common revisionist tactic: leave the claim text intact but swap the supporting
source. "Civilian casualties were minimal" stays, but the citation changes from
an independent human rights report to a government press release.

Refract catches this as a `citation_replaced` event:

```bash
refract export "Battle of X" --from <revId> --to <revId> --format ndjson > battle-events.jsonl
```

```sql
SELECT timestamp, before, after
FROM 'battle-events.jsonl'
WHERE "eventType" = 'citation_replaced'
ORDER BY timestamp;
```

A citation event's `section` is the section that holds the reference, so the result can
be narrowed with `AND section = 'History'`.

The `before` field contains the old citation. The `after` field contains the new
one. The claim text didn't change — but what supports it did. Without Refract,
this pattern requires manually comparing every revision diff.

Citation events are not linked to a sentence. To find the revisions that removed more
sources than they added:

```sql
SELECT
  "toRevisionId",
  count(*) FILTER (WHERE "eventType" = 'citation_added') as sources_added,
  count(*) FILTER (WHERE "eventType" = 'citation_removed') as sources_removed,
  count(*) FILTER (WHERE "eventType" = 'citation_replaced') as sources_swapped
FROM 'battle-events.jsonl'
GROUP BY "toRevisionId"
HAVING sources_removed > sources_added
ORDER BY sources_swapped DESC;
```

## Step 3: Edit clusters — coordinated or organic?

An `edit_cluster_detected` event marks 3 or more edits within an hour. Its fact gives
the number of revisions and of distinct editors; `--cluster-window` changes the window.

```bash
jq -r 'select(.eventType == "edit_cluster_detected") | [.timestamp, .fromRevisionId, .toRevisionId, .deterministicFacts[0].detail] | @tsv' battle-events.jsonl
```

The revisions per hour show the same bursts:

```bash
jq -r 'select(.eventType != "talk_page_correlated") | [.timestamp[:13], .toRevisionId] | @tsv' battle-events.jsonl \
  | sort -u | cut -f1 | uniq -c | awk '$1 >= 3'
```

Events have no editor field. An edit summary quoted in a `revert_detected` event may name one.

## Step 4: Talk page correlation — was this debated?

Refract checks whether talk page discussion occurred within 7 days before or
3 days after each edit. The absence of talk activity alongside content changes
is itself a signal:

```sql
SELECT
  count(*) FILTER (WHERE "eventType" LIKE 'sentence_%') as content_changes,
  count(*) FILTER (WHERE "eventType" LIKE 'talk_%') as talk_activity,
  count(*) FILTER (WHERE "eventType" = 'revert_detected') as reverts
FROM 'battle-events.jsonl';
```

## Step 5: Cross-wiki temporal precedence — who said it first?

```bash
refract analyze "Topic" --api https://en.wikipedia.org/w/api.php --from <revId> --to <revId> --json > wiki-en.jsonl
refract analyze "Topic" --api https://de.wikipedia.org/w/api.php --from <revId> --to <revId> --json > wiki-de.jsonl
```

Revision IDs are per wiki, so each command needs its own range. `refract diff` prints
side-by-side event counts for the same title on several wikis.

## Step 6: A Merkle root others can reproduce

```bash
refract export "Battle of X" --manifest --from 1270000000 --to 1280110100 > battle-manifest.json
```

The manifest lists a SHA-256 hash of each input revision, a hash of each event,
the Merkle root over the event hashes, and the Refract version. A skeptic who
runs the same version over the same revision range gets the same Merkle root; a
different root means the events differ. Nothing is signed, so the root shows the
analysis is reproducible, not who ran it or when.

## What Refract deliberately does NOT tell you

Refract never says "this edit was revisionist" or "this claim is true." It says:
this sentence appeared at this revision, supported by this source, removed at
this revision, discussed on talk at this date, reinstated without its original
citation at this revision.

- No sentiment analysis
- No truth claims
- No editor targeting
- No model calls in the deterministic pipeline

The historian brings the domain knowledge. Refract brings the audit trail.

## Next steps

- [Event taxonomy](../events.md) — all 26 event types
- [Schema reference](../schema.md) — full EvidenceEvent structure
- [Citation churn tutorial](citation-churn.md)
- [Dispute timeline tutorial](dispute-timeline.md)
- [Analytics with DuckDB](../analytics.md)
- [Bundle and manifest formats](../bundle-manifest.md)
