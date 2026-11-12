# Recipes

Start with a question and finish with an artifact you can inspect. The offline
workflow uses a fictional history; the Wikipedia examples name real revision
pairs. Commands below use `refract` as the CLI command.

## Try the offline walkthrough

With the CLI installed, or through `npx @refract-org/cli`:

```bash
refract init
```

The fictional Rivergate Library sample shows a sentence changing from closing at
six to closing at eight, a reference being removed, and wording about free
printing disappearing and returning. The reference URL, dates, and revision IDs
are fictional too. It makes no wiki requests.

![Computed observations from the fictional sample](./examples/onboarding.svg)

Inspect the [source revisions](../packages/cli/src/onboarding-sample.ts),
[captured terminal output](./examples/onboarding.txt), and
[complete events](./examples/sample-events.ndjson).

## Review sources since your last check

Use [the review workflow](./review.md) for a watchlist with saved revision
baselines, resumable fetching, and acknowledgment of an inspected report. Its
[offline sample](./review.md#try-the-complete-flow-offline) exercises the whole
process without fetching a wiki.

## Inspect changes to a passage

**“What changed in this passage between two revisions?”**

```bash
refract analyze "Bitcoin" --from 345930425 --to 350653695 --depth detailed --json > passage-events.ndjson
jq -c 'select(.eventType == "sentence_modified") | {timestamp, before, after, fromRevisionId, toRevisionId}' passage-events.ndjson
```

`detailed` includes matched text. `--json` prints one JSON event per line and
avoids launching the browser. The range is pinned so an unrelated current edit
does not change the example's article inputs.

The [Bitcoin walkthrough](./example-output.md) includes the captured wording
change and links to both source revisions. A similarity match is a rule-based
association of text, not a guarantee that its meaning remained the same.

For a phrase in a page's recent history:

```bash
refract claim "Bitcoin" --text "decentralized" --limit 50
```

This inspects the latest 50 revisions. The command prints candidate text,
match kind, latest revision, and status. `unknown` identifies a partial match or
unavailable latest text; `absent` identifies no match in available latest text.
The first match is relative to the fetched window. A partial candidate is found
by sentence word overlap; see [matching rules](./concepts/claim-state-timelines.md#identity-and-matching).

## Inspect an earlier record

**“What did the page say at this date?”**

```bash
refract snapshot "Bitcoin" --at 2024-01-15
```

The result names the closest fetched revision at or before the requested date
and prints a text preview, limited to 2,000 characters. Inspect the complete
revision by inserting its ID in:

```text
https://en.wikipedia.org/w/index.php?oldid=REVISION_ID
```

A snapshot is one captured state. Use a bounded `analyze` call to compare it with
another revision.

## Build a review feed

**“My application needs reference removals as data.”**

This offline workflow requires `jq`:

```bash
refract init --json > sample-events.ndjson
jq -c 'select(.eventType == "citation_removed")' sample-events.ndjson > review-events.ndjson
jq '{timestamp, removedReference: .before, fromRevisionId, toRevisionId}' review-events.ndjson
```

The selected event says that a reference was removed from fictional sample
revision 2 to 3. It preserves the removed reference and links the observation to
the input revision IDs. Compare your file with the
[captured review event](./examples/review-events.ndjson).

`review-events.ndjson` is the artifact your application can ingest into a review
queue. Your application supplies the routing rule and any judgment about the
reference's significance. This recipe writes a file locally; it does not send a
notification or create a review item in an external service.

For real Wikipedia revisions, export a pinned range and attach source links:

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > wiki-events.ndjson
jq -c 'select(.eventType == "citation_removed") | {
  eventId, timestamp, removedReference: .before,
  priorRevision: ("https://en.wikipedia.org/w/index.php?oldid=" + (.fromRevisionId | tostring)),
  nextRevision: ("https://en.wikipedia.org/w/index.php?oldid=" + (.toRevisionId | tostring))
}' wiki-events.ndjson > wiki-review-items.ndjson
```

The links above assume English Wikipedia. For another MediaWiki instance, use
that wiki's revision URL. Events are bounded by the captured range; they do not
establish why a reference was removed or whether it supported the passage.

## Share or check what you found

**“Someone else needs to read this without running Refract.”**

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --format html > bitcoin-report.html
```

The result is one standalone page with the same timeline as the explorer and a
JSON download. It needs no server.

**“I want to check that a saved result is internally consistent.”**

```bash
refract export "Bitcoin" --from 369361755 --to 369393212 --proof > bitcoin-proof.json
refract verify bitcoin-proof.json --html bitcoin-receipt.html
```

`verify` works offline and exits 1 when a check fails. A pass shows that the
bundle agrees with itself. Nothing in it is signed, and anyone who edits it can
recompute every hash, so compare its Merkle root with one you received separately
or re-run the same Refract version over the same range. Use 0.6.0 or later:
`verify` in 0.5.17 and earlier does not rehash the events.
[What `verify` checks](https://zz-plant.github.io/refract/bundle-manifest/#checking-a-bundle)
lists the fields a pass does not cover.

## Compare two wikis

```bash
refract diff "Star Wars" --wiki-a https://en.wikipedia.org/w/api.php --wiki-b https://starwars.fandom.com/api.php
```

This produces a cross-wiki comparison. Live results depend on both histories;
counts are not fixed example output. Compare detected differences in text and
structure before assigning meaning to divergence.

Add `--detect-borrowing` to measure the text each pair of wikis shares. A shared
passage does not establish which wiki copied which.

## Let an agent request history

Use the CLI package that supplies the MCP executable:

```json
{
  "mcpServers": {
    "refract": {
      "command": "npx",
      "args": ["-y", "@refract-org/cli", "mcp"]
    }
  }
}
```

A useful first request is: “Analyze Bitcoin revisions 345930425 through
350653695 with text included. Show the observed wording changes and source
revision IDs. State the analyzed range.”

The agent requests observations from Refract and explains them to the reader.
Its explanation is separate from Refract's deterministic event stream.
[MCP reference](./mcp.md) lists the tools and arguments.

## Reproduce the saved examples

After `bun run build`, these commands regenerate the checked-in artifacts:

```bash
bun scripts/capture-onboarding.ts
bun scripts/capture-wiki-examples.ts
```

Both use local inputs. Add `--check` to compare the saved artifacts with current
output without rewriting them. To fetch the pinned Pluto and Bitcoin revision
pairs again, run `bun scripts/capture-wiki-examples.ts --refresh`; that step
requires network access.

## Next steps

- [History range and output guide](./usage.md)
- [Library adapter and data integrations](./integrations.md)
- [Other MediaWiki instances](./usage.md#other-mediawiki-instances)
- [Identity and verification limits](./concepts/claim-state-timelines.md)
