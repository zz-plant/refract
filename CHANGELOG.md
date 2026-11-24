# Changelog

## Unreleased

### Added
- **`refract field` names the revision before each change.** A `FieldChange` carried the revision that changed a value and nothing about the one before it. A value already present on the first revision read came back as `added`, like one added later, and a caller could not tell which. Each change now carries `previousRevisionId`, `previousTimestamp` and `adjacent`, as `refract claim`'s transitions do. They name the fetched revision with readable text before it, and whether that revision is its parent. The first revision read has no `previousRevisionId`. The text report marks a change whose prior revision is not its parent `(not adjacent)`.
- **`findRevertedStates` catches damage repaired by hand.** It matched `sha1` only, so a state put back by hand, which matches no earlier text, read as one that survived: on 13 October 2004 a third of Anarchism was deleted and restored four minutes later, 42 bytes short. A size change of 30% or more from a surviving state, followed within the window by a revision within 1% of the size before it, now marks the revisions in between as reverted states (`nearRestorations`, on by default). Over Pluto, Anarchism, Stoicism and Mutualism (economic theory), 35,957 revisions, it adds 11 states to the 9,063 the exact rule finds. Two of the 11, on Anarchism in January 2003, are ordinary edits that ended the window within 1% of where a large change began; that, and a large edit undone by hand and then redone, is what the rule costs, and `{ nearRestorations: false }` keeps the exact rule alone. Pluto's October 2021 paste-over, which prompted this, was already caught: its hand repair restored 14 October's text byte for byte, 35.6 hours after the first undone state. `fetchLongitudinalHistory` and `selectLongitudinalRevisions` take the option through `excludeRevertedStates: { nearRestorations }`, and `coverage.revertedStateNearRestorations` says whether it applied. `findRevertedStates`' second argument may be `{ windowHours, nearRestorations }`; a number is still the window.
- **`timeCoverage` spreads a longitudinal sample over time.** Once a page had more months than the sample had anchors, `selectLongitudinalRevisions` spaced the anchors by position in the history, so busy years took the sample: with `fetchLongitudinalHistory`'s defaults and 60 revisions, Anarchism (20,435 revisions) got 24 in 2005 and none in 10 of its 26 years, 2022–2025 among them; at 120, five years had none. `timeCoverage: 0.75` spends that share of the budget on checkpoints evenly spaced from the first revision to the last, each the last surviving revision at or before it, and the rest on the largest structural changes. Every year then has at least one, and 2005 has 13. `selectLongitudinalRevisions` and `fetchLongitudinalHistory` both take it; unset, the selection is unchanged.
- **`yearlyPressure(metadata, { talkTimestamps, protections, revertedStates? })`** counts, per calendar year: edits, how many were reverted states and their share, talk-page edits, protections, and protections whose comment names a content dispute. `computeFullHistoryTelemetry` reports months and reads only the article's history. A year without activity is a row of zeros, and `revertedShare` is null in a year without edits.
- **Protection log entries carry a reason category.** `ProtectionLogEvent.reasonCategory` is `content_dispute`, `vandalism`, `disruption`, `sockpuppetry`, `sourcing` or `other`, from the policy page the comment links (`[[WP:PP#Content disputes|…]]`, `[[WP:Vandalism|…]]`, `[[WP:Disruptive editing|…]]`, `[[WP:Sock puppetry|…]]`, `[[WP:INTREF|…]]`, `[[WP:Verifiability|…]]`) or else its wording. Of the 94 entries in the logs of Pluto, Anarchism and Cultural Marxism conspiracy theory, 17 are `content_dispute`, 17 `vandalism`, 10 `disruption`, 5 `sockpuppetry`, 1 `sourcing` and 44 `other`. It is a category of what the administrator wrote, not a finding about the page. `protection_changed` events from the log carry it and the level as `protection_reason` and `protection_level` facts, so those events' `eventId`s change.
- **`MediaWikiClient.resolveTitle`, `fetchSections` and `revisionAt`.** Callers made these requests themselves, outside the client's Retry-After retries and rate limit; ism.wiki wrote its own fetch wrapper for them. `resolveTitle(title)` follows redirects to `{ pageId, title, ns }`, or null for a missing page or invalid title. `fetchSections(revIds, section)` reads one section of up to 50 revisions a request (`rvsection`) into a `Map` from revision ID to text; a revision without the section, which MediaWiki flags `nosuchsection` without failing the batch, has no entry. `revisionAt(title, isoDateTime, { around = 10 })` returns the revision live at that moment and up to `around` revisions either side, with `sha1` and size. Four MediaWiki API contract tests, run under `REFRACT_TEST_LIVE=1`, cover them and the protection log's levels.
- **`claimHistory(revisions, text, { page })` in `@refract-org/analyzers` (#98).** The passage matching and state machine behind `refract claim` lived in the CLI package, which imports Node-only modules, so a Worker could not follow a passage. They move to analyzers with no I/O: the function takes revisions and returns the same `ClaimHistoryResult`, with the same `transitions`. `runClaimHistory` now fetches and calls it, so `refract claim` (text and `--json`) and the MCP `get_statement_history` tool return what they did. `findPassageMatch`, `nearestPassage` and the `ClaimHistoryResult`, `ClaimTransition` and `ClaimHistoryVariant` types are exported from analyzers. A test walks the package entry's runtime imports, evidence-graph's included, and fails on `node:fs`, `child_process`, `bun:` or the ingestion, CLI, persistence and eval packages.
- **`locateChange(candidates, isNew, fetchLeads, { k = 8 })` finds the edit that made a change between two samples (#97).** Given the revision IDs between two sampled revisions, oldest first with reverted states removed, it reads `k` evenly spaced candidates per call to the injected batch fetcher, narrows the range (k+1)-fold, and returns the first candidate for which `isNew` holds, with the candidate before it and the reads it took; 300 candidates take three reads. It assumes the change happens once inside the bracket. `sameWording(a, b, { lang, threshold = 0.8 })` is the test to give it: each phrase must share 80% of its content words with the other, where a one-sided test read "is a planet" as matching "is a dwarf planet". `locateTransitions(result, { between, fetchTexts })` narrows each non-adjacent transition of a passage history to the edit that made it, as `located`; for a rewording it looks for the new version's text, not for the old one's end, which on ism.wiki landed on intermediate drafts.
- **`refract claim --sample <n> --locate`.** Fifty consecutive revisions cover days on a busy page and leave nothing between them to find. `--sample` reads `n` revisions spread across the history, or the `--from`/`--to` range, as `fetchLongitudinalHistory` selects them with reverted states left out; `--locate` reads the revisions inside each transition's bracket, drops the states a later edit in it reverted (`findRevertedStates`), and adds `located` (`revisionId`, `timestamp`, `previousRevisionId`, `requests`) to the transition, and `made by rev N (…), after rev M` to its text line. Neither is offered with `--pages-file`, `--dump` or `--wayback`, and `--sample` is not combined with `--limit`. Without them the output is unchanged.
- **`snapshotAt({ revisionsAround, fetchContent }, title, date, { scope, section, excludeRevertedStates, around })` (#99).** What a page said at the end of a date, as a library function that reads through the two functions it is given. It reads `around` (10) revisions on each side of the cutoff with their `sha1`, picks the latest at or before it, and steps back past a reverted state, a revision a later edit undid by restoring the text before it within 48 hours (`revertedStates` takes another rule, such as ingestion's `findRevertedStates`). It returns the revision, its timestamp, the revisions it `skipped`, the one that `restoredBy` put the text back, the wikitext, and the `lead`, one `section` (with its subsections, found by its heading in that revision) or the `full` page as prose. Null when no revision existed yet.
- **`definitionalSentence(wikitext, title, { lang })` and `definitionHead(sentence, { lang })` (#100).** The sentence of a lead that defines its subject: the first that names the subject before its copula, so "There are many types and traditions of anarchism" is passed over. The subject may follow an article or opening phrase ("L'anarchisme … est", "Unter dem Begriff Konjunktur versteht man"), and in German, Spanish and French it may follow the verb by up to three words. The head is the dozen words after the copula, lowercased, without parentheticals or punctuation. Copulas (`DEFINITION_COPULAS`) cover English ("is/was/are/were/refers to/describes/denotes"), German ("ist/war/sind/waren/bezeichnet/bezeichnet man/versteht man"), Spanish ("es/fue/son/era/se denomina/se llama") and French ("est/était/sont/désigne/on appelle"); `copulas` supplies a list for another edition. Tested on trimmed leads of Anarchism, Anarchismus, Anarquismo, Anarchisme and Konjunktur.
- **`stripWikitextSections`, `stripLead` and `stripSection(wikitext, heading)`** in `@refract-org/analyzers`: a page's prose section by section, its lead, and one section with its subsections, found by its heading as a reader sees it (markup removed, any case, `_` as a space).

### Changed
- **`ProtectionLogEvent.level` is normalized and read from older entries.** It was MediaWiki's group name (`autoconfirmed`, `sysop`) from the entry's `details`, which entries logged before about 2015 lack: 17 of the 94 entries above had one, and none of Pluto's 33. It is now `semi`, `extended`, `full` or `template`, the edit protection set (the create protection for a page protected from creation), read from `details` or else the `[edit=…]` list in the entry's description or comment. 57 of the 72 entries that set or changed protection now have one; the other 15 protect against moves only, or were logged in 2005, before levels were.
- **`refract snapshot` reads to the end of the date and skips reverted states.** `--at 2024-01-15` meant midnight at its start, so an edit made that afternoon was not in the snapshot of that day, and a version vandalized that evening and reverted the next morning was reported as what the page said. The command is now `snapshotAt` over the client: the latest revision at or before 23:59:59 UTC (a timestamp is read as given, UTC when it names no zone), stepping back past a state a later edit reverted or repaired within 48 hours (`findRevertedStates`, near-restorations included) and printing `Skipped rev N`. `--scope lead|section|full` (default `full`) and `--section <heading>` choose the text, and `--keep-reverted` reports the live revision anyway. `--revision-limit` and the MCP `snapshot` tool's `revisionLimit` now count the revisions read on each side of the date (default 10); they read up to 500 revisions with their text to find one. The tool gains the same behaviour and, in its reply, `cutoff`, `skipped` and `restoredBy`. **A snapshot of a date now includes that day's edits, and can name an earlier revision than before.** A date such as `2024-02-30` is refused rather than read as 1 March.

### Fixed
- **`stripWikitext` keeps the lead of a page whose infobox holds a literal `<` (#94).** It removed HTML tags with `/<[^>]+>/`, which read any `<` as a tag and deleted the text up to the next `>`. English Wikipedia's Pluto infobox ends `| flattening = <1%<ref name="Stern2015" />` and `}}`, and the next `>` was a `<gallery>` in the Name section, so the infobox's closing braces and the whole lead were deleted, and the unclosed infobox came through as about 1,600 characters of prose. A tag is now `<` or `</`, a letter, and no `<` before its `>`; a `<` before a digit or a space is text, as it is to MediaWiki. Tags are removed in one linear scan, which also removes a tag that removing another put together, so `<scr<b>ipt>` leaves nothing rather than `<script>`. Comments and braces were not the cause. In 48 sampled Pluto revisions (the 12 before each of June 2008, June 2014, June 2020 and 24 November 2026), the 24 from 2020 and 2026 had lost lead text this way, and in the 12 from 2026 the first paragraph was the infobox. **Sentence and citation events on such revisions change**: with this fix alone, 17 of that sample's events differ and their count rises from 64 to 79. Samples of Anarchism and Recession taken the same way lost no lead to it.
- **Embedded files and their captions no longer enter the prose.** A file link's caption usually holds a link, and the link patterns stopped at its first `]`, so `[[Datei:A.svg|mini|Das A im Kreis: ein [[Anarchistische Symbolik|Symbol]]]]` became the line `mini|Das A im Kreis: ein [[Anarchistische Symbolik|Symbol]]`, and English captions became sentences such as `thumb|upright|Mikhail Bakunin opposed …` that then shared events with the prose after them. `[[File:…]]` and `[[Image:…]]` are removed whole, nested links included, as are the German (`Datei`, `Bild`), French (`Fichier`), Spanish (`Archivo`, `Imagen`) and Japanese (`ファイル`, `画像`) names, from one list in `wikitext-parser.ts`; `[[:File:…]]`, a visible link, stays. French Wikipedia's `{{'}}` reads as an apostrophe, so `L{{'}}'''anarchisme'''` is "L'anarchisme", not "Lanarchisme". **Sentence events on pages with images change, and their `eventId`s with them**: in 48 Anarchism revisions sampled the same way every stripped text changed, and 14 of the 79 sentence and citation events, each a caption or prose run together with one, are gone. The saved examples are unchanged.

### Removed
- **The CLI's copies of the claim matcher, and `fuzzyFindText`.** `findPassageMatch` and `nearestPassage` are exported from `@refract-org/analyzers` instead of the CLI's claim module, and the claim types with them. `fuzzyFindText`, which nothing called, is gone with its tests.

## 0.8.0 (2026-11-24)

### Added
- **`fetchLongitudinalHistory` leaves reverted states out of its sample.** Of the 120 revisions it hydrated, 33 of Stoicism's and 44 of Pluto's were states a later edit undid within two days: vandalised leads, blankings, citations dropping to zero. `findRevertedStates(metadata, windowHours = 48)` finds them from `sha1` alone: when a revision restores an earlier revision's text, every revision between the two is a reverted state if the first of them came no more than `windowHours` before the restoration. `fetchLongitudinalHistory` now picks its sample from the surviving states (`excludeRevertedStates`, on by default; `false` keeps them, `{ windowHours }` changes the window), so those slots go to states readers saw; both pages' samples now hold none. Telemetry is still computed over every revision. `selectLongitudinalRevisions` takes the same option as a third argument, off by default, so its selection is unchanged unless asked.
- **`LongitudinalHistoryResult.coverage`** says how much history was read: `metadataRevisions`, `truncated`, `maxMetadataRevisions`, `direction`, `revertedStatesExcluded` and `revertedStateWindowHours`.
- **`page_moved` reports moves into the page.** The move log is keyed by the title moved from, so a query for "Pluto" never listed Pluto's moves back from "(134340) Pluto" or "Pluto (dwarf planet)". `refract analyze` and `export` now also read the `moved page [[A]] to [[B]]` (and pre-2012 `moved [[A]] to [[B]]`) summaries of the analyzed revisions, and report a move found both ways once, as the log has it. A move found only in a summary carries `page_move_source: edit_summary`, and its `toRevisionId` is the null revision the move left. `pageMovesFromEditSummaries` and `mergePageMoves` are exported from `@refract-org/analyzers`. Runs on `--dump` now report the moves their summaries name.
- **`countCitationsByKind` and `matchShortFootnotes`** in `@refract-org/analyzers`.

### Changed
- **Editor names are removed from summary text before it reaches an event.** `revert_detected` copied the edit summary into `after` and its fact, so Mutualism's events read "Revert to revision 57480834 dated 2006-06-08 04:35:51 by Mattergy using popups", though events are documented to carry no editor identity. `redactEditorIdentity` (exported from `@refract-org/analyzers`) replaces user, user talk and contributions links, `{{u|…}}`-style templates, IP addresses, the name after "edits/revision N/version … by" or a time of day, and the mover's name in a move summary with `[editor]`, keeping the revert pattern, revision IDs and reason. It applies to `revert_detected` (also from `refract watch`), `protection_summary`, `page_moved`'s `comment=`, `talk_page_correlated`'s `talk_comment=`, `refract claim`'s `editSummary`, and `wikidataStatementHistory`'s `editSummary`. The function lives in `@refract-org/evidence-graph`, so ingestion can use it, and is re-exported from `@refract-org/analyzers`. **Events whose summary named an editor get new `eventId`s.** See [docs/events.md](./docs/events.md#edit-summaries-carry-no-editor-names).
- **Citations include shortened footnotes.** `countCitations` and `citation_added`/`citation_removed` saw `<ref>` tags only, so an article citing with `{{sfn}}` read as nearly uncited: Anarchism's latest revision has 14 `<ref>` tags and 210 sfn/harv-family templates. Both now count sfn- and harv-family templates outside a `<ref>` (one inside a reference is that reference's text). A footnote is matched between revisions by its whole text. **Articles that use shortened footnotes gain citation events, and their `countCitations` results rise.** `countCitations` moved from `wikitext-parser.ts` to `citation-tracker.ts`; the package export is unchanged.
- **`fetchLongitudinalHistory` reads the whole history by default.** `maxMetadataRevisions` defaulted to 10,000, so World War II's 28,683 revisions were cut to the newest third without notice. There is no default limit now; with one, `coverage.truncated` reports a cut.
- **Hydration keeps at most 3 requests in flight by default** (`fetchRevisionsByIds`, `fetchLongitudinalHistory`), the limit [Wikimedia asks API clients to keep to](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits). It was 4.
- **`--batch-concurrency` defaults to 3** on `analyze`, `export`, `claim` and `field`, for the same reason: pages are read in parallel, so this bounds the requests in flight. It was 4. A page's move log, protection log and talk-page reads still go out together, so `analyze` and `export` can briefly have more than 3 requests in flight. `DEFAULT_BATCH_CONCURRENCY` is exported from the CLI's batch module.

### Fixed
- **`refract field --template` matches an infobox written as a module call.** A page that calls `{{#invoke:Infobox military conflict|main …}}` directly, as English Wikipedia's `Template:2026 Iran war infobox` does, passes the module the parameters the template would; `--template "Infobox military conflict"` found nothing there, so the field read as absent. A module call now answers to the template name it implements. `FieldChange.template` still names it as the page does, `#invoke:Infobox military conflict`.
- **`sanitizeWikitext` keeps the items of list templates.** It removed every template, so `[[…|Ongoing]]<br>{{blist|Strait of Hormuz crisis|…}}` read as `Ongoing<br>`, and `refract field` reported an item added to or removed from a listed value as a `markup` change, one where only the wikitext changed. In that template's 204 daily versions, 34 of the 67 changes to `status` were word changes reported as `markup`. The items of `blist`, `bulleted list`, `ubl`, `ubil`, `unbulleted list`, `plainlist`, `flatlist` and `hlist` are now kept, each after ` · `, without their named arguments or `*` markers, and `{{nowrap|…}}` keeps its text; `<br>` reads as a space. Other templates are still removed, and `stripWikitext`, which sentence events use, is unchanged. **Callers of `sanitizeWikitext` get list items and no `<br>` in its output**, so a `text` that `refract field` recorded earlier can differ from one recorded now for the same value.

### Removed
- **`refract mcp`'s unused `McpServerOptions` callbacks.** `runMcpServer` in `packages/cli/src/commands/mcp.ts` built `analyze`, `claim`, `exportData`, `cron`, `classify`, `getStatementHistory`, `snapshot` and `review` callbacks and passed them to a request handler that never read them; every `tools/call` goes to the CLI's `handleToolCall`, which already did the same work (its `classify` also takes per-call `apiKey`, `endpoint` and `model`). The callbacks, the handler's `options` parameter and the `McpServerOptions` import are gone. `refract mcp` behaves as before, and `@refract-org/mcp`'s `McpServerOptions` and `createMcpServer` are unchanged.

## 0.7.0 (2026-11-19)

### Added
- **Longitudinal multi-year ingestion, multilingual forensic analyzers, and privacy-preserving actor cohorts (#85).** `MediaWikiClient` gains multi-year longitudinal revision fetching; citation, revision-event, revert, and semantic-enrichment analyzers support multilingual forensic analysis and privacy-preserving actor cohorts; `refract diff` gains longitudinal/multilingual forensic comparison.
- **Constitutional drift, minority evidence, and categorization drift (#80–#84).** `@refract-org/evidence-graph` exports `ConstitutionalDriftWindow`, `MinorityEvidenceTrace`, `RuleChangeEvent`, `ObjectionTrace`, `DriftWindow`, and `DriftRecord`; `@refract-org/analyzers` exports `computeConstitutionalDriftWindow`, `computeBotShare`, `computeProtectedEditShare`, `computeRevertAsymmetry`, `classifyObjection`, `classifyTerminalState`, `isDriftTerminal`, and `computeDriftRate`; `refract drift` emits NDJSON, JSON, or Markdown constitutional-drift windows.
- **Passage histories carry structured transitions.** `runClaimHistory`, `refract claim --json` and the MCP `get_statement_history` tool return `transitions`: one record per change in a passage's presence or wording (`first_seen`, `text_changed`, `removed`, `reintroduced`), placed between the two revisions read that it lies between, with `adjacent` saying whether revisions not read lie between them; the text either side; the edit summary, whether it matches a revert pattern, and `restoresRevisionId` for an identity revert; `heldRevisions`, `endedByRevisionId` and `endedAt` for how long the result lasted; and, on a removal, `nearest`, the remaining sentence carrying at least half the passage's words, so a rewrite is not read as a deletion unseen. The text report lists them one per line. `nearestPassage` and `formatTransition` are exported from the CLI's claim module.
- **`get_statement_history` reads a chosen range.** `limit`, `from` and `to` select the revisions read, as `refract claim --limit/--from/--to` do; 50 latest revisions was the only option. The response gains `transitions`, and the `@refract-org/mcp` server now returns `latest_revision_id`, `latest_match` and `caveats` as `refract mcp` did. `statementHistoryOptions` and `statementHistoryResponse` are exported from `@refract-org/mcp`, which builds the response for both servers.
- **Wikidata statements with identity, rank and qualifiers, and their history.** `WikidataEntity.statements` lists each statement with Wikidata's statement ID, rank, snak type, value, qualifiers (such as start time P580 and end time P582) and reference count; time values carry their `precision`. `fetchWikidataEntity(qid, { revisionId })` reads an entity as it stood at a revision, and `parseWikidataEntity` reads Wikidata's JSON from Special:EntityData or a revision's text. `diffWikidataStatements` compares two states by statement ID, and `wikidataStatementHistory` reports each statement added, removed or changed across revisions of an entity's page, placed between the revisions it lies between.
- **Signed verification bundles.** `refract export --proof --sign-key <key.pem>` adds an Ed25519 signature over the bundle's `manifestHash`, which covers the input revision hashes, analyzer versions, event hashes and Merkle root. `refract verify --public-key <key.pub.pem>` fails a bundle that is unsigned, signed with another key, or changed after signing; without `--public-key`, a signature is checked against the key the bundle carries and `verify` says it was not checked against a trusted one. Keys are standard PEM, e.g. from `openssl genpkey -algorithm ed25519`. The optional `signature` field leaves the format `refract-verification-bundle/v1`; older readers ignore it. `signVerificationBundle`, `verifyBundleSignature` and `bundleKeyId` are exported from `@refract-org/evidence-graph`.
- **`--dump <path>` and `--wayback` on `analyze`, `export`, `claim` and `field`.** `XmlDumpRevisionSource` and `WaybackRevisionSource` were exported but no command used them. `--dump` reads a page's revisions from a MediaWiki XML export (a full-history `Special:Export` file or an uncompressed dump) with no network access: a dated file gives the same output on every run, and one file serves every page of a `--pages-file`. `--wayback` reads the Internet Archive's snapshots of the page, given as a URL or built from the title and `--api`, which reaches a page deleted from the wiki; snapshots are text, not wikitext, so sentence events and `claim` work and citation, template and `field` results do not. Moves, protection logs and talk pages are not read from either source.
- **`refract diff` compares one topic across languages.** It read the same title on every wiki, so an article whose title differs by language could not be compared. `--title <label>=<title>` gives one wiki's title, and `--resolve-titles` finds each other wiki's title through wiki A's interlanguage links (`prop=langlinks`), matching the wiki by its host prefix or its content language (`meta=siteinfo`). The report and `DiffResult.comparison.citedDomains` list every domain the latest revisions cite with each wiki's count, which compares across languages where wording does not; each `wikis[]` entry names the `title` it read. `MediaWikiClient` gains `fetchLanguageLinks` and `fetchSiteInfo`, covered by a seventh live contract test.
- **`refract linksearch <domain>`** lists the pages that link to a domain, from MediaWiki's `list=exturlusage` (what Special:LinkSearch shows), one title per line so the output can feed `--pages-file`. `--subdomains` also matches `*.<domain>`, `--namespace` picks the namespace (articles by default), `--limit` caps the links read per query (10,000 by default, with a note when reached), and `--json` lists each page's matching URLs. It finds the links pages have now, not links already removed. `MediaWikiClient.fetchExternalLinkUsage` follows MediaWiki's `continue` protocol whatever the continuation key; a live contract test covers it, so there are now six.
- **Citation events say which passage a reference supports, and whether the passage outlived it.** Each reference is linked to the prose it follows, read from the same stripped text sentence events use. `citation_added`, `citation_removed` and `citation_replaced` gain `citation_source` (`domain=<host> url=<url>`) and up to five `citation_anchor` facts naming the passages; `citation_removed` also gains `citation_anchor_status` (`anchors=<n> kept=<k> unsourced=<u>`), where `kept` counts passages still in the later revision and `unsourced` those no other reference follows any more. A reference inside a template has no anchor. Anchor text is omitted at `brief` depth; the counts are not. `extractCitationAnchors`, `citationKey`, `citationDomain` and `normalizeAnchor` are exported from `@refract-org/analyzers`. **Every citation event gains facts, so every citation event's `eventId` changes.** The saved examples are regenerated; the fictional sample's third revision removes the opening-hours citation while the sentence stays, and reports `kept=1 unsourced=1`.
- **`--pages-file` on `export`, `claim` and `field`.** `analyze --pages-file` prints only a total, so a question across many pages meant a loop of single-page runs. `export --pages-file <path> --format ndjson` writes every page's events as one NDJSON stream with `pageTitle` and `pageId` on each line, pages in the file's order, and each event's `eventId` unchanged from a single-page export. `claim --pages-file` and `field --pages-file` report each page on one line, as NDJSON with `--json`, where a page that could not be read is `{"page", "status": "error", "error"}`; searching a set of pages finds a passage that moved between them. `--batch-concurrency` sets how many pages are read at once (default 4). A failed page does not stop the others, and the command exits 2. `--from` and `--to` are refused with `--pages-file`, since revision IDs belong to one page.
- **`refract field <page> --param <name>`** tracks a template parameter, such as an infobox's `result`, across revisions. It reports each revision where the value changed, as `added`, `removed`, `text` (the prose changed) or `markup` (only the wikitext did, such as a reference removed while the words stayed), and marks a value that returns to one seen earlier, which is how back-and-forth over a field shows. `--template` reads the parameter from one template; without it the first top-level template that has the parameter is read and a note names the others. Takes `--limit`, `--from`, `--to` and `--json` as `claim` does. Sentence matching no longer sees infobox text (see Fixed), so this is the way to follow a field.
- **`refract claim --json`** (`-j`) prints the passage history as one indented JSON object in place of the text report: the `ClaimHistoryResult` that `runClaimHistory` returns (`statement`, `page`, `pageId`, `status`, `latestRevisionId`, `latestMatch`, `historySummary`, `caveats`, and `revisions` with `revisionId`, `timestamp`, `text`, `section` and `match`), plus the `claimId` the text report prints. Without the flag the output is unchanged.
- **`examples/06-pluto-in-the-loop.ts`: a model in the loop, checked against the record.** It replays the saved Pluto revisions of 24 August 2006 offline and, at each of the three places the sentence matcher splits that history into a removed and a first-seen sentence, asks a model through `refract classify sentence_similarity` whether the two are the same claim. Each answer names the two events it is about and is checked against the events derived from the saved revisions before it is shown: an answer that cites an event the revisions do not give, quotes text an event does not hold, was asked a different prompt, or records a verdict its reply does not give is refused, and the script exits 1. `--save` keeps a model's answers and `--answers` replays them; `--tamper` shows a refusal; `--json` prints the events and the checked answers as `model_interpretation` records.

### Fixed
- **The `@refract-org/mcp` server passes `get_statement_history`'s page to its handler.** It called `getStatementHistory(statement)` and dropped the required `page`, so a library consumer of `createMcpServer` could not ground the lookup, and it reported a missing handler as a crash. The handler now receives `(statement, page, { api, limit, from, to })`; a one-argument handler still type-checks. `refract mcp` was not affected; its unused copy of the handler, which passed an empty page, now reads the page it is given. The tool's description no longer says it matches a "semantic neighbor": it matches normalized text or, partially, a sentence sharing at least 70% of the statement's longer words.
- **Wikidata item values are read.** Wikidata serializes an item value as `wikibase-entityid`, and the mapper read only `wikibase-item`, so on real entities `instanceOf` was empty and every item-valued claim was dropped from `claims`. Both are read now.
- **`classify` through MCP sampling works.** `refract mcp` awaited each request before reading the next line from its client, so a `classify` waiting on the client's sampling reply never read it, and every sampling request ended in `MCP sampling timeout` after 30 seconds. Requests are still handled one at a time in order, but the server keeps reading while one waits. The reply's content is read as one block, as the 2025-06-18 protocol defines it, or as a list; only a list was read, so a conforming reply was taken for empty. When the client closes its input, a request waiting on it fails at once.
- **A model's `classify` result reports what the model said, not numbers it never gave.** `confidence` was 0.85 whenever the reply contained "yes" and 0.5 otherwise, and `sentence_similarity`'s `matchRatio` was 0.9 for yes and 0.2 for no; the BYO-inference tutorial showed a `rationale` and a confidence of 0.98 that no code produced. A model result now has no `confidence` or `matchRatio`, and carries the reply as `answer` and the model that gave it as `model`. The reply is read from its first word, so "I think yes" is no longer a no, and "not a revert" no longer the label `revert`; a reply that does not begin with an allowed answer leaves `output` empty, with a `note`. **Consumers that read `confidence` or `matchRatio` from a model result get nothing there now.** Default-rule results are unchanged.
- **`classify sentence_similarity`'s default rule is the sentence matcher's.** It measured overlap with its own tokenizer, which dropped punctuation and every non-ASCII word, so it could disagree with `refract analyze` about the same two sentences, and two different sentences in another script scored 1 and counted as one claim. It now uses `wordOverlapRatio`, the measure sentence events compare with `similarityThreshold`, which is exported from `@refract-org/analyzers`.
- **`XmlDumpRevisionSource` reads what an export records.** It dropped each revision's parent, editor and minor flag, so coverage could not check continuity, and read a revision whose text was deleted (`<text deleted="deleted" />`) as an empty page, which became the page being blanked and restored. Revisions now carry `parentId`, `user`, `minor` and the export's byte `size`, and deleted text is `contentAvailable: false`. Titles match with underscores as spaces, hexadecimal entities decode, and the file is read once per instance rather than once per page.
- **`WaybackRevisionSource` reports a failed index request** instead of returning no snapshots, which read as a page never archived. A snapshot's `revId` is its 14-digit timestamp rather than a count from 1, so the same snapshot keeps its ID whatever range is asked for, and `direction: "older"` reads the latest snapshots first so a limit keeps the latest without downloading the rest.
- **A reference after a reused named reference is no longer lost.** The full-reference scanner read a self-closing `<ref name="x"/>` as an opening tag, as the regex it replaced did, so its match ran on to the next `</ref>` and swallowed the reference after it, which then counted as another use of `x`. On any page that reuses a named reference, which is most cited Wikipedia articles, citations added or removed after a reuse went unreported. Self-closing tags now open nothing. Citation events appear where they were missed.
- **A reference's URL is read from its `url=` parameter, or else its first bare URL.** `url\s*=` matched the first parameter ending in `url`, so an `archive-url=` or `chapter-url=` written before `url=` was taken for it, and a bare `<ref>https://…</ref>` or `<ref>[https://… Title]</ref>` had no URL. This changes `buildSourceId` for those references, and the domains `analyzeCitationNetwork` and `refract diff` count.
- **Reverts are found by their text, not only their edit summary.** `revert_detected` fired only when the summary matched a revert pattern, so a manual revert with a silent or unusual summary went unseen, which is how much of an edit war looks. A revision whose text is byte-identical to an earlier analyzed revision, other than the one directly before it, is now a revert too, with an `identity_revert` fact naming the revision restored (`restores=<revId>`). Text is compared by SHA-1 computed from the content, so revisions from the API, the cache or any other source compare the same way, and no API field is requested. A revert found both ways is one event with both facts. `findIdentityReverts` is exported from `@refract-org/analyzers`. **Revert events that also restore an earlier text gain a fact, which changes their `eventId`; new revert events appear where only the text showed one.** The fictional sample gains one: its fifth revision restores the third, and the saved review example is regenerated.
- **`detectRevertChain` no longer does arithmetic on revision IDs.** IDs are numbered across a whole wiki, so one page's revisions are far apart. Chains were grouped by IDs within one of each other, which put every revert in a chain of its own, and a target the summary did not name was guessed as `revId - 1`, a revision of some other page. Reverts are now consecutive when no other revision of the page falls between them. `revertedToRevisionId` comes from identical text or a "restored revision N" summary and is otherwise absent (the field is now optional); an "Undid revision N" summary, which names the revision taken away, sets the new `undoneRevisionId` instead.
- **Templates that contain other templates no longer leak into sentence text.** `stripWikitext` removed a template with one pass of `/\{\{[^{}]*?\}\}/`, which matches only templates with none inside, so a template holding another kept its own braces and parameters. Real infoboxes nearly always hold one (`{{start date}}`, `{{efn}}`, `{{flagicon}}`), so the whole box came through as prose: `{{Infobox military conflict | conflict = … | result = … }}` was split into sentences, and `refract claim` matched infobox values by accident. `sanitizeWikitext` had the same fault with `/\{\{[^}]*\}\}/`. Both now use `removeTemplates`, one linear scan that removes balanced templates at any depth and leaves an unclosed `{{` or a stray `}}` as text. **On pages whose infobox or other templates nest, sentence events lose the infobox lines, which changes those events' `eventId`s**, and `refract claim` no longer matches text that exists only inside a template; use `refract field` for that. The saved examples are unchanged: their pinned revision pairs do not change a nested template.
- **Section headings no longer leak into sentence text, and sentences are placed under their own heading.** `stripWikitext` kept heading lines and the sentence splitter did not stop at a line break, so a `sentence_modified` event's text could start `==Planetary status== ===Planet X?=== Pluto was originally discovered in 1930`, and a section ending in a list ran into the next section's heading and first sentence. `stripWikitext` now leaves a paragraph break where each heading stood, and a blank line ends a sentence. Section attribution was wrong for the same pages: heading offsets were measured in the wikitext and compared with positions in the stripped text, which is shorter by every template, reference and heading above, so a sentence was reported under an earlier heading or `(lead)`. `buildSectionCharMap` now returns offsets in the stripped text `findSectionForText` searches, and `refract claim` uses the same map. A heading inside a comment opens no section for sentence events.
  **Sentence events change, and so do their `eventId`s.** On any page with headings, a sentence that used to carry a heading loses it, a sentence that used to span a blank line becomes two, and `section` can change; each of these gives the event a new `eventId`. Stored baselines keyed on sentence text, section or `eventId` will see the old events resolve and new ones appear once, so the first `refract cron` or `refract review` run after upgrading can report those sentences as changed. In the saved Bitcoin example inputs one of 22 sentence events differs: a `sentence_modified` that held `==See also==` … `==External links==` and was filed under `Proof-of-work` is now the changed link list alone, under `External links`. `refract snapshot` and the MCP `snapshot` tool's plain text no longer contain heading lines; the headings are in their `sections` list.
- **Category tags in German, French and Japanese no longer join sentence text.** `stripWikitext` removed `[[Category:X]]` only under its English name, so on other editions `[[Kategorie:Zwergplanet]]` stayed in the text as `Kategorie:Zwergplanet` and became part of the sentence after it. It now also removes `Kategorie`, `Catégorie` and `カテゴリ` tags, from one list in `wikitext-parser.ts` that takes further names. A visible link such as `[[:Kategorie:X]]` stays. Sentence events on pages that carry these tags lose the tag text, which changes those events' `eventId`.

## 0.6.2 (2026-11-13)

### Fixed
- The local explorer returns HTTP 400 for malformed request URLs such as `//` and keeps serving requests. Reloads reuse the rendered HTML report.

### Added
- **MCP `snapshot` and `review` tools.** `snapshot` returns the revision live at a date as JSON: its ID, timestamp, section headings, and plain text or wikitext. `review` observes a page list against an explicit, absolute `stateDir`, saves the report there, and returns it with `reportPath`, a filtered `view`, and an `acknowledgment` field. No MCP tool acknowledges a report: acknowledgment records that a person inspected every entry, so the response gives that person the `refract review --ack` command, and gives none for an incomplete report. `runSnapshot` now prints the result of `takeSnapshot`, which returns it.

## 0.6.1 (2026-11-11)

### Changed
- **The MCP registry entry is `io.github.zz-plant/refract`.** The registry grants a name to the GitHub account that owns the publishing repository, and the repository moved from refract-org to zz-plant. The registry treats this as a new server; the entry under the old name stays at its last published version. Each published package's `repository.url` names zz-plant/refract for the same reason: npm checks it against the publishing workflow's repository.
- **The docs site is built with Starlight.** `apps/docs` moves from a hand-written `build.mjs` to Astro 7 and Starlight 0.42, which add a light theme beside the dark one, full-text search with Pagefind, previous and next links, and an edit link on every page. All 55 pages keep their URLs, titles, descriptions, canonical links, Open Graph tags and JSON-LD; `sitemap.xml` now indexes Starlight's `sitemap-0.xml`. Pages live in `apps/docs/src/content/docs/` with their title and description as frontmatter. Links to the review and usage guides name `docs/review.md` and `docs/usage.md`, so they also work on GitHub.

### Added
- **`refract analyze` and `export` emit `edit_cluster_detected` and `talk_activity_spike`.** The detectors existed in `@refract-org/analyzers` but the CLI never called them, so `--cluster-window` and `--spike-factor` did nothing. Three or more edits within an hour now produce a cluster event spanning them. Spikes are measured back from the last analyzed revision over the ten talk-page edits the CLI fetches, so most runs emit none. Output for a range with a burst of edits gains events.
- **`--section-rename` works.** `diffSections` ignored its option. At the default, `exact`, a heading that changes over identical text is one `section_reorganized` event with `change=moved from=<old heading>` in place of a removal and an addition; `similarity` also pairs sections whose word overlap reaches `--similarity`; `none` keeps the old output. `SectionChange` gains `fromSection`.
- **`refract analyze` and `export` emit `talk_thread_opened`, `talk_reply_added` and `talk_thread_archived`** for the fetched talk-page edits made since the first analyzed revision.
- **Citation events name their section.** `section` was `body` on every citation event. It is now the section whose text holds the reference, `(lead)` for the introduction, and `body` only when none does. The `eventId` of every citation event changes with it, and the saved examples are regenerated.
- **`detectTalkActivitySpikes` takes a reference time** that ends its lookback window. Without one it still measures from now.

### Fixed
- **`export --format json` reports the revisions it analyzed.** `analyzedRevisionRange`, `totalRevisions`, `analyzedRevisions` and `dateRange` were derived from events, so a two-revision range reported five revisions, a range that began at its own end, and `pageId: 0`. They now come from the fetched revisions.
- **`analyze --report` names the range it analyzed.** `revisionRange` was the span of revisions that changed a sentence, so a six-revision range reported two revisions inside it, and each claim's ledger entry also covered the claims listed before it.
- **`refract classify activity_spike --input '{}'` returns the default rule's answer** instead of failing on fields that rule treats as optional.
- **`--revert-patterns` and `--talk-window` take effect.** Both were parsed and then dropped before analysis, on `analyze`, `export`, `delegation` and `explore`. `buildRevisionEvents` accepts `revertPatterns`.
- **`refract cron --interval` no longer reports changes as its window slides.** A revision leaving the window made events on the next one look resolved, and turned `sentence_reintroduced` into a new `sentence_first_seen`. An event on a revision that already had events is no longer new, and the window's first revision yields no resolved events.
- **`refract classify revert` uses the rule `revert_detected` uses.** Its default was the edit-type heuristic's wider pattern, so `rv …` was a revert to `classify` and not to `analyze`.
- **`refract cron` no longer reports changes on an unchanged page.** Without `--interval`, the next window started at the last event in the saved observation, which is a talk-page correlation stamped hours before the newest article event. Re-reading that wider window turned a reintroduced sentence into a first-seen one and counted it as new. The window now starts at the newest event.
- **Flattened CSV keeps its columns.** `export --format csv --flatten` wrote the `input_hashes` and `parameters_json` columns unquoted, so their commas split the row.
- **`refract_eval` accepts a date-only cutoff.** `build_leakage_benchmark(path, cutoff="2024-06-01")`, the documented call, raised `TypeError` on any real export because event timestamps carry a zone and the cutoff did not. A cutoff without an offset is read as UTC.
- **`RefractLoader` honors `depth` and `api_url`.** It called `export`, which is fixed at `detailed` depth, and never passed the API URL. It now calls `analyze` with both.
- **`docker-compose.yml` starts.** Its command began with `refract`, which the image's entry point already supplies, so the container exited with `unknown command 'refract'`. It now runs a one-shot analysis; the explorer listens on loopback only and cannot be published from a container.
- **The examples do what they print.** `01-claim-provenance.ts` looked up a lead section by a title it never has and so compared empty text; four examples labelled a page's oldest revisions "last N".
- **Guides corrected against the built CLI and libraries**: depth levels, the event envelope, the evaluation harness, cache and credential behavior, the Python SDK reference, the viewer tutorial, and samples that named exports or fields that do not exist.
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
