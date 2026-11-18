# Walkthrough: wording and reference changes

These examples use real revision pairs from Wikipedia. Each pair is analyzed
separately; no event is inferred across the gap between pairs.

## Pluto: one sentence in one hour

On 24 August 2006, the International Astronomical Union reclassified Pluto as a
dwarf planet. Wikipedia's Pluto article went through 43 revisions between 13:39
and 14:37 UTC that day. The [captured events](./examples/pluto-events.ndjson)
follow its first sentence across seven of those edits:

```text
13:40:11Z  sentence_removed     71593043 → 71593165
  Pluto is the ninth and smallest of the traditional planets of the Solar system, though its status as a planet has been disputed in recent years
13:40:11Z  sentence_first_seen  71593043 → 71593165
  Pluto is the ninth and smallest of the traditional planets of the Solar system, but on August 24, 2006 it was 'demoted' and stripped of its planetary status by the International Astronomical Union at their Prague meeting
13:41:22Z  sentence_modified    71593165 → 71593296
  Pluto was until recently considered the ninth and smallest…
13:59:47Z  sentence_modified    71595813 → 71595967
  Pluto is considered the ninth and smallest of the traditional planets of the Solar system, except by the IAU…
14:09:06Z  sentence_first_seen  71597389 → 71597482
  Pluto is widely considered the ninth and smallest of the traditional planets of the Solar system
14:10:27Z  sentence_first_seen  71597482 → 71597671
  Pluto was considered the ninth and smallest of the traditional planets of the Solar system
14:20:36Z  sentence_modified    71599033 → 71599252
  Pluto at one time was considered the ninth and smallest…
14:37:04Z  sentence_modified    71601076 → 71601937
  Pluto was considered the ninth and smallest of the planets of the Solar system…
```

Excerpts drop the rest of each sentence. A rewrite too different from the previous
wording is reported as `sentence_first_seen`, usually beside a `sentence_removed`.

The [saved inputs](./examples/pluto-revisions.json) stop at each revision's first
section heading and omit edit summaries, because some from that day name an
editor's IP address. The selected events match those from analyzing the complete
revisions. Article text is by Wikipedia's Pluto contributors, available under
[CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/).

These timestamps show when the text changed. They do not establish why an editor
changed it.

To follow the sentence through the whole range on Wikipedia:

```bash
refract claim "Pluto" --text "ninth and smallest" --from 71593043 --to 71601937
```

Three of these edits are reported as a `sentence_removed` beside a
`sentence_first_seen`. [Example 06](../examples/README.md#06-a-model-in-the-loop)
replays the day, asks a model at each of those splits whether the two sentences
are the same claim, and checks every answer against these events before showing it.

To fetch one of these transitions as events:

```bash
refract analyze "Pluto" --from 71593165 --to 71593296 --depth detailed --json > pluto-events.ndjson
jq -c 'select(.eventType == "sentence_modified") | {timestamp, before, after}' pluto-events.ndjson
```

## Bitcoin: a wording change and a removed reference

Refract detects a wording change in one adjacent pair from Wikipedia's Bitcoin
article and a removed reference in another.

```text
2010-03-18T20:03:27Z  sentence_modified
  Revisions: 345930425 → 350653695
  Before (excerpt): The longest proof-of-work chain…
  After  (excerpt): The longest proof-of-work block chain…

2010-06-21T17:29:07Z  citation_removed
  Revisions: 369361755 → 369393212
  Removed: <ref>[http://www.bitcoin.org/faq Bitcoin FAQ]</ref>
```

The sentence excerpts omit the unchanged remainder. The
[captured events](./examples/bitcoin-events.ndjson) include the complete matched
text, removed reference, timestamps, and revision IDs. They were computed from
[saved inputs](./examples/bitcoin-revisions.json) with the current checkout's
analyzers and event schema. The capture script also derives event IDs.

| Observation | Prior revision | Next revision |
|-------------|----------------|---------------|
| Wording changed | [345930425](https://en.wikipedia.org/w/index.php?oldid=345930425) | [350653695](https://en.wikipedia.org/w/index.php?oldid=350653695) |
| FAQ reference removed | [369361755](https://en.wikipedia.org/w/index.php?oldid=369361755) | [369393212](https://en.wikipedia.org/w/index.php?oldid=369393212) |

The article content is attributed to Wikipedia's Bitcoin contributors; the
revision links identify each captured version. A reference disappearing does
not establish why it was removed or whether it supported the passage.

### Reproduce with the CLI

These commands require network access and print NDJSON:

```bash
refract analyze "Bitcoin" --from 345930425 --to 350653695 --depth detailed --json > wording-events.ndjson
refract export "Bitcoin" --from 369361755 --to 369393212 --format ndjson > reference-events.ndjson
```

Each command can emit additional events for the pair. Select the observations
shown above by their type and text:

```bash
jq -c 'select(.eventType == "sentence_modified" and (.before | startswith("The longest proof-of-work chain")))' wording-events.ndjson
jq -c 'select(.eventType == "citation_removed" and (.before | contains("Bitcoin FAQ")))' reference-events.ndjson
```

## Reproduce without the wiki

From a source checkout with dependencies installed and packages built:

```bash
bun scripts/capture-wiki-examples.ts --check
```

This reruns the analyzers against the saved revision pairs and checks the
captured events for both examples. It makes no network calls. To regenerate the output, omit
`--check`. To fetch those pinned pairs again, add `--refresh`.

The [capture script](../scripts/capture-wiki-examples.ts) specifies the pairs,
selection rules, and event-ID derivation. Preserved article inputs make this
example reproducible even if current page content or supplemental metadata
changes.

## Start with a fictional sample

For a walkthrough that also includes text disappearing and returning, use
[the offline recipe](./recipes.md#try-the-offline-walkthrough). Its inputs and
reference URL are fictional and marked as such in the exported events.
