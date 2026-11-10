---
title: "Tutorial: Scheduled monitoring with cron, watch, and notifications"
description: "Set up Refract to re-observe Wikipedia pages on a schedule, detect when claims change, and notify you via Slack, email, or webhook. Catch citation removal…"
---

## Goal

Set up Refract to re-observe Wikipedia pages on a schedule, detect when claims change,
and notify you via Slack, email, or webhook. Catch citation removal, template disputes,
and section reorganization as they happen — not when someone notices.

## Two monitoring modes

| Mode | How it works | Use when |
|---|---|---|
| `refract cron` | One-shot re-observation for cron scheduling | Batch monitoring of many pages on a fixed schedule |
| `refract watch` | Polls one page and prints its new revisions until stopped | Following a specific page as it changes |

These modes alert you to changes; they do not record what anyone inspected. For that, use
[`refract review`](../../../../../../docs/review.md), and see
[how all the monitoring commands compare](../../../../../../docs/usage.md#which-command-keeps-checking-a-source).

## Step 1: Create your pages file

List the pages you want to monitor, one per line:

```bash
cat > watch-pages.txt << EOF
COVID-19
SARS-CoV-2
COVID-19_pandemic
COVID-19_vaccine
mRNA_vaccine
EOF
```

Pages can be any valid MediaWiki page title. Use underscores for spaces.

## Step 2: Run a one-shot re-observation

```bash
refract cron watch-pages.txt --interval 24 --cache-dir ~/.refract-watch
```

This re-observes every page in the file over the last 24 hours and prints, per page,
how many events are new since the previous run. The first run for a page records a
baseline and reports none. `--cache-dir` is where `cron` keeps each page's previous
observation; without it, `~/.wikihistory`. The [cron reference](../cron.md) describes
the comparison, the output and the exit code.

## Step 3: Schedule it

Add to your crontab, with the interval matching the schedule:

```bash
# Every 6 hours
0 */6 * * * refract cron /path/to/watch-pages.txt --interval 6 --cache-dir /path/to/state
```

On GitHub Actions the runner starts empty, so the state directory has to be carried
between runs — cached or committed — or every run is a first run and reports nothing.
The [cron reference](../cron.md#scheduling-with-github-actions) has a complete
workflow that does this.

Refract spaces its requests to the MediaWiki API (100 ms apart by default) and retries
a 429 or 503 after the server's `Retry-After`.

## Step 4: Set up notifications

Notifications go out only when a page has new or resolved events.

### Slack

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."

refract cron watch-pages.txt --interval 24 --notify-slack
```

The message lists each changed page with its counts:

```
Refract observation report
2 page(s) changed since last observation.

COVID-19
3 new event(s), 0 resolved
Changes detected

mRNA_vaccine
5 new event(s), 1 resolved
Changes detected
```

### Email

```bash
export SMTP_TO="researcher@example.com"

refract cron watch-pages.txt --interval 24 --notify-email
```

Mail goes through the local `sendmail` (`/usr/sbin/sendmail`, or the path in
`SMTP_SENDMAIL`). There is no SMTP host, user or password setting.

### Webhook

```bash
refract cron watch-pages.txt --interval 24 --notify-webhook https://your-server.com/hooks/refract
```

Refract POSTs a JSON summary — per page, the new and resolved counts. The payload is
in the [cron reference](../cron.md#webhook).

## Step 5: Live polling with watch

For one page, as it changes:

```bash
refract watch "COVID-19" --interval 60000
```

Polls every 60 seconds (`--interval` is in milliseconds) and prints each new revision
with the events it produced, one `- <eventType> <detail>` line per event.
`--section "Vaccine safety"` limits section events to that section. The output is text
for people; a pipe can still pick lines out of it:

```bash
refract watch "COVID-19" | while read -r line; do
  case "$line" in
    *citation_removed*)
      echo "Citation removed from COVID-19: $line" | mail -s "Refract alert" researcher@example.com ;;
  esac
done
```

`watch` polls until stopped.

## Step 6: Get the events themselves

`cron` reports counts. For the events, run `analyze` over the same window with
`--json`, which prints one JSON event per line:

```bash
SINCE=$(date -u -d '25 hours ago' +%Y-%m-%dT%H:%M:%SZ)

# Citation removals — often the first sign a claim is about to change
refract analyze "COVID-19" --since "$SINCE" --json | jq -c 'select(.eventType == "citation_removed")'

# Template changes — dispute, neutrality and citation-needed tags
refract analyze "COVID-19" --since "$SINCE" --json | jq -c 'select(.eventType | startswith("template_"))'
```

The window opens an hour before the day it covers because the first revision inside a
`--since` window is not diffed against the one before it.

## Step 7: Integrate with your own alerts

```bash
while read -r page; do
  refract analyze "$page" --since "$SINCE" --json | while read -r event; do
    if [ "$(echo "$event" | jq -r '.eventType')" = "citation_removed" ]; then
      echo "ALERT: citation removed from $page / $(echo "$event" | jq -r '.section')"
      # Trigger your alerting pipeline
    fi
  done
done < watch-pages.txt
```

## Next steps

- [CLI cron reference](../cron.md) — all flags and environment variables
- [Citation churn tutorial](citation-churn.md) — interpreting citation patterns
- [Dispute timeline tutorial](dispute-timeline.md) — detecting edit wars
- [Downstream integration](../downstream.md) — production patterns for consuming events
