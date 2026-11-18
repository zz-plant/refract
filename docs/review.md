# Review changes to wiki pages you rely on

**What changed since I last reviewed these pages, and where can I inspect it?**

`refract review` saves the revisions it fetched and produces a review report.
Checking for updates keeps changes pending. After inspecting a saved report,
you acknowledge its ID to move the reviewed baseline to its captured endpoint.
Edits that arrive afterward remain for the next review.

The workflow fits a researcher or developer who already knows which MediaWiki
pages their work depends on. It observes changes to article text, citations,
and structure. You decide which changes matter. The review command's scope is
article revisions; it does not include talk-page or page-move log observations.
Use `analyze` when you need those additional observations.

## Try the complete flow offline

```bash
npm install -g @refract-org/cli

refract review --sample --from 1 --state-dir ./review-state --format json > review.json
jq -r '.pages[] | .entries[] | [.eventType, .before, .after] | @tsv' review.json
refract review --sample --state-dir ./review-state --event-type citation_removed
```

The bundled library history is **fictional**. Its dates, IDs, and URLs are
illustrative. The terminal report shows changed text; the JSON report also
retains all input revisions. Sample revision links are illustrative and are
not rendered as live source links.

Inspect the unfiltered report before acknowledging it:

```bash
review_report_id=$(jq -r '.reportId' review.json)
refract review --state-dir ./review-state --ack "$review_report_id"
refract review --sample --state-dir ./review-state
```

The final command reports `no_changes`. No wiki requests are made by `--sample`
or `--ack`. [Read the captured review](./examples/review.md),
[inspect its JSON and input revisions](./examples/review.json), or compare the
[citation-only view](./examples/review-citations.md).

## Start a live watchlist

Create a plain-text file containing one page title per line. Blank lines,
comments beginning with `#`, and duplicate titles are ignored:

```text
# Sources I depend on
Bitcoin
Earth
```

```bash
refract review --pages-file pages.txt --state-dir ./source-review --format json > baseline.json
```

On the first run, each page has status `baseline_required`. This records its
current revision for inspection. It makes no observation about earlier history.
Inspect the linked source revisions, then establish that baseline:

```bash
baseline_report_id=$(jq -r '.reportId' baseline.json)
refract review --state-dir ./source-review --ack "$baseline_report_id"
```

On later runs:

```bash
refract review --pages-file pages.txt --state-dir ./source-review > changes.md
refract review --pages-file pages.txt --state-dir ./source-review --format json > changes.json
```

Read the report, then acknowledge its ID using the same `--state-dir`. A repeat
run retains pending changes until acknowledgment; it does not append duplicate
entries to the report. For a single page whose last reviewed revision you know,
use `review "Bitcoin" --from REVISION_ID` on its first run. `--from` chooses a
comparison baseline; it does not mark those revisions reviewed. It cannot
replace a baseline that has already been acknowledged.

Use `--api` and the existing authentication options for another MediaWiki
instance. Source keys include the API endpoint and page title, so matching
revision IDs on different wikis do not share a review cursor.

## Inspect changes with context

Every entry includes the source, section, date, mechanical event type, full
before/after text, and links to both source revisions and their diff.

```bash
refract review --pages-file pages.txt --event-type citation_removed,sentence_modified
refract review "Bitcoin" --section "History"
refract review "Bitcoin" --text "proof-of-work"
```

Filters affect the displayed view. The report shows how many entries are hidden.
**Acknowledgment covers the whole captured revision range**, including entries
hidden by filters. Review the unfiltered report before acknowledging it.
JSON keeps the full report in `pages` and the filtered entries in `view.pages`.

For an application, consume the report directly:

```bash
jq -c '.pages[] | .entries[] | select(.eventType == "citation_removed") | {entryId, source, timestamp, before, revisionLinks}' changes.json
```

`eventId` retains the analyzer's observation identity. `entryId` combines that
identity with the source key; use it for deduplication across multiple wikis.
`reportId` hashes the saved report, including its inputs, scope, and analyzer
version. This detects changes to that local artifact; it does not authenticate
the external source.

## Understand coverage and recovery

| Report field or status | Meaning |
|------------------------|---------|
| `reviewedRevisionId` | Endpoint of the last acknowledged report |
| `baselineRevisionId` | First input used for this comparison |
| `fetchedRevisionId` | Last revision captured so far |
| `latestRevisionId` | Source head observed at the start of this run |
| `pending` | Complete comparison with emitted events awaiting review |
| `no_changes` | No events emitted for the captured comparison, or no newer revision; coverage explains which |
| `incomplete` | Missing endpoints, missing parents, withheld text, unknown continuity, or a limited fetch |
| `error` | A source could not be fetched; its prior checkpoint is retained |

The report lists requested and observed ranges, missing parent revision IDs,
unavailable text, and truncation. Refract avoids text comparisons across known
gaps or unavailable text. An incomplete report cannot be acknowledged.

By default, a run fetches up to 200 new revisions per page. For longer pending
histories, repeat the command to resume from the saved fetched cursor. The
boundary revision is retained so its next transition is included. You can also
raise `--limit`. Missing or withheld source revisions may require restoring
source access; increasing the limit does not fill those gaps.

A complete saved report stays available even if a later fetch fails. `--ack`
reads that artifact, never refetches, and advances only to its recorded end.
It is idempotent for that endpoint and refuses stale reports that would replace
a newer acknowledged baseline. A watchlist report containing an incomplete
page cannot be acknowledged as a whole; rerun after resolving that page, or
review a complete page separately.

Exit status is `0` for a complete observation or acknowledgment, `2` for an
incomplete or failed page, and `1` for invalid options or state errors. Pending
changes alone do not cause a nonzero exit status.

State defaults to `~/.refract/review`. Each state directory contains a cursor
file and saved reports with their source text. Choose a separate directory for
each independent review process. A lock prevents overlapping writers. After an
interrupted process, remove the indicated `.lock` directory only when no review
process is running, then rerun; the saved checkpoints remain available.

## Check fit with a real review process

The offline example and tests demonstrate behavior. They do not establish demand
or savings. Before relying on this workflow, try it with a small set of pages
you already revisit:

1. Record what you need to notice and your prior review method.
2. Review an unfiltered report. Check whether its text and links let you inspect
   a relevant change without reconstructing the revision range yourself.
3. Acknowledge it, return after more edits, and check that the next report starts
   where you left off.
4. Record review time, relevant changes found, distracting entries, missing
   coverage, and any custom integration code required.

Use those observations to decide whether the workflow fits your work and which
filters or integrations would help. Refract supplies observations; your review
criteria remain yours.

Regenerate the captured sample with `bun scripts/capture-review.ts`. Check it
without rewriting files using `bun scripts/capture-review.ts --check`.
