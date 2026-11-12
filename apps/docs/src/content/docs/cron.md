---
title: "Scheduled monitoring with cron"
description: "refract cron re-observes every page in a list once and reports, per page, how many events are new since the previous run. It is built to be started by a…"
---

`refract cron` re-observes every page in a list once and reports, per page, how many
events are new since the previous run. It is built to be started by a scheduler —
system cron, a CI workflow, a job runner — and to exit. It keeps its own state between
runs, so the scheduler has to keep that state too (see [where state lives](#where-state-lives)).
To record what a person has inspected instead, use [`refract review`](../../../../../docs/review.md);
[compare the monitoring commands](../../../../../docs/usage.md#which-command-keeps-checking-a-source).

## Basic usage

```bash
refract cron pages.txt
```

`pages.txt` holds one page title per line. Blank lines and lines starting with `#`
are skipped.

```
# Observed daily
Bitcoin
COVID-19
Climate change
```

For a wiki other than English Wikipedia, add `--api https://example.org/w/api.php`.

## What a run does

For each page:

1. Reads the page's previous observation, if there is one.
2. Analyzes the revisions since the lookback start (below) at `detailed` depth.
3. Compares: an event is **new** if it sits on a revision the previous observation had
   no events for, and **resolved** if the previous observation had it inside this
   run's window and its revision, compared again, has no events left. An event that is
   merely older than the window is neither.
4. Writes this run's events as the page's observation — unless the run found none, in
   which case the previous observation is kept, so the next run still has something
   to compare against.
5. Merges a claim-level report into `reports/<page>.json`.

The first run for a page has nothing to compare with. It records a baseline and
reports no new events.

## Lookback window

| Flag | Window |
|---|---|
| (none) | From the newest event in the previous observation; 24 hours when there is none |
| `-i, --interval <hours>` | The last N hours, whatever the previous observation holds |

```bash
refract cron pages.txt --interval 24
```

Run the scheduler at least as often as the interval. A window shorter than the gap
between runs leaves edits no run looked at.

With `--interval` the window slides, and each run analyzes a different slice of
history. The first revision in a window is not compared with the one before it, and a
sentence whose earlier appearance has left the window is typed `sentence_first_seen`
where it was `sentence_reintroduced`. Neither counts as a change: a revision that
already had events contributes no new ones, and the window's first revision contributes
no resolved ones. A page nobody edited reports no changes.

## Output and exit code

The output is a report for people, not a data format:

```
Cron: 3 pages from pages.txt

  Bitcoin: observing since 2026-09-23T06:00:00.000Z...
    2 new events, 0 resolved
  COVID-19: observing since 2026-09-23T06:00:00.000Z...
    No changes
  Climate change: observing since 2026-09-23T06:00:00.000Z...
    No changes

=== Cron Summary ===
Pages: 3
Total new events: 2
```

`refract cron` exits **1 when there are new events** — and also 1 when anything fails,
so the exit code alone cannot tell a change from an error. Read the
`Total new events: N` line: a run that printed it finished; a run that did not, failed.

For the events themselves, use `analyze` over the same window, which prints one JSON
event per line:

```bash
refract analyze "Bitcoin" --since 2026-09-23T06:00:00Z --json > bitcoin-events.ndjson
```

## Where state lives

Everything `cron` remembers is in one directory: `--cache-dir <dir>`, or
`~/.wikihistory` without it.

| Path | Holds |
|---|---|
| `<dir>/observations/<page>.json` | The page's last observation — the events the next run compares against |
| `<dir>/reports/<page>.json` | The merged claim-level report |

`<page>` is the title with every character outside `A–Z a–z 0–9 _ -` replaced by `_`.

**On a fresh machine every run is a first run.** A CI runner starts empty, so unless
the directory is carried from one run to the next, every run records a baseline and
reports no new events. Pass `--cache-dir` and persist that directory.

## Scheduling with system cron

```bash
# /etc/cron.d/refract-observation — every 6 hours
0 */6 * * * user refract cron /srv/refract/pages.txt --interval 6 --cache-dir /srv/refract/state
```

## Scheduling with GitHub Actions

The state directory is restored from the Actions cache at the start of each run and
saved under a new key at the end, so each run compares against the one before it.

```yaml
name: Refract observation
on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch:

jobs:
  observe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/cache@v4
        with:
          path: .refract
          key: refract-state-${{ github.run_id }}
          restore-keys: refract-state-
      - name: Observe
        run: |
          set +e
          npx -y @refract-org/cli cron pages.txt --interval 6 --cache-dir .refract | tee cron.log
          status=${PIPESTATUS[0]}
          set -e
          # Exit 1 means new events only when the run printed its summary.
          if ! grep -q '^Total new events:' cron.log; then exit "$status"; fi
```

Committing `.refract/` back to the repository instead of caching it gives the same
continuity plus a history of every observation.

## Notifications

A notification is sent only when at least one page has new or resolved events.

### Slack

```bash
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..." \
  refract cron pages.txt --notify-slack
```

Posts a message listing each changed page with its new and resolved counts.

### Email

```bash
SMTP_TO="alerts@example.com" refract cron pages.txt --notify-email
```

Sends through the local `sendmail` (`/usr/sbin/sendmail`, or the path in
`SMTP_SENDMAIL`). `SMTP_TO` is required; there is no SMTP host or password setting.

### Webhook

```bash
refract cron pages.txt --notify-webhook https://hooks.example.com/refract
```

POSTs:

```json
{
  "event": "refract.observation",
  "pages": [
    {
      "pageTitle": "Bitcoin",
      "eventsNew": 2,
      "eventsResolved": 0,
      "deltaSummary": "2 new, 0 resolved"
    }
  ],
  "totalNewEvents": 2,
  "totalResolved": 0,
  "generatedAt": "2026-09-24T06:00:04.000Z"
}
```

With `--api`, each page also carries `wikiUrl`, the API it was observed through.

## Serverless platforms

The CLI needs Node.js or Bun and a filesystem, so it cannot run inside a Cloudflare
Worker. Two patterns work:

- Run `refract cron` (or `analyze --since … --json`) on a scheduled runner, and send
  the results to the platform — D1, R2, a queue.
- Import the library packages (`@refract-org/ingestion`, `@refract-org/analyzers`) in
  the Worker and fetch and diff revisions there, keeping the previous observation in
  D1 or KV. The Worker needs `nodejs_compat`: the packages use `node:crypto`.

A function platform with a filesystem and a Node runtime (AWS Lambda, Cloud Run jobs)
can run the CLI directly; keep `--cache-dir` on durable storage.

## In CI for documentation checks

`analyze` compares one window of one page; with `--json` its output is one event per
line, ready for `jq` or DuckDB:

```yaml
- name: Events on the observed page this week
  run: |
    npx -y @refract-org/cli analyze "Page_Name" --depth detailed \
      --since "$(date -u -d '8 days ago' +%Y-%m-%dT%H:%M:%SZ)" --json > events.ndjson
    duckdb -c "SELECT eventType, count(*) FROM 'events.ndjson' GROUP BY 1 ORDER BY 2 DESC"
```

A `--since` window diffs each revision in it against the one before — except the
first, whose parent lies outside the window. Open the window a little before the
period you care about (eight days for a week, above).
