/**
 * Reads several revisions in one request, returning what the search tests for
 * each: lead text, a definition head, a whole page. A revision missing from
 * the map is tested as `undefined`. A client's batched section read fits as
 * it is: `(ids) => client.fetchSections(ids, 0)` for leads.
 */
export type BatchFetcher<T> = (revisionIds: number[]) => Promise<ReadonlyMap<number, T>>;

export interface LocateChangeOptions {
  /** Candidates read per round, in one call to the fetcher. Default 8. */
  k?: number;
}

export interface LocatedChange<T> {
  /** The first candidate `isNew` accepted. */
  revisionId: number;
  /** Its position in `candidates`. */
  index: number;
  /** What the fetcher returned for it, so a caller can quote the edit's own wording. */
  value: T | undefined;
  /** The candidate before it, which `isNew` rejected. Absent when the first candidate is the change. */
  previousRevisionId?: number;
  /** Calls made to the fetcher. */
  requests: number;
}

/**
 * The first of `candidates` for which `isNew` holds: the edit that introduced
 * a wording, found between two sampled revisions that bracket it.
 *
 * `candidates` are the revision IDs between the two samples, oldest first,
 * with reverted states already removed (`findRevertedStates` in
 * `@refract-org/ingestion` finds them from `sha1`). Each round reads up to `k`
 * evenly spaced candidates in one call to `fetchLeads` and narrows the range
 * (k+1)-fold, so 300 candidates take three calls at the default `k` of 8.
 * Undefined when there are no candidates or none is new: then the later
 * sample itself, if it is new, is the change.
 *
 * It assumes the change happens once within the bracket: `isNew` is false up
 * to some candidate and true from there on. If the wording came and went in
 * between, the search lands on one of the edits that brought it, not
 * necessarily the first. A reverted state left in the candidates breaks the
 * assumption the same way, which is why they are removed first.
 *
 * Test for the new version, not for the end of the old one. Dating
 * definitions on ism.wiki, two other tests both landed on intermediate drafts
 * whose text did not match the version being dated: "the old wording is gone"
 * and "closer to the new wording than the old". Asking whether a candidate
 * has the new version's wording (sameWording against it, for instance) finds
 * the edit whose text the dated version quotes.
 *
 * The fetcher is passed in, so this module reads no network; a Worker or any
 * other caller supplies the requests.
 */
export async function locateChange<T = string | null>(
  candidates: readonly number[],
  isNew: (value: T | undefined, revisionId: number) => boolean,
  fetchLeads: BatchFetcher<T>,
  options: LocateChangeOptions = {},
): Promise<LocatedChange<T> | undefined> {
  const k = options.k ?? 8;
  if (!Number.isSafeInteger(k) || k < 1) throw new RangeError("k must be a positive integer.");
  // lo is the last candidate known to be old and hi the first known to be
  // new; hi starts one past the end, where the later sample stands.
  let lo = -1;
  let hi = candidates.length;
  let found: T | undefined;
  let requests = 0;
  while (hi - lo > 1) {
    const span = hi - lo;
    const probes = [
      ...new Set(Array.from({ length: k }, (_, j) => lo + Math.round((span * (j + 1)) / (k + 1)))),
    ].filter((i) => i > lo && i < hi);
    const values = await fetchLeads(probes.map((i) => candidates[i]));
    requests++;
    // Probes run oldest first, so the first new one bounds the change from above.
    for (const i of probes) {
      const value = values.get(candidates[i]);
      if (isNew(value, candidates[i])) {
        hi = i;
        found = value;
        break;
      }
      lo = i;
    }
  }
  if (hi === candidates.length) return undefined;
  return {
    revisionId: candidates[hi],
    index: hi,
    value: found,
    ...(hi > 0 ? { previousRevisionId: candidates[hi - 1] } : {}),
    requests,
  };
}
