import { createHash } from "node:crypto";
import type { Revision } from "@refract-org/evidence-graph";
import type { RevertChain, RevertDetector } from "./index.js";

const DEFAULT_REVERT_PATTERNS = [
  /\brevert/i,
  /\bundid\s+revision/i,
  /\brvv\b/i,
  /\brollback\b/i,
  /\brestore/i,
  /\[\[WP:ROLLBACK\]\]/i,
  // Arabic MediaWiki default revert / rollback / undo summaries
  /(?:استرجاع|رجوع|إلغاء\s+تعديل|استعادة\s+النسخة)/,
];

// "Restored revision 123" and "reverted to revision 123" name the revision
// put back; "Undid revision 123" (or Arabic "إلغاء تعديل ... رقم 123") names the one taken away.
const RESTORED_REVISION = /\b(?:restored?|revert(?:ed)?\s+to)\s+(?:revision|rev\.?|version)\s+(\d+)/i;
const UNDONE_REVISION = /(?:(?:\bundid\s+revision\s+)|(?:إلغاء\s+تعديل.*?رقم\s+))(\d+)/i;

function byTimestamp(revisions: readonly Revision[]): Revision[] {
  return [...revisions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * For each revision whose text is byte-identical to an earlier revision other
 * than the one directly before it, the ID of the latest such revision: the
 * state it put back. This finds a revert whatever its edit summary says,
 * including a manual one that says nothing. A revision identical to the one
 * directly before it is a null edit and restores nothing. Only the revisions
 * given are compared, so a revert to a state older than all of them is not
 * found this way. Revisions whose text was withheld are skipped.
 *
 * Text is compared by SHA-1 computed here rather than MediaWiki's `sha1`
 * field, so revisions from a dump, an archive or the cache compare the same
 * way as revisions from the API.
 */
export function findIdentityReverts(revisions: readonly Revision[]): Map<number, number> {
  const restores = new Map<number, number>();
  const latestWithKey = new Map<string, number>();
  let previousKey: string | undefined;
  for (const rev of byTimestamp(revisions)) {
    if (rev.contentAvailable === false) {
      previousKey = undefined;
      continue;
    }
    const key = createHash("sha1").update(rev.content).digest("hex");
    const earlier = latestWithKey.get(key);
    if (earlier !== undefined && key !== previousKey) restores.set(rev.revId, earlier);
    latestWithKey.set(key, rev.revId);
    previousKey = key;
  }
  return restores;
}

export const revertDetector: RevertDetector = {
  /** Check if an edit comment matches known revert patterns. */
  isRevert(comment: string, options?: { patterns?: RegExp[] }): boolean {
    const patterns = options?.patterns ?? DEFAULT_REVERT_PATTERNS;
    return patterns.some((pattern) => pattern.test(comment));
  },

  /**
   * Runs of consecutive reverting revisions. A revision reverts when its edit
   * summary matches a revert pattern or its text restores an earlier
   * revision's (findIdentityReverts). Reverts are consecutive when no other
   * revision of the page falls between them; revision IDs are numbered across
   * the whole wiki, so they are not compared with each other.
   */
  detectRevertChain(revisions: Revision[], options?: { patterns?: RegExp[] }): RevertChain[] {
    const sorted = byTimestamp(revisions);
    const restores = findIdentityReverts(sorted);
    const chains: RevertChain[] = [];
    let current: RevertChain | undefined;
    let lastIndex = -2;

    sorted.forEach((rev, index) => {
      const restored = restores.get(rev.revId);
      if (restored === undefined && !this.isRevert(rev.comment, options)) return;

      if (current && index === lastIndex + 1) {
        current.endRevisionId = rev.revId;
        current.participants++;
      } else {
        const named = rev.comment.match(RESTORED_REVISION);
        const undone = rev.comment.match(UNDONE_REVISION);
        const revertedTo = restored ?? (named ? Number.parseInt(named[1], 10) : undefined);
        current = {
          startRevisionId: rev.revId,
          endRevisionId: rev.revId,
          ...(revertedTo !== undefined ? { revertedToRevisionId: revertedTo } : {}),
          ...(undone ? { undoneRevisionId: Number.parseInt(undone[1], 10) } : {}),
          participants: 1,
        };
        chains.push(current);
      }
      lastIndex = index;
    });

    return chains;
  },
};
