import type { Revision } from "@refract-org/evidence-graph";
import type { RevisionOptions, RevisionSource } from "./index.js";
import { RateLimiter } from "./rate-limiter.js";

export interface WaybackSourceOptions {
  /** Optional custom fetch implementation (useful for tests or proxies) */
  fetchFn?: typeof fetch;
  /** Minimum delay between requests in milliseconds. Default: 250ms */
  rateLimitMs?: number;
  /** Custom CDX server URL. Default: https://web.archive.org/cdx/search/cdx */
  cdxApiUrl?: string;
  /** Custom snapshot archive base. Default: https://web.archive.org/web */
  archiveBaseUrl?: string;
}

interface CdxRow {
  timestamp: string;
  original: string;
  digest: string;
}

function parseWaybackTimestamp(ts: string): string {
  // Format: YYYYMMDDhhmmss
  const year = ts.slice(0, 4);
  const month = ts.slice(4, 6);
  const day = ts.slice(6, 8);
  const hour = ts.slice(8, 10) || "00";
  const min = ts.slice(10, 12) || "00";
  const sec = ts.slice(12, 14) || "00";
  return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
}

function extractReadableText(html: string): string {
  // Strip comments, scripts, styles deterministically
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const noScripts = noComments.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  const noStyles = noScripts.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  // Replace block tags with newlines
  const blockReplaced = noStyles.replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n");
  // Strip all other HTML tags
  const tagsStripped = blockReplaced.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  const decoded = tagsStripped
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Normalize whitespace lines
  return decoded
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Ingests revisions from the Internet Archive Wayback Machine.
 * Allows tracking the evolution and modification of any archived public URL over time.
 */
export class WaybackRevisionSource implements RevisionSource {
  private fetchFn: typeof fetch;
  private rateLimiter: RateLimiter;
  private cdxApiUrl: string;
  private archiveBaseUrl: string;

  constructor(options?: WaybackSourceOptions) {
    this.fetchFn = options?.fetchFn ?? fetch;
    this.rateLimiter = new RateLimiter(options?.rateLimitMs ?? 250);
    this.cdxApiUrl = options?.cdxApiUrl ?? "https://web.archive.org/cdx/search/cdx";
    this.archiveBaseUrl = options?.archiveBaseUrl ?? "https://web.archive.org/web";
  }

  async *revisions(targetUrl: string, options?: RevisionOptions): AsyncIterable<Revision> {
    await this.rateLimiter.acquire();

    // Query CDX API for snapshots
    const cdxUrl = new URL(this.cdxApiUrl);
    cdxUrl.searchParams.set("url", targetUrl);
    cdxUrl.searchParams.set("output", "json");
    cdxUrl.searchParams.set("filter", "statuscode:200");
    cdxUrl.searchParams.set("fl", "timestamp,original,digest");

    // A failed index request is an error, not an empty history: returning
    // nothing made an unreachable archive read as a page never archived.
    let rows: string[][];
    let res: Response;
    try {
      res = await this.fetchFn(cdxUrl.toString());
    } catch (error) {
      throw new Error(
        `Wayback Machine index request failed for ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!res.ok) throw new Error(`Wayback Machine index returned HTTP ${res.status} for ${targetUrl}`);
    try {
      rows = (await res.json()) as string[][];
    } catch {
      // The index answers an empty body, not "[]", for a URL it has never captured.
      return;
    }

    if (!Array.isArray(rows) || rows.length <= 1) return;

    // First row is headers: ["timestamp", "original", "digest"]
    const snapshots: CdxRow[] = rows.slice(1).map(([timestamp, original, digest]) => ({
      timestamp,
      original,
      digest,
    }));

    // Filter by timestamp range
    const filteredSnapshots = snapshots.filter((s) => {
      const iso = parseWaybackTimestamp(s.timestamp);
      const date = new Date(iso);
      if (options?.start && date < options.start) return false;
      if (options?.end && date > options.end) return false;
      return true;
    });

    let count = 0;
    let lastDigest = "";
    // "older" reads the latest snapshots first, so a limit keeps the latest N
    // without fetching every snapshot before them.
    if (options?.direction === "older") filteredSnapshots.reverse();

    for (const snap of filteredSnapshots) {
      // Skip identical consecutive snapshots if digest is identical
      if (snap.digest && snap.digest === lastDigest) continue;

      await this.rateLimiter.acquire();
      const rawSnapshotUrl = `${this.archiveBaseUrl}/${snap.timestamp}id_/${snap.original}`;

      let content = "";
      try {
        const snapRes = await this.fetchFn(rawSnapshotUrl);
        if (!snapRes.ok) continue;
        const html = await snapRes.text();
        content = extractReadableText(html);
      } catch {
        continue;
      }

      lastDigest = snap.digest;
      const isoTimestamp = parseWaybackTimestamp(snap.timestamp);

      // The snapshot's 14-digit timestamp is its ID: the same snapshot keeps the
      // same ID whatever date range is asked for, which a running count did not.
      yield {
        revId: Number(snap.timestamp.padEnd(14, "0")),
        pageId: 1,
        pageTitle: targetUrl,
        timestamp: isoTimestamp,
        comment: `Wayback snapshot ${snap.timestamp} (digest: ${snap.digest || "none"})`,
        content,
        size: content.length,
        minor: false,
      };

      count++;
      if (options?.limit && count >= options.limit) break;
    }
  }
}
