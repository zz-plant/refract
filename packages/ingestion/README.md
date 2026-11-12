# @refract-org/ingestion

Revision-history adapters — MediaWiki APIs, Git repositories, snapshot archives, the Wayback Machine. Each yields a history as an async iterable of `Revision`s.

```bash
bun add @refract-org/ingestion
```

## Exports

### Interfaces

- `RevisionFetcher` — fetch revisions by page title
- `RevisionSource` — async iterable revision stream
- `DiffFetcher` — fetch diff between two revisions

### Revision sources (0.3.2+)

All implement `RevisionSource`, so each composes with the analyzers the way the MediaWiki source does.

- `MediaWikiClient` — MediaWiki API client with pagination, retry and error handling
- `GitRevisionSource` — a file's `git log --follow`, each commit as a revision
- `SnapshotDirectorySource` — a directory of timestamped snapshot files, or an explicit list in memory
- `WaybackRevisionSource` — a URL's Internet Archive captures, via the CDX server, rate-limited (250ms by default)
- `XmlDumpRevisionSource` — a MediaWiki XML dump file

### Utilities

- `RateLimiter` — configurable request throttling
- `WikimediaStreamClient` — live edit stream (EventStreams)
- `MediaWikiApiError`, `retryAfterMs`, `DEFAULT_USER_AGENT` — error handling for API failures (`maxlag`, `ratelimited`, `readonly` are retried; anything else throws)

```ts
import { GitRevisionSource, MediaWikiClient, RateLimiter } from "@refract-org/ingestion";
import type { RevisionFetcher, RevisionOptions } from "@refract-org/ingestion";
```

[Refract](https://github.com/refract-org/refract) · [Docs](https://zz-plant.github.io/refract/) · [npm](https://www.npmjs.com/package/@refract-org/ingestion)
