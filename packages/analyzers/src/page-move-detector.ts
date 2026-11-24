import type { EvidenceEvent, EvidenceLayer } from "@refract-org/evidence-graph";
import { redactEditorIdentity } from "@refract-org/evidence-graph";

export interface PageMoveRecord {
  oldTitle: string;
  newTitle: string;
  timestamp: string;
  /** The move log entry's ID for a move from the log; the null revision's ID for one read from an edit summary. */
  revId: number;
  comment: string;
  /** Where the move was found. Absent means the move log. */
  source?: "move_log" | "edit_summary";
}

// MediaWiki's move summary, current and pre-2012 forms:
//   "X moved page [[A]] to [[B]]: reason"
//   "X moved [[A]] to [[B]] over redirect: reason"
const MOVE_SUMMARY =
  /\bmoved\s+(?:page\s+)?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s+to\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\](?:\s+over\s+(?:a\s+)?redirect)?(?:\s*:\s*([\s\S]*))?$/i;

/**
 * Moves read from revision edit summaries. The move log is keyed by the title
 * a page was moved from, so `fetchPageMoves(title)` never returns a move into
 * `title`. Every move also leaves a null revision in the moved page's history
 * whose summary names both titles, so the page's own revisions recover the
 * moves into it. Only English summaries are recognised, and only the
 * revisions given are read: a move whose null revision was not fetched is not
 * found.
 */
export function pageMovesFromEditSummaries(
  revisions: readonly { revId: number; timestamp: string; comment: string }[],
): PageMoveRecord[] {
  const moves: PageMoveRecord[] = [];
  for (const rev of revisions) {
    const match = rev.comment.match(MOVE_SUMMARY);
    if (!match) continue;
    moves.push({
      oldTitle: match[1].trim(),
      newTitle: match[2].trim(),
      timestamp: rev.timestamp,
      revId: rev.revId,
      comment: (match[3] ?? "").trim(),
      source: "edit_summary",
    });
  }
  return moves;
}

function normalizeTitle(title: string): string {
  const spaced = title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The move log's moves plus those found only in edit summaries. A move found
 * both ways (same titles, within two minutes) is kept once, as the log has it.
 */
export function mergePageMoves(
  logMoves: readonly PageMoveRecord[],
  summaryMoves: readonly PageMoveRecord[],
): PageMoveRecord[] {
  const merged = [...logMoves];
  for (const move of summaryMoves) {
    const t = new Date(move.timestamp).getTime();
    const duplicate = logMoves.some(
      (log) =>
        normalizeTitle(log.oldTitle) === normalizeTitle(move.oldTitle) &&
        normalizeTitle(log.newTitle) === normalizeTitle(move.newTitle) &&
        Math.abs(new Date(log.timestamp).getTime() - t) <= 120_000,
    );
    if (!duplicate) merged.push(move);
  }
  return merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Bound move records to the analyzed revision span. The move log is fetched
 * for the page's whole lifetime, but an analysis windowed with --since/--from
 * must not emit moves from outside the window — a 14-day observation of
 * Bitcoin was opening with page moves from 2005. Bounds are inclusive; a
 * full-history run (window = first revision to last) keeps every move it
 * kept before.
 */
export function windowPageMoves(
  moves: PageMoveRecord[],
  firstRevTimestamp: string,
  lastRevTimestamp: string,
): PageMoveRecord[] {
  const start = new Date(firstRevTimestamp).getTime();
  const end = new Date(lastRevTimestamp).getTime();
  return moves.filter((m) => {
    const t = new Date(m.timestamp).getTime();
    return t >= start && t <= end;
  });
}

export function buildPageMoveEvents(moves: PageMoveRecord[]): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];

  for (const move of moves) {
    const layer: EvidenceLayer = "observed";
    events.push({
      eventType: "page_moved",
      fromRevisionId: 0,
      toRevisionId: move.revId,
      section: "",
      before: move.oldTitle,
      after: move.newTitle,
      deterministicFacts: [
        {
          fact: "page_moved",
          detail: `from=${move.oldTitle} to=${move.newTitle} comment=${redactEditorIdentity(move.comment)}`,
        },
        ...(move.source === "edit_summary" ? [{ fact: "page_move_source", detail: "edit_summary" }] : []),
      ],
      layer,
      timestamp: move.timestamp,
    });
  }

  return events;
}
