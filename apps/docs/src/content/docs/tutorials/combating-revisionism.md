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
refract claim "Battle of X" --text "civilian casualties were minimal" -c
```

Output: a timeline of every revision where that sentence appeared, was rewritten,
removed, or reintroduced. Each event carries the exact revision ID, timestamp,
and a deterministic SHA-256 `eventId`. Run the same command on the same revision
range and you get the same hash — independently verifiable.

```json
{
  "eventType": "sentence_first_seen",
  "toRevisionId": 1280110100,
  "timestamp": "2021-04-03T12:00:00Z",
  "after": "civilian casualties were minimal according to official sources",
  "claimId": "c7d8e9f0a1b23456",
  "layer": "observed"
}
```

## Step 2: Citation laundering — same claim, different source

A common revisionist tactic: leave the claim text intact but swap the supporting
source. "Civilian casualties were minimal" stays, but the citation changes from
an independent human rights report to a government press release.

Refract catches this as a `citation_replaced` event:

```bash
refract analyze "Battle of X" --depth forensic -c > battle-events.jsonl
```

```sql
SELECT timestamp, before, after
FROM 'battle-events.jsonl'
WHERE "eventType" = 'citation_replaced'
  AND section LIKE '%Casualties%'
ORDER BY timestamp;
```

The `before` field contains the old citation. The `after` field contains the new
one. The claim text didn't change — but what supports it did. Without Refract,
this pattern requires manually comparing every revision diff.

To find claims that lost their original sources:

```sql
SELECT
  claim_id,
  count(*) FILTER (WHERE "eventType" = 'citation_added') as sources_added,
  count(*) FILTER (WHERE "eventType" = 'citation_removed') as sources_removed,
  count(*) FILTER (WHERE "eventType" = 'citation_replaced') as sources_swapped
FROM 'battle-events.jsonl'
GROUP BY claim_id
HAVING sources_removed > sources_added
ORDER BY sources_swapped DESC;
```

## Step 3: Edit clusters — coordinated or organic?

3+ edits hitting the same section within an hour fire `edit_cluster_detected`:

```sql
SELECT timestamp, section, deterministicFacts[0].detail as detail
FROM 'battle-events.jsonl'
WHERE "eventType" = 'edit_cluster_detected'
ORDER BY timestamp;
```

The `detail` field reports the editor count and time span.
Refract does not record editor identities.

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
refract analyze "Topic" --api https://en.wikipedia.org/w/api.php > wiki-en.jsonl
refract analyze "Topic" --api https://de.wikipedia.org/w/api.php > wiki-de.jsonl
```

Or use `refract diff` for structured cross-wiki comparison with z-score outlier detection.

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
