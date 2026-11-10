---
title: "A git log for Wikipedia"
template: splash
hero:
  tagline: "<p>Refract shows how a page's sentences, citations, and structure changed, revision by revision, with the source revisions behind each observation. It works on Wikipedia and any other MediaWiki wiki.</p><p>It runs locally under deterministic rules, with no API key or model. Your review process decides what the changes mean.</p>"
  actions:
    - text: "See a captured example"
      link: "demo/"
      icon: right-arrow
    - text: "Analyze a history"
      link: "quickstart/"
      variant: secondary
    - text: "Review a watchlist"
      link: "review/"
      variant: secondary
---

## Start with one change

On 24 August 2006, the International Astronomical Union reclassified Pluto as a dwarf planet. Wikipedia's Pluto article went through 43 revisions in under an hour that afternoon. This prints its first sentence from each of them:

```bash
npx @refract-org/cli@0.6.0 claim "Pluto" --text "ninth and smallest" --from 71593043 --to 71601937
```

The sentence starts at "Pluto is the ninth…" and passes through "Pluto was until recently considered the ninth…". The [captured walkthrough](https://github.com/refract-org/refract/blob/main/docs/example-output.md) links each change to its revisions.

For repeated review, [review a watchlist](../../../../../docs/review.md). Refract remembers the last revision you explicitly acknowledged.

## What you receive

<div class="features-grid not-content">
  <div class="feature-card">
    <h3>Changed text</h3>
    <p>Sentence observations include the wording before and after the transition.</p>
  </div>
  <div class="feature-card">
    <h3>Source changes</h3>
    <p>Citation events identify references added, removed, or replaced.</p>
  </div>
  <div class="feature-card">
    <h3>Revision context</h3>
    <p>Events carry revision identifiers, sections, timestamps, and analyzer provenance.</p>
  </div>
  <div class="feature-card">
    <h3>Repeatable observations</h3>
    <p>The same captured inputs, analyzer versions, and configuration produce the same observations. Export metadata can vary.</p>
  </div>
  <div class="feature-card">
    <h3>Files for your tools</h3>
    <p>Export NDJSON for a notebook, SQL query, browser viewer, or downstream review process.</p>
  </div>
  <div class="feature-card">
    <h3>Inspectable history</h3>
    <p>Follow the analyzed revision span. Hash verification checks record consistency; it does not establish complete coverage or authenticate a source.</p>
  </div>
</div>

## Choose a workflow

<div class="usecase-grid not-content">
  <div class="usecase-card">
    <h3>Review sources you revisit</h3>
    <p>Inspect pending changes since your last acknowledgment. Keep fetched progress separate from reviewed progress.</p>
    <div class="usecase-steps"><a href="review/">Source-build review guide</a></div>
  </div>
  <div class="usecase-card">
    <h3>Inspect an earlier record</h3>
    <p>Find a revision at or before a date, or compare a bounded span of revisions.</p>
    <div class="usecase-steps"><a href="quickstart/">Quick start</a> · <a href="cli/#refract-snapshot">Snapshot command</a></div>
  </div>
  <div class="usecase-card">
    <h3>Use changes as data</h3>
    <p>Select events such as removed citations and inspect their source context in your own tools.</p>
    <div class="usecase-steps"><a href="integrations/">Data integrations</a> · <a href="mcp/">MCP access</a></div>
  </div>
</div>

## Scope

<div class="split-columns not-content">
  <div class="column-card focus">
    <h4>Available revision histories</h4>
    <p>The CLI fetches Wikipedia and compatible MediaWiki histories. Library consumers can supply versioned text through the shared revision model.</p>
  </div>
  <div class="column-card out-of-scope">
    <h4>Observation limits</h4>
    <p>An arbitrary web URL does not supply a revision history. First observed means first in the analyzed range. Wording changes alone do not establish a dispute or whether a statement is supported.</p>
  </div>
</div>

## One repository, optional interfaces

| Interface | Use it for |
|-----------|------------|
| [CLI and libraries](sdk.md) | Fetch, compare, review, and export source histories; use the built-in explorer |
| [Browser viewer](visualizer.md) | Inspect an exported NDJSON event file locally |
| [Python adapter](python-sdk.md) | Call the CLI from notebooks and read events as dataclasses or DataFrames |

All three live in [the Refract repository](https://github.com/refract-org/refract). Event contracts and reproducible examples are maintained with the engine. The public [review](../../../../../docs/review.md) and [history-range](../../../../../docs/usage.md) pages are built directly from those core guides.

## License

The engine is AGPL-3.0. This site's original documentation is CC-BY-4.0; included core guides retain their source license. Built and maintained by [NextConsensus](https://nextconsensus.com).
