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
import { RateLimiter } from "./rate-limiter.js";

const DEFAULT_API_URL = "https://en.wikipedia.org/w/api.php";
export const DEFAULT_USER_AGENT = "Refract/0.1.0 (https://github.com/refract-org/refract; refract@nextconsensus.com)";
const MAX_REVISIONS_PER_REQUEST = 500;
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
            };
          }>;
        };
        continue?: { lecontinue: string };
      }>(url);

      if (data.query?.logevents) {
        for (const entry of data.query.logevents) {
          const level = (entry.params?.details ?? entry.params?.detail)?.[0]?.level;
          events.push({
            logId: entry.logid,
            pageTitle: entry.title,
            timestamp: entry.timestamp,
            comment: entry.comment ?? "",
            action: entry.action as "protect" | "unprotect" | "modify",
            level,
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
