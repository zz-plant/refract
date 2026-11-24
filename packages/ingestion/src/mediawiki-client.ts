import type { DiffLine, DiffResult, Revision } from "@refract-org/evidence-graph";
import type {
  AuthConfig,
  DiffFetcher,
  KnowledgeSource,
  MoveFetcher,
  PageMove,
  ProtectionLogEvent,
  RevisionFetcher,
  RevisionOptions,
  RevisionSource,
  SourceEntity,
  SourceQuery,
} from "./index.js";
import { protectionLevel, protectionReasonCategory } from "./protection-log.js";
import { RateLimiter } from "./rate-limiter.js";

const DEFAULT_API_URL = "https://en.wikipedia.org/w/api.php";
export const DEFAULT_USER_AGENT = "Refract/0.1.0 (https://github.com/refract-org/refract; refract@nextconsensus.com)";
const MAX_REVISIONS_PER_REQUEST = 500;
/** The most revision IDs `revids=` takes in one request. */
const MAX_REVIDS_PER_REQUEST = 50;
const MAX_ATTEMPTS = 3;
/** Longest a single Retry-After is honoured. Past this, giving up is better than hanging a run. */
const MAX_RETRY_WAIT_MS = 60_000;

/**
 * Error codes MediaWiki returns in an HTTP 200 body that mean "not now" rather
 * than "not ever": replication lag over the caller's maxlag, a rate limit, or a
 * wiki in read-only maintenance.
 */
const RETRYABLE_API_ERRORS = new Set(["maxlag", "ratelimited", "readonly"]);

/**
 * An error MediaWiki reported in the response body. The action API answers most
 * failures with HTTP 200 and an `error` object, so a client that only checks the
 * status reads a lag or rate-limit refusal as an empty page and returns whatever
 * it had collected so far as though it were the whole history.
 */
export class MediaWikiApiError extends Error {
  readonly code: string;
  readonly info: string;

  constructor(code: string, info: string, url: string) {
    super(`MediaWiki API error ${code}: ${info} for ${url}`);
    this.name = "MediaWikiApiError";
    this.code = code;
    this.info = info;
  }
}

/**
 * Milliseconds a Retry-After header asks for. It may be delta-seconds or an
 * HTTP-date; the date form used to parse to NaN, which setTimeout treats as 0,
 * so the retry went out immediately and was refused again.
 */
export function retryAfterMs(header: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, MAX_RETRY_WAIT_MS);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.min(Math.max(0, at - now), MAX_RETRY_WAIT_MS);
}

function backoffMs(attempt: number): number {
  return 2 ** attempt * 1000;
}

function describeFailure(err: unknown): string {
  if (err instanceof Error) return err.name === "TimeoutError" ? "timed out" : err.message;
  return String(err);
}

interface PageInfo {
  pageId: number;
  title: string;
}

interface RawRevision {
  revid: number;
  parentid: number;
  texthidden?: boolean;
  timestamp: string;
  comment: string;
  size: number;
  minor?: boolean;
  user?: string;
  userhidden?: boolean;
  sha1?: string;
  slots?: {
    main?: {
      content?: string;
    };
  };
}

interface RevisionQueryResponse {
  query?: {
    pages?: Record<
      string,
      {
        pageid: number;
        title: string;
        revisions?: RawRevision[];
        missing?: string;
      }
    >;
  };
  continue?: {
    rvcontinue: string;
  };
}

interface TitleQueryResponse {
  query?: {
    pages?: Array<{ pageid?: number; ns?: number; title: string; missing?: boolean; invalid?: boolean }>;
  };
}

/** A page a title resolved to: see `MediaWikiClient.resolveTitle`. */
export interface ResolvedTitle {
  pageId: number;
  /** The page's title after redirects and normalization. */
  title: string;
  /** Namespace number: 0 for articles, 1 for their talk pages. */
  ns: number;
}

/** See `MediaWikiClient.revisionAt`. */
export interface RevisionAtResult {
  /** The last revision made at or before the moment. Null when the page had none yet, or does not exist. */
  revision: RevisionMetadata | null;
  /** Up to `around` revisions before `revision`, oldest first. */
  before: RevisionMetadata[];
  /** Up to `around` revisions after `revision` (after the moment, when it is null), oldest first. */
  after: RevisionMetadata[];
}

interface LogEventResponse {
  query?: {
    logevents?: {
      logid: number;
      title: string;
      timestamp: string;
      comment: string;
      params?: {
        target_title: string;
      };
    }[];
  };
}

/** One page's link to a URL, as `list=exturlusage` reports it. */
export interface ExternalLinkUsage {
  pageId: number;
  namespace: number;
  title: string;
  url: string;
}

interface ExternalLinkUsageResponse {
  continue?: Record<string, string | number>;
  query?: { exturlusage?: Array<{ pageid: number; ns: number; title: string; url: string }> };
}

/** One interlanguage link: the other edition's interwiki prefix, such as "ru", and the page's title there. */
export interface LanguageLink {
  lang: string;
  title: string;
}

export interface SiteInfo {
  /** Content language code, such as "ru". */
  lang: string;
  /** Database name, such as "ruwiki". */
  wikiId: string;
  siteName: string;
}

interface LanguageLinkResponse {
  continue?: Record<string, string | number>;
  query?: { pages?: Array<{ title: string; langlinks?: Array<{ lang: string; title: string }> }> };
}

interface SiteInfoResponse {
  query?: { general?: { lang: string; wikiid: string; sitename: string } };
}

interface CompareResponse {
  compare?: {
    fromrevid: number;
    torevid: number;
    fromsize: number;
    tosize: number;
    "*"?: string;
  };
}

export class MediaWikiClient implements RevisionFetcher, RevisionSource, DiffFetcher, MoveFetcher, KnowledgeSource {
  readonly sourceId = "mediawiki";
  readonly sourceName = "MediaWiki";
  private rateLimiter: RateLimiter;
  private userAgent: string;
  private apiUrl: string;
  private auth?: AuthConfig;
  private maxlag?: number;

  /**
   * @param options.maxlag  Sent as `maxlag` on every request. Wikimedia asks
   *   automated clients to set it (5 is customary) so they back off when
   *   database replicas lag; a refusal is retried after the server's
   *   Retry-After. Unset by default, which sends nothing.
   */
  constructor(options?: {
    apiUrl?: string;
    userAgent?: string;
    minDelayMs?: number;
    auth?: AuthConfig;
    maxlag?: number;
  }) {
    this.apiUrl = options?.apiUrl ?? DEFAULT_API_URL;
    this.userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;
    this.rateLimiter = new RateLimiter(options?.minDelayMs ?? 100);
    this.auth = options?.auth;
    this.maxlag = options?.maxlag;
  }

  async fetchTalkRevisions(pageTitle: string, options?: RevisionOptions, talkPrefix?: string): Promise<Revision[]> {
    const prefix = talkPrefix ?? "Talk:";
    const talkTitle = `${prefix}${pageTitle}`;
    return this.fetchRevisions(talkTitle, options);
  }

  async fetchRevisions(pageTitle: string, options?: RevisionOptions): Promise<Revision[]> {
    const revisions: Revision[] = [];
    const limit = Math.min(options?.limit ?? MAX_REVISIONS_PER_REQUEST, MAX_REVISIONS_PER_REQUEST);
    let rvcontinue: string | undefined;

    let pageInfo: PageInfo | null = null;

    while (true) {
      const params = new URLSearchParams({
        action: "query",
        prop: "revisions",
        titles: pageTitle,
        rvprop: "content|ids|timestamp|flags|comment|size|user",
        rvslots: "main",
        rvlimit: String(limit),
        format: "json",
        formatversion: "2",
      });

      const isNewer = options?.direction === "newer";
      params.set("rvdir", isNewer ? "newer" : "older");

      if (options?.start && options?.end) {
        params.set("rvstart", formatTimestamp(isNewer ? options.start : options.end));
        params.set("rvend", formatTimestamp(isNewer ? options.end : options.start));
      } else if (options?.start) {
        params.set("rvstart", formatTimestamp(options.start));
      } else if (options?.end) {
        params.set("rvend", formatTimestamp(options.end));
      }
      if (options?.startRevId) {
        params.set("rvstartid", String(options.startRevId));
      }
      if (options?.endRevId) {
        params.set("rvendid", String(options.endRevId));
      }

      if (rvcontinue) {
        params.set("rvcontinue", rvcontinue);
      }

      const url = `${this.apiUrl}?${params.toString()}`;
      const data = await this.getJson<RevisionQueryResponse>(url);

      if (!data.query?.pages) {
        break;
      }

      for (const page of Object.values(data.query.pages)) {
        if (page.missing) continue;
        if (!pageInfo) {
          pageInfo = { pageId: page.pageid, title: page.title };
        }
        if (page.revisions) {
          for (const rev of page.revisions) {
            revisions.push(this.mapRevision(rev, pageInfo));
          }
        }
      }

      if (data.continue?.rvcontinue) {
        rvcontinue = data.continue.rvcontinue;
        if (options?.limit !== undefined && revisions.length >= options.limit) break;
      } else {
        break;
      }
    }

    // A page of content-bearing revisions holds at most 50, whatever rvlimit
    // asked for, so paging toward a limit can overshoot it by most of a page.
    return options?.limit !== undefined ? revisions.slice(0, options.limit) : revisions;
  }

  async fetchPageMoves(pageTitle: string): Promise<PageMove[]> {
    const moves: PageMove[] = [];
    let lecontinue: string | undefined;

    while (true) {
      const params = new URLSearchParams({
        action: "query",
        list: "logevents",
        letype: "move",
        letitle: pageTitle,
        lelimit: "50",
        format: "json",
        formatversion: "2",
      });

      if (lecontinue) params.set("lecontinue", lecontinue);

      const url = `${this.apiUrl}?${params.toString()}`;
      const data = await this.getJson<LogEventResponse & { continue?: { lecontinue: string } }>(url);

      if (!data.query?.logevents) break;

      for (const entry of data.query.logevents) {
        moves.push({
          oldTitle: entry.title,
          newTitle: entry.params?.target_title ?? "",
          timestamp: entry.timestamp,
          revId: entry.logid,
          comment: entry.comment ?? "",
        });
      }

      if (data.continue?.lecontinue) {
        lecontinue = data.continue.lecontinue;
      } else {
        break;
      }
    }

    return moves;
  }

  async fetchProtectionLogs(pageTitle: string): Promise<ProtectionLogEvent[]> {
    const events: ProtectionLogEvent[] = [];
    let lecontinue: string | undefined;

    while (true) {
      const params = new URLSearchParams({
        action: "query",
        list: "logevents",
        letype: "protect",
        letitle: pageTitle,
        lelimit: "50",
        // leprop replaces the default property set rather than adding to it.
        // "details" alone returned entries with no logid, title, timestamp,
        // comment or action, so every protection event came back undated.
        leprop: "ids|title|type|timestamp|comment|details",
        format: "json",
        formatversion: "2",
      });

      if (lecontinue) params.set("lecontinue", lecontinue);

      const url = `${this.apiUrl}?${params.toString()}`;
      const data = await this.getJson<{
        query?: {
          logevents?: Array<{
            logid: number;
            title: string;
            timestamp: string;
            comment: string;
            action: string;
            params?: {
              // The API names this "details"; "detail" is read too so a
              // fixture written against the old field still parses.
              details?: Array<{ type?: string; level?: string; expiry?: string }>;
              detail?: Array<{ type?: string; level?: string; expiry?: string }>;
              // Entries logged before details existed (about 2009–2014) carry
              // the levels only here: "[edit=autoconfirmed] (indefinite)".
              description?: string;
            };
          }>;
        };
        continue?: { lecontinue: string };
      }>(url);

      if (data.query?.logevents) {
        for (const entry of data.query.logevents) {
          const comment = entry.comment ?? "";
          const level = protectionLevel({
            comment,
            details: entry.params?.details ?? entry.params?.detail,
            description: entry.params?.description,
          });
          events.push({
            logId: entry.logid,
            pageTitle: entry.title,
            timestamp: entry.timestamp,
            comment,
            action: entry.action as "protect" | "unprotect" | "modify",
            ...(level ? { level } : {}),
            reasonCategory: protectionReasonCategory(comment),
          });
        }
      }

      if (data.continue?.lecontinue) {
        lecontinue = data.continue.lecontinue;
      } else {
        break;
      }
    }

    return events;
  }

  /**
   * Pages that currently link to a URL pattern, from `list=exturlusage` (what
   * Special:LinkSearch shows). `query` is a host with an optional path and no
   * protocol, e.g. `example.org` or `example.org/news`; a leading `*.` also
   * matches subdomains. Both http and https links match. Results are links
   * in the wiki's link table now: a link already removed from every page is
   * not found. Follows MediaWiki's `continue` protocol until done or until
   * `maxLinks` links have been read.
   */
  async fetchExternalLinkUsage(
    query: string,
    options: { namespace?: number; maxLinks?: number } = {},
  ): Promise<ExternalLinkUsage[]> {
    const links: ExternalLinkUsage[] = [];
    const max = options.maxLinks ?? Number.POSITIVE_INFINITY;
    let next: Record<string, string> = {};
    while (links.length < max) {
      const params = new URLSearchParams({
        action: "query",
        list: "exturlusage",
        euquery: query,
        euprop: "ids|title|url",
        eunamespace: String(options.namespace ?? 0),
        eulimit: "500",
        format: "json",
        formatversion: "2",
        ...next,
      });
      const data = await this.getJson<ExternalLinkUsageResponse>(`${this.apiUrl}?${params.toString()}`);
      for (const entry of data.query?.exturlusage ?? []) {
        if (links.length >= max) break;
        links.push({ pageId: entry.pageid, namespace: entry.ns, title: entry.title, url: entry.url });
      }
      if (!data.continue) break;
      // Pass every continuation value back, whatever its key: euoffset on
      // older MediaWiki, eucontinue on newer.
      next = Object.fromEntries(Object.entries(data.continue).map(([key, value]) => [key, String(value)]));
    }
    return links;
  }

  /**
   * The page's interlanguage links: for each other-language edition that has
   * the topic, its interwiki prefix and the page's title there, from
   * `prop=langlinks`. Follows a redirect from `pageTitle` first. Empty when
   * the page has none or does not exist.
   */
  async fetchLanguageLinks(pageTitle: string): Promise<LanguageLink[]> {
    const links: LanguageLink[] = [];
    let next: Record<string, string> = {};
    for (;;) {
      const params = new URLSearchParams({
        action: "query",
        prop: "langlinks",
        titles: pageTitle,
        redirects: "1",
        lllimit: "max",
        format: "json",
        formatversion: "2",
        ...next,
      });
      const data = await this.getJson<LanguageLinkResponse>(`${this.apiUrl}?${params.toString()}`);
      for (const page of data.query?.pages ?? []) {
        for (const link of page.langlinks ?? []) links.push({ lang: link.lang, title: link.title });
      }
      if (!data.continue) break;
      next = Object.fromEntries(Object.entries(data.continue).map(([key, value]) => [key, String(value)]));
    }
    return links;
  }

  /** The wiki's content language and database name, from `meta=siteinfo`. */
  async fetchSiteInfo(): Promise<SiteInfo> {
    const params = new URLSearchParams({
      action: "query",
      meta: "siteinfo",
      siprop: "general",
      format: "json",
      formatversion: "2",
    });
    const data = await this.getJson<SiteInfoResponse>(`${this.apiUrl}?${params.toString()}`);
    const general = data.query?.general;
    if (!general) throw new Error(`No site information from ${this.apiUrl}`);
    return { lang: general.lang, wikiId: general.wikiid, siteName: general.sitename };
  }

  async fetchEntities(query: SourceQuery): Promise<SourceEntity[]> {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query.query,
      srlimit: String(query.limit ?? 10),
      format: "json",
      formatversion: "2",
    });
    const data = await this.getJson<{
      query?: { search?: Array<{ title: string; pageid: number }> };
    }>(`${this.apiUrl}?${params.toString()}`);
    return (data.query?.search ?? []).map((r) => ({
      entityId: String(r.pageid),
      title: r.title,
      type: "page",
      metadata: { api: this.apiUrl },
    }));
  }

  async fetchDiff(fromRevId: number, toRevId: number): Promise<DiffResult> {
    const params = new URLSearchParams({
      action: "compare",
      fromrev: String(fromRevId),
      torev: String(toRevId),
      format: "json",
      formatversion: "2",
    });

    const url = `${this.apiUrl}?${params.toString()}`;
    const data = await this.getJson<CompareResponse>(url);

    if (!data.compare) {
      throw new Error(`Failed to fetch diff for revisions ${fromRevId} -> ${toRevId}`);
    }

    const sizeDelta = data.compare.tosize - data.compare.fromsize;
    const lines = data.compare["*"] ? parseUnifiedDiff(data.compare["*"]) : [];

    return {
      fromRevId: data.compare.fromrevid,
      toRevId: data.compare.torevid,
      lines,
      sections: [],
      sizeDelta,
    };
  }

  /**
   * GET a JSON response, treating an `error` object in a 200 body as the
   * failure it is: retried after the server's Retry-After when MediaWiki says
   * "not now" (maxlag, ratelimited, readonly), thrown as MediaWikiApiError
   * otherwise. Never returned as data.
   */
  private async getJson<T>(url: string): Promise<T> {
    const target = this.maxlag === undefined ? url : `${url}&maxlag=${this.maxlag}`;
    for (let attempt = 1; ; attempt++) {
      const response = await this.fetch(target);
      const data = (await response.json()) as T & { error?: { code?: string; info?: string } };
      const error = data?.error;
      if (!error) return data;

      const code = error.code ?? "unknown";
      if (RETRYABLE_API_ERRORS.has(code) && attempt < MAX_ATTEMPTS) {
        const waitMs = retryAfterMs(response.headers?.get?.("Retry-After")) ?? backoffMs(attempt);
        console.error(
          `refract: retrying request (attempt ${attempt + 1}/${MAX_ATTEMPTS}, API error ${code}, wait ${waitMs}ms)...`,
        );
        await this.sleep(waitMs);
        continue;
      }
      throw new MediaWikiApiError(code, error.info ?? "", target);
    }
  }

  private async fetch(url: string, retries = MAX_ATTEMPTS): Promise<Response> {
    for (let attempt = 0; attempt < retries; attempt++) {
      await this.rateLimiter.acquire();
      const headers: Record<string, string> = {
        "User-Agent": this.userAgent,
        Accept: "application/json",
        "Accept-Encoding": "gzip",
      };

      if (this.auth?.apiKey) {
        headers.Authorization = `Bearer ${this.auth.apiKey}`;
      } else if (this.auth?.apiUser && this.auth?.apiPassword) {
        const encoded = btoa(`${this.auth.apiUser}:${this.auth.apiPassword}`);
        headers.Authorization = `Basic ${encoded}`;
      }

      if (this.auth?.oauthClientId && this.auth?.oauthClientSecret) {
        headers["X-OAuth-Client-Id"] = this.auth.oauthClientId;
        headers["X-OAuth-Client-Secret"] = this.auth.oauthClientSecret;
      }

      let response: Response;
      try {
        response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(30000),
        });
      } catch (err) {
        // A reset connection or a timeout says nothing about the request
        // itself, so it gets the same retries as a 503 instead of ending the run.
        if (attempt < retries - 1) {
          const waitMs = backoffMs(attempt);
          console.error(
            `refract: retrying request (attempt ${attempt + 2}/${retries}, ${describeFailure(err)}, wait ${waitMs}ms)...`,
          );
          await this.sleep(waitMs);
          continue;
        }
        throw new Error(`MediaWiki API request failed for ${url}: ${describeFailure(err)}`);
      }

      if (response.ok) return response;

      if ((response.status === 429 || response.status >= 500) && attempt < retries - 1) {
        // Honour the server's Retry-After on a 503 as well as a 429; Wikimedia
        // sends one on both.
        const waitMs =
          retryAfterMs(response.headers?.get?.("Retry-After")) ?? (response.status === 429 ? 1000 : backoffMs(attempt));
        console.error(
          `refract: retrying request (attempt ${attempt + 2}/${retries}, status ${response.status}, wait ${waitMs}ms)...`,
        );
        await this.sleep(waitMs);
        continue;
      }

      throw new Error(`MediaWiki API error: ${response.status} ${response.statusText} for ${url}`);
    }

    throw new Error(`MediaWiki API request failed after ${retries} retries for ${url}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async *revisions(pageTitle: string, options?: RevisionOptions): AsyncIterable<Revision> {
    const revs = await this.fetchRevisions(pageTitle, options);
    for (const rev of revs) {
      yield rev;
    }
  }

  private mapRevision(raw: RawRevision, page: PageInfo): Revision {
    const content = raw.slots?.main?.content ?? "";
    return {
      revId: raw.revid,
      parentId: raw.parentid,
      contentAvailable: !raw.texthidden && typeof raw.slots?.main?.content === "string",
      pageId: page.pageId,
      pageTitle: page.title,
      timestamp: raw.timestamp,
      user: raw.userhidden ? undefined : raw.user,
      comment: raw.comment ?? "",
      content,
      size: raw.size,
      minor: raw.minor ?? false,
    };
  }

  private mapRevisionMetadata(raw: RawRevision, page: PageInfo): RevisionMetadata {
    return {
      revId: raw.revid,
      parentId: raw.parentid,
      pageId: page.pageId,
      pageTitle: page.title,
      timestamp: raw.timestamp,
      user: raw.userhidden ? undefined : raw.user,
      comment: raw.comment ?? "",
      size: raw.size,
      minor: raw.minor ?? false,
      sha1: raw.sha1,
    };
  }

  /**
   * Fetch lightweight revision metadata (without full wikitext) at up to 500
   * revisions per request (`rvlimit=500`), including MediaWiki's precomputed
   * `sha1` content digest. Scans multi-year histories (thousands of revisions)
   * roughly 10x–20x faster than content queries.
   */
  async fetchRevisionMetadata(pageTitle: string, options?: RevisionOptions): Promise<RevisionMetadata[]> {
    const metadata: RevisionMetadata[] = [];
    const perRequest = Math.min(options?.limit ?? MAX_REVISIONS_PER_REQUEST, MAX_REVISIONS_PER_REQUEST);
    let rvcontinue: string | undefined;
    let pageInfo: PageInfo | null = null;

    while (true) {
      const params = new URLSearchParams({
        action: "query",
        prop: "revisions",
        titles: pageTitle,
        rvprop: "ids|timestamp|flags|comment|size|user|sha1",
        rvlimit: String(perRequest),
        format: "json",
        formatversion: "2",
      });

      const isNewer = options?.direction === "newer";
      params.set("rvdir", isNewer ? "newer" : "older");

      if (options?.start && options?.end) {
        params.set("rvstart", formatTimestamp(isNewer ? options.start : options.end));
        params.set("rvend", formatTimestamp(isNewer ? options.end : options.start));
      } else if (options?.start) {
        params.set("rvstart", formatTimestamp(options.start));
      } else if (options?.end) {
        params.set("rvend", formatTimestamp(options.end));
      }
      if (options?.startRevId) {
        params.set("rvstartid", String(options.startRevId));
      }
      if (options?.endRevId) {
        params.set("rvendid", String(options.endRevId));
      }
      if (rvcontinue) {
        params.set("rvcontinue", rvcontinue);
      }

      const url = `${this.apiUrl}?${params.toString()}`;
      const data = await this.getJson<RevisionQueryResponse>(url);
      if (!data.query?.pages) break;

      for (const page of Object.values(data.query.pages)) {
        if (page.missing) continue;
        if (!pageInfo) {
          pageInfo = { pageId: page.pageid, title: page.title };
        }
        if (page.revisions) {
          for (const rev of page.revisions) {
            metadata.push(this.mapRevisionMetadata(rev, pageInfo));
          }
        }
      }

      if (data.continue?.rvcontinue) {
        rvcontinue = data.continue.rvcontinue;
        if (options?.limit !== undefined && metadata.length >= options.limit) break;
      } else {
        break;
      }
    }

    return options?.limit !== undefined ? metadata.slice(0, options.limit) : metadata;
  }

  /**
   * Hydrate full wikitext content for an arbitrary set of revision IDs using
   * MediaWiki's `revids=` batch parameter (up to 50 revision IDs per request)
   * with bounded concurrency and optional SHA-1 content deduplication.
   */
  async fetchRevisionsByIds(
    revIds: readonly number[],
    options?: {
      concurrency?: number;
      metadataByRevId?: ReadonlyMap<number, RevisionMetadata>;
    },
  ): Promise<Revision[]> {
    const uniqueIds = [...new Set(revIds)];
    if (uniqueIds.length === 0) return [];

    const metadataByRevId = options?.metadataByRevId;
    const sha1CanonicalRevId = new Map<string, number>();
    const idsToFetch: number[] = [];

    if (metadataByRevId) {
      for (const id of uniqueIds) {
        const meta = metadataByRevId.get(id);
        if (meta?.sha1) {
          const existing = sha1CanonicalRevId.get(meta.sha1);
          if (existing !== undefined) {
            continue;
          }
          sha1CanonicalRevId.set(meta.sha1, id);
        }
        idsToFetch.push(id);
      }
    } else {
      idsToFetch.push(...uniqueIds);
    }

    const fetchedByRevId = new Map<number, Revision>();
    await this.queryRevisionsById(
      idsToFetch,
      { rvprop: "content|ids|timestamp|flags|comment|size|user", rvslots: "main" },
      options?.concurrency,
      (raw, info) => fetchedByRevId.set(raw.revid, this.mapRevision(raw, info)),
    );

    const results: Revision[] = [];
    for (const id of uniqueIds) {
      const direct = fetchedByRevId.get(id);
      if (direct) {
        results.push(direct);
        continue;
      }
      const meta = metadataByRevId?.get(id);
      const canonicalId = meta?.sha1 ? sha1CanonicalRevId.get(meta.sha1) : undefined;
      const canonicalRev = canonicalId !== undefined ? fetchedByRevId.get(canonicalId) : undefined;
      if (meta && canonicalRev) {
        results.push({
          revId: meta.revId,
          parentId: meta.parentId,
          contentAvailable: canonicalRev.contentAvailable,
          pageId: meta.pageId,
          pageTitle: meta.pageTitle,
          timestamp: meta.timestamp,
          user: meta.user,
          comment: meta.comment,
          content: canonicalRev.content,
          size: meta.size,
          minor: meta.minor,
        });
      }
    }

    results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return results;
  }

  /**
   * One section of each revision, from `rvsection`, keyed by revision ID:
   * section 0 is the lead, and sections after it are numbered in page order,
   * each with its subsections. Reads up to 50 revisions a request, as
   * `fetchRevisionsByIds` does. A revision without that section, whose text is
   * hidden, or that does not exist has no entry.
   */
  async fetchSections(revIds: readonly number[], section: number): Promise<Map<number, string>> {
    if (!Number.isInteger(section) || section < 0) {
      throw new RangeError(`section must be a non-negative integer, got ${section}`);
    }
    const contents = new Map<number, string>();
    await this.queryRevisionsById(
      [...new Set(revIds)],
      { rvprop: "ids|content", rvslots: "main", rvsection: String(section) },
      undefined,
      (raw) => {
        // A revision without the section comes back as `nosuchsection`, with no content.
        const content = raw.slots?.main?.content;
        if (typeof content === "string") contents.set(raw.revid, content);
      },
    );
    return contents;
  }

  /**
   * The page a title names, after following redirects and normalizing it
   * ("UK" → United Kingdom), with its page ID and namespace number. Null when
   * the page does not exist, the title is invalid, or it names a special page
   * or another wiki.
   */
  async resolveTitle(title: string): Promise<ResolvedTitle | null> {
    // `titles` takes a |-separated list; a title cannot contain one.
    if (title.includes("|")) return null;
    const params = new URLSearchParams({
      action: "query",
      titles: title,
      redirects: "1",
      format: "json",
      formatversion: "2",
    });
    const data = await this.getJson<TitleQueryResponse>(`${this.apiUrl}?${params.toString()}`);
    const page = data.query?.pages?.[0];
    if (!page || page.missing || page.invalid || page.pageid === undefined || page.ns === undefined) return null;
    return { pageId: page.pageid, title: page.title, ns: page.ns };
  }

  /**
   * The revision that was live at a moment, the last one made at or before
   * it, with up to `around` revisions either side, each with `sha1` and size
   * so a caller can tell whether the live one was a state soon reverted
   * (`findRevertedStates`). `title` is read as given; resolve a redirect with
   * `resolveTitle` first. Two requests.
   */
  async revisionAt(title: string, isoDateTime: string, options?: { around?: number }): Promise<RevisionAtResult> {
    const moment = new Date(isoDateTime);
    if (Number.isNaN(moment.getTime())) throw new RangeError(`Not a date-time: ${isoDateTime}`);
    const around = options?.around ?? 10;
    if (!Number.isInteger(around) || around < 0) {
      throw new RangeError(`around must be a non-negative integer, got ${around}`);
    }

    const [revision = null, ...earlier] = await this.fetchRevisionMetadata(title, {
      start: moment,
      direction: "older",
      limit: around + 1,
    });
    let after: RevisionMetadata[] = [];
    if (around > 0) {
      // From the live revision's own position, so a revision made in the same
      // second as it is still read; or from the moment, when none was live.
      const later = await this.fetchRevisionMetadata(title, {
        ...(revision ? { startRevId: revision.revId } : { start: moment }),
        direction: "newer",
        limit: around + 1,
      });
      after = later.filter((m) => m.revId !== revision?.revId).slice(0, around);
    }
    return { revision, before: earlier.reverse(), after };
  }

  /**
   * `prop=revisions` for `revIds`, 50 to a request, with at most `concurrency`
   * requests in flight (default 3), calling `visit` with each revision returned.
   */
  private async queryRevisionsById(
    revIds: readonly number[],
    params: Record<string, string>,
    concurrency: number | undefined,
    visit: (raw: RawRevision, page: PageInfo) => void,
  ): Promise<void> {
    const batches: number[][] = [];
    for (let i = 0; i < revIds.length; i += MAX_REVIDS_PER_REQUEST) {
      batches.push(revIds.slice(i, i + MAX_REVIDS_PER_REQUEST));
    }

    // Wikimedia asks API clients to keep at most 3 requests in flight
    // (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits).
    const workers = Math.max(1, Math.min(concurrency ?? 3, 8));
    let cursor = 0;
    const runWorker = async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor++];
        const query = new URLSearchParams({
          action: "query",
          prop: "revisions",
          revids: batch.join("|"),
          ...params,
          format: "json",
          formatversion: "2",
        });
        const data = await this.getJson<RevisionQueryResponse>(`${this.apiUrl}?${query.toString()}`);
        for (const page of Object.values(data.query?.pages ?? {})) {
          if (page.missing || !page.revisions) continue;
          const info: PageInfo = { pageId: page.pageid, title: page.title };
          for (const raw of page.revisions) visit(raw, info);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(workers, batches.length) }, () => runWorker()));
  }

  /**
   * Ingest a multi-year revision history without the small-window bottleneck:
   * 1. Scans 100% of revision metadata in the date range at 500 revisions/request.
   * 2. Computes full-history telemetry (monthly velocity, SHA-1 & summary reverts,
   *    pseudonymous actor revert pairs) across every revision in the window.
   * 3. Selects stratified longitudinal checkpoints + high-signal structural/revert
   *    revisions across the entire time span and hydrates their content in parallel batches.
   */
  async fetchLongitudinalHistory(
    pageTitle: string,
    options?: LongitudinalHistoryOptions,
  ): Promise<LongitudinalHistoryResult> {
    const limit = options?.maxMetadataRevisions;
    // One row past the limit tells a history that was cut short from one
    // that happens to be exactly that long.
    const fetched = await this.fetchRevisionMetadata(pageTitle, {
      start: options?.start,
      end: options?.end,
      startRevId: options?.startRevId,
      endRevId: options?.endRevId,
      direction: options?.direction ?? "older",
      ...(limit !== undefined ? { limit: limit + 1 } : {}),
    });
    const truncated = limit !== undefined && fetched.length > limit;
    const metadata = truncated ? fetched.slice(0, limit) : fetched;

    const sortedMeta = [...metadata].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const telemetry = computeFullHistoryTelemetry(sortedMeta);
    const excludeOption = options?.excludeRevertedStates ?? true;
    const selection = selectLongitudinalRevisionsWithExclusions(sortedMeta, options?.maxContentRevisions ?? 120, {
      excludeRevertedStates: excludeOption,
      timeCoverage: options?.timeCoverage,
    });
    const metadataByRevId = new Map(sortedMeta.map((m) => [m.revId, m]));
    const revisions = await this.fetchRevisionsByIds(
      selection.selected.map((m) => m.revId),
      {
        concurrency: options?.concurrency ?? 3,
        metadataByRevId,
      },
    );

    return {
      metadata: sortedMeta,
      selectedMetadata: selection.selected,
      revisions,
      telemetry,
      coverage: {
        metadataRevisions: sortedMeta.length,
        truncated,
        ...(limit !== undefined ? { maxMetadataRevisions: limit } : {}),
        direction: options?.direction ?? "older",
        revertedStatesExcluded: selection.revertedStates.size,
        ...(selection.rules
          ? {
              revertedStateWindowHours: selection.rules.windowHours,
              revertedStateNearRestorations: selection.rules.nearRestorations,
            }
          : {}),
      },
    };
  }
}

export interface RevisionMetadata {
  revId: number;
  parentId: number;
  pageId: number;
  pageTitle: string;
  timestamp: string;
  user?: string;
  comment: string;
  size: number;
  minor: boolean;
  sha1?: string;
}

export interface MonthlyVelocityBucket {
  month: string;
  revisions: number;
  summaryReverts: number;
  sha1IdentityReverts: number;
  distinctActors: number;
  netBytesDelta: number;
  maxAbsByteDelta: number;
}

export interface FullHistoryTelemetry {
  pageTitle: string;
  totalRevisions: number;
  fromRevId?: number;
  toRevId?: number;
  fromTimestamp?: string;
  toTimestamp?: string;
  distinctActors: number;
  summaryReverts: number;
  sha1IdentityReverts: number;
  topRevertPairs: Array<[string, number]>;
  topActorsByRevisions: Array<[string, number]>;
  monthlyVelocity: MonthlyVelocityBucket[];
}

export interface LongitudinalHistoryOptions extends RevisionOptions, Pick<SelectLongitudinalOptions, "timeCoverage"> {
  /** Maximum number of full-text revisions to hydrate across the window (default: 120). */
  maxContentRevisions?: number;
  /**
   * Maximum number of metadata rows to scan at 500/request. Default: no limit,
   * so the whole history in the window is read. With a limit, the rows kept are
   * the newest (`direction: "older"`, the default) or the oldest (`"newer"`),
   * and `coverage.truncated` says whether rows were left out.
   */
  maxMetadataRevisions?: number;
  /** Parallel batch concurrency for `revids=` queries (default: 3, Wikimedia's limit). */
  concurrency?: number;
  /**
   * Leave states that a later edit reverted out of the hydrated sample, and
   * fill their slots with states that survived. See `findRevertedStates`.
   * `true` (the default) uses its defaults: a 48-hour window, near-restorations
   * included. An object sets `windowHours` or `nearRestorations`; `false` keeps
   * every state. Telemetry is computed from the full metadata either way.
   */
  excludeRevertedStates?: boolean | RevertedStateOptions;
}

export interface LongitudinalCoverage {
  /** Metadata rows read, and the population telemetry was computed over. */
  metadataRevisions: number;
  /** Whether the page has revisions in the window that `maxMetadataRevisions` left out. */
  truncated: boolean;
  maxMetadataRevisions?: number;
  /** Which end of the history was kept when truncated. */
  direction: "older" | "newer";
  /** Revisions left out of the sample as reverted states. */
  revertedStatesExcluded: number;
  /** The reverted-state window, when exclusion was on. */
  revertedStateWindowHours?: number;
  /** Whether near-restorations counted as reverts, when exclusion was on. */
  revertedStateNearRestorations?: boolean;
}

export interface LongitudinalHistoryResult {
  metadata: RevisionMetadata[];
  selectedMetadata: RevisionMetadata[];
  revisions: Revision[];
  telemetry: FullHistoryTelemetry;
  coverage: LongitudinalCoverage;
}

const SUMMARY_REVERT_REGEX =
  /\b(?:revert(?:ed|ing)?|undid\s+revision|rvv?|rollback)\b|(?:استرجاع|رجوع|إلغاء\s+تعديل|استعادة\s+النسخة)/i;

/**
 * Compute 100%-coverage telemetry across an arbitrarily large metadata history
 * (thousands of revisions over multiple years) using timestamps, sizes, edit
 * summaries, precomputed SHA-1 content hashes, and run-scoped actor pseudonyms.
 */
export function computeFullHistoryTelemetry(metadata: readonly RevisionMetadata[]): FullHistoryTelemetry {
  const sorted = [...metadata].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const pageTitle = sorted[0]?.pageTitle ?? "";

  const pseudonyms = new Map<string, string>();
  let nextActorIdx = 1;
  for (const m of sorted) {
    if (m.user && !pseudonyms.has(m.user)) {
      pseudonyms.set(m.user, `Actor_${nextActorIdx++}`);
    }
  }

  const actorRevCounts = new Map<string, number>();
  const revertPairs = new Map<string, number>();
  const sha1FirstRev = new Map<string, RevisionMetadata>();
  const monthlyMap = new Map<
    string,
    {
      revisions: number;
      summaryReverts: number;
      sha1IdentityReverts: number;
      actors: Set<string>;
      netBytesDelta: number;
      maxAbsByteDelta: number;
    }
  >();

  let summaryReverts = 0;
  let sha1IdentityReverts = 0;

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : undefined;
    const month = cur.timestamp.slice(0, 7);
    let bucket = monthlyMap.get(month);
    if (!bucket) {
      bucket = {
        revisions: 0,
        summaryReverts: 0,
        sha1IdentityReverts: 0,
        actors: new Set<string>(),
        netBytesDelta: 0,
        maxAbsByteDelta: 0,
      };
      monthlyMap.set(month, bucket);
    }

    bucket.revisions++;
    const curPseudo = cur.user ? pseudonyms.get(cur.user) : undefined;
    if (curPseudo) {
      bucket.actors.add(curPseudo);
      actorRevCounts.set(curPseudo, (actorRevCounts.get(curPseudo) ?? 0) + 1);
    }

    if (prev) {
      const delta = cur.size - prev.size;
      bucket.netBytesDelta += delta;
      const absDelta = Math.abs(delta);
      if (absDelta > bucket.maxAbsByteDelta) {
        bucket.maxAbsByteDelta = absDelta;
      }
    }

    const isSummaryRevert = SUMMARY_REVERT_REGEX.test(cur.comment);
    let isSha1Revert = false;
    if (cur.sha1) {
      const matchedEarlier = sha1FirstRev.get(cur.sha1);
      if (matchedEarlier && (!prev || prev.sha1 !== cur.sha1)) {
        isSha1Revert = true;
      } else if (!matchedEarlier) {
        sha1FirstRev.set(cur.sha1, cur);
      }
    }

    if (isSummaryRevert) {
      summaryReverts++;
      bucket.summaryReverts++;
    }
    if (isSha1Revert) {
      sha1IdentityReverts++;
      bucket.sha1IdentityReverts++;
    }

    if ((isSummaryRevert || isSha1Revert) && prev) {
      const prevPseudo = prev.user ? pseudonyms.get(prev.user) : undefined;
      if (curPseudo && prevPseudo) {
        const pairKey = `${curPseudo} ↺ ${prevPseudo}`;
        revertPairs.set(pairKey, (revertPairs.get(pairKey) ?? 0) + 1);
      }
    }
  }

  const monthlyVelocity: MonthlyVelocityBucket[] = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, b]) => ({
      month,
      revisions: b.revisions,
      summaryReverts: b.summaryReverts,
      sha1IdentityReverts: b.sha1IdentityReverts,
      distinctActors: b.actors.size,
      netBytesDelta: b.netBytesDelta,
      maxAbsByteDelta: b.maxAbsByteDelta,
    }));

  return {
    pageTitle,
    totalRevisions: sorted.length,
    fromRevId: sorted[0]?.revId,
    toRevId: sorted[sorted.length - 1]?.revId,
    fromTimestamp: sorted[0]?.timestamp,
    toTimestamp: sorted[sorted.length - 1]?.timestamp,
    distinctActors: pseudonyms.size,
    summaryReverts,
    sha1IdentityReverts,
    topRevertPairs: [...revertPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    topActorsByRevisions: [...actorRevCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    monthlyVelocity,
  };
}

/** One calendar year (UTC) of `yearlyPressure`. */
export interface YearlyPressure {
  year: number;
  /** Revisions of the page made that year. */
  edits: number;
  /** Of those, revisions that were reverted states. */
  revertedEdits: number;
  /** `revertedEdits / edits`; null in a year without edits. */
  revertedShare: number | null;
  /** Talk-page revisions made that year. */
  talkEdits: number;
  /** Protection log entries that set or changed protection (`protect` and `modify`; not `unprotect`). */
  protections: number;
  /** Of those, entries whose comment names a content dispute (`reasonCategory: "content_dispute"`). */
  contentDisputeProtections: number;
}

export interface YearlyPressureInput {
  /** Timestamps of the talk page's revisions, e.g. from `fetchRevisionMetadata("Talk:…")`. */
  talkTimestamps: readonly string[];
  /** The page's protection log, from `fetchProtectionLogs`. */
  protections: readonly Pick<ProtectionLogEvent, "timestamp" | "action" | "reasonCategory">[];
  /** Revision IDs of reverted states. Default: `findRevertedStates(metadata)`. */
  revertedStates?: ReadonlySet<number>;
}

/**
 * Per calendar year (UTC), from the first year any input touches to the
 * last, with zeros in between: the page's edits and how many were reverted
 * states, talk-page edits, and protections, counting those whose stated reason
 * is a content dispute. These are counts of what the histories record; reading
 * a year as settled or contested is left to the caller. Citation density per
 * year can be added from analyzed revisions with `countCitations` in
 * `@refract-org/analyzers`.
 */
export function yearlyPressure(metadata: readonly RevisionMetadata[], input: YearlyPressureInput): YearlyPressure[] {
  const revertedStates = input.revertedStates ?? findRevertedStates(metadata);
  const protections = input.protections.filter((p) => p.action === "protect" || p.action === "modify");
  const yearOf = (timestamp: string) => Number(timestamp.slice(0, 4));
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const timestamp of [
    ...metadata.map((m) => m.timestamp),
    ...input.talkTimestamps,
    ...protections.map((p) => p.timestamp),
  ]) {
    first = Math.min(first, yearOf(timestamp));
    last = Math.max(last, yearOf(timestamp));
  }

  const rows = new Map<number, YearlyPressure>();
  for (let year = first; year <= last; year++) {
    rows.set(year, {
      year,
      edits: 0,
      revertedEdits: 0,
      revertedShare: null,
      talkEdits: 0,
      protections: 0,
      contentDisputeProtections: 0,
    });
  }
  const row = (timestamp: string) => rows.get(yearOf(timestamp)) as YearlyPressure;
  for (const m of metadata) {
    const r = row(m.timestamp);
    r.edits++;
    if (revertedStates.has(m.revId)) r.revertedEdits++;
  }
  for (const timestamp of input.talkTimestamps) row(timestamp).talkEdits++;
  for (const p of protections) {
    const r = row(p.timestamp);
    r.protections++;
    if (p.reasonCategory === "content_dispute") r.contentDisputeProtections++;
  }
  for (const r of rows.values()) r.revertedShare = r.edits > 0 ? r.revertedEdits / r.edits : null;
  return [...rows.values()];
}

/**
 * Deterministically select a longitudinal subset of revisions spanning the entire
 * multi-year window `[first, last]`:
 * 1. Anchors the first and last revision of each calendar month. When those
 *    exceed 55% of the budget, it takes that many revisions evenly spaced by
 *    position in the history instead, which crowds the sample into busy years.
 *    `timeCoverage` replaces this step with checkpoints evenly spaced in time.
 * 2. Fills the remaining budget with the highest-signal structural edits (largest
 *    `|Δsize|` transitions and explicit reverts) together with their parent revision
 *    so localized transitions are preserved.
 */
export function selectLongitudinalRevisions(
  metadata: readonly RevisionMetadata[],
  maxRevisions: number = 120,
  options?: SelectLongitudinalOptions,
): RevisionMetadata[] {
  return selectLongitudinalRevisionsWithExclusions(metadata, maxRevisions, options).selected;
}

export interface SelectLongitudinalOptions {
  /**
   * Leave out states a later edit reverted (`findRevertedStates`), with its
   * defaults for `true` or the options given. Default for this function:
   * `false`, the selection it has always made; `fetchLongitudinalHistory`
   * turns it on.
   */
  excludeRevertedStates?: boolean | RevertedStateOptions;
  /**
   * The share of the budget, from 0 to 1, spent on checkpoints evenly spaced
   * in time from the first revision to the last: at each, the last revision
   * made at or before it (the last surviving one, with `excludeRevertedStates`).
   * The rest goes to the high-signal picks. A quiet stretch whose checkpoints
   * all land on one revision leaves the spare slots to those picks. Unset, the
   * month anchors are used instead.
   */
  timeCoverage?: number;
}

export interface RevertedStateOptions {
  /** How soon after the first reverted state the restoration must come. Default 48. */
  windowHours?: number;
  /**
   * Also count states repaired by hand, which leave no `sha1` match: a size
   * change of 30% or more from a surviving state, then, within the window, a
   * revision within 1% of the size before it. Default `true`. See
   * `findRevertedStates` for what it costs.
   */
  nearRestorations?: boolean;
}

const DEFAULT_REVERTED_STATE_WINDOW_HOURS = 48;
/** A size change at least this share of the size before it can open a near-restoration. */
const NEAR_RESTORATION_CHANGE = 0.3;
/** A later size within this share of the size before the change restores it. */
const NEAR_RESTORATION_TOLERANCE = 0.01;

/**
 * Revisions whose state a later edit undid by restoring an earlier state.
 *
 * Exact restorations: revisions are read in time order, remembering the last
 * revision with each `sha1`. When revision j has the same `sha1` as an
 * earlier revision k that is not directly before it, j put k's text back, and
 * every revision from k+1 to j−1 is a state that was reverted — provided the
 * first of them, k+1, was made no more than `windowHours` before j. The window
 * is measured from the first reverted edit rather than from k, so a page left
 * alone for a year and then vandalised and reverted within the hour still
 * counts. Revisions without a `sha1` (text suppressed) neither restore nor are
 * matched.
 *
 * Near-restorations (`nearRestorations`, on by default) catch damage repaired
 * by hand, which no `sha1` matches: when revision i changes the size of the
 * revision before it, itself not a reverted state, by 30% or more, and a
 * revision j no more than `windowHours` after i comes back within 1% of that
 * earlier size, i to j−1 are reverted states. Anarchism lost a third of its
 * text on 13 October 2004 and got it back by hand four minutes later, 42 bytes
 * short. The cost is a large edit that really was undone by hand and then
 * redone, whose first appearance counts as reverted, and ordinary edits that
 * happen to end the window within 1% of where a large change began. Over
 * Pluto, Anarchism, Stoicism and Mutualism's 35,957 revisions the rule adds 11
 * states to the 9,063 the exact rule finds, and 2 of the 11 are such edits.
 * `nearRestorations: false` gives the exact rule alone.
 *
 * A number for `options` is the window in hours.
 */
export function findRevertedStates(
  metadata: readonly RevisionMetadata[],
  options: number | RevertedStateOptions = {},
): Set<number> {
  const { windowHours = DEFAULT_REVERTED_STATE_WINDOW_HOURS, nearRestorations = true } =
    typeof options === "number" ? { windowHours: options } : options;
  const sorted = [...metadata].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const times = sorted.map((m) => new Date(m.timestamp).getTime());
  const windowMs = windowHours * 60 * 60 * 1000;
  const lastIndexBySha1 = new Map<string, number>();
  const reverted = new Set<number>();
  for (let j = 0; j < sorted.length; j++) {
    const sha1 = sorted[j].sha1;
    if (!sha1) continue;
    const k = lastIndexBySha1.get(sha1);
    if (k !== undefined && j - k >= 2 && times[j] - times[k + 1] <= windowMs) {
      for (let r = k + 1; r < j; r++) reverted.add(sorted[r].revId);
    }
    lastIndexBySha1.set(sha1, j);
  }
  if (!nearRestorations) return reverted;

  for (let i = 1; i < sorted.length; i++) {
    // A change is measured from a state that survived. Measured from a
    // vandalised one, the revert that repaired it is itself a large change,
    // and the vandal's next blanking brings the size back.
    if (reverted.has(sorted[i - 1].revId)) continue;
    const base = sorted[i - 1].size;
    if (base <= 0 || Math.abs(sorted[i].size - base) < NEAR_RESTORATION_CHANGE * base) continue;
    for (let j = i + 1; j < sorted.length && times[j] - times[i] <= windowMs; j++) {
      if (Math.abs(sorted[j].size - base) <= NEAR_RESTORATION_TOLERANCE * base) {
        for (let r = i; r < j; r++) reverted.add(sorted[r].revId);
        break;
      }
    }
  }
  return reverted;
}

function selectLongitudinalRevisionsWithExclusions(
  metadata: readonly RevisionMetadata[],
  maxRevisions: number,
  options?: SelectLongitudinalOptions,
): {
  selected: RevisionMetadata[];
  revertedStates: Set<number>;
  rules?: { windowHours: number; nearRestorations: boolean };
} {
  const timeCoverage = options?.timeCoverage;
  if (timeCoverage !== undefined && !(timeCoverage >= 0 && timeCoverage <= 1)) {
    throw new RangeError(`timeCoverage must be between 0 and 1, got ${timeCoverage}`);
  }
  const exclude = options?.excludeRevertedStates ?? false;
  if (exclude === false) {
    return { selected: selectFromSorted(metadata, maxRevisions, { timeCoverage }), revertedStates: new Set() };
  }
  const rules = {
    windowHours: (exclude === true ? undefined : exclude.windowHours) ?? DEFAULT_REVERTED_STATE_WINDOW_HOURS,
    nearRestorations: (exclude === true ? undefined : exclude.nearRestorations) ?? true,
  };
  const revertedStates = findRevertedStates(metadata, rules);
  // Selection runs over the surviving states only, so size deltas and month
  // anchors are measured between states readers saw for longer than the window.
  // A revert then sits next to the state it restored, a zero-size transition.
  const surviving = metadata.filter((m) => !revertedStates.has(m.revId));
  return {
    selected: selectFromSorted(surviving, maxRevisions, { skipUnchanged: true, timeCoverage }),
    revertedStates,
    rules,
  };
}

function selectFromSorted(
  metadata: readonly RevisionMetadata[],
  maxRevisions: number,
  options: { skipUnchanged?: boolean; timeCoverage?: number } = {},
): RevisionMetadata[] {
  const sorted = [...metadata].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (sorted.length <= maxRevisions || maxRevisions < 2) {
    return sorted.slice(0, Math.max(sorted.length, maxRevisions));
  }

  const selectedIndices = new Set<number>([0, sorted.length - 1]);

  // Phase 1: anchors across the entire multi-year range, by calendar month or
  // at moments evenly spaced in time.
  const anchors =
    options.timeCoverage === undefined
      ? monthAnchors(sorted, maxRevisions)
      : timeCheckpoints(sorted, Math.round(maxRevisions * options.timeCoverage));
  for (const idx of anchors) selectedIndices.add(idx);

  // Phase 2: High-signal structural transitions (|Δsize| + non-trivial edits) across the full history
  const scoredTransitions: Array<{ idx: number; score: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    if (selectedIndices.has(i)) continue;
    const prev = sorted[i - 1];
    const cur = sorted[i];
    // Among surviving states, a revert follows the state it restored: the text
    // did not change, so neither it nor its parent adds a state to the sample.
    if (options.skipUnchanged && cur.sha1 && cur.sha1 === prev.sha1) continue;
    const absDelta = Math.abs(cur.size - prev.size);
    const isRevert = SUMMARY_REVERT_REGEX.test(cur.comment);
    // Prioritize large structural additions/removals and significant reverts
    const score = absDelta + (isRevert ? 1500 : 0);
    scoredTransitions.push({ idx: i, score });
  }
  scoredTransitions.sort((a, b) => b.score - a.score);

  for (const { idx } of scoredTransitions) {
    if (selectedIndices.size >= maxRevisions) break;
    selectedIndices.add(idx);
    if (selectedIndices.size < maxRevisions && idx > 0) {
      selectedIndices.add(idx - 1);
    }
  }

  return [...selectedIndices].sort((a, b) => a - b).map((idx) => sorted[idx]);
}

/**
 * The first and last revision of each calendar month, or, when those exceed
 * 55% of the budget, that many revisions evenly spaced by position.
 */
function monthAnchors(sorted: readonly RevisionMetadata[], maxRevisions: number): number[] {
  const monthFirstIdx = new Map<string, number>();
  const monthLastIdx = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i].timestamp.slice(0, 7);
    if (!monthFirstIdx.has(m)) monthFirstIdx.set(m, i);
    monthLastIdx.set(m, i);
  }
  const monthAnchorBudget = Math.floor(maxRevisions * 0.55);
  const monthIndices = [...new Set([...monthFirstIdx.values(), ...monthLastIdx.values()])].sort((a, b) => a - b);
  if (monthIndices.length <= monthAnchorBudget) return monthIndices;
  return Array.from({ length: monthAnchorBudget }, (_, k) =>
    Math.round((k / Math.max(1, monthAnchorBudget - 1)) * (sorted.length - 1)),
  );
}

/**
 * For `count` moments evenly spaced from the first revision's timestamp to
 * the last's, the index of the last revision made at or before each. Moments
 * in a quiet stretch share an index.
 */
function timeCheckpoints(sorted: readonly RevisionMetadata[], count: number): number[] {
  const times = sorted.map((m) => new Date(m.timestamp).getTime());
  const first = times[0];
  const last = times[times.length - 1];
  const indices: number[] = [];
  let idx = 0;
  for (let k = 0; k < count; k++) {
    const moment = count === 1 ? last : first + ((last - first) * k) / (count - 1);
    while (idx + 1 < times.length && times[idx + 1] <= moment) idx++;
    indices.push(idx);
  }
  return indices;
}

function formatTimestamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, -5)}Z`;
}

function parseUnifiedDiff(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const textLines = diffText.split("\n");

  let fromLine = 0;
  let toLine = 0;

  for (const line of textLines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        fromLine = parseInt(match[1], 10);
        toLine = parseInt(match[2], 10);
      }
      continue;
    }

    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }

    if (line.startsWith(" ")) {
      lines.push({ type: "unchanged", content: line.slice(1), lineNumber: toLine });
      fromLine++;
      toLine++;
    } else if (line.startsWith("-")) {
      lines.push({ type: "removed", content: line.slice(1), lineNumber: fromLine });
      fromLine++;
    } else if (line.startsWith("+")) {
      lines.push({ type: "added", content: line.slice(1), lineNumber: toLine });
      toLine++;
    }
  }

  return lines;
}
