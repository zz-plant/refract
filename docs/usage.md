# Choose a history range and output

Use a page title such as `Bitcoin`. A page URL is treated as a title, not parsed.
English Wikipedia is the default source. Range selection applies to cached and
fresh runs. A fixed range is reused only when both endpoints and parent
continuity are present. Open ranges check the source; incomplete cache entries
do not widen or shorten the requested selection. Custom `--api` sources bypass
the shared SQLite cache to avoid mixing wiki identities.

## What gets analyzed?

| Command or option | History used |
|-------------------|--------------|
| `analyze --depth brief` with no bounds | Latest 20 revisions; change the count with `--brief-limit` |
| `analyze --depth detailed` or `forensic` with no bounds | Available history, paginated from the beginning |
| `analyze --from ID --to ID` | Revisions between the specified bounds, including the endpoints |
| `analyze --since TIMESTAMP` | Revisions from that timestamp onward |
| `claim --text TEXT` | Latest 50 revisions; change the count with `--limit` |
| `snapshot --at DATE` | The latest revision at or before the end of the date, past a state a later edit reverted; 10 revisions read either side to tell |
| `explore PAGE` | Available history at detailed depth; accepts `--from`, `--to`, `--since`, `--depth`, and `--cache` |
| `review PAGE` or `review --pages-file FILE` | Revisions since the last acknowledged report; the first run establishes a baseline for inspection |

Specifying bounds on `brief` disables its default latest-20 selection; `brief`
still controls how much text appears in the events. Large histories can take
longer to fetch and analyze. Start with a pinned pair or a small brief window.

Interactive `analyze` serves the same captured result in the explorer, including
its revision bounds and coverage. It does not refetch the history. A direct
`explore` command can use the same bounds.

`--since` also maintains prior observation files for re-observation comparisons
under `~/.wikihistory/observations`, or the supplied `--cache-dir`. It is not a
complete capture of the execution inputs. Retain those separately if you need
independent reconstruction.

## How much detail do you need?

| Depth | Content events carry | Useful for |
|-------|----------------------|------------|
| `brief` | Metadata; `before` and `after` text omitted | A small recent-change overview |
| `detailed` | Matched or changed text | Inspecting wording and references |
| `forensic` | Changed text plus full before/after wikitext in deterministic facts | Examining source markup |

The flags select extraction detail, not the importance of a change.

## Where do results appear?

| Command | Result |
|---------|--------|
| `init` | Readable fictional walkthrough in the terminal; no wiki access |
| `init --json` | Fictional sample events as NDJSON; no wiki access |
| `analyze PAGE` in an interactive terminal, with events | Opens the local browser explorer and keeps its server running |
| `analyze PAGE --json` | One event per stdout line; progress messages go to stderr |
| `analyze PAGE --report` | One observation report JSON object |
| `export PAGE --format ndjson` | One exported event per stdout line; pipe it to a file |
| `explore PAGE` | Browser explorer at `localhost:8899`; Ctrl+C stops the server |
| `snapshot PAGE --at DATE` | Terminal text preview and revision metadata |
| `review PAGE` | Markdown review report with saved inputs and explicit acknowledgment |
| `review PAGE --format json` | Complete saved report plus filtered view; coverage is structured |

When stdout is redirected, `analyze` without `--json` can print a human-readable
summary. Use `--json` for data pipelines. `explore --no-open` starts the server
without opening a browser automatically.

## Which command keeps checking a source?

| You want | Command | How it runs | What it keeps |
|----------|---------|-------------|---------------|
| To inspect every change since your last acknowledged review | `review` | You run it; changes stay pending until you acknowledge the report | Fetched and reviewed revisions and saved reports, under `--state-dir` |
| A scheduler to act when pages in a list change | `cron` | One run per schedule; exits 1 on new events and can notify Slack, email, or a webhook | Each page's previous observation, under `--cache-dir` |
| To see one page's new revisions while a terminal stays open | `watch` | Polls the latest five revisions every 60 seconds until stopped | Nothing between runs |
| A live feed of edits on a Wikimedia wiki | `stream` | Stays connected to EventStreams until stopped; prints revision metadata without analysis | Nothing |

`cron` reports that events are new; it does not record what anyone inspected. Use
`review` when a person's acknowledgment is part of the process.

## What does an empty result mean?

Coverage reports the requested and observed range, revision count, missing
parents or endpoints, unavailable text, and limits. `analyze --report` includes
structured `coverage`; NDJSON keeps native event records and prints coverage to
stderr. The explorer displays coverage and exposes it at `/api/coverage`.

No emitted events means the enabled rules emitted none for the captured inputs.
`insufficient` means fewer than two revisions were captured; `partial` identifies
missing inputs, and `unknown` identifies unverified parent continuity. Known gaps
and unavailable text are not compared as adjacent revisions. Check coverage
before concluding there were no changes.

The [review workflow](./review.md) distinguishes fetched and reviewed revisions
and prevents acknowledgment of incomplete histories.

“Claim not found” means the requested text did not match within the fetched
revisions and matching rules. Try another phrase or a wider `--limit`; it does
not establish that the statement never appeared.

## Other MediaWiki instances

Use the target wiki's API endpoint:

```bash
refract analyze "Internal Policy" --api https://wiki.example.org/w/api.php --depth brief --json
```

For an instance that expects authentication, add the appropriate credentials:

| Method | Setting |
|--------|---------|
| Bearer token | `--api-key TOKEN` |
| Basic auth | `--api-user USER --api-password PASSWORD` |
| Gateway client headers | `REFRACT_OAUTH_CLIENT_ID` and `REFRACT_OAUTH_CLIENT_SECRET` environment variables |

The client-header option sends custom headers; it does not perform an OAuth
login flow. Set those variables only for the wiki that expects them. CLI
credentials can appear in process listings; see [security considerations](./security.md).

## Versioned text you already own

The CLI does not recover a history from an arbitrary web URL. Library consumers
can supply text snapshots as `Revision[]` and use the deterministic analyzers.
Each revision needs an ID, page identity, timestamp, content, edit summary,
size, and minor-edit flag. Optional `parentId` records its source parent, and
`contentAvailable: false` records withheld source text. If your snapshots have gaps, events describe changes
between the captured states, not every intervening edit.

[Library integration](./integrations.md#use-a-single-library-adapter) shows the
import boundary. The [revision type](../packages/evidence-graph/src/schemas/revision.ts)
is the input contract.
