import type { ClaimState, Revision } from "@refract-org/evidence-graph";
import { redactEditorIdentity } from "@refract-org/evidence-graph";
import { type BatchFetcher, locateChange } from "./locate-change.js";
import { findIdentityReverts, revertDetector } from "./revert-detector.js";
import { findSectionForText, stripWikitext } from "./wikitext-parser.js";

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
  /** The edit within a non-adjacent bracket that made the change, when locateTransitions found it. */
  located?: LocatedTransition;
}

/** The revision locateTransitions found to have made a change, and the surviving revision before it. */
export interface LocatedTransition {
  revisionId: number;
  timestamp: string;
  /** The revision before it with reverted states skipped; the change lies between the two. */
  previousRevisionId: number;
  previousTimestamp?: string;
  /** Batched reads the search made. */
  requests: number;
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

export interface ClaimHistoryOptions {
  /** The page title the result names. Default: the first revision's `pageTitle`. */
  page?: string;
}

/**
 * Follow a passage across a page's revisions: where it matches in each, each
 * change in whether or how it appears, and a status for the latest revision.
 *
 * Reads no network and no filesystem, so it runs in a Worker as well as Node
 * or Bun; `refract claim` and the MCP `get_statement_history` tool fetch the
 * revisions and call it. Revisions are read oldest first whatever order they
 * come in, and those whose text was withheld (`contentAvailable: false`)
 * neither start nor end a transition. Each revision is stripped with
 * `stripWikitext` and searched with `findPassageMatch`.
 */
export function claimHistory(
  revisions: readonly Revision[],
  text: string,
  options: ClaimHistoryOptions = {},
): ClaimHistoryResult {
  if (!text.trim()) throw new Error("Supply nonempty passage text.");
  const pageTitle = options.page ?? revisions[0]?.pageTitle ?? "";
  if (revisions.length === 0) {
    return {
      statement: text,
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
    const match = findPassageMatch(text, plainText);
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
        record(rev, "removed", lastKnownText, "", nearestPassage(text, plainText));
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
      statement: text,
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
    `Tracked "${text}" across ${revs.length} revisions.`,
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
    statement: text,
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

/**
 * Where a passage appears in a page's plain text: the sentence that contains
 * it (`exact`), the whole text when it crosses sentences, or the sentence
 * carrying at least 70% of its words longer than three characters
 * (`partial`, for a passage of three such words or more).
 */
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

/** The I/O locateTransitions needs, supplied by the caller. */
export interface TransitionLocator {
  /**
   * The revisions strictly between a transition's `previousRevisionId` and
   * its `revisionId`, oldest first, with reverted states removed.
   */
  between(transition: ClaimTransition): Promise<ReadonlyArray<{ revisionId: number; timestamp: string }>>;
  /** Wikitext for several revisions in one request; null, or no entry, when the text is hidden. */
  fetchTexts: BatchFetcher<string | null>;
}

/**
 * The history with each non-adjacent transition narrowed to the edit that
 * made it, found with locateChange over the revisions between its bracket and
 * recorded as `located`. A candidate counts as new when it holds the state
 * the transition produced: for `first_seen` and `reintroduced`, the passage
 * matches; for `removed`, it does not; for `text_changed`, the matched text
 * is the transition's `after`, ignoring case and whitespace: the new version,
 * rather than anything unlike the old. (claimHistory reports a text change
 * when the matched text differs at all, so a looser test such as sameWording
 * can read the old text as the new one.) A candidate whose text is
 * hidden is never new. When no candidate is new, the change is the bracket's
 * later revision, and `located` names the last candidate before it.
 *
 * The bracket is assumed to hold one change, as locateChange assumes; an edit
 * that brought the passage and one that took it away again between two
 * fetched revisions read as no change at all, and are not looked for.
 */
export async function locateTransitions(
  result: ClaimHistoryResult,
  locator: TransitionLocator,
  options: { k?: number } = {},
): Promise<ClaimHistoryResult> {
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const transitions: ClaimTransition[] = [];
  for (const transition of result.transitions) {
    if (transition.adjacent || transition.previousRevisionId === undefined) {
      transitions.push(transition);
      continue;
    }
    const candidates = await locator.between(transition);
    const isNew = (wikitext: string | null | undefined) => {
      if (typeof wikitext !== "string") return false;
      const match = findPassageMatch(result.statement, stripWikitext(wikitext));
      if (transition.kind === "removed") return match.kind === "none";
      if (match.kind === "none") return false;
      return transition.kind !== "text_changed" || normalize(match.text) === normalize(transition.after);
    };
    let requests = 0;
    const found = await locateChange(
      candidates.map((c) => c.revisionId),
      isNew,
      (ids) => {
        requests++;
        return locator.fetchTexts(ids);
      },
      options,
    );
    const previous = found ? (found.index > 0 ? candidates[found.index - 1] : undefined) : candidates.at(-1);
    const located: LocatedTransition = {
      revisionId: found ? found.revisionId : transition.revisionId,
      timestamp: found ? candidates[found.index].timestamp : transition.timestamp,
      previousRevisionId: previous?.revisionId ?? transition.previousRevisionId,
      ...(previous
        ? { previousTimestamp: previous.timestamp }
        : transition.previousTimestamp
          ? { previousTimestamp: transition.previousTimestamp }
          : {}),
      requests,
    };
    transitions.push({ ...transition, located });
  }
  return { ...result, transitions };
}
