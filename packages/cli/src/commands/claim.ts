import {
  type ClaimHistoryResult,
  type ClaimTransition,
  claimHistory,
  locateTransitions,
  type TransitionLocator,
} from "@refract-org/analyzers";
import type { Revision } from "@refract-org/evidence-graph";
import { createClaimIdentity } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { findRevertedStates, MediaWikiClient } from "@refract-org/ingestion";
import { DEFAULT_BATCH_CONCURRENCY, forEachPage } from "./batch.js";
import { saveRevisions } from "./cache.js";
import { type RevisionSourceSpec, readRevisionsFromSource } from "./revision-source.js";

export interface ClaimRange {
  from?: number;
  to?: number;
  /** Read the revisions from a dump or the Wayback Machine instead of the wiki's API. */
  source?: RevisionSourceSpec;
}

/**
 * The revisions `claim` and `field` read: the latest `limit` (50 by default),
 * forward from `from`, or backward from `to`. A closed range is read whole
 * unless a limit is given.
 */
export async function fetchRevisionRange(
  pageTitle: string,
  range: ClaimRange,
  revisionLimit?: number,
  apiUrl?: string,
  auth?: AuthConfig,
): Promise<Revision[]> {
  const { from, to } = range;
  for (const id of [from, to]) {
    if (id !== undefined && (!Number.isSafeInteger(id) || id < 1))
      throw new Error("Revision bounds must be positive integer IDs.");
  }
  if (from !== undefined && to !== undefined && from > to)
    throw new Error("The start revision must be before the end revision.");
  // Only a closed range says how much to read; anything else keeps the default cap.
  const limit = revisionLimit ?? (from !== undefined && to !== undefined ? undefined : 50);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error("--limit must be a positive integer.");
  if (range.source) {
    return readRevisionsFromSource(
      range.source,
      pageTitle,
      { fromRevId: from, toRevId: to, limit, newest: from === undefined },
      apiUrl,
    );
  }
  const client = new MediaWikiClient(apiUrl ? { apiUrl, auth } : auth ? { auth } : undefined);

  return client.fetchRevisions(
    pageTitle,
    from !== undefined
      ? { direction: "newer", startRevId: from, endRevId: to, limit }
      : { direction: "older", startRevId: to, limit },
  );
}

/** How `refract claim` reads a history besides its range: a spread sample, and exact dates for the changes found. */
export interface ClaimReadOptions {
  /**
   * Read this many revisions spread across the history (or the range), as
   * `fetchLongitudinalHistory` selects them, leaving out reverted states,
   * instead of consecutive ones. Its transitions then lie between samples.
   */
  sample?: number;
  /** Narrow each transition between revisions that are not adjacent to the edit that made it. */
  locate?: boolean;
}

/**
 * The passage history `refract claim` reports: the revisions `range` selects,
 * fetched (and cached with `useCache`), then matched by `claimHistory` from
 * `@refract-org/analyzers`. With `options.locate`, each transition between
 * revisions that are not adjacent is narrowed to the edit that made it
 * (`locateTransitions`), reading the revisions in between from the wiki.
 */
export async function runClaimHistory(
  pageTitle: string,
  claimText: string,
  useCache = false,
  apiUrl?: string,
  cacheDir?: string,
  auth?: AuthConfig,
  revisionLimit?: number,
  range: ClaimRange = {},
  options: ClaimReadOptions = {},
): Promise<ClaimHistoryResult> {
  if (!claimText.trim()) throw new Error("Supply nonempty passage text.");
  if ((options.locate || options.sample !== undefined) && range.source) {
    throw new Error("--sample and --locate read the wiki's API; they cannot be used with --dump or --wayback.");
  }
  const client = new MediaWikiClient(apiUrl ? { apiUrl, auth } : auth ? { auth } : undefined);
  const revisions =
    options.sample === undefined
      ? await fetchRevisionRange(pageTitle, range, revisionLimit, apiUrl, auth)
      : await sampleRevisions(client, pageTitle, range, options.sample, revisionLimit);
  if (useCache && !apiUrl && !range.source && revisions.length > 0) await saveRevisions(revisions, cacheDir);
  const result = claimHistory(revisions, claimText, { page: pageTitle });
  return options.locate ? locateTransitions(result, apiLocator(client, pageTitle)) : result;
}

/** A sample of `size` revisions across the page's history, or across `range`, with reverted states left out. */
async function sampleRevisions(
  client: MediaWikiClient,
  pageTitle: string,
  range: ClaimRange,
  size: number,
  revisionLimit?: number,
): Promise<Revision[]> {
  if (!Number.isSafeInteger(size) || size < 2) throw new Error("--sample must be an integer of 2 or more.");
  if (revisionLimit !== undefined)
    throw new Error("--sample and --limit both say how many revisions to read; give one.");
  const { from, to } = range;
  if (from !== undefined && to !== undefined && from > to)
    throw new Error("The start revision must be before the end revision.");
  const { revisions } = await client.fetchLongitudinalHistory(pageTitle, {
    maxContentRevisions: size,
    ...(from !== undefined
      ? { direction: "newer", startRevId: from, endRevId: to }
      : { direction: "older", startRevId: to }),
  });
  return revisions;
}

/**
 * The wiki reads locateTransitions makes: the metadata of the revisions
 * inside a transition's bracket, with the states a later edit in the bracket
 * reverted (`findRevertedStates`) left out, and their text in batches.
 */
function apiLocator(client: MediaWikiClient, pageTitle: string): TransitionLocator {
  return {
    async between(transition: ClaimTransition) {
      const metadata = await client.fetchRevisionMetadata(pageTitle, {
        direction: "newer",
        startRevId: transition.previousRevisionId,
        endRevId: transition.revisionId,
      });
      const reverted = findRevertedStates(metadata);
      return metadata
        .filter((m) => m.revId !== transition.previousRevisionId && m.revId !== transition.revisionId)
        .filter((m) => !reverted.has(m.revId))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        .map((m) => ({ revisionId: m.revId, timestamp: m.timestamp }));
    },
    async fetchTexts(revisionIds: number[]) {
      const revisions = await client.fetchRevisionsByIds(revisionIds);
      return new Map(revisions.map((r) => [r.revId, r.contentAvailable === false ? null : r.content]));
    },
  };
}

export async function runClaim(
  pageTitle: string,
  claimText: string,
  useCache = false,
  apiUrl?: string,
  cacheDir?: string,
  auth?: AuthConfig,
  revisionLimit?: number,
  range?: ClaimRange,
  output: { json?: boolean } & ClaimReadOptions = {},
): Promise<void> {
  const { json, ...read } = output;
  const result = await runClaimHistory(
    pageTitle,
    claimText,
    useCache,
    apiUrl,
    cacheDir,
    auth,
    revisionLimit,
    range,
    read,
  );
  if (json) {
    const { claimId } = createClaimIdentity({ text: claimText, section: "", pageTitle, pageId: result.pageId ?? 0 });
    console.log(JSON.stringify({ ...result, claimId }, null, 2));
    return;
  }
  console.log(`Tracking passage in "${pageTitle}"...`);
  console.log(`Claim text: "${claimText}"\n`);
  for (const variant of result.revisions) {
    console.log(`[${variant.timestamp}] ${variant.match.toUpperCase()} MATCH (rev ${variant.revisionId})`);
    console.log(`  Matched text: "${variant.text}"`);
  }
  const identity = createClaimIdentity({ text: claimText, section: "", pageTitle, pageId: result.pageId ?? 0 });
  console.log(`\n=== Passage History Summary ===`);
  console.log(`Claim ID:    ${identity.claimId}`);
  console.log(`Page:        ${pageTitle}`);
  console.log(`Status:      ${result.status}`);
  console.log(`Latest revision: ${result.latestRevisionId ?? "none"}`);
  console.log(`Latest match:    ${result.latestMatch ?? "none"}`);
  console.log(result.historySummary);
  if (result.transitions.length > 0) console.log("\nTransitions:");
  for (const t of result.transitions) console.log(`  ${formatTransition(t)}`);
  for (const caveat of result.caveats ?? []) console.log(`Note: ${caveat}`);
}

/** One line for a transition: what changed, where it lies, and how long the result held. */
export function formatTransition(t: ClaimTransition): string {
  const between =
    t.previousRevisionId === undefined
      ? `at rev ${t.revisionId}, the first read`
      : `rev ${t.previousRevisionId} → ${t.revisionId}${t.adjacent ? "" : " (not adjacent)"}`;
  const held =
    t.endedByRevisionId === undefined
      ? `held ${t.heldRevisions} revision(s) through the latest read`
      : `held ${t.heldRevisions} revision(s) until ${t.endedAt}`;
  const revert = [
    t.revertSummary ? "revert summary" : "",
    t.restoresRevisionId !== undefined ? `restores rev ${t.restoresRevisionId}` : "",
  ].filter(Boolean);
  const nearest = t.nearest
    ? `; nearest remaining sentence (${Math.round(t.nearest.wordOverlap * 100)}% of words): "${t.nearest.text}"`
    : "";
  const located = t.located
    ? `; made by rev ${t.located.revisionId} (${t.located.timestamp}), after rev ${t.located.previousRevisionId}`
    : "";
  return `[${t.timestamp}] ${t.kind.replace("_", " ")}, ${between}${located}; ${held}${revert.length ? `; ${revert.join(", ")}` : ""}${nearest}`;
}

/**
 * Track one passage across every page in `titles`, as `runClaimHistory` does
 * for one, reporting pages in the order given. With `json`, each page is one
 * line of NDJSON: its result with `claimId`, or `{ page, status: "error",
 * error }` when it could not be read. Text output is one line per page.
 * Resolves with how many pages failed.
 */
export async function runClaimBatch(
  titles: readonly string[],
  claimText: string,
  apiUrl?: string,
  auth?: AuthConfig,
  revisionLimit?: number,
  concurrency = DEFAULT_BATCH_CONCURRENCY,
  output: { json?: boolean; write?: (line: string) => void } = {},
  source?: RevisionSourceSpec,
): Promise<{ failed: number }> {
  if (!claimText.trim()) throw new Error("Supply nonempty passage text.");
  const write = output.write ?? ((line: string) => console.log(line));
  if (!output.json) write(`Tracking "${claimText}" across ${titles.length} pages\n`);
  const { failed } = await forEachPage(
    titles,
    concurrency,
    (title) => runClaimHistory(title, claimText, false, apiUrl, undefined, auth, revisionLimit, { source }),
    ({ title, result, error }) => {
      if (!result) {
        if (output.json) write(JSON.stringify({ page: title, status: "error", error }));
        else write(`${"error".padEnd(9)} ${title}: ${error}`);
        return;
      }
      if (output.json) {
        const { claimId } = createClaimIdentity({
          text: claimText,
          section: "",
          pageTitle: title,
          pageId: result.pageId ?? 0,
        });
        write(JSON.stringify({ ...result, claimId }));
        return;
      }
      const first = result.revisions[0];
      const seen = first ? `first matched rev ${first.revisionId} (${first.timestamp})` : "not matched";
      write(`${result.status.padEnd(9)} ${title}: ${seen}; latest match ${result.latestMatch ?? "none"}`);
    },
  );
  return { failed };
}
