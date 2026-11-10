---
title: "Tutorial: Add a non-Wikipedia data source"
description: "Connect Refract to a wiki or knowledge base that isn't Wikipedia — Confluence, GitHub wikis, Notion, or any revision-tracked content source. The engine…"
---

## Goal

Connect Refract to a wiki or knowledge base that isn't Wikipedia — Confluence,
GitHub wikis, Notion, or any revision-tracked content source. The engine doesn't
change. You write an adapter.

## How the adapter surface works

Refract's ingestion pipeline consumes `Revision[]` — an array of revision objects
with content, timestamps, and metadata. The `MediaWikiClient` is one implementation
of this interface. Any source that can produce `Revision[]` works.

```typescript
export interface Revision {
  revId: number;
  pageId: number;
  pageTitle: string;
  timestamp: string;
  user?: string;
  comment: string;
  content: string;    // ← the wikitext or document content
  size: number;
  minor: boolean;
}
```

Once you have `Revision[]`, every analyzer works: section differ, citation tracker,
revert detector, edit cluster detector, talk page correlator. The analyzers are
pure functions — they don't know or care where the revisions came from.

They do care what the content is written in. The section, citation, template and
link diffs parse wikitext: `== headings ==`, `<ref>` tags, `{{templates}}`,
`[[links]]`. Content in another markup has to be converted to wikitext first, or
those diffs find nothing to compare. Confluence's storage format, used below, is
XHTML.

## Pattern: adapter function

Write a single function that fetches your source and returns `Revision[]`:

```typescript
import type { Revision } from "@refract-org/evidence-graph";
import { annotateEvents, buildRevisionEvents } from "@refract-org/analyzers";

async function fetchFromConfluence(
  pageId: string,
  apiUrl: string,
  apiToken: string,
): Promise<Revision[]> {
  const response = await fetch(`${apiUrl}/rest/api/content/${pageId}/version`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  const data = await response.json();
  return data.results.map((v: any) => ({
    revId: v.number,
    pageId: parseInt(pageId),
    pageTitle: v.title ?? pageId,
    timestamp: v.when,
    user: v.by?.displayName,
    comment: v.message ?? "",
    content: toWikitext(v.body?.storage?.value ?? ""), // your XHTML-to-wikitext converter
    size: v.body?.storage?.value?.length ?? 0,
    minor: v.minorEdit ?? false,
  }));
}

// Use it exactly like the Wikipedia client
const revisions = await fetchFromConfluence("12345", "https://mycompany.atlassian.net/wiki", "token");
// The events `refract analyze` derives from each pair of revisions
// (@refract-org/analyzers 0.5.1+).
const events = annotateEvents(buildRevisionEvents(revisions));

console.log(`Found ${events.length} events across ${revisions.length} revisions`);
```

## Existing adapters

| Source | Protocol | Auth | Example |
|---|---|---|---|
| **MediaWiki** (Wikipedia, Fandom) | `api.php` | None / Bearer / Basic / OAuth2 | Built-in (`@refract-org/ingestion`) |
| **Private MediaWiki** | `api.php` | Bearer / Basic | [Private wiki tutorial](private-wiki.md) |
| **Confluence** | REST API | Bearer token | Example above |

## When to build an adapter vs. use the CLI

| If you need | Use |
|---|---|
| Wikipedia or any MediaWiki wiki | `refract analyze "Page" --api <url>` — no code needed |
| A non-MediaWiki source | Write an adapter function (pattern above) |
| An adapter that others might use | Contribute it to `labs/` in the refract monorepo |
| Private/authenticated sources | [Private wiki tutorial](private-wiki.md) |

## What the analyzers expect

The analyzers operate on `content` (plain wikitext). If your source isn't
wikitext (e.g., Markdown, HTML, Notion blocks), preprocess it before passing
to analyzers:

```typescript
function markdownToWikitext(md: string): string {
  return md
    .replace(/^### /gm, "=== ")      // headings
    .replace(/^## /gm, "== ")
    .replace(/^# /gm, "= ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // links → plain text
    .replace(/`([^`]+)`/g, "$1");    // inline code → plain text
}
```

The better the preprocessing, the better the analysis. Citation tracking, for
example, looks for `<ref>` tags — if your source doesn't use them, citations
won't be detected. Adapt the preprocessing to match what your analyzers expect.

## Contribute an adapter

If you've built an adapter for a common source, contribute it to
[the core examples directory](https://github.com/refract-org/refract/tree/main/examples) as an experimental
probe. Follow the [custom analyzer tutorial](custom-analyzer.md) for the full
pipeline: adapter → analyzer integration → tests → eval.

## Next steps

- [Private wiki tutorial](private-wiki.md) — authenticated MediaWiki instances
- [Custom analyzer tutorial](custom-analyzer.md) — build a new analyzer
- [Downstream integration](../downstream.md) — production patterns
