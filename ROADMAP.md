# Roadmap

Core revision analyzers are available. Current product work focuses on repeatable source review with inspectable observations.

## Source review workflow

Shipped in 0.6.0, first published to npm as 0.6.1:

- `review`: watchlists, separate fetched/reviewed cursors, resumable inputs, and acknowledgment of saved reports.
- Markdown and JSON reports with full changed text, source links, filters, and coverage.
- Shared captured analysis in the explorer and consistent bounded cache selection.
- Latest-revision passage status, candidate text, and explicit matching uncertainty through CLI and MCP.

[Workflow and fit assessment](./docs/review.md) · [Acceptance record](./.github/workqueue/CLI-REVIEW-01.md)

Real-user fit remains to be assessed with repeated reviews of sources people already depend on. The offline fixture and automated checks demonstrate implementation behavior. If you revisit a set of wiki pages, [tell us how it goes](https://github.com/refract-org/refract/discussions).

## What Refract Observes

Refract works on any MediaWiki wiki. The `--api` flag accepts any
`api.php` endpoint — Wikipedia, Fandom.com wikis, independent fan wikis, any
public MediaWiki instance. Revision history, diffs, talk pages, page moves,
categories, wikilinks — all extracted deterministically from the API response,
byte-for-byte reproducible.

Fandom wikis are the hardest public-domain stress test for the architecture:

**Canon disputes.** Multiple official canons coexist — Star Wars Legends vs.
Disney canon, DC Rebirth vs. New 52. Edits change which reality a page describes.
Tracking claims across revisions and correlating with talk page
discussions about sourcing reveals which canon an edit aligns with.

**Warring wikis.** The same topic has competing wikis — a Game of Thrones wiki
on Fandom.com vs. an independent Song of Ice and Fire wiki. Editors split and
fork. Cross-wiki diff distinguishes a fork event from parallel
independent development.

**Headcanon drift.** A contributor's personal interpretation seeps into article
text. Another editor reverts it citing no source. But "source" itself is
contested: is an author tweet canon? The revert detector fires, but the talk
page reveals the dispute is about what constitutes a source.

**Doctrinal edit wars.** "Darth Vader turned because of fear of loss" vs.
"...because of pride and ambition" — both supported by the same films, both
contradictory. The revision history shows back-and-forth edits; the talk page
reveals it's a dispute about character interpretation. Talk page correlation
surfaces the pattern.

**Time-deep.** 15+ year revision histories, decade-spanning talk page archives.
A 2008 consensus about what's canon gets overturned in 2023. Outcome labels
must carry temporal validity windows — a label that was correct in
2015 may be incomplete today.

Wikipedia's editorial norms suppress most of these dynamics. Fandom wikis don't.
That makes them the proving ground — if the engine handles fandom, it handles
anything.

## Shipped work

Released changes are in the [changelog](./CHANGELOG.md). See [COMPATIBILITY.md](./COMPATIBILITY.md) for the version matrix.
