import {
  findIdentityReverts,
  findSectionForText,
  redactEditorIdentity,
  revertDetector,
  stripWikitext,
} from "@refract-org/analyzers";
import type { ClaimState, Revision } from "@refract-org/evidence-graph";
import { createClaimIdentity } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { MediaWikiClient } from "@refract-org/ingestion";
import { forEachPage } from "./batch.js";
import { saveRevisions } from "./cache.js";
import { type RevisionSourceSpec, readRevisionsFromSource } from "./revision-source.js";

export interface ClaimHistoryVariant {
  revisionId: number;
  timestamp: string;
  text: string;
  section: string;
  match: "exact" | "partial";
}

/**
 * One change in whether, or how, the passage appears, between two fetched
 * revisions. The change happened after `previousRevisionId` and at or before
 * `revisionId`; when `adjacent` is false, revisions that were not fetched lie
 * between them and the change could be in any of those.
 */
export interface ClaimTransition {
  kind: "first_seen" | "text_changed" | "removed" | "reintroduced";
  revisionId: number;
  timestamp: string;
  /** The fetched revision before this one with readable text. Absent on the first revision read: a passage first seen there may be older than the range. */
  previousRevisionId?: number;
  previousTimestamp?: string;
  /** True when `previousRevisionId` is this revision's parent, so no revision lies between them. */
  adjacent: boolean;
  /** Matched text before the change; empty when the passage was absent. */
  before: string;
  /** Matched text after the change; empty when the passage was removed. */
  after: string;
  editSummary: string;
  /** The edit summary matches a default revert pattern. */
  revertSummary: boolean;
  /** This revision's text is identical to an earlier fetched revision other than its predecessor: the one it restores. */
  restoresRevisionId?: number;
  /** Fetched revisions with readable text in which the state this transition produced held, counting this one. */
  heldRevisions: number;
  /** The next transition, which ended this state. Both are absent when the state held through the latest fetched revision. */
  endedByRevisionId?: number;
  endedAt?: string;
  /**
   * On a removal: the sentence left in the revision that carries the largest
   * share (at least half) of the passage's words, and that share. Word overlap
   * below the matching threshold, recorded so a rewrite is not read as a
   * deletion without a look; it does not establish that the two say the same.
   */
  nearest?: { text: string; wordOverlap: number };
}

export interface ClaimHistoryResult {
  statement: string;
  page: string;
  revisions: ClaimHistoryVariant[];
  /** Changes in the passage's presence or wording, oldest first. */
  transitions: ClaimTransition[];
  status: "present" | "absent" | "modified" | "contested" | "unknown";
  pageId?: number;
  historySummary: string;
  latestRevisionId?: number;
  latestMatch?: "exact" | "partial" | "none" | "unavailable";
  caveats?: string[];
}

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

export async function runClaimHistory(
  pageTitle: string,
  claimText: string,
  useCache = false,
  apiUrl?: string,
  cacheDir?: string,
  auth?: AuthConfig,
  revisionLimit?: number,
  range: ClaimRange = {},
): Promise<ClaimHistoryResult> {
  if (!claimText.trim()) throw new Error("Supply nonempty passage text.");
  const revisions = await fetchRevisionRange(pageTitle, range, revisionLimit, apiUrl, auth);
  if (useCache && !apiUrl && !range.source && revisions.length > 0) await saveRevisions(revisions, cacheDir);

  if (revisions.length === 0) {
    return {
      statement: claimText,
      page: pageTitle,
      revisions: [],
      transitions: [],
      status: "absent",
      historySummary: `No revisions found for "${pageTitle}".`,
    };
  }

  const withTs = [...revisions].map((r) => ({ r, ts: new Date(r.timestamp).getTime() }));
  withTs.sort((a, b) => a.ts - b.ts);
  const revs = withTs.map((x) => x.r);

  const variants: ClaimHistoryVariant[] = [];
  const trajectory: ClaimTransition[] = [];
  const restores = findIdentityReverts(revs);
  let previous: Revision | undefined;
  let lastKnownText = "";
  let currentState: ClaimState = "absent";
  const transitions: string[] = [];
  let textChanges = 0;
  let removals = 0;
  let reintroductions = 0;
  let latestMatch: "exact" | "partial" | "none" | "unavailable" = "none";
  const caveats = [
    `Matching covers ${revs.length} fetched revisions, not the page's entire history.`,
    "Partial matches use sentence word overlap; they do not establish that two passages express the same statement.",
    "The legacy contested label records repeated wording changes or disappearance and return, not an observed discussion dispute.",
    "Each transition lies between two fetched revisions; where they are not adjacent, the change could be in any revision between them.",
  ];

  const record = (
    rev: Revision,
    kind: ClaimTransition["kind"],
    before: string,
    after: string,
    nearest?: ClaimTransition["nearest"],
  ) => {
    const prior = trajectory.at(-1);
    if (prior) {
      prior.endedByRevisionId = rev.revId;
      prior.endedAt = rev.timestamp;
    }
    const restored = restores.get(rev.revId);
    trajectory.push({
      kind,
      revisionId: rev.revId,
      timestamp: rev.timestamp,
      ...(previous ? { previousRevisionId: previous.revId, previousTimestamp: previous.timestamp } : {}),
      adjacent: previous !== undefined && rev.parentId === previous.revId,
      before,
      after,
      editSummary: redactEditorIdentity(rev.comment),
      revertSummary: revertDetector.isRevert(rev.comment),
      ...(restored !== undefined ? { restoresRevisionId: restored } : {}),
      heldRevisions: 0,
      ...(nearest ? { nearest } : {}),
    });
  };

  for (const rev of revs) {
    if (rev.contentAvailable === false) {
      latestMatch = "unavailable";
      continue;
    }
    const plainText = stripWikitext(rev.content);
    const match = findPassageMatch(claimText, plainText);
    const foundText = match.text;
    latestMatch = match.kind;

    if (foundText) {
      if (currentState === "absent" || currentState === "receding") {
        if (currentState !== "absent") {
          reintroductions++;
          transitions.push(`reintroduced at ${rev.timestamp}`);
          record(rev, "reintroduced", "", foundText);
        } else {
          transitions.push(`first seen at ${rev.timestamp}`);
          record(rev, "first_seen", "", foundText);
        }
        currentState = "emerging";
      } else if (foundText !== lastKnownText && lastKnownText !== "") {
        currentState = "contested";
        textChanges++;
        transitions.push(`matched text changed at ${rev.timestamp}`);
        record(rev, "text_changed", lastKnownText, foundText);
      }

      lastKnownText = foundText;
      const section = findSectionForText(rev.content, foundText);
      variants.push({
        revisionId: rev.revId,
        timestamp: rev.timestamp,
        text: foundText,
        section,
        match: match.kind as "exact" | "partial",
      });
    } else {
      if (lastKnownText !== "") {
        currentState = "receding";
        removals++;
        transitions.push(`removed at ${rev.timestamp}`);
        record(rev, "removed", lastKnownText, "", nearestPassage(claimText, plainText));
        lastKnownText = "";
      }
    }
    const current = trajectory.at(-1);
    if (current) current.heldRevisions++;
    previous = rev;
  }

  const isPresentInLatest = latestMatch !== "none";

  if (variants.length === 0) {
    return {
      statement: claimText,
      page: pageTitle,
      revisions: [],
      transitions: [],
      status: latestMatch === "unavailable" ? "unknown" : "absent",
      pageId: revs[0].pageId,
      latestRevisionId: revs.at(-1)?.revId,
      latestMatch,
      caveats,
      historySummary: `Statement not found in any revision of "${pageTitle}".`,
    };
  }

  let status: ClaimHistoryResult["status"];
  if (latestMatch === "unavailable" || latestMatch === "partial") {
    status = "unknown";
  } else if (!isPresentInLatest) {
    status = "absent";
  } else if (removals > 0 || reintroductions > 0 || textChanges > 1) {
    status = "contested";
  } else if (textChanges === 1) {
    status = "modified";
  } else {
    status = "present";
  }

  const first = variants[0];
  const latest = variants[variants.length - 1];
  const parts: string[] = [
    `Tracked "${claimText}" across ${revs.length} revisions.`,
    `First matched within this selection at ${first.timestamp} (rev ${first.revisionId}).`,
  ];
  if (status === "unknown") {
    parts.push("Latest passage presence is uncertain: text is unavailable or only a word-overlap candidate matched.");
  } else if (status === "absent") {
    parts.push(`Last present at ${latest.timestamp} (rev ${latest.revisionId}), then removed.`);
  } else if (status === "modified") {
    parts.push(`Latest version at ${latest.timestamp} (rev ${latest.revisionId}) has modified wording.`);
  } else if (status === "contested") {
    parts.push(`Multiple changes detected; latest version at ${latest.timestamp} (rev ${latest.revisionId}).`);
  } else {
    parts.push(`Matching text found in the latest fetched revision (rev ${revs.at(-1)?.revId}).`);
  }
  if (transitions.length > 0) {
    parts.push(transitions.join("; "));
  }

  return {
    statement: claimText,
    page: pageTitle,
    revisions: variants,
    transitions: trajectory,
    status,
    pageId: revs[0].pageId,
    historySummary: parts.join(" "),
    latestRevisionId: revs.at(-1)?.revId,
    latestMatch,
    caveats,
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
  output: { json?: boolean } = {},
): Promise<void> {
  const result = await runClaimHistory(pageTitle, claimText, useCache, apiUrl, cacheDir, auth, revisionLimit, range);
  if (output.json) {
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
  return `[${t.timestamp}] ${t.kind.replace("_", " ")}, ${between}; ${held}${revert.length ? `; ${revert.join(", ")}` : ""}${nearest}`;
}

export function findPassageMatch(
  claimText: string,
  plainText: string,
): {
  kind: "exact" | "partial" | "none";
  text: string;
} {
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const query = normalize(claimText);
  if (!query) return { kind: "none", text: "" };
  const candidates = plainText.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const exact = candidates.find((text) => normalize(text).includes(query));
  if (exact) return { kind: "exact", text: exact.trim() };
  // An exact passage can cross sentence boundaries.
  if (normalize(plainText).includes(query)) return { kind: "exact", text: plainText.trim() };
  const words = [...new Set(query.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3))];
  let best = "";
  let overlap = 0;
  for (const candidate of candidates) {
    const tokens = new Set(normalize(candidate).split(/[^\p{L}\p{N}]+/u));
    const count = words.filter((word) => tokens.has(word)).length;
    if (count > overlap) {
      overlap = count;
      best = candidate.trim();
    }
  }
  return words.length >= 3 && overlap >= words.length * 0.7
    ? { kind: "partial", text: best }
    : { kind: "none", text: "" };
}

/**
 * The sentence of `plainText` that carries the largest share of the passage's
 * words longer than three characters, when that share is at least half;
 * otherwise undefined. Used on a removal to show where a rewrite may have
 * gone. Ties keep the earlier sentence.
 */
export function nearestPassage(
  claimText: string,
  plainText: string,
): { text: string; wordOverlap: number } | undefined {
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const words = [
    ...new Set(
      normalize(claimText)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 3),
    ),
  ];
  if (words.length === 0) return undefined;
  let best: { text: string; wordOverlap: number } | undefined;
  for (const candidate of plainText.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)) {
    const tokens = new Set(normalize(candidate).split(/[^\p{L}\p{N}]+/u));
    const share = words.filter((word) => tokens.has(word)).length / words.length;
    if (share >= 0.5 && (!best || share > best.wordOverlap))
      best = { text: candidate.trim(), wordOverlap: Math.round(share * 1000) / 1000 };
  }
  return best;
}

export function fuzzyFindText(claimText: string, plainText: string, preNormalized?: string): string {
  const normalized = claimText.toLowerCase().replace(/\s+/g, " ").trim();
  const searchText = preNormalized ?? plainText.toLowerCase().replace(/\s+/g, " ");

  if (searchText.includes(normalized)) {
    const idx = searchText.indexOf(normalized);
    const start = Math.max(0, idx - 50);
    const end = Math.min(searchText.length, idx + normalized.length + 100);
    return plainText.slice(start, end).trim();
  }

  const words = normalized.split(" ").filter((w) => w.length > 3);
  const matched = words.filter((w) => searchText.includes(w));
  if (matched.length >= words.length * 0.7 && words.length >= 3) {
    return `[partial match: ${matched.length}/${words.length} words]`;
  }

  return "";
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
  concurrency = 4,
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
