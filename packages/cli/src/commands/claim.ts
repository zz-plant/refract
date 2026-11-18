import { findSectionForText, stripWikitext } from "@refract-org/analyzers";
import type { ClaimState, Revision } from "@refract-org/evidence-graph";
import { createClaimIdentity } from "@refract-org/evidence-graph";
import type { AuthConfig } from "@refract-org/ingestion";
import { MediaWikiClient } from "@refract-org/ingestion";
import { saveRevisions } from "./cache.js";

export interface ClaimHistoryVariant {
  revisionId: number;
  timestamp: string;
  text: string;
  section: string;
  match: "exact" | "partial";
}

export interface ClaimHistoryResult {
  statement: string;
  page: string;
  revisions: ClaimHistoryVariant[];
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
  if (useCache && !apiUrl && revisions.length > 0) await saveRevisions(revisions, cacheDir);

  if (revisions.length === 0) {
    return {
      statement: claimText,
      page: pageTitle,
      revisions: [],
      status: "absent",
      historySummary: `No revisions found for "${pageTitle}".`,
    };
  }

  const withTs = [...revisions].map((r) => ({ r, ts: new Date(r.timestamp).getTime() }));
  withTs.sort((a, b) => a.ts - b.ts);
  const revs = withTs.map((x) => x.r);

  const variants: ClaimHistoryVariant[] = [];
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
  ];

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
        } else {
          transitions.push(`first seen at ${rev.timestamp}`);
        }
        currentState = "emerging";
      } else if (foundText !== lastKnownText && lastKnownText !== "") {
        currentState = "contested";
        textChanges++;
        transitions.push(`matched text changed at ${rev.timestamp}`);
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
        lastKnownText = "";
      }
    }
  }

  const isPresentInLatest = latestMatch !== "none";

  if (variants.length === 0) {
    return {
      statement: claimText,
      page: pageTitle,
      revisions: [],
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
  for (const caveat of result.caveats ?? []) console.log(`Note: ${caveat}`);
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
