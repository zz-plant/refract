import { readFileSync } from "node:fs";
import type { RevisionEventDepth } from "@refract-org/analyzers";
import {
  buildPageMoveEvents,
  buildRevisionEvents,
  buildTalkThreadEvents,
  detectEditClusters,
  detectTalkActivitySpikes,
  windowPageMoves,
} from "@refract-org/analyzers";
import type {
  AnalyzerConfig,
  ClaimLedger,
  ClaimLedgerEntry,
  ClaimState,
  EvidenceEvent,
  ObservationReport,
  Revision,
} from "@refract-org/evidence-graph";
import {
  createClaimIdentity,
  createEventIdentity,
  createReplayManifest,
  DEFAULT_ANALYZER_CONFIG,
} from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";

import type { HistoryCoverage } from "../coverage.js";
import { contiguousRevisionGroups } from "../coverage.js";
import { REFRACT_VERSION } from "../version.js";
import { correlateTalkPages, fetchRevisionsWithCache, finalizeEvents } from "./analyze-helpers.js";

interface BatchPageResult {
  pageTitle: string;
  pageId: number;
  eventCount: number;
  events: EvidenceEvent[];
}

interface BatchResult {
  mode: "batch";
  batchSize: number;
  pages: BatchPageResult[];
  totalEvents: number;
  generatedAt: string;
}

function toCamelCase(str: string): string {
  return str.replace(/[-_](.)/g, (_, c: string) => c.toUpperCase());
}

function deepCamelCaseKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(deepCamelCaseKeys);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[toCamelCase(key)] = deepCamelCaseKeys(value);
    }
    return result;
  }
  return obj;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!(key in target) || target[key] === undefined || typeof target[key] !== "object") {
        target[key] = {};
      }
      deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

function compilePatterns(config: AnalyzerConfig): void {
  if (config.revert?.patterns) {
    config.revert.patterns = config.revert.patterns.map((p) => (typeof p === "string" ? new RegExp(p) : p));
  }
  if (config.talkParser?.resolvedPatterns) {
    config.talkParser.resolvedPatterns = config.talkParser.resolvedPatterns.map((p) =>
      typeof p === "string" ? new RegExp(p) : p,
    );
  }
  if (config.heuristic?.vandalismPatterns) {
    config.heuristic.vandalismPatterns = config.heuristic.vandalismPatterns.map((p) =>
      typeof p === "string" ? new RegExp(p) : p,
    );
  }
  if (config.heuristic?.sourcingPatterns) {
    config.heuristic.sourcingPatterns = config.heuristic.sourcingPatterns.map((p) =>
      typeof p === "string" ? new RegExp(p) : p,
    );
  }
}

export function buildConfig(options: Record<string, unknown>): AnalyzerConfig {
  const config: AnalyzerConfig = structuredClone(DEFAULT_ANALYZER_CONFIG);

  if (options.config) {
    const content = readFileSync(options.config as string, "utf-8");
    const fileOverrides = JSON.parse(content);
    const camelCased = deepCamelCaseKeys(fileOverrides) as Record<string, unknown>;
    deepMerge(config as unknown as Record<string, unknown>, camelCased);
    compilePatterns(config);
  }

  if (options.similarity !== undefined) {
    config.section ??= {};
    config.section.similarityThreshold = Number(options.similarity);
  }

  if (options.revertPatterns) {
    const content = readFileSync(options.revertPatterns as string, "utf-8");
    config.revert ??= {};
    config.revert.patterns = content
      .split("\n")
      .filter(Boolean)
      .map((line) => new RegExp(line.trim()));
  }

  if (options.clusterWindow !== undefined) {
    config.editCluster ??= {};
    config.editCluster.windowMs = Number(options.clusterWindow) * 60 * 1000;
  }

  if (options.spikeFactor !== undefined) {
    config.talkSpike ??= {};
    config.talkSpike.spikeFactor = Number(options.spikeFactor);
  }

  if (options.talkWindow) {
    const parts = (options.talkWindow as string).split("/");
    if (parts.length === 2) {
      const beforeDays = Number(parts[0]);
      const afterDays = Number(parts[1]);
      config.talkCorrelation ??= {};
      config.talkCorrelation.windowBeforeMs = beforeDays * 24 * 60 * 60 * 1000;
      config.talkCorrelation.windowAfterMs = afterDays * 24 * 60 * 60 * 1000;
    }
  }

  if (options.sectionRename) {
    const mode = options.sectionRename as string;
    if (["exact", "similarity", "none"].includes(mode)) {
      config.section ??= {};
      config.section.renameDetection = mode as "exact" | "similarity" | "none";
    }
  }

  if (options.briefLimit !== undefined) {
    config.briefRevisionLimit = Number(options.briefLimit);
  }

  if (options.batchConcurrency !== undefined) {
    config.batchConcurrency = Number(options.batchConcurrency);
  }

  // Pin config version from the package version for traceability
  config.$version = REFRACT_VERSION;

  return config;
}

/**
 * Run the full Refract analysis pipeline on a page (or batch of pages).
 * Fetches revisions, computes diffs, and emits structured provenance events.
 */
export async function runAnalyze(
  pageTitle: string,
  depth: string,
  fromRevId?: number,
  toRevId?: number,
  fromTimestamp?: string,
  useCache = false,
  apiUrl?: string,
  pagesFile?: string,
  cacheDir?: string,
  auth?: AuthConfig,
  config?: AnalyzerConfig,
  { recordObservation = true }: { recordObservation?: boolean } = {},
): Promise<{ events: EvidenceEvent[]; revisions: Revision[]; coverage?: HistoryCoverage }> {
  if (pagesFile) {
    return runBatch(pagesFile, depth, fromRevId, toRevId, fromTimestamp, useCache, apiUrl, cacheDir, auth, config);
  }

  const {
    client,
    revisions: sortedRevs,
    coverage,
  } = await fetchRevisionsWithCache(
    pageTitle,
    depth,
    fromRevId,
    toRevId,
    fromTimestamp,
    useCache,
    apiUrl,
    cacheDir,
    auth,
    config?.briefRevisionLimit,
  );
  if (sortedRevs.length < 2) return { events: [], revisions: sortedRevs, coverage };

  const events: EvidenceEvent[] = [];

  const [pageMoves, protectionLogs, talkRevs] = await Promise.all([
    client.fetchPageMoves(pageTitle),
    client.fetchProtectionLogs(pageTitle),
    // The talk edits leading up to the last analyzed revision. "newer" with a
    // limit read the talk page's first ten edits, years before most windows.
    client
      .fetchTalkRevisions(pageTitle, {
        direction: "older",
        start: new Date(sortedRevs[sortedRevs.length - 1].timestamp),
        limit: 10,
      })
      .then((revs) => [...revs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())),
  ]);
  // Bound moves to the analyzed span: the move log covers the page's whole
  // lifetime, and a --since window must not open with moves from 2005.
  events.push(
    ...buildPageMoveEvents(
      windowPageMoves(pageMoves, sortedRevs[0].timestamp, sortedRevs[sortedRevs.length - 1].timestamp),
    ),
  );

  // Any other --depth value has always run as detailed.
  const eventDepth: RevisionEventDepth = depth === "brief" || depth === "forensic" ? depth : "detailed";
  events.push(
    ...contiguousRevisionGroups(sortedRevs).flatMap((group) =>
      buildRevisionEvents(group, {
        depth: eventDepth,
        similarityThreshold: config?.section?.similarityThreshold ?? 0.8,
        protectionLogs,
        // --revert-patterns and --talk-window were parsed into config and then
        // dropped here, so neither flag changed anything.
        revertPatterns: config?.revert?.patterns,
        sectionRename: config?.section?.renameDetection,
      }),
    ),
  );

  // Bursts of edits, within each run of revisions whose parents are all
  // present: a gap is not evidence that the edits on either side were close.
  events.push(
    ...contiguousRevisionGroups(sortedRevs).flatMap((group) => detectEditClusters(group, config?.editCluster)),
  );

  // Threads opened, answered or archived by the fetched talk edits made since
  // the first analyzed revision. Earlier talk edits belong to another span.
  const spanStart = new Date(sortedRevs[0].timestamp).getTime();
  for (let i = 1; i < talkRevs.length; i++) {
    const earlier = talkRevs[i - 1];
    const later = talkRevs[i];
    if (new Date(later.timestamp).getTime() < spanStart) continue;
    if (earlier.contentAvailable === false || later.contentAvailable === false) continue;
    events.push(
      ...buildTalkThreadEvents(
        earlier.content,
        later.content,
        earlier.revId,
        later.revId,
        later.timestamp,
        config?.talkParser,
      ),
    );
  }

  // Days of unusual talk-page activity among the talk edits fetched above,
  // measured back from the last analyzed revision rather than from today.
  events.push(
    ...detectTalkActivitySpikes(talkRevs, sortedRevs, config?.talkSpike, sortedRevs[sortedRevs.length - 1].timestamp)
      .spikes,
  );

  events.push(...correlateTalkPages(sortedRevs, talkRevs, config?.talkCorrelation));
  finalizeEvents(pageTitle, events, sortedRevs, fromTimestamp, cacheDir, recordObservation);

  return { events, revisions: sortedRevs, coverage };
}

async function runBatch(
  pagesFile: string,
  depth: string,
  fromRevId?: number,
  toRevId?: number,
  fromTimestamp?: string,
  useCache = false,
  apiUrl?: string,
  cacheDir?: string,
  auth?: AuthConfig,
  config?: AnalyzerConfig,
): Promise<{ events: EvidenceEvent[]; revisions: Revision[] }> {
  const content = readFileSync(pagesFile, "utf-8");
  const titles: string[] = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  console.error(`Batch mode: ${titles.length} pages from ${pagesFile}\n`);

  const batchConcurrency = config?.batchConcurrency ?? 4;
  const pageResults: BatchPageResult[] = [];
  const allEvents: EvidenceEvent[] = [];

  for (let i = 0; i < titles.length; i += batchConcurrency) {
    const chunk = titles.slice(i, i + batchConcurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (title, j) => {
        const idx = i + j + 1;
        console.error(`--- Page ${idx}/${titles.length}: ${title} ---`);
        const { events } = await runAnalyze(
          title,
          depth,
          fromRevId,
          toRevId,
          fromTimestamp,
          useCache,
          apiUrl,
          undefined,
          cacheDir,
          auth,
          config,
        );
        return { pageTitle: title, pageId: 0, eventCount: events.length, events };
      }),
    );
    pageResults.push(...chunkResults);
    for (const r of chunkResults) allEvents.push(...r.events);
  }

  const pages = pageResults;

  const result: BatchResult = {
    mode: "batch",
    batchSize: titles.length,
    pages,
    totalEvents: allEvents.length,
    generatedAt: new Date().toISOString(),
  };

  console.error(`\n=== Batch Results ===`);
  console.error(`Pages processed: ${result.batchSize}`);
  console.error(`Total events: ${result.totalEvents}\n`);
  for (const p of result.pages) {
    console.error(`  ${p.pageTitle}: ${p.eventCount} events`);
  }

  return { events: allEvents, revisions: [] };
}

export function buildObservationReport(
  pageTitle: string,
  pageId: number,
  events: EvidenceEvent[],
  revisions: Revision[],
): ObservationReport {
  const claimEventTypes = new Set([
    "sentence_first_seen",
    "sentence_reintroduced",
    "sentence_modified",
    "sentence_removed",
  ]);

  const claimEvents = events.filter((e) => claimEventTypes.has(e.eventType));

  const claimGroups = new Map<string, EvidenceEvent[]>();
  for (const event of claimEvents) {
    const text = event.after || event.before;
    if (!text) continue;
    const identity = createClaimIdentity({
      text,
      section: event.section,
      pageTitle,
      pageId,
    });
    const existing = claimGroups.get(identity.claimId) || [];
    existing.push(event);
    claimGroups.set(identity.claimId, existing);
  }

  const claims: Record<string, ClaimLedger> = {};

  for (const [claimId, groupEvents] of claimGroups) {
    groupEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const text = groupEvents[0].after || groupEvents[0].before;
    const firstSeenAt = groupEvents[0].timestamp;
    const lastSeenAt = groupEvents[groupEvents.length - 1].timestamp;

    const lastEvent = groupEvents[groupEvents.length - 1];
    let currentState: ClaimState;
    switch (lastEvent.eventType) {
      case "sentence_first_seen":
        currentState = "emerging";
        break;
      case "sentence_reintroduced":
        currentState = "stabilizing";
        break;
      case "sentence_modified":
        currentState = "contested";
        break;
      case "sentence_removed":
        currentState = "absent";
        break;
      default:
        currentState = "emerging";
    }

    // Per claim: these were shared across claims, so each ledger entry's range
    // also covered every claim processed before it.
    let minRev = Infinity;
    let maxRev = -Infinity;
    for (const e of groupEvents) {
      if (e.toRevisionId < minRev) minRev = e.toRevisionId;
      if (e.toRevisionId > maxRev) maxRev = e.toRevisionId;
    }

    const eventIds = groupEvents.map((e) => e.eventId ?? createEventIdentity(e));

    const entry: ClaimLedgerEntry = {
      observedAt: new Date().toISOString(),
      revisionRange: {
        from: minRev === Infinity ? 0 : minRev,
        to: maxRev === -Infinity ? 0 : maxRev,
      },
      state: currentState,
      eventCount: groupEvents.length,
      eventIds,
    };

    claims[claimId] = {
      claimId,
      text,
      firstSeenAt,
      lastSeenAt,
      currentState,
      history: [entry],
    };
  }

  const manifest = createReplayManifest({
    pageTitle,
    analyzerVersions: { refract: REFRACT_VERSION },
    revisions,
    events: claimEvents,
  });
  const revIds = revisions.map((r) => r.revId);

  return {
    pageTitle,
    pageId,
    observedAt: new Date().toISOString(),
    // The revisions analyzed. Taken from sentence events, this was the span of
    // revisions that changed a sentence, and 0–0 when none did.
    revisionRange: {
      from: revIds.length > 0 ? Math.min(...revIds) : 0,
      to: revIds.length > 0 ? Math.max(...revIds) : 0,
    },
    claims,
    eventCount: events.length,
    uniqueEditorCount: [...new Set(revisions.map((r) => r.user).filter(Boolean))].length,
    merkleRoot: manifest.merkleRoot,
    analyzerVersion: REFRACT_VERSION,
  };
}
