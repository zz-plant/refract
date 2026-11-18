import type { Revision } from "@refract-org/evidence-graph";
import { WaybackRevisionSource, XmlDumpRevisionSource } from "@refract-org/ingestion";

/**
 * Where revisions come from when not the wiki's API: a MediaWiki XML export
 * file (`--dump`), or the Internet Archive's snapshots of the page (`--wayback`).
 */
export type RevisionSourceSpec = { kind: "dump"; path: string } | { kind: "wayback" };

/** The source the `--dump` and `--wayback` options name, if either; both is an error. */
export function revisionSourceFromOptions(opts: Record<string, unknown>): RevisionSourceSpec | undefined {
  const dump = opts.dump as string | undefined;
  const wayback = !!opts.wayback;
  if (dump && wayback) throw new Error("Use --dump or --wayback, not both.");
  if (dump) return { kind: "dump", path: dump };
  if (wayback) return { kind: "wayback" };
  return undefined;
}

/**
 * The URL whose snapshots `--wayback` reads: the page argument itself when it
 * is a URL, otherwise the article's URL on the wiki `--api` names
 * (en.wikipedia.org by default), with spaces as underscores.
 */
export function waybackTarget(page: string, apiUrl?: string): string {
  if (/^https?:\/\//i.test(page)) return page;
  const host = apiUrl ? new URL(apiUrl).host : "en.wikipedia.org";
  return `https://${host}/wiki/${encodeURIComponent(page.trim().replace(/ /g, "_")).replace(/%2F/g, "/")}`;
}

export interface SourceRange {
  /** Keep revisions with this ID or later. */
  fromRevId?: number;
  /** Keep revisions with this ID or earlier. */
  toRevId?: number;
  /** Keep revisions at or after this ISO timestamp. */
  since?: string;
  /** Keep at most this many: the latest with `newest`, the earliest otherwise. */
  limit?: number;
  newest?: boolean;
}

// One reader per dump file, so a batch over many pages reads the file once.
const dumpSources = new Map<string, XmlDumpRevisionSource>();

/**
 * The page's revisions from `spec`, oldest first, cut to `range` the way the
 * API path cuts them. A dump's revision IDs are the wiki's; a Wayback
 * snapshot's is its 14-digit timestamp, so both increase with time and
 * `fromRevId`/`toRevId` bound either.
 */
export async function readRevisionsFromSource(
  spec: RevisionSourceSpec,
  pageTitle: string,
  range: SourceRange = {},
  apiUrl?: string,
): Promise<Revision[]> {
  let source: XmlDumpRevisionSource | WaybackRevisionSource;
  if (spec.kind === "dump") {
    source = dumpSources.get(spec.path) ?? new XmlDumpRevisionSource(spec.path);
    dumpSources.set(spec.path, source);
  } else {
    source = new WaybackRevisionSource();
  }
  const target = spec.kind === "wayback" ? waybackTarget(pageTitle, apiUrl) : pageTitle;
  const since = range.since ? new Date(range.since) : undefined;

  // Each Wayback snapshot is a download, so with no ID bounds the limit is
  // applied while reading, latest first when the latest are wanted. A dump is
  // already in memory and is cut afterwards.
  const bounded = range.fromRevId !== undefined || range.toRevId !== undefined;
  const options =
    spec.kind === "wayback" && !bounded && range.limit !== undefined
      ? { start: since, limit: range.limit, direction: range.newest ? ("older" as const) : ("newer" as const) }
      : since
        ? { start: since }
        : undefined;

  const revisions: Revision[] = [];
  for await (const rev of source.revisions(target, options)) revisions.push(rev);
  const kept = revisions
    .filter((r) => range.fromRevId === undefined || r.revId >= range.fromRevId)
    .filter((r) => range.toRevId === undefined || r.revId <= range.toRevId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() || a.revId - b.revId);
  if (range.limit === undefined || kept.length <= range.limit) return kept;
  return range.newest ? kept.slice(-range.limit) : kept.slice(0, range.limit);
}
