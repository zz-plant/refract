# Changelog

## Unreleased

### Changed
- **The docs site is built with Starlight.** `apps/docs` moves from a hand-written `build.mjs` to Astro 7 and Starlight 0.42, which add a light theme beside the dark one, full-text search with Pagefind, previous and next links, and an edit link on every page. All 55 pages keep their URLs, titles, descriptions, canonical links, Open Graph tags and JSON-LD; `sitemap.xml` now indexes Starlight's `sitemap-0.xml`. Pages live in `apps/docs/src/content/docs/` with their title and description as frontmatter. Links to the review and usage guides name `docs/review.md` and `docs/usage.md`, so they also work on GitHub.

### Fixed
- **Links to the docs site work again.** The repository moved to zz-plant/refract, and GitHub Pages now serves the site at https://zz-plant.github.io/refract/; the old refract-org.github.io address returns 404. The READMEs, package READMEs, `server.json`, the agent skill, the Python adapter and the URL `refract init` and `analyze` print all pointed there. So did the site's own canonical links, sitemap, Open Graph URLs and JSON-LD, which told search engines the pages lived at an address that serves nothing. Each public package's npm `homepage` is now the docs site.
- **Five links in the repository's guides went nowhere.** `SCHEMA_VERSIONING.md` linked `schema.md` and `downstream.md`, pages that live on the docs site, and `docs/README.md` and the claim-state timelines guide linked README sections that no longer exist (`#quick-start`, `#core-concepts`). They now point at the docs site's pages and at the README's Install and How it works sections, and `tests/markdown-links.test.ts` fails on a relative link to a missing file or heading anywhere outside `apps/`.
- **`publish.yml` waits for each package to reach installers before publishing the next.** During the 0.6.0 publish, `ingestion` 0.3.4 appeared on the registry before the `evidence-graph` 0.5.3 it requires, and a clean `npm install @refract-org/cli` failed with ETARGET until the two matched. Each new version must now appear in both forms of its packument that installers read. One that does not appear within 10 minutes counts as a failure and holds back the packages that depend on it. The job's time limit rises from 30 to 75 minutes to fit these waits.

## 0.6.0 (2026-11-04)

### Fixed
- **Sentence text no longer includes category tags.** `[[Category:X]]` was left in the stripped text, so its name joined the next sentence, as in `Category:IAU planet debate Pluto is…`. Events for affected sentences differ from earlier versions, and some rewrites near a category tag are now reported as `sentence_first_seen` rather than `sentence_modified`.
- **The browser explorer and `export --format html` work again.** An unescaped newline in the page's inline script stopped it parsing, so the event list stayed empty and the tabs and buttons did nothing. Published 0.5.17 has this bug. A new test parses the script.
- **Wiki text can no longer break out of those pages.** Event text is escaped where it is embedded in the inline script and in HTML attributes.

### Added
- **`refract claim` takes `--from` and `--to`.** With both, it reads the whole range; with one, the `--limit` default still applies.
- **Piped `analyze` output shows the changed wording** of sentence and citation events, not only `sentence_length=`.
- **`publish.yml` lists the server in the official MCP registry.** `server.json` now follows the registry's current schema. The tool list stays in the MCP server card.
- **A real example leads the README.** `docs/examples/pluto-events.ndjson` follows the first sentence of Wikipedia's Pluto article through 24 August 2006, from saved lead-only inputs. `scripts/capture-wiki-examples.ts`, which replaces `capture-bitcoin-example.ts`, checks the events and the README's quotes.
- **`packages/mcp/README.md`**, and a test that it lists each tool.
- `refract review`: source watchlists, saved fetched/reviewed revision cursors, resumable history fetching, and explicit acknowledgment of an inspected report.
- Markdown and JSON review reports with source identity, changed text, revision links, mechanical filters, saved inputs, and coverage. `review --sample` demonstrates the complete workflow offline.
- Optional revision parent and source-text availability metadata. Coverage reports missing inputs and avoids text comparisons across known gaps.
- **The docs site and the viewer are checked in CI.** Since #37 imported them into `apps/docs` and `apps/ui`, nothing ran their lint, tests or builds: their workflows sat under `apps/*/.github`, which GitHub does not read, and the root suite excludes `apps/`. `docs-site.yml` and `viewer.yml` now run each app's checks, path-filtered and separate from the engine gate. The viewer's also runs when `packages/evidence-graph` or `docs/examples` change.
- **The Python adapter is in this repository**, at `clients/python`, imported from refract-org/refract-py with its history. Install it with `pip install "git+https://github.com/refract-org/refract.git#subdirectory=clients/python"`. `python.yml` builds and installs its wheel on Python 3.10 and 3.12 and tests it against the CLI built from the same commit instead of the one on npm; `tests/test_engine_contract.py` parses the engine output in `docs/examples/` and fails when a flag the adapter passes is missing from the CLI's help.

- **The CLI reference and npm README list every command, and a test keeps them doing so.** `tests/cli-docs-contract.test.ts` fails when a command, flag, or MCP tool is missing from `apps/docs/docs/cli.md`, `packages/cli/README.md`, either MCP page, `server.json`, or the server card, or when those list something that does not exist. Writing it found `refract review` with no reference section, undocumented flags, a tool missing from each MCP page, and `explore --report`, which the command does not accept.
- **Which monitoring command to use.** `docs/usage.md` compares `review`, `cron`, `watch`, and `stream`; the CLI reference, cron guide, and monitoring tutorial link to it.
- **`refract --help` starts from questions** and links to the docs. `init` also points at `review`, `claim`, and `snapshot`. The README adds `claim` to its workflows and links the docs site from the top.
- **Recipes for sharing and checking a result**, covering `export --format html`, `export --proof`, and `verify --html`. The cross-wiki tutorial and CLI reference document `diff --detect-borrowing`, the Python README documents `refract_langchain` and `refract_eval`, and the install guide documents building the Docker image.
- **A logo, a favicon set, and a loading indicator, drawn from one diagram of a lens focusing rays onto a point.** `assets/brand/` holds the sources, `bun run assets:brand` renders the icons, and `tests/brand-assets.test.ts` fails when a copy falls behind. The viewer, docs site, and social card drop the solid triangle for them, and the README gains the logo.
- **The viewer shows progress while it reads a file.** A throbber appears when a file or the sample data takes longer than 150 ms, holds still under reduced motion, and keeps moving through a long parse, which now yields every 2,000 lines.

### Changed
- **One description everywhere: "git log for Wikipedia".** The README, docs site, CLI help, `init`, package metadata, MCP server metadata and agent skill now lead with it. The MCP description now fits the registry's 100-character limit.
- **The README is shorter and starts from the result.** It names who Refract is for and what it does not read. The architecture tree and project list left the README, and the STD-07 context moved to `docs/repositories.md`.
- **The roadmap covers current work only.** Completed-phase lists and the agent workstream table are gone.
- **Files moved:** `refract-analytics.sql` to `examples/`, and `benchmark/ground-truth/` to `benchmarks/ground-truth/`.
- **Removed:** `tmp-gen.ts`, a backup `opencode.json`, `.agent/`, `.opencode/`, the unused demo GIF and PNG, and the archived v0.3.x Bitcoin transcript.
- **`analyze` shows a throbber on a terminal while it fetches revisions.** The CLI's spinner existed, but nothing called it. Piped output and logs are unchanged.
- **The docs site moved to https://refract-org.github.io/refract/.** It is built and published from `apps/docs` by `docs-deploy.yml`, so a change to the engine and to its documentation can land in one PR. Every page under the old address, https://refract-org.github.io/refract-docs/, redirects to the same page at the new one, and the old images stay where they were. Canonical URLs, Open Graph tags and the sitemap use the new address, as do the "Next steps" that `refract analyze` prints and the package READMEs.
- **The apps use the monorepo's tooling.** Their own lockfiles (two `bun.lock`, one `package-lock.json`), `.husky` hooks, `mise.toml` and `prepare: husky` scripts are removed; the root lockfile, hook and toolchain cover them, and each app's `.lintstagedrc.json` still applies to its files. Their `package.json` repository and issue links point at this repository.

### Removed
- **The `*-favicon.png` and `*-touch-icon.png` files and the `favicon` asset scene.** The favicons were nearly blank, the touch icons were bad crops of other scenes, and nothing referenced them.
- **The root `SKILL.md`, `skills/refract/references/cli.md`, and `.github/actions/varia-action`.** `skills/refract/SKILL.md` is now the one agent skill: the two had diverged, and one listed event names renamed long ago and said `npx` was "coming". The action could not run: it points at a `dist/index.js` that was never committed and calls the CLI by its old name.

### Fixed
- **`analyze`'s "Next steps" never reached a terminal.** They printed only on the path that does not open the explorer, so only piped output had them. They now print after the explorer starts as well, and point at `review` rather than `cron`.
- **`refract classify` printed `undefined` and exited 0 for an unknown boundary**, and its help did not name the valid ones. It now rejects the name and lists the choices.
- **`--cache` told Node.js users to install a package that is not on npm.** Its help and error now say it needs Bun and a source checkout.
- **`docs/mcp.md` said private-wiki credentials could be passed on any tool call.** No MCP tool reads them; the page now says to use the CLI. It also listed `interval` and `api` on `cron`, which that tool does not take. `server.json` and the server card advertised `format` on `export`, and the card omitted `get_statement_history`.
- **`.env.example` listed `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`**, which the CLI stopped reading; it now lists the `REFRACT_OAUTH_*` names and the inference and `SMTP_SENDMAIL` settings.
- **`export --help` left out `html`**, and the cross-wiki tutorial showed JSON events and a `.jsonl` export that `refract diff` does not produce.
- **`pip install` of the Python adapter left out `refract_eval` and `refract_langchain`.** The wheel packaged only `src/refract`, so `from refract_langchain import RefractLoader` and `from refract_eval import …`, as the docs show them, failed everywhere but a checkout. Both modules are now in the wheel. The docs' notebook page named classes the adapter does not have (`RefractClient`, `RefractDocumentLoader`, three typed exceptions) and called `model_dump()` on its dataclasses; it uses `Refract`, `RefractLoader`, `RefractError` and `as_frame=True`.
- **The viewer's event types had drifted from the engine's.** `apps/ui` kept its own copy, which still listed `claim_first_seen`, `claim_softened` and the other `claim_*` names the engine renamed `sentence_*`, and lacked `edit_cluster_detected` and `talk_activity_spike`; timeline colours were keyed to the old names, so removed and modified sentences got none. It now imports `EventType` and `EvidenceEvent` from `@refract-org/evidence-graph` as types only — nothing from the engine is bundled — and its list of event types is a `Record<EventType, true>`, so the build fails when the engine adds or renames a type. Softened and strengthened wording is coloured from the event's `directionSignal`. A contract test imports, lists and re-exports the engine output in `docs/examples/` and an event of every type.
- Latest passage disappearance now reports absence from the latest fetched revision. Partial matches expose inspectable candidate text and uncertainty; unavailable latest text returns `unknown` through the CLI and MCP.
- Bounded analysis no longer mixes unrelated cached revisions into the selected range. Interactive analysis serves its captured inputs; the explorer accepts explicit bounds and shows coverage.
- **`refract verify --html` marked every event's proof "Merkle Root Match"**, including in a bundle that had failed verification. Each row now shows the verifier's result for that event's hash and for its proof, the page lists the checks that failed, and it states what `verify` checks and what it does not. The receipt and the command's output no longer say "cryptographically verified" or "integrity verified": nothing in a bundle is signed. Revision IDs read from the bundle are HTML-escaped like the other fields.
- **`refract mcp` answered notifications with "Method not found"**. A message with no `id`, such as the `notifications/initialized` every MCP client sends after `initialize`, got a -32601 error reply, which JSON-RPC 2.0 forbids. Both `refract mcp` and `@refract-org/mcp` now ignore notifications, including unknown ones, without writing anything back. An unknown request, one that has an `id`, still gets -32601; that now includes a request named `initialized`, which used to get no reply at all.
- **`--bundle` was described as a signed evidence bundle** in `refract export --help` and the CLI README. It carries a SHA-256 `bundleHash` of its own contents, which anyone who edits the bundle can recompute; nothing in Refract signs anything.
- **`refract cron --cache-dir` read and wrote outside the cache directory.** The analysis cron runs for each page recorded its own observation in `~/.wikihistory/observations/<page>.json` whatever `--cache-dir` said, and printed a "Re-observation delta" against that file: on a first run into an empty cache directory it could report dozens of new and resolved events from an unrelated earlier run, and it counted prior events outside the lookback window as resolved, which cron's own count does not. Cron now keeps the only observation, under its cache directory, and passes that directory to the analysis.
- **A page's first `refract cron` run printed a stack trace.** The report file that does not exist until the first run finishes was logged as a read failure, with the ENOENT and its full stack. `refract analyze --since` did the same for the observation file on its first run. A missing file is now silent; a file that exists but cannot be read or parsed is reported in one line naming the path and the reason.

### Security
- **Any website could read what the local explorer served.** `/api/events` and `/api/revisions` sent `Access-Control-Allow-Origin: *`, so while `refract explore` ran, or `refract analyze` had opened the explorer from a terminal, a page on any origin could read the events and revision text, including those fetched from a private wiki with `--api-key` or `--api-user`. The header is gone: the explorer's own page is same-origin and nothing else used it. The server also answers 403 on every route when `Host` is not `localhost` or `127.0.0.1`, which closes the same read through DNS rebinding. A reverse proxy that forwards another hostname must now rewrite `Host`.
- **`refract verify` passed bundles whose events or proofs had been changed.** `verifyVerificationBundle` checked only that a bundle agreed with itself: it never rehashed the events, never compared a proof's root with the manifest's, and did not require a proof per event hash. On a `refract export "Merkle tree" --proof` bundle, editing an event's text, its type or its `eventId`, reversing the events, deleting every proof, or replacing a proof with one that hashes to its own root all verified. An edited event also left the Merkle root unchanged, so comparing the root with one received separately did not catch it. `verifyVerificationBundle` (`@refract-org/evidence-graph` 0.5.3) now rehashes each event as `createReplayManifest` does and compares it with the hash listed at its index, requires an event that carries an `eventId` to hash to it, and requires one proof per listed hash, for that hash and index, ending at the manifest's root. Each failure names its index. Its result adds `events`, the hash and proof outcome per event, which the receipt's rows show. A bundle without an `events` or `proofs` array is reported instead of throwing. The event hash leaves out `layer`, `claimId`, `schemaVersion`, the semantic enrichment fields, fact provenance and source spans, and `modelInterpretation`, so edits to those still pass, and nothing in a bundle is signed. evidence-graph → 0.5.3, internal ranges moved to match.

## 0.5.17 (2026-09-26)

### Added
- **`refract verify` CLI command and verification HTML receipts.** `refract verify <bundle.json> [--html <receipt.html>]` recomputes a verification bundle's manifest hash, checks its Merkle root against the event hashes the manifest lists and its event count against them, and checks that each inclusion proof hashes to the root it records; `--html` also writes the result as a standalone HTML page. It does not rehash the events, and nothing in a bundle is signed. The release after 0.5.17 rehashes the events and checks each proof against the manifest's root.
- **Verification bundle export.** `refract export --proof` prints a verification bundle (JSON, `refract-verification-bundle/v1`) containing the page's replay manifest, its events, and a Merkle inclusion proof for each event hash.
- **Export CLI range filtering.** `refract export` now supports `--from <revId>`, `--to <revId>`, and `--since <timestamp>` filters matching `refract analyze`.

### Fixed
- **`hash-identity.ts` deterministic facts safety.** Safely handles optional `deterministicFacts` arrays in `createEventIdentity` without throwing on events where deterministic facts are omitted.
- **Package version alignment and dependency ranges.** Bumped `@refract-org/evidence-graph` to 0.5.2, `@refract-org/ingestion` to 0.3.3, `@refract-org/analyzers` to 0.5.2, and synchronized internal dependency ranges across `@refract-org/mcp`, `@refract-org/eval`, and `@refract-org/cli`.

## 0.5.16 (2026-09-25)

Nothing has reached npm since 0.5.7, and 0.5.7's CLI does not start: it declares `@refract-org/analyzers@^0.3.0` — 0.3.x only, under npm's rule for 0.x — and imports code that exists only in analyzers 0.5.0; forcing 0.5.0 fails on an ingestion export no published ingestion has. This release published the library packages; the CLI's own 0.5.16 publish did not complete, because `@refract-org/mcp` was not yet on npm. 0.5.17 is the first CLI to reach npm since 0.5.7, and it installs and runs.

### Added
- **Three more `RevisionSource` implementations, so Refract is no longer Wikipedia-only.** `GitRevisionSource` (`@refract-org/ingestion`) walks `git log --follow` for a file and yields each commit as a revision, which puts version-controlled documents — specs, statutes, markdown repos — on the same timeline as wiki pages. `SnapshotDirectorySource` ingests a directory of timestamped snapshot files, or an explicit list of snapshot records in memory, for archives that are versioned by capture time rather than by an API. `WaybackRevisionSource` queries the Internet Archive CDX server for a URL's captures and yields each snapshot as a revision, rate-limited at 250ms per request by default with the fetcher, the CDX URL and the archive base URL all injectable. All three implement the same `RevisionSource` interface the MediaWiki source does, so they compose with `sectionDiffer`, the event pipeline and everything else without a new code path.
- **Text propagation detection.** `detectTextPropagation` in `@refract-org/analyzers` compares two revisions by n-gram Jaccard similarity over token shingles (5 by default) and extracts the contiguous borrowed spans it finds (8 tokens minimum), flagging significant borrowing above a 0.15 similarity threshold. Boilerplate that passes as an edit is measurable rather than a judgement call.
- **Citation network analysis.** `analyzeCitationNetwork` in `@refract-org/analyzers` computes per-domain source counts, a Herfindahl concentration index, the top sources, and a diversity flag — how concentrated a page's sourcing is, which the per-citation tracker could not say.
- **Verification bundles.** `createVerificationBundle` and `verifyVerificationBundle` package a manifest (format `refract-replay-manifest/v1`, page title, analyzer versions, input revision hashes, output event hashes, generated-at timestamp) with its events and a Merkle proof per leaf, so a bundle can be re-checked later: `verifyVerificationBundle` recomputes the manifest hash and the Merkle root from the manifest's event hashes, compares the event count with them, and checks that each proof hashes to the root it records. It does not rehash the events themselves, so a pass shows the bundle is internally consistent, not that its events are unaltered; evidence-graph 0.5.3 adds those checks. `ReplayManifest` and `MerkleProof` are exported from `@refract-org/evidence-graph`.
- **The per-pair event pipeline is a library export.** `buildRevisionEvents(revisions, options)` in `@refract-org/analyzers` returns the structural, editorial-signal and sentence events `refract analyze` derives from each consecutive pair of revisions; `annotateEvents` adds the schema version and semantic fields the CLI's output carries. The CLI now calls both, so the two cannot drift. Consumers that copied the CLI's diff code, as NextConsensus's app did, can import it instead. Also exported: `parseContent`, `computeStructuralDiffs`, `detectEditorialSignals`, `findSectionForText`, `buildSectionCharMap` and the `ProtectionLogRecord` type. Output is unchanged: a history exercising every per-pair event type, run through the CLI's previous loop and through the export, gives byte-identical events at each depth.

### Changed
- **CLI output carries no emoji.** The Slack notification header is "Refract observation report" (was "🔭 Refract Observation Report") and its per-page status lines drop their emoji; `refract stream` prints `new` or `edit` where it printed an emoji; `refract init` drops its boxed banner and no longer calls a failed fetch "offline mode".

### Fixed
- **Release pipeline would have shipped another CLI that cannot install or start.** evidence-graph 0.5.0, ingestion 0.3.1 and eval 0.2.1 carried source changes under versions already on npm, which `publish.yml` skips, while the CLI built against that source would have been published; and the CLI depends on `@refract-org/mcp`, which `publish.yml` never published. `scripts/check-release.ts` (`bun run check:release`) now fails on an internal range that is not `^` + the sibling's version, a published package depending on a private one, a version already on npm whose `src/` differs from this tree (`--registry`), a CLI that stamps a different version than it ships as, and a pack-install-run of every package that does not start `refract --version` (`--pack`). CI runs `--pack`; `publish.yml` runs `--registry --pack` and publishes in the order the script prints, `@refract-org/mcp` included. evidence-graph → 0.5.1, ingestion → 0.3.2, eval → 0.2.2, internal ranges moved to match.
- **Publishing authentication.** v0.5.15 failed `ENEEDAUTH`: npm 10, bundled with Node 22, has no OIDC login, and no `NPM_TOKEN` was set. `publish.yml` installs npm ≥ 11.5.1 first, so trusted publishing works once it is configured for each package on npmjs.com; a token still works.
- **Docker image** is built from the tagged checkout. It ran `bun install -g @refract-org/cli`, which raced the npm publish on the same tag and installed 0.5.7.
- **Version stamps.** `--version`, the MCP handshake, and the analyzer version recorded in every analysis and replay manifest said 0.5.14 while the package was 0.5.15. One constant, `packages/cli/src/version.ts`, checked against `package.json` and bumped by `scripts/release.ts` together with `server.json`.
- **`refract cron` never reported a new event.** It read the prior observation after `analyze --since` had overwritten it with the current events, so it diffed each run against itself; with `--cache-dir` it read a directory nothing wrote, so every run was "baseline established". It now reads the prior observation first and writes its own, keeps it through a run that found nothing so the next run keeps its anchor, and counts as resolved only prior events inside the current window.
- **Oldest revisions instead of latest.** `claim`, `watch`, `snapshot`, `analyze --depth brief` and talk-page correlation fetched `direction: "newer"` with a limit, which is a page's first N revisions: current claims read as absent, a watch never saw a new edit, and a brief look at a live page reported the year it was created. They read the latest revisions (a snapshot, those at or before its date).
- **`refract claim` put text under the wrong heading** when a heading directly followed another, as a subsection under its section does: the heading regex kept its global flag, so matching one line made it skip the next. The text was attributed to the outer section. `findSectionForText` now matches every heading line.
- **`refract watch` exited after one poll**: early returns in the poll skipped the reschedule.
- **`export --format ndjson` with no events** printed "No events to export." to stdout, which became the first line of the file it was redirected to. It goes to stderr.
- **MediaWiki client (`@refract-org/ingestion`).** An API error in an HTTP 200 body — `maxlag`, `ratelimited`, a bad continuation — ended pagination and returned the pages read so far as though they were the whole history; `maxlag`/`ratelimited`/`readonly` are now retried after the server's Retry-After and anything else throws `MediaWikiApiError`. An HTTP-date `Retry-After` parsed to no wait; it is read, and honoured on 503 as well as 429 (capped at 60s). Dropped connections and timeouts are retried like a 503. A limit is no longer overshot by most of a page. The protection log asked only for `details`, so every entry came back without id, title, timestamp, comment or action; it asks for all of them and reads the level from `details`. New `maxlag` option; `MediaWikiApiError`, `retryAfterMs` and `DEFAULT_USER_AGENT` are exported.

### Security
- **Heading and citation parsing took super-linear time on hostile text.** The heading patterns in `sectionDiffer.extractSections`, `buildSectionCharMap` and `findSectionForText`, all of which `refract analyze` runs on every revision, and in `extractHeadingMap` (behind `deriveSectionHeading`) and `refract snapshot` let the spaces on a line be split between three quantifiers. One line of `=` and a few thousand spaces took minutes (four at 8,000 characters). `citationTracker.extractCitations` re-read the rest of the text from every `<ref` whose tag did not close, which is quadratic in the number of openers, and its title pattern was cubic in a run of whitespace. So a single vandalized or crafted revision could stall an analysis. All of them now run in linear time. Section and citation extraction return exactly what the patterns did: 30,000 generated documents gave identical citations, and the event pipeline's output is byte-identical. `extractHeadingMap` no longer joins a heading across two lines, which the old pattern did because `\s` matched newlines; `refract snapshot` no longer prints a line of only `=` and whitespace as a section named `=`.
- **Client-credential variables are namespaced**: `REFRACT_OAUTH_CLIENT_ID` / `REFRACT_OAUTH_CLIENT_SECRET`. Under the generic `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` they were read whenever set — as they often are on CI runners, for other tools — and sent as headers to whatever wiki was queried, English Wikipedia when `--api` was not given.

### Docs
- **MCP client configuration** used `npx refract mcp`, which runs the unscoped npm package `refract`, an unrelated project. It is `npx -y @refract-org/cli mcp`.
- **README**: npm status; page URLs are not parsed, so examples use titles; `--json` prints one event per line; a Worker imports the libraries and cannot run the CLI; `@refract-org/mcp` listed. `COMPATIBILITY.md`, `SCHEMA_VERSIONING.md` and `docs/refract-and-nextconsensus.md` describe the current versions and how NextConsensus consumes the packages.

## 0.5.15 (2026-08-27)

### Added
- **Benchmark ground-truth corpus**: 15,926 hash-pinned events across the ten benchmark pages, published as a release asset with an in-repo manifest (`BENCHMARK.md#ground-truth-corpus`).

### Fixed
- **Windowed analyses leaked the full page-move log**: a `--since` window opened with `page_moved` events from the page's earliest history. Moves are now bounded to the analyzed revision span (`windowPageMoves`).
- **Scheduled observation**: observes a trailing 30-day window instead of replaying full history daily, which had outgrown any fixed heap.
- **Publish pipeline**: the gate ran `bun test` (not the vitest suite) and hung in CI until GitHub's 6-hour timeout — every publish since v0.5.7 died this way or on duplicate-version PUTs. The workflow now runs the real suite, times out in 30 minutes, and skips already-published versions.

## 0.5.14 (2026-07-29)

**schema:** `EVENT_SCHEMA_VERSION "0.5.0"`.

### Added
- **Fact provenance, Merkle roots, and statement history MCP**: deterministic claim-state timelines with `sourceSpan` pointer tracing and verifiable provenance blocks.
- **Enriched evidence schema**: `sourceSpan` optional field on `FactProvenance`, `DeterministicFact`, and `QuantitativeFinding` for precise document-range references.

### Fixed
- **Scheduled observation workflow**: repaired to build from source and actually publish packages.

## 0.5.13 (2026-05-31)

### Added
- Standard opencode modes (`deploy`, `refactor`, `review`) and `.opencode/` build/check commands.
- Demo asset updates.

### Changed
- README positioning sharpened with GTM-informed one-liner and value statement.
- Boundary documentation refined with temporal framing and out-of-scope specifics.
- Claim-state timelines concept documented.

### Fixed
- Removed nonexistent `refract-labs` from CI downstream configuration.
- Added tooling patterns to `.gitignore`.

## 0.5.12 (2026-05-25)

### Changed
- Bumped CLI to `0.5.12`.
- Publish workflow now continues past already-published packages.

## 0.5.11 (2026-05-25)

### Changed
- Bumped CLI to `0.5.11`.

### Fixed
- Trusted Publishing OIDC: added `setup-node@v4` for npm 10+ support and debugged OIDC env vars in publish workflow.

## 0.5.10 (2026-05-25)

### Changed
- Bumped CLI to `0.5.10`.
- Switched package publish workflow to npm for Trusted Publishing OIDC.

## 0.5.9 (2026-05-24)

### Added
- Regenerated graphical assets with retina scaling; added email, blur, circle, and topology scene assets.
- Added CLI and package-registry card assets.

### Fixed
- Favicons regenerated as proper 32px squares.
- Card assets rebuilt with correct ffmpeg scaling.

## 0.5.8 (2026-05-23)

### Changed
- Bumped CLI to `0.5.8` with analyzers dependency resolution fix.
- Publish workflow allowed to proceed despite test failures while CI is hardened.

### Added
- CodeQL security analysis workflow.
- Dependency review and stale issue workflows.
- Husky pre-commit hooks with lint-staged.
- `mise.toml` for Bun/Node version pinning.

### Fixed
- Labs examples updated to current L1/L2 terminology.

## 0.5.7 (2026-05-18)

### Added
- AI model evaluation toolkit: benchmark harness, eval adapter, dataset script, and leaderboard with template submission.
- Streaming adapter and snapshot command for live and point-in-time observation.
- Init onboarding command for first-time users.
- Cross-repo CI trigger for downstream repositories.
- Scheduled observation workflow that builds from source.

## 0.5.6 (2026-05-16)

### Changed
- Bumped `evidence-graph` to `0.4.4` and CLI to `0.5.6`.

### Added
- `--format parquet` on `refract export`.
- `editorCount` on `edit_cluster_detected`, `uniqueEditorCount` on `ObservationReport`, and `UserMetadata` for heuristic classification.

### Fixed
- Progress output redirected to `stderr`, parquet CJS interop fixed, lint clean.

## 0.5.5 (2026-05-15)

### Changed
- Moved SVG assets to `refract-docs`; updated README and ARCHITECTURE to link to docs-site versions.

## 0.5.4 (2026-07-18)

### Removed
- **PayerPolicySource from `@refract-org/ingestion`**: Healthcare-specific payer/coverage policy ingestion logic removed to enforce domain-neutral boundary. This adapter (CoverageDecision, PolicyDocument, PayerPolicySource) has moved to NextConsensus's private evidence-ingest adapters (`@nextconsensus/evidence-ingest/adapters/payer-policy.ts`). Refract remains strictly domain-neutral; all healthcare-specific source adapters belong in downstream applications.

## 0.5.3 (2026-05-15)

### Added
- **Slack Block Kit notifications**: Rich-formatted Slack messages with header, page breakdown, emoji indicators (⚠️/✅), and context footer. `sendSlackNotification` now posts `{"blocks": [...]}` instead of `{"text": "..."}`.
- **GitHub Actions observe workflow**: `.github/workflows/observe.yml` — daily scheduled observation of configurable page titles, auto-commits results.
- **LangChain document loader**: `refract-py/src/refract_langchain.py` — loads events as `Document` objects with stability metadata for provenance-aware RAG.
- **Marimo notebook template**: `docs/notebooks.md` updated with Altair-based analysis template.
- **`.github/workflows/observe.yml`**: reusable scheduled observation workflow.

### Fixed
- CLI `--version` now reports `0.5.3` (was stuck at `0.5.1` in index.ts)

## 0.5.2 (2026-05-15)

### Fixed
- **Boundary check script**: regex patterns updated from `@var-ia/` to `@refract-org/` — architectural boundary enforcement was silently non-functional since the rename
- **Inter-package dependency ranges**: CLI, analyzers, ingestion, and eval all updated caret ranges to match actual published versions (e.g., `evidence-graph ^0.2.2` → `^0.4.0`)
- **CITATION.cff**: stale `var-ia/var-ia` URL and version `0.2.1` fixed to `refract-org/refract` and `0.5.1`
- **SUPPORT.md**: stale `nextconsensus/var-ia` discussion/issue URLs fixed to `refract-org/refract`

## 0.5.1 (2026-05-15)

**schema:** `EVENT_SCHEMA_VERSION "0.5.0"`. No `EventType` changes. Added `EVENT_SCHEMA_VERSION` constant and `CLAIM_IDENTITY_VERSION` constant to package exports.

### Added
- `--json` flag on `analyze` command to force JSON output (disable interactive web UI)
- Auto-launch web UI when `refract analyze` is run in an interactive terminal
- `runExplore` now supports `useCache`, `depth`, `since` parameters
- `scripts/verify-mcp.sh` — MCP connectivity verification script

### Changed
- Empty events response now shows "No events detected" instead of raw JSON
- Explorer server waits for port assignment before printing URL (supports random port allocation)

## 0.4.0 / 0.5.0 (2026-05-15)

**schema:** `EVENT_SCHEMA_VERSION "0.4.0"`. Added `sentence_modified` to `EventType` union. Added `parameters` to `FactProvenance` interface. Added `AnalyzerConfig` type. Added `$version` to `AnalyzerConfig`. Added `CLAIM_IDENTITY_VERSION "claimidentityv1"`.

### Added
- **BYO-inference boundaries**: typed interfaces for 5 judgment points (revert, similarity, heuristic, template, spike) with `buildInferencePrompt()` and `parseInferenceResponse()`
- **`refract classify`**: CLI command for single-boundary model calls
- **MCP `classify` tool**: accepts boundary + input, uses MCP sampling or OpenAI-compatible provider
- **OpenAICompatibleProvider**: works with OpenAI, DeepSeek, Ollama, any `/chat/completions` endpoint
- **`--config`, `--similarity`, `--report`** flags on `analyze` and `export` commands
- **Config version pinning**: `config.$version` recorded on every event set
- **ObservationReport**: structured output with claim lifecycle and Merkle root
- **On-revision integrity**: every event stamped with `schemaVersion` at generation time

## 0.3.1 (2026-05-15)

### Removed
- **@refract-org/interpreter** package deleted — L2 model interpretation moved to NextConsensus
- CLI `--model`, `--model-api-key`, `--model-name`, `--model-endpoint`, `--temperature`, `--prompt`, `--router` flags removed
- Old claim direction event types (`claim_softened`, `claim_strengthened`, `claim_reworded`, `claim_moved`) replaced with mechanical sentence events
- Architecture boundary check scripts cleaned up (no longer checks deleted interpreter package)

### Added
- **@refract-org/evidence-graph**: `buildInterpretationPrompt()`, `parseInterpretationResponse()`, `ModelInterpretationSchema` — format pipeline for bring-your-own-inference
- **MCP server**: `interpret` tool with host-sampling support — requests host LLM via `sampling/createMessage`, no API key management
- **`--format html`** on `wikihistory export` — self-contained interactive report
- **Docker**: GHCR publish workflow (`ghcr.io/refract-org/cli`)

### Fixed
- `@refract-org/persistence` removed from hard CLI deps — `npx @refract-org/cli` no longer fails to install
- `@refract-org/persistence` lazy-imported at runtime; `--cache` requires explicit install
- `wikihistory explore` `--no-open` now actually suppresses browser open (not just the log message)
- `docs/recipes.md` claim tracking example now shows `wikihistory claim` not `wikihistory cron`
- `.env.example` no longer references removed model provider API keys

## 0.3.0 (2026-05-15)

### New L1 analyzers

- **Edit cluster detection** — `detectEditClusters()` groups 3+ rapid edits within a configurable time window. Produces `edit_cluster_detected` events.
- **Talk activity spike detection** — `detectTalkActivitySpikes()` flags anomalous talk page activity (3x moving average). Produces `talk_activity_spike` events.
- **Wikidata entity mapping** — `fetchWikidataId()`, `mapPageToEntity()`, `mapPagesToEntities()` for page-to-Q-ID lookups, entity data, and claim extraction.

### New CLI commands

- **`wikihistory explore <page>`** — starts a local HTTP web server with an interactive timeline, evidence table, diff viewer, and summary view.

### Model adapters hardened

- All 5 adapters (OpenAI, Anthropic, DeepSeek, Ollama, BYOK) now support `timeoutMs` (default 120s) and `maxTokens` (default 4096) configuration.
- Fetch calls use `AbortSignal.timeout()` for deterministic timeouts.
- Interpreter barrel (`index.ts`) split: 381-line file → 6 dedicated adapter files in `adapters/`.
- Removed dead exports (`CalibratedAdapter`, `CascadingRouter`).

### Infrastructure

- **CI pinned to bun 1.2.x** — reproducible builds.
- **Architecture boundary check** — `scripts/check-boundaries.ts` prevents L1→interpreter and L2→ingestion imports, enforced in CI.
- **`.env.example`** added with expected environment variables.
- **Public `@refract-org/eval`** — package made public with full exports, README, and benchmark fixtures (25 seeded labels across 5 pages).

### Documentation

- `docs/events.md` — full event taxonomy with triggers and examples (all 29 event types).
- `docs/naming.md` — explains Refract/var-ia/@refract-org/wikihistory split.
- `docs/mcp.md` — MCP tool reference with connection configs.
- `docs/security.md` — credential exposure, local cache, L2 data flow.
- `docs/recipes.md` — example JSON output added to claim, cron, and diff recipes.
- L2 invariant now reads "never receives full revision wikitext" (was "never sees raw Wikipedia text").

### Bug fixes

- `_toRevId` renamed to `toRevId` (underscore was misleading — parameter IS used).
- `stripWikitext` moved from CLI `claim.ts` to `analyzers/wikitext-parser.ts` (removed duplicate).
- `ReportLayerLabel` consolidated as alias of `EvidenceLayer`.
- Dueling `ExpectedInterpretation` types in eval renamed to `L2ExpectedInterpretation`.
- Stale dist test files cleaned (compiled `__tests__/` in dist were being run by vitest).

## 0.2.1 (2026-05-13)

### Examples (new)

Six migration-audience tutorial scripts covering claim provenance, WikiWho
equivalent, ORES equivalent, from-scratch migration, Wikidata editorial depth,
and L2 custom adapter deep dive. See `examples/README.md`.

Dual-licensed: CC0-1.0 (scripts) + AGPL-3.0 (everything else).

### L1-02: Talk Page Correlation

New `correlateTalkRevisions()` analyzer matches article revision timestamps to
nearby talk page revision timestamps (configurable window, default 7 days before
to 3 days after). Produces `talk_page_correlated` events. Integrated into the
analyze command pipeline.

### L1-07: Re-Observation / Temporal Diff

New `--since <iso-timestamp>` flag for the `analyze` command. Fetches only
revisions after the given timestamp and diffs the event stream against the prior
observation (persisted to `~/.wikihistory/observations/`). Shows delta of new,
resolved, and unchanged events.

### L1-08: Talk Page Section Extractor

New `parseTalkThreads()` function extracts threaded discussion structure (sections,
replies, participants, timestamps, resolved status). New event types:
`talk_thread_opened`, `talk_thread_archived`, `talk_reply_added`.

### L1-09: Template Parameter Differ

Extended `template-tracker.ts` with `diffTemplateParams()` and
`buildParamChangeEvents()`. Diffs parameter key-value pairs on templates present
in both revisions. New event type: `template_parameter_changed`.

### L2-01: Talk Page Interpretation

Added `discussionType` field to `ModelInterpretation`. Extended default system
prompt with talk page discussion type taxonomy (notability_challenge,
sourcing_dispute, neutrality_concern, content_deletion, content_addition,
naming_dispute, procedural, other). Model receives only L1-extracted
deterministic facts — never raw wikitext.

### INFRA-01: Real L3 Eval with Ground Truth

New `OutcomeLabel` type and `validateAgainstGroundTruth()` function. Ground
truth dataset of 5 manually curated labels covering RFC closures, talk page
consensus, and page protection events. New `--ground-truth builtin | <path>`
flag for `wikihistory eval`. CLI validates pipeline signal against independent
outcome labels.

### Test Coverage (expanded from 12 files to 20)

New test files:
- heuristic-classifier, wikitext-parser, protection-tracker, revert-detector — 0→full coverage
- rate-limiter, mediawiki-client (mocked) — 0→full coverage
- adapter (createAdapter, parseInterpretations, ConsensusAdapter) — 0→full coverage
- eval harness (evaluate, benchmarkPages, computeScores) — 0→full coverage
- persistence (all 7 methods via bun:sqlite mock) — 0→full coverage
- claim-utils (stripWikitext, fuzzyFindClaim, findSectionForText) — 0→full coverage
- parseFlag — 0→full coverage

Extended existing tests:
- section-differ: added extractSections + diffSections (was buildSectionLineage-only)
- template-tracker: added extractTemplates + diffTemplates (was param-differ-only)
- hash-identity: added createEventIdentity (was createClaimIdentity-only)
- replay-manifest: created (was 0 tests)

Total: 41 test files, 602 tests passing.

## 0.1.0 (2025-01-01)

Initial release.

### Packages

- `@refract-org/evidence-graph` 0.2.0 — core types and schemas
- `@refract-org/ingestion` 0.2.0 — Wikimedia API adapters
- `@refract-org/analyzers` 0.2.0 — deterministic analyzers
- `@refract-org/interpreter` 0.1.0 — model adapter interface
- `@refract-org/cli` 0.3.0 — CLI tool
- `@refract-org/persistence` 0.1.0 — SQLite persistence
- `@refract-org/eval` 0.1.0 — evaluation harness

## 0.5.0 — Semantic Enrichment (2026-05-18)

### Added
- 6 new deterministic fields on every `EvidenceEvent`: `editMagnitude`, `contentChange`, `keyTerms`, `certaintyProfile`, `directionSignal`, `quantitativeFindings`
- New types: `EditMagnitude`, `ContentChange`, `CertaintyProfile`, `DirectionSignal`, `QuantitativeFinding`
- `semantic-enrichment.ts` analyzer: `computeCertaintyProfile()`, `computeDirectionSignal()`, `computeEditMagnitude()`, `computeContentChange()`, `extractKeyTerms()`, `extractQuantitativeFindings()`
- All fields are deterministic — no model, no API, byte-reproducible on every run

### Design
- Fields that require domain knowledge (e.g., "is this a safety edit?") belong in downstream consumers
- Fields that are pure text analysis (e.g., "how long is this edit?") belong in refract
- This preserves the two-knowledge-split: refract observes, consumers interpret
