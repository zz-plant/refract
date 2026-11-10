---
title: "Wikipedia history tools compared"
description: "This page compares tools for reading a Wikipedia article's history: the built-in page history, XTools, WikiBlame, Who Wrote That? and Refract."
---

This page compares tools for reading a Wikipedia article's history: the built-in page history, XTools, WikiBlame, Who Wrote That? and Refract.

Each answers a different question:

- the page history lists every edit with its editor, timestamp, edit summary and diff;
- XTools reports statistics about a page's edits and each editor's share of the current text;
- WikiBlame finds the revision in which a given text was inserted or removed;
- Who Wrote That? highlights who wrote each part of the current text;
- Refract reports each change between revisions as a typed event (sentences, citations, templates, reverts, sections), without editor identity.

## Wikipedia's page history

Sources: [Help:Page history](https://en.wikipedia.org/wiki/Help:Page_history),
[Manual:Reverts](https://www.mediawiki.org/wiki/Manual:Reverts),
[API:Revisions](https://www.mediawiki.org/wiki/API:Revisions),
[Help:Watchlist](https://en.wikipedia.org/wiki/Help:Watchlist).

| Capability | Page history | Refract |
|---|---|---|
| **View a single revision diff** | Yes — click "prev" on any revision | Yes — every event carries `before`/`after` snapshots |
| **See who edited what** | Yes — username + timestamp per revision | No — Refract observes document change, not editor identity |
| **Find when a sentence first appeared** | Not built in — on English Wikipedia, the history page's "Find addition/removal" link opens WikiBlame | `refract claim "Page" --text "sentence"` → exact revision + timestamp |
| **Track a sentence across its entire lifecycle** | Manual — follow the page history | Automatic — first seen, modified, removed, reintroduced, all timestamped |
| **Detect citation swapping** | Manual — compare each diff's reference section | `citation_replaced` event — `before`/`after` show the old and new source |
| **Detect edit wars** | Partly — undos, rollbacks and manual reverts are tagged, as are the edits they revert; spotting back-and-forth is manual | `revert_detected` + `edit_cluster_detected` — automatic structural detection |
| **Correlate article edits with talk page discussion** | Manual — check Talk tab separately | `talk_page_correlated` — Refract checks 7 days before / 3 days after each edit |
| **Compare the same topic across language editions** | Manual — open each wiki separately | `refract diff` — cross-wiki comparison with z-score outlier detection |
| **Query with SQL** | No | DuckDB: `SELECT "eventType", count(*) FROM 'events.jsonl' GROUP BY 1` |
| **Hash an export so others can check it** | Per revision — each revision has a permanent link, and the API returns a SHA-1 of its content | `refract export --manifest` → Merkle root over the event hashes; the same version over the same revision range reproduces it |
| **Automated monitoring** | Watchlist, with optional email when any watched page changes | `refract cron` + `refract watch` → Slack, email, webhook alerts |
| **AI agent integration** | No | `refract mcp` → Claude Code, Cursor, VS Code can call Refract tools directly |

## Refract vs. other tools

| Tool | What it does | Refract's difference |
|---|---|---|
| **[XTools](https://www.mediawiki.org/wiki/XTools)** | [Page History](https://www.mediawiki.org/wiki/XTools/Page_History): statistics about a page's edits, such as top editors and edits per year and month. [Authorship](https://www.mediawiki.org/wiki/XTools/Authorship): each editor's share of the current text, by character count. [Blame](https://www.mediawiki.org/wiki/XTools/Blame): the edits that added a given text. Authorship and Blame use WikiWho | Refract reports each change between revisions as a typed event and does not attribute text to editors |
| **[WikiBlame](https://en.wikipedia.org/wiki/User:Flominator/WikiBlame)** | Uses binary or linear search over a page's revisions to find the one in which a given text was inserted or removed. Works on MediaWiki wikis | `refract claim` follows one sentence through every revision: first seen, modified, removed, reintroduced |
| **[Who Wrote That?](https://www.mediawiki.org/wiki/Who_Wrote_That%3F)** | Browser extension for Chrome and Firefox that uses WikiWho to highlight who wrote each part of an article's current text | Refract does not identify editors; it reports what changed at each revision |
| **[WikiWho](https://www.mediawiki.org/wiki/WikiWho)** | Token-level provenance for about 70 Wikipedia editions: who added, removed or reinserted each token, and in which revision | Refract emits events for sentences, citations, templates, reverts and sections rather than tokens, and does not attribute editors |
| **[WhoColor](https://github.com/wikiwho/WhoColor)** | Userscript that colors article text by author, with conflict and age views, built on WikiWho | Refract structures the data for querying, not just viewing |
| **[Wikimedia Enterprise](https://meta.wikimedia.org/wiki/Wikimedia_Enterprise/FAQ)** | APIs that deliver Wikimedia project content: daily project snapshots, single articles on demand, and a real-time stream of updates. Free access, and paid plans with service-level agreements | Refract analyzes a page's past revisions, is open-source, and runs locally |
| **[MediaWiki API](https://www.mediawiki.org/wiki/API:Revisions)** | Raw revision data: metadata, content and a SHA-1 of each revision | Refract adds deterministic analysis, event typing, provenance metadata |
| **[Internet Archive](https://help.archive.org/help/wayback-machine-general-information/)** | Archived captures of web pages from its crawls | Refract produces structured, queryable event streams, not page captures |
| **Custom scrapers** | Ad-hoc revision analysis | Refract has 26 event types, deterministic hashing, and a published SDK |

## What Refract deliberately doesn't do

| Capability | Why not |
|---|---|
| **Truth/fact-checking** | Refract observes change, not correctness. It answers "what changed?", not "is this true?" |
| **Sentiment analysis** | Refract doesn't judge editor intent or tone |
| **Editor scoring** | Refract tracks document change, not editor behavior |
| **Prediction** | Refract reports what happened, not what might happen |
| **Automated editing** | Refract is read-only observation |

## When to use Refract

- You need to **prove** when a claim appeared, not just screenshot it
- You're analyzing **patterns across many revisions** (citation churn, edit clusters, talk correlation)
- You need **exports others can reproduce and compare** (a Merkle root over the event hashes)
- You want to **monitor pages automatically** (cron + notifications)
- You're building a **RAG pipeline** that needs claim stability signals
- You want **AI agents** to reason about page history with structured data

## Refract vs. AI evaluation tools

Refract's model evaluation capability — temporal leakage detection, provenance hallucination checking, retrieval quality scoring — has no direct competitor. Existing tools evaluate models on accuracy, safety, or reasoning. None evaluate models against deterministic ground truth about what was public knowledge and when.

| Capability | Existing tools | Refract |
|---|---|---|
| **Temporal leakage detection** | Heuristic: compare model output to training cutoff dates. No deterministic proof. | `refract_eval.build_leakage_benchmark()` — exact revision ID, timestamp, SHA-256 hash. Proves leakage deterministically. |
| **Provenance hallucination** | Manual: check model citations against sources one at a time. | `refract_eval.check_provenance()` — query citation_added/removed/replaced events. Classify: verified, outdated, hallucinated. |
| **Retrieval quality (stability-weighted)** | Embedding similarity only. Contested and stable passages score identically. | `refract_eval.score_retrieval_quality()` — each passage scored by revert count, citation churn, talk activity. |
| **Knowledge recency** | No standard tooling. Ad-hoc: "ask the model what date it thinks it is." | `refract snapshot "Page" --at <date>` — deterministic page state at any point. Compare model answer against ground truth. |
| **Standard benchmark** | No open benchmark for temporal ground truth. | `BENCHMARK.md` — 10 standard pages, submission format, reproducibility requirements. |
| **Reproducibility** | Most eval suites: "run our script, trust our numbers." | Every event has a deterministic SHA-256 hash. Reviewer runs same command, gets same hash. |

**The gap Refract fills**: every eval suite tests whether a model is *accurate*. None test whether a model *knows things it shouldn't*. Refract provides the ground truth for that test — and makes it reproducible.

## When Wikipedia's UI is enough

- You're checking **one revision diff** quickly
- You need to see **who** made an edit
- You're browsing page history casually

Refract doesn't replace the page history. It adds typed change events, SQL queries over them, exports that others can reproduce from the same revisions, and scheduled re-observation with Slack, email or webhook notifications.
