import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { annotateEvents, correlateTalkRevisions, diffObservations } from "@refract-org/analyzers";
import type { AnalyzerConfig, EvidenceEvent, Revision } from "@refract-org/evidence-graph";
import type { AuthConfig, RevisionOptions } from "@refract-org/ingestion";
import { MediaWikiClient } from "@refract-org/ingestion";
import type { HistoryCoverage } from "../coverage.js";
import { describeCoverage, formatCoverage } from "../coverage.js";
import { spinner } from "../render.js";
import { loadCachedRevisions, saveRevisions } from "./cache.js";

export interface FetchResult {
  client: MediaWikiClient;
  revisions: Revision[];
  coverage: HistoryCoverage;
}

/** Create a MediaWikiClient and fetch revisions with delta-update caching. */
export async function fetchRevisionsWithCache(
  pageTitle: string,
  depth: string,
  fromRevId: number | undefined,
  toRevId: number | undefined,
  fromTimestamp: string | undefined,
  useCache: boolean,
  apiUrl: string | undefined,
  cacheDir: string | undefined,
  auth: AuthConfig | undefined,
  briefRevisionLimit?: number,
): Promise<FetchResult> {
  for (const id of [fromRevId, toRevId]) {
    if (id !== undefined && (!Number.isSafeInteger(id) || id < 1))
      throw new Error("Revision bounds must be positive integer IDs.");
  }
  if (fromRevId !== undefined && toRevId !== undefined && fromRevId > toRevId)
    throw new Error("The start revision must be before the end revision.");
  if (fromTimestamp && !Number.isFinite(new Date(fromTimestamp).getTime()))
    throw new Error("Use a valid ISO timestamp for --since.");
  if (briefRevisionLimit !== undefined && (!Number.isSafeInteger(briefRevisionLimit) || briefRevisionLimit < 1))
    throw new Error("--brief-limit must be a positive integer.");
  const client = new MediaWikiClient(apiUrl ? { apiUrl, auth } : auth ? { auth } : undefined);
  const progress = spinner();
  progress.start(`Analyzing "${pageTitle}" at depth: ${depth}...`);

  let revisions: Revision[] = [];

  const options: RevisionOptions = { direction: "newer" };
  if (fromTimestamp) options.start = new Date(fromTimestamp);
  else if (fromRevId) options.startRevId = fromRevId;
  if (toRevId) options.endRevId = toRevId;
  if (depth === "brief" && !fromTimestamp && !fromRevId && !toRevId) {
    options.direction = "older";
    options.limit = briefRevisionLimit ?? 20;
  }
  const request = { fromRevisionId: fromRevId, toRevisionId: toRevId, since: fromTimestamp, limit: options.limit };
  try {
    // A fixed, continuous range can be reused. Open ranges always check the source.
    if (useCache && !apiUrl && fromRevId && toRevId && !fromTimestamp) {
      const cached = (await loadCachedRevisions(pageTitle, 500, cacheDir))
        .filter((r) => r.revId >= fromRevId && r.revId <= toRevId)
        .sort((a, b) => a.revId - b.revId);
      if (describeCoverage(cached, request).status === "complete") revisions = cached;
    }
    if (!revisions.length) {
      revisions = await client.fetchRevisions(pageTitle, options);
      if (useCache && !apiUrl && revisions.length) await saveRevisions(revisions, cacheDir);
    }
    progress.land();
  } catch (err) {
    progress.stop();
    throw err;
  }
  const withTs = revisions.map((r) => ({ r, ts: new Date(r.timestamp).getTime() }));
  withTs.sort((a, b) => a.ts - b.ts);
  const sorted = withTs.map((x) => x.r);
  const coverage = describeCoverage(sorted, request);
  console.error(formatCoverage(coverage));
  return { client, revisions: sorted, coverage };
}
/** Correlate talk page revisions with article revisions. */
export function correlateTalkPages(
  sortedRevs: Revision[],
  talkRevs: Revision[],
  options?: AnalyzerConfig["talkCorrelation"],
): EvidenceEvent[] {
  if (talkRevs.length === 0) return [];

  const talkEvents = correlateTalkRevisions(sortedRevs, talkRevs, options);
  if (talkEvents.length > 0) {
    console.error(`Correlated ${talkEvents.length} talk page discussions.`);
  }
  return talkEvents;
}

/**
 * Reads JSON an earlier run wrote. A missing file is the first run, not an
 * error, so it returns undefined silently; anything else it could not read or
 * parse is reported in one line, path and reason, and also returns undefined.
 */
export function readPriorJson<T>(file: string, failure: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`refract: ${failure} ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return undefined;
  }
}

/**
 * Observation diffing, schema version stamping, and semantic enrichment.
 * `recordObservation: false` is for a caller that keeps its own observation
 * state, as cron does: the delta is neither printed nor written.
 */
export function finalizeEvents(
  pageTitle: string,
  events: EvidenceEvent[],
  _sortedRevs: Revision[],
  fromTimestamp: string | undefined,
  cacheDir: string | undefined,
  recordObservation = true,
): EvidenceEvent[] {
  if (fromTimestamp && recordObservation) {
    const obsDir = cacheDir ?? join(homedir(), ".wikihistory", "observations");
    if (!existsSync(obsDir)) mkdirSync(obsDir, { recursive: true });
    const obsFile = join(obsDir, `${pageTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);

    const priorEvents = readPriorJson<EvidenceEvent[]>(obsFile, "analyze: failed to read prior observation file") ?? [];

    const obsDiff = diffObservations(priorEvents, events);
    if (priorEvents.length > 0) {
      console.error(`\n── Re-observation delta ──`);
      console.error(`  New events:      ${obsDiff.new.length}`);
      console.error(`  Resolved events: ${obsDiff.resolved.length}`);
      console.error(`  Unchanged:       ${obsDiff.unchanged.length}`);
    } else {
      console.error(`First observation — no delta available.`);
    }

    writeFileSync(obsFile, JSON.stringify(events, null, 2), "utf-8");
  }

  return annotateEvents(events);
}
